#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE } from './structural-material-3d-webgpu-hot-sidecar.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE } from './structural-material-3d-webgpu-tear.js';
import {
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
} from './structural-material-3d-resident-solver.js';

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

async function captureVisibleScreenshot(send, evaluate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  while (Date.now() < deadline) {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const probe = await probeScreenshot(evaluate, capture.data);
    attempts.push({
      attempt: attempts.length + 1,
      nonDarkPixels: probe.nonDarkPixels,
      structuralColorPixels: probe.structuralColorPixels,
    });
    if (probe.nonDarkPixels >= 500 && probe.structuralColorPixels >= 180) {
      return {
        capture,
        probe: {
          ...probe,
          minimumNonDarkPixels: 500,
          minimumStructuralColorPixels: 180,
          attempts,
        },
      };
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`hot sidecar screenshot remained blank for ${attempts.length} attempts`);
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
  const cameraBefore = await evaluate('window.__structuralMaterial3dCameraWitness().state');

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
    livePage.gpuTearDiscardedCount === 0;
  report.checks.cameraPreserved = JSON.stringify(cameraBefore) === JSON.stringify(cameraAfter);
  report.checks.visibleSeparation = livePage.visibleTear?.components?.some(component =>
    !component.pinned && component.maxDisplacement > 0.000001) &&
    livePage.visibleTear.components.filter(component => component.pinned)
      .every(component => component.maxPinnedDisplacement < 0.000001);

  report.failurePhase = 'visual-evidence';
  const screenshotEvidence = await captureVisibleScreenshot(send, evaluate, config.loadTimeoutMs);
  report.screenshotPixelProbe = screenshotEvidence.probe;
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(screenshotEvidence.capture.data, 'base64'));
  report.checks.actualScreenshotPixels = report.screenshotPixelProbe.nonDarkPixels >=
      report.screenshotPixelProbe.minimumNonDarkPixels &&
    report.screenshotPixelProbe.structuralColorPixels >=
      report.screenshotPixelProbe.minimumStructuralColorPixels;
  report.checks.routeStatusVisible = await evaluate(`(() => {
    const status = document.querySelector('#gpu-status');
    return status?.textContent.includes('GPU tear passed') &&
      status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE)};
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
