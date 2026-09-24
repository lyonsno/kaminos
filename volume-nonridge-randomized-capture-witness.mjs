#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  NONRIDGE_RANDOMIZED_CAPTURE_IDENTITY,
  buildNonRidgeRandomizedControlTranche,
} from './volume-nonridge-randomized-capture-contract.mjs';

const REPORT_IDENTITY = 'kaminos.volume.positive-nonridge-randomized-control-witness.v0';
const NEGATIVE_CAPTURE_RECEIPT = Object.freeze({ status: 'captured-negative' });
const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-nonridge-randomized-capture'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const timeoutMs = Number(args.get('--timeout-ms') || 240000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const trancheIndex = Number(args.get('--tranche-index') || 0);
const interiorCount = Number(args.get('--interior-count') || 30);
const selectedSettingIndex = args.has('--setting-index') ? Number(args.get('--setting-index')) : null;
const viewportWidth = Number(args.get('--viewport-width') || 512);
const viewportHeight = Number(args.get('--viewport-height') || 512);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-nonridge-randomized-capture-profile-');
const design = buildNonRidgeRandomizedControlTranche({ trancheIndex, interiorCount });
const selectedRows = selectedSettingIndex === null
  ? design.rows.map((row, index) => ({ ...row, designIndex: index }))
  : [{ ...design.rows[selectedSettingIndex], designIndex: selectedSettingIndex }];

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { design };
const captures = [];

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.socket?.close();
  }
}

