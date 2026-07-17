#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
} from './structural-material-3d-webgpu-hot-sidecar.js';
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
    '  [--require-native-haptics true|false]',
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
  const boolean = (name, fallback) => {
    if (!values.has(name)) return fallback;
    const value = values.get(name);
    if (value !== 'true' && value !== 'false') {
      throw new Error(`--${name} must be true or false; received ${JSON.stringify(value)}`);
    }
    return value === 'true';
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
    requireNativeHaptics: boolean('require-native-haptics', false),
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
  const rawArguments = process.argv.slice(2);
  const outputIndex = rawArguments.indexOf('--out');
  const requestedOutput = outputIndex >= 0 && rawArguments[outputIndex + 1]
    ? resolve(rawArguments[outputIndex + 1])
    : null;
  if (requestedOutput) {
    const failureReport = {
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
      requestedConfig: { arguments: rawArguments, reportPath: requestedOutput },
      effectiveConfig: null,
      lastTrustworthyEvidence: null,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };
    mkdirSync(dirname(requestedOutput), { recursive: true });
    writeFileSync(requestedOutput, `${JSON.stringify(failureReport, null, 2)}\n`);
  }
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
    requireNativeHaptics: config.requireNativeHaptics,
    reportPath: config.out,
    screenshotPath: config.screenshot,
  },
  effectiveConfig: null,
  browserVersion: null,
  unnotchedControl: null,
  notchedTear: null,
  visibleTear: null,
  residentBinding: null,
  visibleBinding: null,
  rollbackRecovery: null,
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
    requireNativeHaptics: config.requireNativeHaptics,
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
  const denseDragSamples = [0.66, 0.78, 0.92].map(fraction => ({
    x: stageRect.left + stageRect.width * fraction,
    y: dragEnd.y,
  }));
  await evaluate(`(() => {
    const canvas = document.querySelector('#stage canvas');
    const pointerId = window.__structuralMaterial3dWitness().liveDrag.pointerId;
    const samples = ${JSON.stringify(denseDragSamples)};
    if (!Number.isInteger(pointerId)) throw new Error('active material pointer id missing');
    for (const sample of samples) {
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        pointerId,
        isPrimary: true,
        bubbles: true,
        buttons: 1,
        clientX: sample.x,
        clientY: sample.y,
      }));
    }
  })()`);
  const dragged = await evaluate('window.__structuralMaterial3dWitness()');
  report.checks.effigyDragProducedForce = dragged.forceEnvelope?.dragLength > 0.3 &&
    dragged.forceEnvelope?.magnitude > 1;
  assertCheck(report.checks.effigyDragProducedForce, 'effigy drag did not produce a structural force envelope');

  const preReleaseDeadline = Date.now() + config.loadTimeoutMs;
  let preRelease = dragged;
  while (Date.now() < preReleaseDeadline) {
    preRelease = await evaluate('window.__structuralMaterial3dWitness()');
    if (preRelease.gpuSympatheticTear?.status === 'passed' && preRelease.visibleTear?.components?.length > 1) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  report.checks.preReleaseStructuralMutation = preRelease.gpuSympatheticTear?.status === 'passed' &&
    preRelease.summary?.brokenBondCount > 0 &&
    preRelease.visibleTear?.components?.length > 1 &&
    preRelease.liveDrag?.pointerActive === true;
  report.checks.latestEnvelopeCoalescing = preRelease.liveDrag?.scheduler?.maxConcurrentExecutionCount === 1 &&
    preRelease.liveDrag?.scheduler?.offeredCount === denseDragSamples.length &&
    preRelease.liveDrag?.scheduler?.coalescedCount >= 1 &&
    preRelease.liveDrag?.scheduler?.pendingInteractionId === null;
  report.preRelease = {
    summary: preRelease.summary,
    gpuSympatheticTear: preRelease.gpuSympatheticTear,
    visibleTear: preRelease.visibleTear,
    liveDrag: preRelease.liveDrag,
    haptics: preRelease.haptics,
  };
  report.lastTrustworthyEvidence = {
    phase: 'held-pointer-state',
    preRelease: report.preRelease,
  };
  assertCheck(
    report.checks.preReleaseStructuralMutation,
    'effigy did not visibly mutate while the primary pointer remained held',
  );
  assertCheck(
    report.checks.latestEnvelopeCoalescing,
    'dense pointer movement did not exercise one-in-flight latest-envelope coalescing',
  );

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
      const scheduler = witness.liveDrag?.scheduler;
      return witness.gpuSympatheticTear?.status === 'passed' &&
        witness.visibleTear !== null &&
        witness.liveDrag?.pointerActive === false &&
        scheduler?.finalCompletedCount >= 1 &&
        scheduler?.pointerExecutionActive === false &&
        scheduler?.pendingInteractionId === null;
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
  report.checks.releaseFlushedFinalEnvelope = pageAfter.liveDrag?.pointerActive === false &&
    pageAfter.liveDrag?.scheduler?.finalCompletedCount >= 1 &&
    pageAfter.liveDrag?.scheduler?.pendingInteractionId === null;
  assertCheck(report.checks.releaseFlushedFinalEnvelope, 'pointer release did not flush the final force envelope');
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
  report.checks.threePipelines = notched.lifecycle?.pipelineCreateCount === 3;
  report.checks.persistentBuffers = notched.lifecycle?.bufferAllocationCount === 9;
  const liveExecutionCount = pageAfter.liveDrag?.scheduler?.completedCount;
  report.checks.compactReadback = Number.isInteger(liveExecutionCount) && liveExecutionCount >= 2 &&
    notched.lifecycle?.compactReadbackCount === liveExecutionCount &&
    notched.lifecycle?.compactReadbackBufferCount === 2 &&
    notched.lifecycle?.fullValidationReadbackCount === 0;
  report.checks.topologyDispatchCount = notched.lifecycle?.topologyDispatchCount ===
    notched.gpuStructuralState?.componentLabels?.length * liveExecutionCount;
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

  report.failurePhase = 'causal-haptics';
  const hapticDeadline = Date.now() + config.loadTimeoutMs;
  let hapticWitness = persisted;
  while (config.requireNativeHaptics && Date.now() < hapticDeadline) {
    hapticWitness = await evaluate('window.__structuralMaterial3dWitness()');
    if (hapticWitness.haptics?.dispatchCount >= hapticWitness.haptics?.impulseCount) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  report.haptics = hapticWitness.haptics;
  const nativeHapticsAccepted = hapticWitness.haptics?.impulseCount > 0
    && hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.status === 'passed'
    && hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.effectiveRoute ===
      'kaminos.structural-material.native-trackpad-haptics.v0'
    && hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.receipt?.cause ===
      'accepted-gpu-connectivity-delta'
    && hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.tactileOutputVerified === false
    && hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.receipt?.tactileOutputVerified === false
    && typeof hapticWitness.haptics?.latestDispatchReceipt?.macTrackpad?.receipt?.tactileOutputQualification === 'string';
  report.checks.nativeHapticCompanionRequirementSatisfied = !config.requireNativeHaptics || nativeHapticsAccepted;
  assertCheck(
    report.checks.nativeHapticCompanionRequirementSatisfied,
    'configured native haptic companion did not accept a causal connectivity impulse',
  );

  report.failurePhase = 'gpu-resident-binding';
  const bindingCameraBefore = await evaluate('window.__structuralMaterial3dCameraWitness().state');
  const brokenBeforeBinding = persisted.summary.brokenBondCount;
  const componentCountBeforeBinding = persisted.summary.componentCount;
  const reinitializeCountBeforeBinding = persisted.gpuHotSidecar?.lifecycle?.reinitializeCount || 0;
  const residentBinding = await evaluate('window.__structuralMaterial3dRunGpuBinding()', true);
  const boundPage = await evaluate('window.__structuralMaterial3dWitness()');
  report.residentBinding = residentBinding;
  report.visibleBinding = boundPage.visibleBinding;
  report.checks.bindingStatusPassed = residentBinding.status === 'passed';
  report.checks.bindingRouteIdentity = residentBinding.effectiveRoute ===
    STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE;
  report.checks.bindingBackendIdentity = residentBinding.effectiveBackend === 'webgpu' &&
    residentBinding.cpuFallbackUsed === false;
  report.checks.bindingCompactValidation = residentBinding.compactValidation?.ok === true;
  report.checks.bindingProducedEvents = residentBinding.binding?.eventCount > 0 &&
    residentBinding.binding.eventCount === residentBinding.binding.events?.length;
  report.checks.bindingReducedDamage = boundPage.summary.brokenBondCount < brokenBeforeBinding &&
    boundPage.summary.repairedBondCount >= residentBinding.binding.eventCount &&
    boundPage.summary.componentCount <= componentCountBeforeBinding;
  report.checks.bindingGpuVisibleCoherence = JSON.stringify(
    residentBinding.gpuStructuralState?.finalBondLiveness,
  ) === JSON.stringify(boundPage.visibleBinding?.finalBondLiveness) &&
    JSON.stringify(residentBinding.gpuStructuralState?.componentLabels) ===
      JSON.stringify(boundPage.visibleBinding?.componentLabels);
  report.checks.bindingMutationProvenance = residentBinding.binding.events.every(event =>
    event.eventEpoch === residentBinding.eventEpoch &&
    event.previousAlive === false &&
    event.cause === 'operator-binding' &&
    event.distance <= residentBinding.binding.effective.radius + 0.000001
  );
  report.checks.bindingStayedResident = residentBinding.lifecycle?.deviceRequestCount === 1 &&
    residentBinding.lifecycle?.pipelineCreateCount === 3 &&
    residentBinding.lifecycle?.bufferAllocationCount === 9 &&
    residentBinding.lifecycle?.reinitializeCount === reinitializeCountBeforeBinding;
  report.checks.bindingPreservedCamera = JSON.stringify(bindingCameraBefore) === JSON.stringify(
    await evaluate('window.__structuralMaterial3dCameraWitness().state'),
  );
  for (const name of [
    'bindingStatusPassed',
    'bindingRouteIdentity',
    'bindingBackendIdentity',
    'bindingCompactValidation',
    'bindingProducedEvents',
    'bindingReducedDamage',
    'bindingGpuVisibleCoherence',
    'bindingMutationProvenance',
    'bindingStayedResident',
    'bindingPreservedCamera',
  ]) assertCheck(report.checks[name], `GPU resident binding check failed: ${name}`);

  const boundFingerprint = {
    finalBondLiveness: boundPage.visibleBinding.finalBondLiveness,
    componentLabels: boundPage.visibleBinding.componentLabels,
    brokenBondCount: boundPage.summary.brokenBondCount,
    repairedBondCount: boundPage.summary.repairedBondCount,
    componentCount: boundPage.summary.componentCount,
  };
  const duplicateBinding = await evaluate(
    `window.__structuralMaterial3dRunGpuBinding(${JSON.stringify(residentBinding.binding.effective)})`,
    true,
  );
  const duplicatePage = await evaluate('window.__structuralMaterial3dWitness()');
  const duplicateFingerprint = {
    finalBondLiveness: duplicatePage.visibleBinding.finalBondLiveness,
    componentLabels: duplicatePage.visibleBinding.componentLabels,
    brokenBondCount: duplicatePage.summary.brokenBondCount,
    repairedBondCount: duplicatePage.summary.repairedBondCount,
    componentCount: duplicatePage.summary.componentCount,
  };
  report.duplicateBinding = duplicateBinding;
  report.checks.duplicateBindingNoOp = duplicateBinding.status === 'passed' &&
    duplicateBinding.binding?.noOp === true &&
    duplicateBinding.binding?.eventCount === 0 &&
    JSON.stringify(boundFingerprint) === JSON.stringify(duplicateFingerprint) &&
    JSON.stringify(boundPage.visibleBinding) === JSON.stringify(duplicatePage.visibleBinding);
  assertCheck(report.checks.duplicateBindingNoOp, 'duplicate binding contact was not an exact no-op');

  report.failurePhase = 'post-dispatch-rollback-recovery';
  report.rollbackRecovery = await evaluate(
    'window.__structuralMaterial3dRunGpuBindingRollbackWitness()',
    true,
  );
  report.checks.postDispatchRollbackRecovery = report.rollbackRecovery?.status === 'passed' &&
    report.rollbackRecovery?.rejected?.status === 'failed' &&
    report.rollbackRecovery?.rejected?.failurePhase === 'compact-binding-receipt-validation' &&
    report.rollbackRecovery?.recovered?.status === 'passed' &&
    report.rollbackRecovery?.recovered?.binding?.eventCount ===
      report.rollbackRecovery?.expectedRepairEventCount &&
    report.rollbackRecovery?.recovered?.binding?.eventCount > 0 &&
    report.rollbackRecovery?.recovered?.lifecycle?.rollbackCount === 1 &&
    report.rollbackRecovery?.recovered?.lifecycle?.rollbackFailureCount === 0;
  assertCheck(
    report.checks.postDispatchRollbackRecovery,
    'a rejected post-dispatch bind did not restore the accepted resident snapshot',
  );

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
    return status?.textContent.includes('GPU bind no-op | repaired 12') && status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE)};
  })()`);
  report.checks.noHorizontalOverflow = await evaluate('document.documentElement.scrollWidth === document.documentElement.clientWidth');
  assertCheck(report.checks.routeStatusVisible, 'operator-visible GPU binding status lacks effective-route identity');
  assertCheck(report.checks.noHorizontalOverflow, 'GPU binding route has horizontal overflow');

  report.failurePhase = 'post-binding-refracture';
  const repairedBondIndices = residentBinding.binding.events.map(event => event.bondIndex);
  const refracture = await evaluate(
    `window.__structuralMaterial3dRunGpuSympatheticTear({ interaction: ${JSON.stringify(dragged.forceEnvelope)} })`,
    true,
  );
  const refracturedPage = await evaluate('window.__structuralMaterial3dWitness()');
  report.postBindingRefracture = refracture;
  report.checks.postBindingRefracture = refracture.status === 'passed' &&
    repairedBondIndices.some(index => refracture.gpuStructuralState?.finalBondLiveness?.[index] === false) &&
    refracturedPage.summary.brokenBondCount > duplicatePage.summary.brokenBondCount;
  assertCheck(report.checks.postBindingRefracture, 'the causative force could not refracture a repaired GPU edge');

  report.failurePhase = 'reset';
  const denseFingerprint = {
    finalBondLiveness: notched.gpuStructuralState.finalBondLiveness,
    componentLabels: notched.gpuStructuralState.componentLabels,
    brokenBondCount: pageAfter.summary.brokenBondCount,
    componentCount: pageAfter.summary.componentCount,
  };
  const reinitializeCountBeforeReset = pageAfter.gpuHotSidecar?.lifecycle?.reinitializeCount || 0;
  await evaluate("document.querySelector('#reset').click()");
  const resetDeadline = Date.now() + config.loadTimeoutMs;
  let reset = await evaluate('window.__structuralMaterial3dWitness()');
  while (Date.now() < resetDeadline) {
    reset = await evaluate('window.__structuralMaterial3dWitness()');
    if (reset.summary.brokenBondCount === 0 &&
        reset.summary.componentCount === 1 &&
        reset.gpuHotSidecar?.lifecycle?.reinitializeCount > reinitializeCountBeforeReset) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  const cameraReset = await evaluate('window.__structuralMaterial3dCameraWitness().state');
  report.checks.resetRestoredTopology = reset.summary.brokenBondCount === 0 &&
    reset.summary.componentCount === 1 &&
    reset.visibleTear === null &&
    reset.visibleBinding === null;
  report.checks.resetPreservedCamera = JSON.stringify(cameraAfter) === JSON.stringify(cameraReset);
  assertCheck(report.checks.resetRestoredTopology, 'reset did not restore pristine topology');
  assertCheck(report.checks.resetPreservedCamera, 'reset changed operator camera state');

  report.failurePhase = 'sampling-invariance';
  const finalCompletedBeforeCoarse = reset.liveDrag?.scheduler?.finalCompletedCount || 0;
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
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...dragEnd,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  const coarseDeadline = Date.now() + config.loadTimeoutMs;
  let coarse = reset;
  while (Date.now() < coarseDeadline) {
    coarse = await evaluate('window.__structuralMaterial3dWitness()');
    if (coarse.liveDrag?.scheduler?.finalCompletedCount > finalCompletedBeforeCoarse &&
        coarse.liveDrag?.scheduler?.pointerExecutionActive === false &&
        coarse.liveDrag?.scheduler?.pendingInteractionId === null) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  const coarseFingerprint = {
    finalBondLiveness: coarse.gpuSympatheticTear?.gpuStructuralState?.finalBondLiveness,
    componentLabels: coarse.gpuSympatheticTear?.gpuStructuralState?.componentLabels,
    brokenBondCount: coarse.summary?.brokenBondCount,
    componentCount: coarse.summary?.componentCount,
  };
  report.sampling = {
    denseMoveCount: denseDragSamples.length,
    coarseMoveCount: 1,
    denseScheduler: pageAfter.liveDrag.scheduler,
    coarseScheduler: coarse.liveDrag.scheduler,
    denseFingerprint,
    coarseFingerprint,
  };
  report.checks.samplingInvariant = JSON.stringify(denseFingerprint) === JSON.stringify(coarseFingerprint);
  report.checks.samplingPreservedCamera = JSON.stringify(cameraAfter) === JSON.stringify(
    await evaluate('window.__structuralMaterial3dCameraWitness().state'),
  );
  assertCheck(report.checks.samplingInvariant, 'dense and coarse pointer sampling produced different structural state');
  assertCheck(report.checks.samplingPreservedCamera, 'sampling-invariance interaction changed operator camera state');

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
    residentBinding: report.residentBinding,
    visibleBinding: report.visibleBinding,
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
