#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';

const SCHEMA = 'kaminos.structural-material.camera-browser-witness.v0';
const CAMERA_AUTHORITY = 'operator-camera-controls-v0';

function usage() {
  return [
    'Usage: node structural-material-3d-camera-witness.mjs',
    '  --url <served structural-material-3d.html URL>',
    '  --out <report.json>',
    '  --screenshot <capture.png>',
    '  [--debug-port 9223] [--width 1280] [--height 820]',
    '  [--device-scale-factor 1] [--load-timeout-ms 30000]',
  ].join('\n');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    values.set(token.slice(2), value);
    index += 1;
  }
  for (const required of ['url', 'out', 'screenshot']) {
    if (!values.has(required)) throw new Error(`missing required --${required}`);
  }
  const number = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };
  return {
    help: false,
    url: values.get('url'),
    out: resolve(values.get('out')),
    screenshot: resolve(values.get('screenshot')),
    debugPort: number('debug-port', 9223),
    width: number('width', 1280),
    height: number('height', 820),
    deviceScaleFactor: number('device-scale-factor', 1),
    loadTimeoutMs: number('load-timeout-ms', 30000),
  };
}

async function connectCdp(debugPort) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error(`no page target on CDP port ${debugPort}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
      else handlers.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(
        message.params.exceptionDetails.exception?.description ||
        message.params.exceptionDetails.text,
      );
    }
  });

  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  };
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { socket, send, evaluate, runtimeErrors };
}

function sameState(a, b) {
  return JSON.stringify(a.state) === JSON.stringify(b.state);
}

function distance(cameraWitness) {
  return Math.hypot(...cameraWitness.state.position);
}

function targetDistance(a, b) {
  return Math.hypot(...a.state.target.map((value, index) => value - b.state.target[index]));
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${usage()}`);
  process.exit(2);
}
if (config.help) {
  console.log(usage());
  process.exit(0);
}

const report = {
  schema: SCHEMA,
  status: 'failed',
  failurePhase: 'configuration',
  requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectiveRoute: null,
  requestedCameraAuthority: CAMERA_AUTHORITY,
  effectiveCameraAuthority: null,
  requestedConfig: {
    url: config.url,
    debugPort: config.debugPort,
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
    loadTimeoutMs: config.loadTimeoutMs,
    reportPath: config.out,
    screenshotPath: config.screenshot,
  },
  effectiveConfig: null,
  checks: {},
  pixelProbe: null,
  runtimeErrors: [],
  lastTrustworthyEvidence: null,
  error: null,
};

