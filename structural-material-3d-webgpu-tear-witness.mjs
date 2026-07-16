#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE } from './structural-material-3d-webgpu-hot-sidecar.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE } from './structural-material-3d-webgpu-tear.js';

const SCHEMA = 'kaminos.structural-material.webgpu-sympathetic-tear-browser-witness.v0';
const BODY_MARKER = 'Kaminos Layered Structural Sidecar';

function usage() {
  return [
    'Usage: node structural-material-3d-webgpu-tear-witness.mjs',
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
      runtimeErrors.push(message.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }));
  };
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  return { socket, send, evaluate, runtimeErrors };
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function probeScreenshotPixels(evaluate, pngBase64) {
  return evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${pngBase64}';
    await image.decode();
    const crop = {
      x: Math.floor(image.naturalWidth * 0.08),
      y: Math.floor(image.naturalHeight * 0.12),
      width: Math.floor(image.naturalWidth * 0.84),
      height: Math.floor(image.naturalHeight * 0.76),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonDarkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (Math.max(red, green, blue) > 48 && red + green + blue > 100) nonDarkPixels += 1;
    }
    return {
      source: 'actual-cdp-screenshot-pixels',
      width: image.naturalWidth,
      height: image.naturalHeight,
      sampleWidth: canvas.width,
      sampleHeight: canvas.height,
      crop,
      nonDarkPixels,
    };
  })()`, true);
}

async function captureVisibleScreenshot(send, evaluate, timeoutMs) {
  const visualDeadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  const attempts = [];
  while (Date.now() < visualDeadline) {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const probe = await probeScreenshotPixels(evaluate, capture.data);
    attempts.push({
      attempt: attempts.length + 1,
      elapsedMs: Date.now() - startedAt,
      nonDarkPixels: probe.nonDarkPixels,
    });
    if (probe.nonDarkPixels >= 24) {
      return {
        capture,
        probe: {
          ...probe,
          minimumNonDarkPixels: 24,
          attempts,
        },
      };
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `actual screenshot remained blank for ${attempts.length} attempts within ${timeoutMs} ms`,
  );
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
  requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectivePageRoute: null,
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  effectiveRoute: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
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
  browserVersion: null,
  unnotchedControl: null,
  notchedTear: null,
  visibleTear: null,
  checks: {},
  pixelProbe: null,
  screenshotPixelProbe: null,
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
  report.browserVersion = await send('Browser.getVersion');
  await send('Emulation.setDeviceMetricsOverride', {
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
    mobile: false,
  });
  report.effectiveConfig = {
    url: config.url,
    debugPort: config.debugPort,
    viewport: {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.deviceScaleFactor,
    },
    reportPath: config.out,
    screenshotPath: config.screenshot,
    browserTarget: 'first-page-target',
  };

  report.failurePhase = 'page-load';
  await send('Page.navigate', { url: config.url });
  const loadDeadline = Date.now() + config.loadTimeoutMs;
  while (Date.now() < loadDeadline) {
    if (await evaluate("typeof window.__structuralMaterial3dRunGpuSympatheticTear === 'function'")) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assertCheck(
    await evaluate("typeof window.__structuralMaterial3dRunGpuSympatheticTear === 'function'"),
    `GPU sympathetic tear route did not load within ${config.loadTimeoutMs} ms`,
  );
  report.checks.bodyIdentity = await evaluate(`document.title === ${JSON.stringify(BODY_MARKER)}`);
  assertCheck(report.checks.bodyIdentity, 'effective body identity mismatch');
  const pageBefore = await evaluate('window.__structuralMaterial3dWitness()');
  report.effectivePageRoute = pageBefore.effectiveRoute;
  report.checks.pageRouteIdentity = pageBefore.effectiveRoute === STRUCTURAL_MATERIAL_3D_ROUTE;
  assertCheck(report.checks.pageRouteIdentity, `effective page route mismatch: ${pageBefore.effectiveRoute}`);
  const cameraBefore = await evaluate('window.__structuralMaterial3dCameraWitness().state');
  report.lastTrustworthyEvidence = {
    phase: 'page-load',
    effectivePageRoute: report.effectivePageRoute,
    cameraAuthority: pageBefore.cameraControlAuthority,
  };

  report.failurePhase = 'effigy-drag';
  const stageRect = await evaluate(`(() => {
    const rect = document.querySelector('#stage').getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })()`);
  const dragStart = {
    x: stageRect.left + stageRect.width * 0.54,
    y: stageRect.top + stageRect.height * 0.52,
  };
  const dragEnd = {
    x: stageRect.left + stageRect.width * 0.92,
    y: stageRect.top + stageRect.height * 0.52,
  };
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...dragStart,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...dragEnd,
    button: 'left',
    buttons: 1,
  });
  const dragged = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.effigyDragProducedForce = dragged.forceEnvelope?.dragLength > 0.3 &&
    dragged.forceEnvelope?.magnitude > 1;
  assertCheck(report.checks.effigyDragProducedForce, 'effigy drag did not produce a structural force envelope');

  report.failurePhase = 'unnotched-control';
  const unnotched = await evaluate(
    `window.__structuralMaterial3dRunGpuSympatheticTear({
      notch: false,
      applyToWorld: false,
      interaction: ${JSON.stringify(dragged.forceEnvelope)}
    })`,
    true,
  );
  report.unnotchedControl = unnotched;
  report.checks.unnotchedRouteIdentity = unnotched.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE;
  report.checks.unnotchedStayedConnected = unnotched.status === 'passed' &&
    unnotched.topology?.parity?.ok === true &&
    unnotched.topology?.componentCount === 1 &&
    unnotched.topology?.detachedComponentLabels?.length === 0;
  assertCheck(report.checks.unnotchedRouteIdentity, 'unnotched control used the wrong effective route');
  assertCheck(report.checks.unnotchedStayedConnected, 'unnotched same-force control separated');

  report.failurePhase = 'notched-gpu-tear';
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...dragEnd,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  const tearDeadline = Date.now() + config.loadTimeoutMs;
  while (Date.now() < tearDeadline) {
    const completed = await evaluate(`(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.gpuSympatheticTear?.status === 'passed' && witness.visibleTear !== null;
    })()`);
    if (completed) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  const pageAfter = await evaluate('window.__structuralMaterial3dWitness()');
  const notched = pageAfter.gpuSympatheticTear;
  assertCheck(notched?.status === 'passed', 'click-drag release did not complete a passing GPU tear');
  report.notchedTear = notched;
  report.effectiveRoute = notched.effectiveRoute;
  report.effectiveBackend = notched.effectiveBackend;
  report.cpuFallbackUsed = notched.cpuFallbackUsed;
  report.visibleTear = pageAfter.visibleTear;
  const cameraAfter = await evaluate('window.__structuralMaterial3dCameraWitness().state');

  report.checks.gpuStatusPassed = notched.status === 'passed';
  report.checks.routeIdentity = notched.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE;
  report.checks.backendIdentity = notched.effectiveBackend === 'webgpu';
  report.checks.noCpuFallback = notched.cpuFallbackUsed === false;
  report.checks.noFallbackAdapter = notched.adapter?.isFallbackAdapter === false;
  report.checks.sequenceIdentity = notched.requestedSequenceIdentity === notched.effectiveSequenceIdentity;
  report.checks.interactiveValidation = notched.interactiveValidation?.ok === true;
  report.checks.hotExecutionRoute = notched.executionRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE;
  report.checks.oneDevice = notched.lifecycle?.deviceRequestCount === 1;
  report.checks.twoPipelines = notched.lifecycle?.pipelineCreateCount === 2;
  report.checks.persistentBuffers = notched.lifecycle?.bufferAllocationCount === 9;
  report.checks.compactReadback = notched.lifecycle?.compactReadbackCount === 1 &&
    notched.lifecycle?.compactReadbackBufferCount === 2 &&
    notched.lifecycle?.fullValidationReadbackCount === 0;
  report.checks.topologyDispatchCount = notched.lifecycle?.topologyDispatchCount ===
    notched.gpuStructuralState?.componentLabels?.length;
  report.checks.warmTimingNamed = Number.isFinite(notched.timingsMs?.warmTotal);
  report.checks.hotResidency = notched.lifecycle?.disposed === false &&
    notched.lifecycle?.bufferDestroyCount === 0 &&
    notched.lifecycle?.deviceDestroyCount === 0;
  const brokenLiveness = notched.gpuStructuralState?.finalBondLiveness?.filter(alive => !alive).length || 0;
  report.checks.notchedSeparated = notched.topology?.componentCount >= 2 &&
    notched.topology?.detachedComponentLabels?.length >= 1 &&
    brokenLiveness > 0;
  report.checks.notchedControlDiscriminates = report.checks.notchedSeparated &&
    report.checks.unnotchedStayedConnected &&
    notched.effectiveSequenceIdentity === unnotched.effectiveSequenceIdentity;
  report.checks.cameraPreserved = JSON.stringify(cameraBefore) === JSON.stringify(cameraAfter);

  const visibleComponents = pageAfter.visibleTear?.components || [];
  const visibleLabels = visibleComponents.map(component => component.label).sort((a, b) => a - b);
  const gpuLabels = [...new Set(notched.gpuStructuralState?.componentLabels || [])].sort((a, b) => a - b);
  const anchoredVisible = visibleComponents.filter(component => component.pinned);
  const detachedVisible = visibleComponents.filter(component => !component.pinned);
  report.checks.visibleTransformBoundToGpuLabels = pageAfter.sympatheticTear?.effectiveRoute === notched.effectiveRoute &&
    pageAfter.sympatheticTear?.effectiveSequenceIdentity === notched.effectiveSequenceIdentity &&
    JSON.stringify(visibleLabels) === JSON.stringify(gpuLabels) &&
    anchoredVisible.length === 1 &&
    anchoredVisible[0].maxDisplacement < 0.000001 &&
    detachedVisible.length >= 1 &&
    detachedVisible.every(component => component.minDirectionDot > 0);

  for (const [name, passed] of Object.entries(report.checks)) {
    assertCheck(passed, `GPU sympathetic tear check failed: ${name}; ${notched.error?.message || 'no execution error'}`);
  }
  report.lastTrustworthyEvidence = {
    phase: 'notched-gpu-tear',
    effectiveRoute: report.effectiveRoute,
    effectiveSequenceIdentity: notched.effectiveSequenceIdentity,
    topology: notched.topology,
    visibleTear: pageAfter.visibleTear,
  };

  report.failurePhase = 'release-persistence';
  await evaluate('new Promise(resolve => setTimeout(resolve, 150))', true);
  const persisted = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.releasePreservedSeparation = JSON.stringify(persisted.visibleTear) === JSON.stringify(pageAfter.visibleTear) &&
    persisted.summary.componentCount === pageAfter.summary.componentCount &&
    persisted.summary.brokenBondCount === pageAfter.summary.brokenBondCount;
  assertCheck(report.checks.releasePreservedSeparation, 'release did not preserve the GPU-authored separation');

  report.failurePhase = 'visual-evidence';
  report.pixelProbe = await evaluate('window.__structuralMaterial3dPixelProbe()', true);
  assertCheck(report.pixelProbe?.ok && report.pixelProbe.nonDarkPixels > 0, 'visual pixel probe is blank');
  const screenshotEvidence = await captureVisibleScreenshot(send, evaluate, config.loadTimeoutMs);
  const capture = screenshotEvidence.capture;
  report.screenshotPixelProbe = screenshotEvidence.probe;
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(capture.data, 'base64'));
  report.checks.screenshotWritten = report.screenshotPixelProbe.nonDarkPixels >=
    report.screenshotPixelProbe.minimumNonDarkPixels;
  report.checks.routeStatusVisible = await evaluate(`(() => {
    const status = document.querySelector('#gpu-status');
    return status?.textContent.includes('GPU tear passed') && status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE)};
  })()`);
  report.checks.noHorizontalOverflow = await evaluate('document.documentElement.scrollWidth === document.documentElement.clientWidth');
  assertCheck(report.checks.routeStatusVisible, 'operator-visible GPU tear status lacks effective-route identity');
  assertCheck(report.checks.noHorizontalOverflow, 'GPU tear route has horizontal overflow');

  report.failurePhase = 'reset';
  await evaluate("document.querySelector('#reset').click()");
  const reset = await evaluate('window.__structuralMaterial3dWitness()');
  const cameraReset = await evaluate('window.__structuralMaterial3dCameraWitness().state');
  report.checks.resetRestoredTopology = reset.summary.brokenBondCount === 0 &&
    reset.summary.componentCount === 1 &&
    reset.visibleTear === null;
  report.checks.resetPreservedCamera = JSON.stringify(cameraAfter) === JSON.stringify(cameraReset);
  assertCheck(report.checks.resetRestoredTopology, 'reset did not restore pristine topology');
  assertCheck(report.checks.resetPreservedCamera, 'reset changed operator camera state');

  report.runtimeErrors = cdp.runtimeErrors.slice();
  report.checks.noRuntimeErrors = report.runtimeErrors.length === 0;
  assertCheck(report.checks.noRuntimeErrors, `browser emitted runtime errors: ${report.runtimeErrors.join('; ')}`);
  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = {
    phase: 'visual-evidence',
    effectiveRoute: report.effectiveRoute,
    effectiveSequenceIdentity: notched.effectiveSequenceIdentity,
    visibleTear: report.visibleTear,
    pixelProbe: report.pixelProbe,
    screenshotPixelProbe: report.screenshotPixelProbe,
    screenshotPath: config.screenshot,
  };
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  if (cdp) report.runtimeErrors = cdp.runtimeErrors.slice();
  process.exitCode = 1;
} finally {
  cdp?.socket.close();
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
