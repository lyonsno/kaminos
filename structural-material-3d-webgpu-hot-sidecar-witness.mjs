#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
} from './structural-material-3d-webgpu-hot-sidecar.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE } from './structural-material-3d-webgpu-tear.js';
import {
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
} from './structural-material-3d-resident-solver.js';
import {
  STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE,
  STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_ROUTE,
  STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE,
} from './structural-material-3d-sympathetic-citadel.js';
import {
  STRUCTURAL_ASSET_SIDECAR_AUTHORITY,
  STRUCTURAL_ASSET_SIDECAR_ROUTE,
} from './structural-material-3d-asset-sidecar.js';
import {
  STRUCTURAL_BELL_RING_AUTHORITY,
  STRUCTURAL_BELL_TOWER_AUTHORITY,
  STRUCTURAL_BELL_TOWER_ROUTE,
} from './structural-material-3d-bell-tower.js';

const SCHEMA = 'kaminos.structural-material.webgpu-hot-sidecar-browser-witness.v0';
const BODY_MARKER = 'Kaminos Layered Structural Sidecar';

function usage() {
  return [
    'Usage: node structural-material-3d-webgpu-hot-sidecar-witness.mjs',
    '  --url <served structural-material-3d.html URL>',
    '  --out <report.json>',
    '  --screenshot <capture.png>',
    '  [--debug-port 9224] [--width 1280] [--height 820]',
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
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
    return value;
  };
  return {
    help: false,
    url: values.get('url'),
    out: resolve(values.get('out')),
    screenshot: resolve(values.get('screenshot')),
    debugPort: number('debug-port', 9224),
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
      runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => pending.set(id, {
      resolve: resolveSend,
      reject: rejectSend,
    }));
  };
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  };
  return { socket, send, evaluate, runtimeErrors };
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function probeScreenshot(evaluate, pngBase64) {
  return evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${pngBase64}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(
      image,
      image.naturalWidth * 0.08,
      image.naturalHeight * 0.12,
      image.naturalWidth * 0.84,
      image.naturalHeight * 0.76,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonDarkPixels = 0;
    let structuralColorPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (Math.max(red, green, blue) > 48 && red + green + blue > 100) nonDarkPixels += 1;
      if (Math.max(red, green, blue) > 90 && Math.max(red, green, blue) - Math.min(red, green, blue) > 38) {
        structuralColorPixels += 1;
      }
    }
    return {
      source: 'actualScreenshotPixels',
      width: image.naturalWidth,
      height: image.naturalHeight,
      sampleWidth: canvas.width,
      sampleHeight: canvas.height,
      nonDarkPixels,
      structuralColorPixels,
    };
  })()`, true);
}

async function captureVisibleScreenshot(send, evaluate, timeoutMs, {
  minimumNonDarkPixels = 500,
  minimumStructuralColorPixels = 180,
  visualState = 'fractured-structural-material',
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  let lastCapture = null;
  let lastProbe = null;
  while (Date.now() < deadline) {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const probe = await probeScreenshot(evaluate, capture.data);
    lastCapture = capture;
    lastProbe = probe;
    attempts.push({
      attempt: attempts.length + 1,
      nonDarkPixels: probe.nonDarkPixels,
      structuralColorPixels: probe.structuralColorPixels,
    });
    if (probe.nonDarkPixels >= minimumNonDarkPixels &&
        probe.structuralColorPixels >= minimumStructuralColorPixels) {
      return {
        capture,
        probe: {
          ...probe,
          visualState,
          minimumNonDarkPixels,
          minimumStructuralColorPixels,
          attempts,
          ok: true,
        },
      };
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  return {
    capture: lastCapture,
    probe: {
      ...lastProbe,
      visualState,
      minimumNonDarkPixels,
      minimumStructuralColorPixels,
      attempts,
      ok: false,
      failure: `screenshot missed ${visualState} pixel thresholds after ${attempts.length} attempts`,
    },
  };
}

async function waitUntil(evaluate, expression, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error(message);
}

async function dispatchProjectedStructuralDrag(send, evaluate, rect) {
  const target = await evaluate('window.__structuralMaterial3dPickTarget()');
  assertCheck(target, 'live sidecar route exposed no projected structural pick target');
  const start = { x: target.clientX, y: target.clientY };
  const end = {
    x: Math.min(rect.left + rect.width - 2, start.x + rect.width * 0.3),
    y: start.y,
  };
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...end, button: 'left', buttons: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function dispatchPointerClick(send, evaluate, selector) {
  const point = await evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  assertCheck(point, `pointer click target ${selector} was unavailable`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function beginProjectedStructuralDrag(send, target, rect) {
  const start = { x: target.clientX, y: target.clientY };
  const end = {
    x: Math.min(rect.left + rect.width - 2, start.x + rect.width * 0.36),
    y: start.y,
  };
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...end, button: 'left', buttons: 1,
  });
  return { start, end };
}

async function releaseProjectedStructuralDrag(send, end) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1,
  });
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
const requestedUrl = new URL(config.url);
const bellTowerRequested = requestedUrl.searchParams.get('bellTower') === '1';
const sympatheticCitadelRequested =
  requestedUrl.searchParams.get('sympatheticCitadel') === '1' || bellTowerRequested;

const report = {
  schema: SCHEMA,
  status: 'failed',
  failurePhase: 'configuration',
  requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectivePageRoute: null,
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  effectiveRoute: null,
  requestedSolverRoute: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
  effectiveSolverRoute: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
  requestedConfig: { ...config },
  effectiveConfig: null,
  isolatedSequence: null,
  liveFirst: null,
  liveSecond: null,
  liveTearAcceptance: null,
  shearPreviewHeldGpuSamples: [],
  shearPreviewDuringHeldGpuExecution: null,
  shearPreviewScreenshot: null,
  shearAcceptedScreenshot: null,
  sympatheticCitadelRequested,
  bellTowerRequested,
  sympatheticCitadelInitial: null,
  sympatheticCitadelHeld: null,
  sympatheticCitadelAccepted: null,
  bellTowerInitial: null,
  bellTowerAccepted: null,
  modeSelection: null,
  liveBinding: null,
  checks: {},
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
  await waitUntil(
    evaluate,
    "typeof window.__structuralMaterial3dRunHotSidecarWitness === 'function'",
    config.loadTimeoutMs,
    `hot sidecar route did not load within ${config.loadTimeoutMs} ms`,
  );
  const pageBefore = await evaluate('window.__structuralMaterial3dWitness()');
  report.effectivePageRoute = pageBefore.effectiveRoute;
  report.checks.bodyIdentity = await evaluate(`document.title === ${JSON.stringify(BODY_MARKER)}`);
  report.checks.pageRouteIdentity = pageBefore.effectiveRoute === STRUCTURAL_MATERIAL_3D_ROUTE;
  assertCheck(report.checks.bodyIdentity, 'effective body identity mismatch');
  assertCheck(report.checks.pageRouteIdentity, 'effective page route mismatch');
  if (sympatheticCitadelRequested) {
    report.sympatheticCitadelInitial = pageBefore.sympatheticCitadel;
    const projection = pageBefore.sympatheticCitadel;
    const expectedTopologyProfile = bellTowerRequested
      ? 'three-turret-bell-citadel-v0'
      : 'three-turret-citadel-v0';
    report.checks.sympatheticCitadelInitialIdentity =
      projection?.status === 'passed' &&
      projection.route === STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_ROUTE &&
      projection.topologyProfile === expectedTopologyProfile &&
      projection.consumers?.effigy?.route === STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE &&
      projection.consumers?.citadel?.route === STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE &&
      projection.consumers.effigy.acceptedState.structuralFingerprint ===
        projection.consumers.citadel.acceptedState.structuralFingerprint &&
      projection.acceptedSurfaceCorrespondence === true &&
      projection.effigyPickable === true &&
      projection.citadelPickable === false &&
      projection.bellTowerSocket?.id === 'center-bell-tower-v0';
    assertCheck(
      report.checks.sympatheticCitadelInitialIdentity,
      'sympathetic citadel route exposed missing, fallback, or divergent consumer identity',
    );
  }
  if (bellTowerRequested) {
    report.bellTowerInitial = {
      bellTower: pageBefore.sympatheticCitadel?.bellTower,
      structuralAssetSidecar: pageBefore.sympatheticCitadel?.structuralAssetSidecar,
    };
    const bellTower = report.bellTowerInitial.bellTower;
    const assetSidecar = report.bellTowerInitial.structuralAssetSidecar;
    report.checks.bellTowerInitialIdentity =
      bellTower?.status === 'passed' &&
      bellTower.route === STRUCTURAL_BELL_TOWER_ROUTE &&
      bellTower.authority === STRUCTURAL_BELL_TOWER_AUTHORITY &&
      bellTower.attached === true &&
      bellTower.deflectionMagnitude === 0 &&
      assetSidecar?.status === 'passed' &&
      assetSidecar.route === STRUCTURAL_ASSET_SIDECAR_ROUTE &&
      assetSidecar.authority === STRUCTURAL_ASSET_SIDECAR_AUTHORITY &&
      assetSidecar.summary?.anchorCount === 217 &&
      assetSidecar.summary?.instancedAnchorCount === 216 &&
      assetSidecar.summary?.authoredAnchorCount === 1 &&
      pageBefore.sympatheticCitadel?.rendered?.citadel?.instancedBlockCount === 216 &&
      assetSidecar.bellAnchor?.structuralRole === 'bell-body' &&
      assetSidecar.bellAnchor?.prototype?.assetId === 'citadel-bell-v0' &&
      assetSidecar.bellAnchor?.prototype?.visualStatus === 'awaiting-handy-candyman-cast' &&
      pageBefore.sympatheticCitadel?.bellCrownSocket?.id === 'bell-crown-v0';
    assertCheck(
      report.checks.bellTowerInitialIdentity,
      'bell route exposed fallback topology, stale asset anchors, or missing structural crown identity',
    );
  }
  const cameraBefore = await evaluate('window.__structuralMaterial3dCameraWitness().state');

  report.failurePhase = 'held-shear-preview';
  const shearPreviewBaseline = await evaluate('window.__structuralMaterial3dWitness()');
  const shearPreviewStageRect = await evaluate(`(() => {
    const rect = document.querySelector('#stage').getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })()`);
  const shearPreviewTarget = await evaluate('window.__structuralMaterial3dPickTarget()');
  assertCheck(shearPreviewTarget, 'live sidecar route exposed no projected Shear contact target');
  const shearPreviewStart = { x: shearPreviewTarget.clientX, y: shearPreviewTarget.clientY };
  const shearPreviewEnd = {
    x: Math.min(
      shearPreviewStageRect.left + shearPreviewStageRect.width - 2,
      shearPreviewStart.x + shearPreviewStageRect.width * 0.3,
    ),
    y: shearPreviewStart.y,
  };
  await evaluate('window.__structuralMaterial3dArmPreExecutionHoldForWitness()');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...shearPreviewStart, button: 'left', buttons: 1, clickCount: 1,
  });
  for (const fraction of [0.34, 0.67, 1]) {
    const samplePoint = {
      x: shearPreviewStart.x + (shearPreviewEnd.x - shearPreviewStart.x) * fraction,
      y: shearPreviewStart.y + (shearPreviewEnd.y - shearPreviewStart.y) * fraction,
    };
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', ...samplePoint, button: 'left', buttons: 1,
    });
    if (fraction === 0.34) {
      await waitUntil(
        evaluate,
        'window.__structuralMaterial3dPreExecutionHoldStatus().reached',
        config.loadTimeoutMs,
        'GPU tear never reached the pre-execution witness hold',
      );
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 16));
    const sample = await evaluate('window.__structuralMaterial3dWitness()');
    report.shearPreviewHeldGpuSamples.push({
      fraction,
      inputLoad: sample.shearContactPreview?.inputLoad ?? null,
      maxOffset: sample.shearContactPreview?.maxOffset ?? null,
      renderedMaxAcceptedDelta: sample.shearContactPreview?.renderedMaxAcceptedDelta ?? null,
      renderedMaxPreviewError: sample.shearContactPreview?.renderedMaxPreviewError ?? null,
      summary: sample.summary,
      geometrySidecar: sample.geometrySidecar,
      haptics: sample.haptics,
      latestGpuOperation: sample.latestGpuOperation,
      scheduler: sample.liveDrag?.scheduler,
      renderTiming: sample.renderTiming,
      sympatheticCitadel: sample.sympatheticCitadel,
    });
  }
  const heldShearPreview = await evaluate('window.__structuralMaterial3dWitness()');
  report.shearPreviewDuringHeldGpuExecution = heldShearPreview.shearContactPreview;
  report.sympatheticCitadelHeld = heldShearPreview.sympatheticCitadel;
  report.checks.shearPreviewPrecededGpuExecution =
    heldShearPreview.latestGpuOperation?.kind === 'tear' &&
    heldShearPreview.latestGpuOperation?.status === 'pending' &&
    heldShearPreview.latestGpuOperation?.receipt?.requestedRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE &&
    heldShearPreview.latestGpuOperation?.receipt?.requestedExecutionRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE &&
    heldShearPreview.shearContactPreview?.status === 'active' &&
    heldShearPreview.shearContactPreview?.authority === 'visual-only-shear-contact-compliance-not-fracture-v0' &&
    heldShearPreview.shearContactPreview?.maxOffset > 0.000001 &&
    heldShearPreview.shearContactPreview?.renderedMaxAcceptedDelta > 0.000001 &&
    heldShearPreview.shearContactPreview?.renderedMaxPreviewError <= 0.000001;
  report.checks.shearPreviewAdvancedWhileGpuHeld =
    report.shearPreviewHeldGpuSamples.length === 3 &&
    report.shearPreviewHeldGpuSamples.every((sample, index) => index === 0 || (
      sample.inputLoad > report.shearPreviewHeldGpuSamples[index - 1].inputLoad &&
      sample.maxOffset > report.shearPreviewHeldGpuSamples[index - 1].maxOffset &&
      sample.renderedMaxAcceptedDelta >
        report.shearPreviewHeldGpuSamples[index - 1].renderedMaxAcceptedDelta
    )) &&
    report.shearPreviewHeldGpuSamples.at(-1).scheduler?.coalescedCount >
      report.shearPreviewHeldGpuSamples[0].scheduler?.coalescedCount;
  report.checks.shearPreviewRenderWithinFrameBudget = report.shearPreviewHeldGpuSamples.every(sample =>
    sample.renderTiming?.renderPath === 'incremental-shear-preview' &&
    sample.renderTiming?.shearPreviewActive === true &&
    sample.renderTiming?.pointerActive === true &&
    Number.isFinite(sample.renderTiming?.materialRebuildMs) &&
    Number.isFinite(sample.renderTiming?.sceneSubmissionMs) &&
    sample.renderTiming?.totalMs <= 1000 / 60);
  report.checks.shearPreviewPreservedAcceptedState = report.shearPreviewHeldGpuSamples.every(sample =>
    JSON.stringify(sample.summary) === JSON.stringify(shearPreviewBaseline.summary) &&
    sample.geometrySidecar?.topologyEpoch === shearPreviewBaseline.geometrySidecar?.topologyEpoch &&
    sample.geometrySidecar?.connectivityEpoch === shearPreviewBaseline.geometrySidecar?.connectivityEpoch &&
    sample.haptics?.impulseCount === shearPreviewBaseline.haptics?.impulseCount &&
    sample.haptics?.dispatchCount === shearPreviewBaseline.haptics?.dispatchCount) &&
    heldShearPreview.shearContactPreview?.sourceTopologyEpoch === shearPreviewBaseline.geometrySidecar?.topologyEpoch &&
    heldShearPreview.shearContactPreview?.sourceConnectivityEpoch === shearPreviewBaseline.geometrySidecar?.connectivityEpoch &&
    heldShearPreview.shearContactPreview?.structuralMutationAuthority === false;
  if (sympatheticCitadelRequested) {
    const baselineProjection = shearPreviewBaseline.sympatheticCitadel;
    const heldProjection = heldShearPreview.sympatheticCitadel;
    report.checks.sympatheticCitadelPreviewIsolation =
      heldProjection?.consumers?.effigy?.previewActive === true &&
      heldProjection?.consumers?.citadel?.previewActive === false &&
      heldProjection?.consumers?.citadel?.acceptedStateOnly === true &&
      heldProjection.acceptedState.structuralFingerprint ===
        baselineProjection?.acceptedState?.structuralFingerprint &&
      heldProjection.rendered?.citadel?.fractureFaceCount ===
        baselineProjection?.rendered?.citadel?.fractureFaceCount &&
      heldProjection.acceptedSurfaceCorrespondence === true &&
      heldProjection.effigyPickable === true &&
      heldProjection.citadelPickable === false;
    assertCheck(
      report.checks.sympatheticCitadelPreviewIsolation,
      'held Shear preview leaked provisional motion or authority into the represented citadel',
    );
  }
  assertCheck(report.checks.shearPreviewPrecededGpuExecution, 'held GPU tear did not expose immediate Shear compliance');
  assertCheck(report.checks.shearPreviewAdvancedWhileGpuHeld, 'Shear preview did not advance while GPU tear was held');
  assertCheck(report.checks.shearPreviewRenderWithinFrameBudget, 'Shear preview missed one 60 Hz frame');
  assertCheck(report.checks.shearPreviewPreservedAcceptedState, 'Shear preview changed accepted state or causal haptics');
  const shearPreviewCapture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const shearPreviewScreenshot = config.screenshot.replace(/\.png$/i, '-shear-preview.png');
  writeFileSync(shearPreviewScreenshot, Buffer.from(shearPreviewCapture.data, 'base64'));
  report.shearPreviewScreenshot = {
    path: shearPreviewScreenshot,
    byteLength: Buffer.from(shearPreviewCapture.data, 'base64').byteLength,
    pixelProbe: await probeScreenshot(evaluate, shearPreviewCapture.data),
  };
  await evaluate(`(() => {
    document.querySelector('#bind').click();
    window.__structuralMaterial3dReleasePreExecutionHoldForWitness();
  })()`);
  await releaseProjectedStructuralDrag(send, shearPreviewEnd);
  await waitUntil(
    evaluate,
    `(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.liveDrag.pointerActive === false &&
        witness.liveDrag.scheduler.pointerExecutionActive === false &&
        witness.latestGpuOperation?.status === 'failed';
    })()`,
    config.loadTimeoutMs,
    'cancelled pre-execution Shear did not settle without execution',
  );
  const cancelledShearPreview = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.cancelledShearPreviewDidNotExecute =
    cancelledShearPreview.latestGpuOperation?.receipt?.failurePhase === 'request-invalidated-before-execution' &&
    cancelledShearPreview.gpuHotSidecar === null &&
    cancelledShearPreview.summary.brokenBondCount === shearPreviewBaseline.summary.brokenBondCount &&
    cancelledShearPreview.shearContactPreview === null &&
    cancelledShearPreview.haptics.impulseCount === shearPreviewBaseline.haptics.impulseCount;
  assertCheck(report.checks.cancelledShearPreviewDidNotExecute, 'held Shear preview leaked into resident execution');
  const shearPreviewDiscardedCount = cancelledShearPreview.gpuTearDiscardedCount;
  await dispatchPointerClick(send, evaluate, '#fracture');

  report.failurePhase = 'isolated-hot-sequence';
  const isolated = await evaluate('window.__structuralMaterial3dRunHotSidecarWitness()', true);
  report.isolatedSequence = isolated;
  report.effectiveRoute = isolated.first.effectiveRoute;
  report.effectiveBackend = isolated.first.effectiveBackend;
  report.cpuFallbackUsed = isolated.first.cpuFallbackUsed;
  report.effectiveSolverRoute = isolated.first.solver?.route || null;
  report.checks.coldInitialization = isolated.coldInitialization.lifecycle.adapterRequestCount === 1 &&
    isolated.coldInitialization.lifecycle.deviceRequestCount === 1 &&
    isolated.coldInitialization.lifecycle.pipelineCreateCount === 4 &&
    isolated.coldInitialization.lifecycle.bufferAllocationCount === 13;
  report.checks.warmReuse = isolated.warmReuse === true &&
    isolated.first.lifecycle.executionCount === 1 &&
    isolated.second.lifecycle.executionCount === 2 &&
    isolated.first.lifecycle.pipelineCreateCount === isolated.second.lifecycle.pipelineCreateCount &&
    isolated.first.lifecycle.bufferAllocationCount === isolated.second.lifecycle.bufferAllocationCount;
  report.checks.compactInteractiveReadback = isolated.first.lifecycle.compactReadbackBufferCount === 2 &&
    isolated.second.lifecycle.compactReadbackBufferCount === 2 &&
    isolated.first.lifecycle.solverNodeReadbackCount === 1 &&
    isolated.second.lifecycle.solverNodeReadbackCount === 2 &&
    isolated.second.lifecycle.fullValidationReadbackCount === 0;
  report.checks.residentSolverIdentity = [isolated.first, isolated.second, isolated.afterReinitialize]
    .every(receipt =>
      receipt.solver?.route === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE &&
      receipt.solver?.authority === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY &&
      receipt.solver?.iterationCount === 12 &&
      receipt.solver?.dispatchCount === 12);
  report.checks.retainedSolverGeneration = isolated.first.solver?.generation?.before === 0 &&
    isolated.first.solver?.generation?.after === 1 &&
    isolated.second.solver?.generation?.before === 1 &&
    isolated.second.solver?.generation?.after === 2 &&
    isolated.afterReinitialize.solver?.generation?.before === 0 &&
    isolated.afterReinitialize.solver?.generation?.after === 1;
  report.checks.solverContactAndIsolation = [isolated.first, isolated.second, isolated.afterReinitialize]
    .every(receipt =>
      receipt.solver?.metrics?.contactTargetError <= 0.000001 &&
      receipt.solver?.metrics?.maxPinnedDisplacement <= 0.000001 &&
      receipt.solver?.metrics?.nonPrimaryCurrentResponse <= 0.000001 &&
      receipt.solver?.metrics?.movedNodeCount > 1 &&
      Number.isFinite(receipt.solver?.metrics?.maxConstraintResidual));
  report.checks.cpuGpuSolverParity =
    isolated.cpuGpuSolverParity?.authority === 'cpu-oracle-versus-native-webgpu-node-displacement-v0' &&
    isolated.cpuGpuSolverParity?.comparedNodeCount === 180 &&
    isolated.cpuGpuSolverParity?.maxNodeDisplacementError <= 0.000002;
  report.checks.reinitializeRestoresEpoch = isolated.reinitialize.status === 'passed' &&
    isolated.reinitialize.eventEpoch === 0 &&
    isolated.afterReinitialize.eventEpoch === 1 &&
    isolated.afterReinitialize.lifecycle.reinitializeCount === 1;
  report.checks.disposeIdempotent = isolated.disposeIdempotent === true &&
    isolated.dispose.lifecycle.bufferDestroyCount === 13 &&
    isolated.dispose.lifecycle.deviceDestroyCount === 1;

  report.failurePhase = 'live-warm-product-route';
  const stageRect = await evaluate(`(() => {
    const rect = document.querySelector('#stage').getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })()`);
  await dispatchProjectedStructuralDrag(send, evaluate, stageRect);
  await dispatchProjectedStructuralDrag(send, evaluate, stageRect);
  await waitUntil(
    evaluate,
    `(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.gpuSympatheticTear?.eventEpoch === 2 &&
        witness.gpuTearAppliedCount === 2 &&
        witness.gpuTearRecentAppliedReceipts?.length === 2;
    })()`,
    config.loadTimeoutMs,
    'two immediate live hot tears did not apply in order',
  );
  const livePage = await evaluate('window.__structuralMaterial3dWitness()');
  report.liveTearAcceptance = livePage.gpuTearAcceptance;
  report.sympatheticCitadelAccepted = livePage.sympatheticCitadel;
  report.bellTowerAccepted = bellTowerRequested ? {
    bellTower: livePage.sympatheticCitadel?.bellTower,
    structuralAssetSidecar: livePage.sympatheticCitadel?.structuralAssetSidecar,
    ringEvents: livePage.sympatheticCitadel?.bellRingEvents,
  } : null;
  const shearAcceptedCapture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const shearAcceptedScreenshot = config.screenshot.replace(/\.png$/i, '-shear-accepted.png');
  writeFileSync(shearAcceptedScreenshot, Buffer.from(shearAcceptedCapture.data, 'base64'));
  const shearAcceptedPixelProbe = await probeScreenshot(evaluate, shearAcceptedCapture.data);
  report.shearAcceptedScreenshot = {
    path: shearAcceptedScreenshot,
    byteLength: Buffer.from(shearAcceptedCapture.data, 'base64').byteLength,
    pixelProbe: shearAcceptedPixelProbe,
  };
  report.checks.shearAcceptedScreenshotPixels =
    shearAcceptedPixelProbe.nonDarkPixels >= 500 &&
    shearAcceptedPixelProbe.structuralColorPixels >= 40;
  [report.liveFirst, report.liveSecond] = livePage.gpuTearRecentAppliedReceipts;
  const cameraAfter = await evaluate('window.__structuralMaterial3dCameraWitness().state');
  report.checks.liveExecutionRoute = report.liveFirst.executionRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE &&
    report.liveSecond.executionRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE &&
    report.liveSecond.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE;
  report.checks.liveWarmReuse = report.liveFirst.lifecycle.deviceRequestCount === 1 &&
    report.liveSecond.lifecycle.deviceRequestCount === 1 &&
    report.liveFirst.lifecycle.pipelineCreateCount === 4 &&
    report.liveSecond.lifecycle.pipelineCreateCount === 4 &&
    report.liveFirst.lifecycle.bufferAllocationCount === 13 &&
    report.liveSecond.lifecycle.bufferAllocationCount === 13 &&
    report.liveFirst.lifecycle.executionCount === 1 &&
    report.liveSecond.lifecycle.executionCount === 2;
  report.checks.liveInteractiveValidation = report.liveFirst.interactiveValidation?.ok === true &&
    report.liveSecond.interactiveValidation?.ok === true &&
    report.liveSecond.lifecycle.fullValidationReadbackCount === 0;
  report.checks.liveResidentSolverIdentity = [report.liveFirst, report.liveSecond].every(receipt =>
    receipt.solver?.route === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE &&
    receipt.solver?.authority === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY &&
    receipt.solver?.iterationCount === 12 &&
    receipt.solver?.metrics?.contactTargetError <= 0.000001 &&
    receipt.solver?.metrics?.maxPinnedDisplacement <= 0.000001 &&
    receipt.solver?.metrics?.nonPrimaryCurrentResponse <= 0.000001);
  report.checks.sameGenerationOrderedApplication = report.liveFirst.eventEpoch === 1 &&
    report.liveSecond.eventEpoch === 2 &&
    livePage.gpuTearAppliedCount === 2 &&
    livePage.gpuTearRecentAppliedReceipts.length === 2 &&
    livePage.gpuTearDiscardedCount === shearPreviewDiscardedCount;
  report.checks.duplicateTearReplaySuppressed =
    livePage.gpuTearAcceptance?.acceptedCount === 2 &&
    livePage.gpuTearAcceptance?.acceptedKeys?.length === 2 &&
    new Set(livePage.gpuTearAcceptance.acceptedKeys).size === 2 &&
    livePage.gpuTearAppliedCount === livePage.gpuTearAcceptance.acceptedCount;
  report.checks.cameraPreserved = JSON.stringify(cameraBefore) === JSON.stringify(cameraAfter);
  report.checks.visibleSeparation = livePage.visibleTear?.components?.some(component =>
    !component.pinned && component.maxDisplacement > 0.000001) &&
    livePage.visibleTear.components.filter(component => component.pinned)
      .every(component => component.maxPinnedDisplacement < 0.000001);
  if (sympatheticCitadelRequested) {
    const projection = livePage.sympatheticCitadel;
    report.checks.sympatheticCitadelAcceptedCorrespondence =
      projection?.status === 'passed' &&
      projection.acceptedSurfaceCorrespondence === true &&
      projection.rendered?.effigy?.fractureFaceCount > 0 &&
      projection.rendered.effigy.fractureFaceCount === projection.rendered.citadel.fractureFaceCount &&
      projection.rendered.effigy.topologyEpoch === projection.acceptedState.topologyEpoch &&
      projection.rendered.citadel.topologyEpoch === projection.acceptedState.topologyEpoch &&
      projection.rendered.effigy.connectivityEpoch === projection.acceptedState.connectivityEpoch &&
      projection.rendered.citadel.connectivityEpoch === projection.acceptedState.connectivityEpoch &&
      projection.consumers.effigy.acceptedState.structuralFingerprint ===
        projection.consumers.citadel.acceptedState.structuralFingerprint;
    assertCheck(
      report.checks.sympatheticCitadelAcceptedCorrespondence,
      'accepted fracture did not produce one matching effigy/citadel structural projection',
    );
  }
  if (bellTowerRequested) {
    const acceptedBell = report.bellTowerAccepted.bellTower;
    const acceptedAsset = report.bellTowerAccepted.structuralAssetSidecar;
    const acceptedRings = report.bellTowerAccepted.ringEvents || [];
    report.checks.bellTowerAcceptedMotionAndRing =
      acceptedBell?.status === 'passed' &&
      acceptedBell.deflectionMagnitude > 0.000001 &&
      acceptedAsset?.status === 'passed' &&
      acceptedAsset.bellAnchor?.acceptedBodyCenter &&
      acceptedAsset.bellAnchor.structuralNodeId === acceptedBell.bellNodeId &&
      acceptedRings.some(event =>
        event.authority === STRUCTURAL_BELL_RING_AUTHORITY &&
        event.bellNodeId === acceptedBell.bellNodeId &&
        event.energy > 0 &&
        event.pitchHz > 0);
    assertCheck(
      report.checks.bellTowerAcceptedMotionAndRing,
      'accepted bell drag did not couple graph motion, asset anchor motion, and a material-derived ring event',
    );
  }

  report.failurePhase = 'bind-mode-selection';
  const bindSelectionBefore = await evaluate(`(() => {
    const witness = window.__structuralMaterial3dWitness();
    return {
      summary: witness.summary,
      geometrySidecar: witness.geometrySidecar,
      gpuHotSidecarEventEpoch: witness.gpuHotSidecar?.eventEpoch ?? null,
      latestGpuOperation: witness.latestGpuOperation,
      gpuBindingPending: witness.gpuBindingPending,
      camera: window.__structuralMaterial3dCameraWitness().state,
    };
  })()`);
  await dispatchPointerClick(send, evaluate, '#bind');
  const bindSelectionAfter = await evaluate(`(() => {
    const witness = window.__structuralMaterial3dWitness();
    return {
      summary: witness.summary,
      geometrySidecar: witness.geometrySidecar,
      gpuHotSidecarEventEpoch: witness.gpuHotSidecar?.eventEpoch ?? null,
      latestGpuOperation: witness.latestGpuOperation,
      gpuBindingPending: witness.gpuBindingPending,
      camera: window.__structuralMaterial3dCameraWitness().state,
      interactionMode: witness.interactionMode,
      shearPressed: document.querySelector('#fracture')?.getAttribute('aria-pressed'),
      bindPressed: document.querySelector('#bind')?.getAttribute('aria-pressed'),
    };
  })()`);
  report.modeSelection = { before: bindSelectionBefore, after: bindSelectionAfter };
  report.checks.modeSelectionInert =
    JSON.stringify(bindSelectionBefore.summary) === JSON.stringify(bindSelectionAfter.summary) &&
    JSON.stringify(bindSelectionBefore.geometrySidecar) === JSON.stringify(bindSelectionAfter.geometrySidecar) &&
    bindSelectionBefore.gpuHotSidecarEventEpoch === bindSelectionAfter.gpuHotSidecarEventEpoch &&
    JSON.stringify(bindSelectionBefore.latestGpuOperation) === JSON.stringify(bindSelectionAfter.latestGpuOperation) &&
    bindSelectionBefore.gpuBindingPending === false &&
    bindSelectionAfter.gpuBindingPending === false &&
    JSON.stringify(bindSelectionBefore.camera) === JSON.stringify(bindSelectionAfter.camera) &&
    bindSelectionAfter.interactionMode?.mode === 'bind' &&
    bindSelectionAfter.shearPressed === 'false' &&
    bindSelectionAfter.bindPressed === 'true';

  const bindTarget = await evaluate(`(() => {
    const targets = window.__structuralMaterial3dPickTargets();
    const failed = window.__structuralMaterial3dWitness().summary.crackPath;
    return targets
      .map(target => ({
        ...target,
        failedDistance: Math.min(...failed.map(edge => Math.hypot(
          target.restPoint.x - edge.midpoint.x,
          target.restPoint.y - edge.midpoint.y,
          target.restPoint.z - edge.midpoint.z,
        ))),
      }))
      .sort((a, b) => a.failedDistance - b.failedDistance)[0] || null;
  })()`);
  assertCheck(bindTarget, 'fractured route exposed no projected Bind contact target');

  report.failurePhase = 'cancelled-in-flight-binding';
  const beforeCancelledBinding = await evaluate('window.__structuralMaterial3dWitness()');
  await evaluate('window.__structuralMaterial3dArmBindingPostExecutionHoldForWitness()');
  const cancelledBindDrag = await beginProjectedStructuralDrag(send, bindTarget, stageRect);
  await waitUntil(
    evaluate,
    'window.__structuralMaterial3dBindingPostExecutionHoldStatus().reached',
    config.loadTimeoutMs,
    'GPU Bind never reached the post-execution cancellation boundary',
  );
  const heldBindPreviewSamples = [];
  let heldBindPreview = null;
  for (const fraction of [0.34, 0.67, 1]) {
    const samplePoint = {
      x: cancelledBindDrag.start.x +
        (cancelledBindDrag.end.x - cancelledBindDrag.start.x) * fraction,
      y: cancelledBindDrag.start.y +
        (cancelledBindDrag.end.y - cancelledBindDrag.start.y) * fraction,
    };
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...samplePoint,
      button: 'left',
      buttons: 1,
    });
    await new Promise(resolveWait => setTimeout(resolveWait, 16));
    heldBindPreview = await evaluate('window.__structuralMaterial3dWitness()');
    heldBindPreviewSamples.push({
      fraction,
      inputLoad: heldBindPreview.bindContactPreview?.inputLoad ?? null,
      maxOffset: heldBindPreview.bindContactPreview?.maxOffset ?? null,
      renderedMaxAcceptedDelta:
        heldBindPreview.bindContactPreview?.renderedMaxAcceptedDelta ?? null,
      renderedMaxPreviewError:
        heldBindPreview.bindContactPreview?.renderedMaxPreviewError ?? null,
      summary: heldBindPreview.summary,
      acceptedConnectivity: heldBindPreview.gpuHotSidecar?.acceptedConnectivity,
      latestGpuOperation: heldBindPreview.latestGpuOperation,
      scheduler: heldBindPreview.liveDrag?.scheduler,
      renderTiming: heldBindPreview.renderTiming,
    });
  }
  report.bindPreviewHeldGpuSamples = heldBindPreviewSamples;
  report.bindPreviewDuringHeldGpuAcceptance = heldBindPreview.bindContactPreview;
  report.checks.bindPreviewPrecededGpuAcceptance =
    heldBindPreview.latestGpuOperation?.kind === 'binding' &&
    heldBindPreview.latestGpuOperation?.status === 'pending' &&
    heldBindPreview.bindContactPreview?.status === 'active' &&
    heldBindPreview.bindContactPreview?.authority === 'visual-only-bind-contact-compliance-not-connectivity-v0' &&
    heldBindPreview.bindContactPreview?.maxOffset > 0.000001 &&
    heldBindPreview.bindContactPreview?.renderedMaxAcceptedDelta > 0.000001 &&
    heldBindPreview.bindContactPreview?.renderedMaxPreviewError <= 0.000001;
  report.checks.bindPreviewAdvancedWhileGpuHeld =
    heldBindPreviewSamples.length === 3 &&
    heldBindPreviewSamples.every(sample =>
      sample.latestGpuOperation?.kind === 'binding' &&
      sample.latestGpuOperation?.status === 'pending' &&
      sample.renderedMaxPreviewError <= 0.000001 &&
      JSON.stringify(sample.summary) === JSON.stringify(beforeCancelledBinding.summary) &&
      JSON.stringify(sample.acceptedConnectivity) ===
        JSON.stringify(beforeCancelledBinding.gpuHotSidecar?.acceptedConnectivity)) &&
    heldBindPreviewSamples.every((sample, index) => index === 0 || (
      sample.inputLoad > heldBindPreviewSamples[index - 1].inputLoad &&
      sample.maxOffset > heldBindPreviewSamples[index - 1].maxOffset &&
      sample.renderedMaxAcceptedDelta >
        heldBindPreviewSamples[index - 1].renderedMaxAcceptedDelta
    )) &&
    heldBindPreviewSamples.at(-1).scheduler?.coalescedCount >
      heldBindPreviewSamples[0].scheduler?.coalescedCount;
  report.checks.bindPreviewRenderWithinFrameBudget = heldBindPreviewSamples.every(sample =>
    sample.renderTiming?.renderPath === 'incremental-bind-preview' &&
    sample.renderTiming?.bindPreviewActive === true &&
    sample.renderTiming?.pointerActive === true &&
    Number.isFinite(sample.renderTiming?.materialRebuildMs) &&
    Number.isFinite(sample.renderTiming?.sceneSubmissionMs) &&
    sample.renderTiming?.totalMs <= 1000 / 60);
  report.checks.bindPreviewPreservedConnectivity =
    JSON.stringify(heldBindPreview.summary) === JSON.stringify(beforeCancelledBinding.summary) &&
    heldBindPreview.geometrySidecar?.topologyEpoch === beforeCancelledBinding.geometrySidecar?.topologyEpoch &&
    heldBindPreview.geometrySidecar?.connectivityEpoch === beforeCancelledBinding.geometrySidecar?.connectivityEpoch &&
    JSON.stringify(heldBindPreview.gpuHotSidecar?.acceptedConnectivity) ===
      JSON.stringify(beforeCancelledBinding.gpuHotSidecar?.acceptedConnectivity) &&
    heldBindPreview.bindContactPreview?.sourceTopologyEpoch === beforeCancelledBinding.geometrySidecar?.topologyEpoch &&
    heldBindPreview.bindContactPreview?.sourceConnectivityEpoch === beforeCancelledBinding.geometrySidecar?.connectivityEpoch &&
    heldBindPreview.bindContactPreview?.structuralMutationAuthority === false;
  assertCheck(
    report.checks.bindPreviewPrecededGpuAcceptance,
    'held GPU Bind did not produce immediate rendered contact compliance',
  );
  assertCheck(
    report.checks.bindPreviewAdvancedWhileGpuHeld,
    'Bind preview did not advance continuously while GPU acceptance was held',
  );
  assertCheck(
    report.checks.bindPreviewRenderWithinFrameBudget,
    'Bind preview render missed the 60 Hz frame budget while GPU acceptance was held',
  );
  assertCheck(
    report.checks.bindPreviewPreservedConnectivity,
    'Bind contact preview changed structural connectivity before GPU acceptance',
  );
  const bindPreviewCapture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const bindPreviewScreenshot = config.screenshot.replace(/\.png$/i, '-bind-preview.png');
  writeFileSync(bindPreviewScreenshot, Buffer.from(bindPreviewCapture.data, 'base64'));
  report.bindPreviewScreenshot = {
    path: bindPreviewScreenshot,
    byteLength: Buffer.from(bindPreviewCapture.data, 'base64').byteLength,
    pixelProbe: await probeScreenshot(evaluate, bindPreviewCapture.data),
  };
  await evaluate(`(() => {
    document.querySelector('#fracture').click();
    window.__structuralMaterial3dReleaseBindingPostExecutionHoldForWitness();
  })()`);
  await releaseProjectedStructuralDrag(send, cancelledBindDrag.end);
  await waitUntil(
    evaluate,
    `(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.latestGpuOperation?.kind === 'binding' &&
        witness.latestGpuOperation.status === 'failed' &&
        witness.liveDrag.pointerActive === false &&
        witness.liveDrag.scheduler.pointerExecutionActive === false &&
        witness.gpuBindingPending === false;
    })()`,
    config.loadTimeoutMs,
    'cancelled post-execution Bind did not settle as failed',
  );
  const cancelledBinding = await evaluate(`({
    structural: window.__structuralMaterial3dWitness(),
    status: window.__structuralMaterial3dGpuStatusWitness()
  })`);
  report.cancelledInFlightBinding = cancelledBinding;
  const cancelledBindingReceipt = cancelledBinding.status?.latestGpuOperation?.receipt;
  report.checks.cancelledInFlightBindingRejected =
    cancelledBindingReceipt?.status === 'failed' &&
    cancelledBindingReceipt?.failurePhase === 'request-invalidated-after-execution' &&
    cancelledBindingReceipt?.effectiveRoute === null &&
    cancelledBindingReceipt?.discardedExecution?.status === 'passed' &&
    cancelledBindingReceipt?.discardedExecution?.binding?.eventCount > 0 &&
    cancelledBinding.status?.latestGpuOperation?.kind === 'binding' &&
    cancelledBinding.status?.text.includes('GPU bind failed') &&
    cancelledBinding.structural?.interactionDiagnostics?.gpuOperationStatus === 'failed' &&
    cancelledBinding.structural?.interactionDiagnostics?.latestWarmTotalMs === null;
  report.checks.residentPageBindingAgreementAfterCancel =
    JSON.stringify(cancelledBinding.structural?.summary) === JSON.stringify(beforeCancelledBinding.summary) &&
    JSON.stringify(cancelledBinding.structural?.gpuHotSidecar?.acceptedConnectivity) ===
      JSON.stringify(beforeCancelledBinding.gpuHotSidecar?.acceptedConnectivity) &&
    cancelledBinding.structural?.gpuHotSidecar?.lifecycle?.rollbackCount ===
      beforeCancelledBinding.gpuHotSidecar?.lifecycle?.rollbackCount + 1 &&
    cancelledBinding.structural?.gpuHotSidecar?.lifecycle?.residentStateTrusted === true &&
    cancelledBinding.structural?.bindContactPreview === null &&
    cancelledBinding.structural?.interactionMode?.mode === 'shear';
  assertCheck(
    report.checks.cancelledInFlightBindingRejected,
    'cancelled in-flight Bind remained operator-visible as passed',
  );
  assertCheck(
    report.checks.residentPageBindingAgreementAfterCancel,
    'cancelled in-flight Bind left resident and page connectivity out of agreement',
  );
  await dispatchPointerClick(send, evaluate, '#bind');

  report.failurePhase = 'picked-bind-gesture';
  const tearAppliedCountBeforeBind = livePage.gpuTearAppliedCount;
  const brokenBondCountBeforeBind = livePage.summary.brokenBondCount;
  const heldBind = await beginProjectedStructuralDrag(send, bindTarget, stageRect);
  await waitUntil(
    evaluate,
    `(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.latestGpuOperation?.kind === 'binding' &&
        witness.latestGpuOperation.status === 'passed' &&
        witness.gpuResidentBinding?.binding?.eventCount > 0;
    })()`,
    config.loadTimeoutMs,
    'held picked Bind gesture did not repair resident connectivity',
  );
  report.liveBinding = await evaluate('window.__structuralMaterial3dWitness()');
  await releaseProjectedStructuralDrag(send, heldBind.end);
  await waitUntil(
    evaluate,
    `(() => {
      const witness = window.__structuralMaterial3dWitness();
      return witness.liveDrag.pointerActive === false &&
        witness.liveDrag.scheduler.pointerExecutionActive === false &&
        witness.gpuBindingPending === false;
    })()`,
    config.loadTimeoutMs,
    'picked Bind release did not settle',
  );
  const boundPage = await evaluate('window.__structuralMaterial3dWitness()');
  const effectiveBindPoint = report.liveBinding.gpuResidentBinding?.binding?.effective?.point;
  const pickedBindPoint = report.liveBinding.forceEnvelope?.point;
  report.checks.pickedBindLocality =
    report.liveBinding.interactionMode?.mode === 'bind' &&
    report.liveBinding.forceEnvelope?.operationMode === 'bind' &&
    report.liveBinding.interactionDiagnostics?.pick?.id === report.liveBinding.forceEnvelope?.contactIdentity?.id &&
    [effectiveBindPoint?.x, effectiveBindPoint?.y, effectiveBindPoint?.z].every(Number.isFinite) &&
    Math.hypot(
      effectiveBindPoint.x - pickedBindPoint.x,
      effectiveBindPoint.y - pickedBindPoint.y,
      effectiveBindPoint.z - pickedBindPoint.z,
    ) <= 0.000001 &&
    bindTarget.failedDistance <= report.liveBinding.gpuResidentBinding.binding.effective.radius + 0.000001;
  report.checks.bindingRouteIdentity =
    report.liveBinding.gpuResidentBinding?.status === 'passed' &&
    report.liveBinding.gpuResidentBinding?.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE &&
    report.liveBinding.gpuResidentBinding?.effectiveBackend === 'webgpu' &&
    report.liveBinding.gpuResidentBinding?.cpuFallbackUsed === false;
  report.checks.bindReducedLocalDamage =
    report.liveBinding.summary.brokenBondCount < brokenBondCountBeforeBind &&
    report.liveBinding.gpuResidentBinding.binding.eventCount > 0 &&
    boundPage.summary.brokenBondCount <= report.liveBinding.summary.brokenBondCount;
  report.checks.bindDidNotInvokeTear =
    report.liveBinding.gpuTearAppliedCount === tearAppliedCountBeforeBind &&
    boundPage.gpuTearAppliedCount === tearAppliedCountBeforeBind &&
    boundPage.latestGpuOperation?.kind === 'binding';
  report.checks.bindCameraPreserved = JSON.stringify(cameraBefore) === JSON.stringify(
    await evaluate('window.__structuralMaterial3dCameraWitness().state'),
  );

  report.failurePhase = 'visual-evidence';
  const screenshotEvidence = await captureVisibleScreenshot(send, evaluate, config.loadTimeoutMs, {
    minimumNonDarkPixels: 500,
    minimumStructuralColorPixels: 40,
    visualState: 'post-picked-bind',
  });
  report.screenshotPixelProbe = screenshotEvidence.probe;
  assertCheck(screenshotEvidence.capture?.data, 'visual witness produced no screenshot payload');
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(screenshotEvidence.capture.data, 'base64'));
  report.checks.actualScreenshotPixels = report.screenshotPixelProbe.ok === true &&
    report.screenshotPixelProbe.nonDarkPixels >= report.screenshotPixelProbe.minimumNonDarkPixels &&
    report.screenshotPixelProbe.structuralColorPixels >= report.screenshotPixelProbe.minimumStructuralColorPixels;
  report.checks.bindingRouteStatusVisible = await evaluate(`(() => {
    const status = document.querySelector('#gpu-status');
    return status?.textContent.includes('GPU bind') &&
      status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE)};
  })()`);

  report.failurePhase = 'reset-reinitialize';
  await evaluate("document.querySelector('#reset').click()");
  await waitUntil(
    evaluate,
    "window.__structuralMaterial3dWitness().gpuHotSidecar?.lifecycle?.reinitializeCount === 1",
    config.loadTimeoutMs,
    'live sidecar did not reinitialize after Reset',
  );
  const reset = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.resetReusesRuntime = reset.summary.brokenBondCount === 0 &&
    reset.summary.componentCount === 1 &&
    reset.gpuHotSidecar.lifecycle.deviceRequestCount === 1 &&
    reset.gpuHotSidecar.lifecycle.pipelineCreateCount === 4 &&
    reset.gpuHotSidecar.lifecycle.bufferAllocationCount === 13 &&
    reset.gpuHotSidecar.lifecycle.reinitializeCount === 1;

  for (const [name, passed] of Object.entries(report.checks)) {
    assertCheck(passed, `hot structural sidecar check failed: ${name}`);
  }
  report.runtimeErrors = cdp.runtimeErrors.slice();
  report.checks.noRuntimeErrors = report.runtimeErrors.length === 0;
  assertCheck(report.checks.noRuntimeErrors, `browser emitted runtime errors: ${report.runtimeErrors.join('; ')}`);
  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = {
    phase: 'reset-reinitialize',
    effectiveRoute: report.effectiveRoute,
    isolatedLifecycle: isolated.beforeDispose.lifecycle,
    liveLifecycle: report.liveSecond.lifecycle,
    liveBinding: {
      effectiveRoute: report.liveBinding.gpuResidentBinding?.effectiveRoute || null,
      effectiveBackend: report.liveBinding.gpuResidentBinding?.effectiveBackend || null,
      eventEpoch: report.liveBinding.gpuResidentBinding?.eventEpoch || null,
      eventCount: report.liveBinding.gpuResidentBinding?.binding?.eventCount || 0,
      point: report.liveBinding.gpuResidentBinding?.binding?.effective?.point || null,
    },
    screenshotPixelProbe: report.screenshotPixelProbe,
  };
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  if (cdp) {
    report.runtimeErrors = cdp.runtimeErrors.slice();
    try {
      report.lastTrustworthyEvidence = await cdp.evaluate(`(() => {
        const witness = window.__structuralMaterial3dWitness?.();
        if (!witness) return { phase: 'page-witness-unavailable' };
        return {
          phase: ${JSON.stringify('failure-snapshot')},
          effectiveRoute: witness.effectiveRoute,
          gpuTearAppliedCount: witness.gpuTearAppliedCount,
          gpuTearDiscardedCount: witness.gpuTearDiscardedCount,
          gpuTearRecentEventEpochs: witness.gpuTearRecentAppliedReceipts?.map(receipt => receipt.eventEpoch) || [],
          gpuSympatheticTear: witness.gpuSympatheticTear && {
            status: witness.gpuSympatheticTear.status,
            failurePhase: witness.gpuSympatheticTear.failurePhase,
            eventEpoch: witness.gpuSympatheticTear.eventEpoch,
          },
          gpuHotSidecar: witness.gpuHotSidecar && {
            status: witness.gpuHotSidecar.status,
            eventEpoch: witness.gpuHotSidecar.eventEpoch,
            solverGeneration: witness.gpuHotSidecar.solverGeneration,
            lifecycle: witness.gpuHotSidecar.lifecycle,
          },
          liveDrag: witness.liveDrag,
          latestGpuOperation: witness.latestGpuOperation,
        };
      })()`);
    } catch (snapshotError) {
      report.lastTrustworthyEvidence = {
        phase: 'failure-snapshot-unavailable',
        error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      };
    }
  }
  process.exitCode = 1;
} finally {
  cdp?.socket.close();
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