let cdp;
try {
  report.failurePhase = 'cdp-connect';
  cdp = await connectCdp(config.debugPort);
  const { send, evaluate } = cdp;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
    mobile: false,
  });
  report.effectiveConfig = {
    url: config.url,
    debugPort: config.debugPort,
    loadTimeoutMs: config.loadTimeoutMs,
    initialViewport: {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.deviceScaleFactor,
    },
    reportPath: config.out,
    screenshotPath: config.screenshot,
    browserTarget: 'first-page-target',
  };

  report.failurePhase = 'page-load';
  cdp.runtimeErrors.length = 0;
  await send('Page.navigate', { url: config.url });
  const loadDeadline = Date.now() + config.loadTimeoutMs;
  while (Date.now() < loadDeadline) {
    if (await evaluate("typeof window.__structuralMaterial3dCameraWitness === 'function'")) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assertCheck(
    await evaluate("typeof window.__structuralMaterial3dCameraWitness === 'function'"),
    `camera witness did not load within ${config.loadTimeoutMs} ms`,
  );
  const canvasRect = await evaluate(`(() => {
    const rect = document.querySelector('#stage canvas')?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  })()`);
  assertCheck(canvasRect?.width > 0 && canvasRect?.height > 0, 'render canvas has no usable bounds');
  report.lastTrustworthyEvidence = { phase: 'page-load', canvasRect };

  report.failurePhase = 'route-identity';
  const initialStructural = await evaluate('window.__structuralMaterial3dWitness()');
  const initialCamera = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.effectiveRoute = initialStructural.effectiveRoute;
  report.effectiveCameraAuthority = initialCamera.authority;
  report.checks.routeIdentity = initialStructural.effectiveRoute === STRUCTURAL_MATERIAL_3D_ROUTE;
  report.checks.cameraAuthority = initialCamera.authority === CAMERA_AUTHORITY;
  assertCheck(report.checks.routeIdentity, `effective route mismatch: ${initialStructural.effectiveRoute}`);
  assertCheck(report.checks.cameraAuthority, `camera authority mismatch: ${initialCamera.authority}`);

  const point = (xRatio, yRatio) => ({
    x: canvasRect.left + canvasRect.width * xRatio,
    y: canvasRect.top + canvasRect.height * yRatio,
  });

  report.failurePhase = 'idle-pointer';
  for (const position of [point(0.15, 0.2), point(0.8, 0.72)]) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  }
  const afterIdleMove = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.checks.idlePointerPreservedCamera = sameState(initialCamera, afterIdleMove);
  assertCheck(report.checks.idlePointerPreservedCamera, 'idle pointer motion changed camera state');

  report.failurePhase = 'structural-buttons';
  const buttonIsolation = await evaluate('window.__structuralMaterial3dCameraIsolationSmoke()');
  report.checks.buttonIsolationPassed = buttonIsolation.ok;
  assertCheck(buttonIsolation.ok, 'Reset/Shear/Bind changed camera state');

  report.failurePhase = 'material-drag';
  const beforeMaterialDrag = await evaluate('window.__structuralMaterial3dCameraWitness()');
  const initialPickTarget = await evaluate('window.__structuralMaterial3dPickTarget()');
  assertCheck(initialPickTarget, 'page exposed no projected structural pick target');
  const dragStart = { x: initialPickTarget.clientX, y: initialPickTarget.clientY };
  const dragEnd = { x: dragStart.x + canvasRect.width * 0.2, y: dragStart.y + canvasRect.height * 0.08 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...dragStart, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dragEnd, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...dragEnd, button: 'left', buttons: 0, clickCount: 1 });
  const afterMaterialDrag = await evaluate('window.__structuralMaterial3dCameraWitness()');
  const structuralAfterDrag = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.materialDragPreservedCamera = sameState(beforeMaterialDrag, afterMaterialDrag);
  report.checks.materialDragProducedForce = structuralAfterDrag.forceEnvelope?.dragLength > 0;
  report.checks.materialDragWasPicked = structuralAfterDrag.interactionDiagnostics?.pick !== null;
  assertCheck(report.checks.materialDragPreservedCamera, 'material drag changed camera state');
  assertCheck(report.checks.materialDragProducedForce, 'material drag produced no force envelope');
  assertCheck(report.checks.materialDragWasPicked, 'material drag lacked a structural pick receipt');

  report.failurePhase = 'background-primary-orbit';
  const missCandidates = [point(0.06, 0.9), point(0.94, 0.9), point(0.06, 0.16), point(0.94, 0.16)];
  let orbitStart = null;
  for (const candidate of missCandidates) {
    const hit = await evaluate(`window.__structuralMaterial3dPickProbe(${candidate.x}, ${candidate.y})`);
    if (!hit) {
      orbitStart = candidate;
      break;
    }
  }
  assertCheck(orbitStart, 'no empty-canvas orbit start could be proven by the page picker');
  const orbitEnd = { x: orbitStart.x + canvasRect.width * 0.16, y: orbitStart.y - canvasRect.height * 0.12 };
  const forceBeforeOrbit = JSON.stringify(structuralAfterDrag.forceEnvelope);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...orbitStart, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...orbitEnd, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...orbitEnd, button: 'left', buttons: 0, clickCount: 1 });
  const afterOrbit = await evaluate('window.__structuralMaterial3dCameraWitness()');
  const structuralAfterOrbit = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.orbitChangedCamera = !sameState(afterMaterialDrag, afterOrbit);
  report.checks.backgroundDragAuthoredNoForce = JSON.stringify(structuralAfterOrbit.forceEnvelope) === forceBeforeOrbit &&
    structuralAfterOrbit.liveDrag?.pointerActive === false;
  assertCheck(report.checks.orbitChangedCamera, 'primary drag on proven empty canvas did not orbit the camera');
  assertCheck(report.checks.backgroundDragAuthoredNoForce, 'empty-canvas camera drag authored a material force');

  report.failurePhase = 'post-orbit-material-drag';
  const postOrbitPickTarget = await evaluate('window.__structuralMaterial3dPickTarget()');
  assertCheck(postOrbitPickTarget, 'post-orbit view exposed no projected structural pick target');
  const postOrbitDragStart = { x: postOrbitPickTarget.clientX, y: postOrbitPickTarget.clientY };
  const postOrbitDragEnd = { x: postOrbitDragStart.x + canvasRect.width * 0.2, y: postOrbitDragStart.y };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...postOrbitDragStart, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...postOrbitDragEnd, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...postOrbitDragEnd, button: 'left', buttons: 0, clickCount: 1 });
  const postOrbitStructural = await evaluate('window.__structuralMaterial3dWitness()');
  const postOrbitCamera = await evaluate('window.__structuralMaterial3dCameraWitness()');
  const postOrbitForce = postOrbitStructural.forceEnvelope;
  const basisRight = postOrbitForce?.screenBasis?.right;
  const direction = postOrbitForce?.vector;
  const cameraRelativeDot = basisRight && direction
    ? basisRight.x * direction.x + basisRight.y * direction.y + basisRight.z * direction.z
    : -1;
  report.checks.postOrbitMaterialPreservedCamera = sameState(afterOrbit, postOrbitCamera);
  report.checks.postOrbitForceFollowedCamera = cameraRelativeDot > 0.999;
  report.checks.postOrbitContactStayedPicked = JSON.stringify(postOrbitForce?.point) ===
    JSON.stringify(postOrbitStructural.interactionDiagnostics?.pick?.point);
  report.postOrbitInteraction = {
    pick: postOrbitStructural.interactionDiagnostics?.pick,
    forceEnvelope: postOrbitForce,
    cameraRelativeDot,
  };
  assertCheck(report.checks.postOrbitMaterialPreservedCamera, 'post-orbit material drag changed the camera');
  assertCheck(report.checks.postOrbitForceFollowedCamera, `post-orbit force missed current camera-right basis: dot ${cameraRelativeDot}`);
  assertCheck(report.checks.postOrbitContactStayedPicked, 'post-orbit force moved away from the picked structural contact');

  report.failurePhase = 'camera-pan';
  const panStart = point(0.62, 0.54);
  const panEnd = point(0.69, 0.48);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...panStart, button: 'middle', buttons: 4, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...panEnd, button: 'middle', buttons: 4 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...panEnd, button: 'middle', buttons: 0, clickCount: 1 });
  const afterPan = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.checks.panChangedTarget = targetDistance(postOrbitCamera, afterPan) > 1e-5;
  assertCheck(report.checks.panChangedTarget, 'auxiliary drag did not pan the camera target');

  report.failurePhase = 'post-camera-isolation';
  const postCameraIsolation = await evaluate('window.__structuralMaterial3dCameraIsolationSmoke()');
  const afterPostCameraActions = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.checks.postCameraActionsPreservedCamera = postCameraIsolation.ok && sameState(afterPan, afterPostCameraActions);
  assertCheck(report.checks.postCameraActionsPreservedCamera, 'structural buttons changed the operator-adjusted camera');

  report.failurePhase = 'camera-zoom';
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point(0.55, 0.52), deltaX: 0, deltaY: -240 });
  const afterZoom = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.checks.zoomChangedDistance = Math.abs(distance(afterZoom) - distance(afterPostCameraActions)) > 0.01;
  assertCheck(report.checks.zoomChangedDistance, 'wheel input did not zoom the camera');

  report.failurePhase = 'viewport-resize';
  const beforeResize = afterZoom;
  const resizeViewport = {
    width: Math.max(320, Math.round(config.width * 0.84)),
    height: Math.max(280, Math.round(config.height * 0.9)),
    deviceScaleFactor: config.deviceScaleFactor,
  };
  await send('Emulation.setDeviceMetricsOverride', {
    ...resizeViewport,
    mobile: false,
  });
  report.effectiveConfig.resizeProbeViewport = resizeViewport;
  await new Promise(resolveWait => setTimeout(resolveWait, 100));
  const afterResize = await evaluate('window.__structuralMaterial3dCameraWitness()');
  report.checks.resizePreservedCamera = sameState(beforeResize, afterResize);
  assertCheck(report.checks.resizePreservedCamera, 'viewport resize changed operator camera state');

  report.failurePhase = 'visual-evidence';
  report.effectiveConfig.captureViewport = await evaluate('({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })');
  report.pixelProbe = await evaluate('window.__structuralMaterial3dPixelProbe()', true);
  assertCheck(report.pixelProbe?.ok && report.pixelProbe.nonDarkPixels > 0, 'visual pixel probe is blank or partial');
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(capture.data, 'base64'));
  report.checks.screenshotWritten = true;

  report.runtimeErrors = cdp.runtimeErrors.slice();
  report.checks.noRuntimeErrors = report.runtimeErrors.length === 0;
  report.checks.noCameraInvariantViolations = afterResize.invariantViolationCount === 0;
  assertCheck(report.checks.noRuntimeErrors, `browser emitted runtime errors: ${report.runtimeErrors.join('; ')}`);
  assertCheck(report.checks.noCameraInvariantViolations, 'camera invariant violations were recorded');

  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = {
    phase: 'visual-evidence',
    pixelProbe: report.pixelProbe,
    screenshotPath: config.screenshot,
  };
} catch (error) {
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if (cdp) report.runtimeErrors = cdp.runtimeErrors.slice();
  process.exitCode = 1;
} finally {
  cdp?.socket.close();
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