try {
  assert.ok(Number.isInteger(trancheIndex) && trancheIndex >= 0, 'tranche index must be a nonnegative integer');
  assert.ok(selectedRows.every(row => row && Number.isInteger(row.designIndex)), 'requested setting index is outside the deterministic design');
  assert.ok(Number.isInteger(viewportWidth) && viewportWidth >= 64, 'viewport width must be at least 64');
  assert.ok(Number.isInteger(viewportHeight) && viewportHeight >= 64, 'viewport height must be at least 64');
  const route = new URL(requestedUrl);
  assert.equal(route.hostname, '127.0.0.1', 'witness route must be caller-owned localhost');

  failurePhase = 'browser-launch';
  browser = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { design, admitted };
  assert.equal(admitted.active, true, 'volume renderer did not become active');
  assert.ok(admitted.backend?.startsWith('WebGPU'), 'effective backend substituted away from WebGPU');
  assert.equal(admitted.effectiveRole, 'truthHigh', 'effective source role substituted away from truthHigh');
  assert.equal(admitted.effectiveComposition, 'raymarch-only-v0', 'effective composition substituted away from raymarch-only');
  await delay(settleMs);

  failurePhase = 'freeze-authority';
  const frozen = await evaluate(socket, `(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    if (!prototype?.beginDebugNonRidgeOpticalCapture || !prototype?.readDebugNonRidgeOpticalCaptureChunk || !prototype?.releaseDebugNonRidgeOpticalCapture) {
      throw new Error('positive-nonridge-optical-capture-api-missing');
    }
    prototype.setSelectiveHeadLiveCapturePaused(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = prototype.debugState();
    const digest = async value => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    };
    return {
      stateIdentity: {
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        grid: state.simGrid,
        stateHash: await digest({ frameCount: state.frameCount, simStepCount: state.simStepCount, grid: state.simGrid }),
      },
      cameraIdentity: {
        pose: basinWindow.kaminosCameraDebugState?.() || null,
        hash: await digest(basinWindow.kaminosCameraDebugState?.() || null),
      },
      smokeIdentity: {
        authoredSmoke: state.controls?.smoke,
        presentationRequested: state.raymarchSmokePresentationRequested,
        presentationEffective: state.raymarchSmokePresentationEffective,
      },
      rayIdentity: {
        raySteps: state.controls?.raySteps,
        adaptiveRays: state.controls?.adaptiveRays,
        runtimeQualityRequested: state.runtimeQualityRequested,
        runtimeQualityEffective: state.runtimeQualityEffective,
      },
      footprintIdentity: {
        radius: state.controls?.boundarySplatRadius,
        sharpness: state.controls?.boundarySplatSharpness,
        covariance: state.controls?.boundarySplatCovariance || null,
        depthPolicy: state.controls?.boundarySplatDepthPolicy || null,
      },
      effectiveFrameFootprint: {
        renderWidth: state.renderWidth,
        renderHeight: state.renderHeight,
        displayWidth: state.displayWidth,
        displayHeight: state.displayHeight,
      },
      captureTimeMs: performance.now(),
      wrapperRequestedRoute: state.requestedRoute,
      rendererEffectiveRoute: state.effectiveRoute,
      backend: state.backend,
    };
  })()`);
  lastTrustworthyEvidence = { design, admitted, frozen };
  const { renderWidth, renderHeight } = frozen.effectiveFrameFootprint;
  assert.ok(
    renderWidth >= 64 && renderHeight >= 64,
    `degenerate effective renderer footprint: requested ${viewportWidth}x${viewportHeight}, effective ${renderWidth}x${renderHeight}`,
  );

  for (const setting of selectedRows) {
    failurePhase = `setting-${setting.designIndex}-control-application`;
    const settingStarted = performance.now();
    const application = await evaluate(socket, `(async () => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      const apply = basinWindow.kaminosApplyVolumeControlsSnapshot || window.kaminosApplyVolumeControlsSnapshot;
      if (typeof apply !== 'function') throw new Error('native-volume-control-snapshot-application-missing');
      const receipt = apply(${JSON.stringify(setting.requestedControls)});
      const capture = await prototype.beginDebugNonRidgeOpticalCapture({ captureTimeMs: ${JSON.stringify(frozen.captureTimeMs)} });
      const state = prototype.debugState();
      const boundary = state.reactionBoundaryControls || {};
      const fire = state.reactionBoundaryFireControls || {};
      const gpuEffectiveControls = {
        reactionBoundarySupportThermal: boundary.supportThermal,
        reactionBoundarySupportReaction: boundary.supportReaction,
        reactionBoundarySupportFront: boundary.supportFront,
        reactionBoundarySupportInterface: boundary.supportInterface,
        reactionBoundaryGradient: boundary.gradientGain,
        reactionBoundaryCut: boundary.cut,
        reactionBoundarySoftness: boundary.softness,
        reactionBoundaryCoreReject: boundary.coreReject,
        reactionBoundaryTopology: boundary.topologyGain,
        reactionBoundaryCurl: boundary.curlGain,
        reactionBoundaryDivergence: boundary.divergenceGain,
        reactionBoundaryFireRidge: fire.ridgeGain,
        reactionBoundaryFireRidgeCut: fire.ridgeCut,
        reactionBoundaryFireTip: fire.tipBreakup,
        reactionBoundaryFireErosion: fire.topologyErosion,
      };
      return { receipt, capture, state, gpuEffectiveControls };
    })()`);
    assert.equal(application.receipt?.status, 'applied', `setting ${setting.designIndex} control application failed`);
    assert.deepEqual(application.receipt?.substitutions, [], `setting ${setting.designIndex} had control substitutions`);
    const receiptEffectiveControls = Object.fromEntries(
      Object.keys(setting.requestedControls).map(key => [key, application.receipt.effectiveControls[key]]),
    );
    assert.deepEqual(
      application.gpuEffectiveControls,
      receiptEffectiveControls,
      `setting ${setting.designIndex} GPU-effective controls diverged from the receipt`,
    );
    assert.equal(application.capture?.ok, true, `setting ${setting.designIndex} capture failed: ${JSON.stringify(application.capture)}`);
    assert.equal(application.capture?.requestedRoute, 'native-3d-compute-fluid-raymarch-v0');
    assert.equal(application.capture?.effectiveRoute, admitted.rendererEffectiveRoute);
    assert.equal(application.capture?.rendererPassReceipt?.raymarchApplied, true);
    assert.equal(application.capture?.rendererPassReceipt?.splatsApplied, false);
    assert.equal(application.capture?.rendererPassReceipt?.fallbackReason, null);
    assert.equal(application.capture?.positiveRecomposition?.exactWithinFloat32, true);
    assert.equal(application.state.frameCount, frozen.stateIdentity.frameCount, 'capture advanced the frozen frame');
    assert.equal(application.state.simStepCount, frozen.stateIdentity.simStepCount, 'capture advanced the frozen simulation');

    failurePhase = `setting-${setting.designIndex}-row-drain`;
    const rowFileName = `setting-${String(setting.designIndex).padStart(3, '0')}-rows.f32`;
    const rowPath = resolve(outDir, rowFileName);
    const handle = openSync(rowPath, 'w');
    const hash = createHash('sha256');
    let startFloat = 0;
    let drainedBytes = 0;
    try {
      while (true) {
        const chunk = await evaluate(socket, `(() => {
          const basinWindow = document.querySelector('#basin')?.contentWindow || window;
          const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
          return prototype.readDebugNonRidgeOpticalCaptureChunk(${JSON.stringify({
            sessionId: application.capture.sessionId,
            startFloat: '__START_FLOAT__',
            floatCount: 262144,
          }).replace('"__START_FLOAT__"', String(startFloat))});
        })()`);
        assert.equal(chunk?.ok, true, `setting ${setting.designIndex} chunk read failed`);
        assert.equal(chunk.startFloat, startFloat, `setting ${setting.designIndex} chunk offset drifted`);
        const bytes = Buffer.from(chunk.base64, 'base64');
        assert.equal(bytes.byteLength, chunk.byteLength, `setting ${setting.designIndex} chunk byte length drifted`);
        writeSync(handle, bytes);
        hash.update(bytes);
        drainedBytes += bytes.byteLength;
        startFloat += chunk.floatCount;
        if (chunk.isFinal) break;
      }
    } finally {
      closeSync(handle);
    }
    assert.equal(drainedBytes, application.capture.byteLength, `setting ${setting.designIndex} drained a partial row payload`);

    failurePhase = `setting-${setting.designIndex}-preview`;
    const preview = await evaluate(socket, `(async () => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      const prior = prototype.debugState().appearanceDecompositionRequestedRaw || 'off';
      prototype.setAppearanceDecompositionMode('non-ridge-emission');
      const sample = await prototype.sampleFrame({
        advanceSim: false,
        includeRgba: true,
        now: ${JSON.stringify(frozen.captureTimeMs)},
        sameStateCaptureId: ${JSON.stringify(`nonridge-randomized-f${frozen.stateIdentity.frameCount}-s${frozen.stateIdentity.simStepCount}`)},
        baseFrameCount: ${JSON.stringify(frozen.stateIdentity.frameCount)},
        baseSimStepCount: ${JSON.stringify(frozen.stateIdentity.simStepCount)},
      });
      prototype.setAppearanceDecompositionMode(prior);
      if (!sample.ok || !sample.image?.rgba?.length) throw new Error('nonridge-preview-capture-failed:' + (sample.reason || 'missing-rgba'));
      const canvas = document.createElement('canvas');
      canvas.width = sample.image.width;
      canvas.height = sample.image.height;
      canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(sample.image.rgba), sample.image.width, sample.image.height), 0, 0);
      let litPixels = 0;
      let lumaSum = 0;
      for (let index = 0; index < sample.image.rgba.length; index += 4) {
        const luma = 0.2126 * sample.image.rgba[index] + 0.7152 * sample.image.rgba[index + 1] + 0.0722 * sample.image.rgba[index + 2];
        litPixels += luma > 8 ? 1 : 0;
        lumaSum += luma;
      }
      return {
        pngDataUrl: canvas.toDataURL('image/png'),
        width: sample.image.width,
        height: sample.image.height,
        litPixels,
        meanLuma: lumaSum / Math.max(1, sample.image.rgba.length / 4),
        rendererPassReceipt: sample.presentationApplication?.appliedPasses || sample.selectiveHeadLivePassReceipt || null,
      };
    })()`);
    const previewFileName = `setting-${String(setting.designIndex).padStart(3, '0')}-nonridge.png`;
    writeFileSync(resolve(outDir, previewFileName), decodePngDataUrl(preview.pngDataUrl));

    const release = await evaluate(socket, `(() => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      return prototype.releaseDebugNonRidgeOpticalCapture(${JSON.stringify({ sessionId: application.capture.sessionId })});
    })()`);
    assert.equal(release?.ok, true, `setting ${setting.designIndex} capture release failed`);

    const status = application.capture.rowCount === 0 ? NEGATIVE_CAPTURE_RECEIPT.status : 'captured';
    captures.push({
      settingId: setting.settingId,
      designIndex: setting.designIndex,
      role: setting.role,
      status,
      requestedControls: setting.requestedControls,
      effectiveControls: receiptEffectiveControls,
      gpuEffectiveControls: application.gpuEffectiveControls,
      substitutions: application.receipt.substitutions,
      stateIdentity: frozen.stateIdentity,
      cameraIdentity: frozen.cameraIdentity,
      smokeIdentity: frozen.smokeIdentity,
      rayIdentity: frozen.rayIdentity,
      footprintIdentity: frozen.footprintIdentity,
      effectiveFrameFootprint: frozen.effectiveFrameFootprint,
      wrapperRequestedRoute: admitted.wrapperRequestedRoute,
      rendererRequestedRoute: application.capture.requestedRoute,
      rendererEffectiveRoute: application.capture.effectiveRoute,
      backend: application.capture.backend,
      rendererPassReceipt: application.capture.rendererPassReceipt,
      rowCapture: {
        identity: application.capture.identity,
        sessionId: application.capture.sessionId,
        rowCount: application.capture.rowCount,
        strideFloats: application.capture.strideFloats,
        byteLength: application.capture.byteLength,
        allocationAuthority: application.capture.allocationAuthority,
        cohortIdentity: application.capture.cohortIdentity,
        sourceIdentity: application.capture.sourceIdentity,
        path: relative(process.cwd(), rowPath),
        sha256: hash.digest('hex'),
      },
      featureViews: {
        current16: 'sidecar[4]+material[4]+fire[4]+micro[4]',
        sourceCompleteCandidate: 'velocity[4]+thermal/reaction/front/interface[4]+frontTopology/coreBody/curl/divergence[4]',
        authoredControlsStoredSeparately: true,
      },
      positiveRecomposition: application.capture.positiveRecomposition,
      preview: {
        path: relative(process.cwd(), resolve(outDir, previewFileName)),
        width: preview.width,
        height: preview.height,
        litPixels: preview.litPixels,
        meanLuma: preview.meanLuma,
        rendererPassReceipt: preview.rendererPassReceipt,
      },
      measuredWallMs: performance.now() - settingStarted,
    });
    lastTrustworthyEvidence = { design, admitted, frozen, captures };
  }

  failurePhase = 'frozen-authority-verification';
  const after = await evaluate(socket, `(() => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    const state = prototype.debugState();
    return {
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      camera: basinWindow.kaminosCameraDebugState?.() || null,
    };
  })()`);
  assert.equal(after.frameCount, frozen.stateIdentity.frameCount, 'assay changed the frozen frame');
  assert.equal(after.simStepCount, frozen.stateIdentity.simStepCount, 'assay changed the frozen simulation step');
  assert.deepEqual(after.camera, frozen.cameraIdentity.pose, 'assay changed the frozen camera');

  const report = {
    schema: REPORT_IDENTITY,
    identity: NONRIDGE_RANDOMIZED_CAPTURE_IDENTITY,
    status: selectedSettingIndex === null ? 'captured-tranche' : 'captured-explicit-setting-subset',
    failurePhase: null,
    requestedUrl,
    admitted,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 },
    design,
    selectedSettingIndexes: selectedRows.map(row => row.designIndex),
    selectionAuthority: selectedSettingIndex === null ? 'entire-requested-tranche' : 'explicit-cli-setting-index',
    frozen,
    after,
    captures,
    uncappedRetainedSettingCount: captures.length,
    stoppingEvidence: {
      designFullRank: design.coverage.fullRank,
      interiorBoundaryCoverage: Object.values(design.coverage.fields).every(field => field.minimumCovered && field.maximumCovered && field.interiorCovered),
      verdictStabilized: false,
      stopped: false,
      reason: 'capture tranche only; Tiger verdict stabilization remains pending',
    },
    browserEvents: socket.browserEvents.map(summarizeBrowserEvent),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, status: report.status, captures: captures.length }, null, 2));
} catch (error) {
  const report = {
    schema: REPORT_IDENTITY,
    identity: NONRIDGE_RANDOMIZED_CAPTURE_IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 },
    design,
    captures,
    lastTrustworthyEvidence,
    browserEvents: socket?.browserEvents?.map(summarizeBrowserEvent) || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`${name} is required`);
  return String(value);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(value || ''));
  if (!match) throw new Error('capture did not return a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome DevTools target');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    last = await evaluate(cdp, `(() => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const wrapper = operator?.debugState?.() || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const state = (window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype)?.debugState?.();
      return {
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        effectiveRole: wrapper?.effectiveRole || state?.selectiveHeadLiveEffectiveRole || null,
        effectiveComposition: wrapper?.effectiveComposition || state?.selectiveHeadLiveCompositionEffective || null,
        active: state?.active === true,
        backend: state?.backend || null,
        error: state?.error || null,
        wrapperRequestedRoute: state?.requestedRoute || null,
        rendererEffectiveRoute: state?.effectiveRoute || null,
        prototypeIdentity: state?.prototypeIdentity || null,
      };
    })()`);
    if (last?.wrapperStatus === 'failed') throw new Error(`operator wrapper admission failed: ${last.wrapperError || 'missing-wrapper-error'}`);
    if (last?.active && last?.backend?.startsWith('WebGPU') && last?.effectiveRole === 'truthHigh' && last?.effectiveComposition === 'raymarch-only-v0') return last;
    if (last?.error) throw new Error(`renderer route failed: ${last.error}`);
    await delay(250);
  }
  throw new Error(`timed out waiting for admitted volume runtime: ${JSON.stringify(last)}`);
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return {
      method: event.method,
      text: details.exception?.description || details.text || null,
      url: details.url || null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null,
    };
  }
  if (event.method === 'Log.entryAdded') {
    return {
      method: event.method,
      level: event.params?.entry?.level || null,
      text: event.params?.entry?.text || null,
      url: event.params?.entry?.url || null,
    };
  }
  return {
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}
