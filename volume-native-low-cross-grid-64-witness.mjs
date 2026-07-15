#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-cross-grid-64-witness.v0';
const IDENTITY = 'native-low-cross-grid-64-witness-v0';
const ROUTE = 'native-low-live-browser-webgpu-inference-v0';
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const MODEL_SHA256 = 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9';
const TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';
const SUPPORT_THRESHOLD = 0.98;
const PREDICTED_POSITIVE_COUNT = 131573;
const NATIVE64_MODE_MARKERS = Object.freeze({
  native64CrossGridDiscriminant: 'native64CrossGridDiscriminant',
  native64NoModelControl: 'native64NoModelControl',
  native64SelectivePredicted: 'native64SelectivePredicted',
  macroStructureDecision: 'requires-visual-inspection-v0',
  blankFrameRejection: 'blankFrameRejection',
  cachedFrameRejection: 'cachedFrameRejection',
});
const args = parseArgs(process.argv.slice(2));
const sourceManifest = resolve(String(args.get('--source-manifest') || '/private/tmp/kaminos-native-low-cross-grid-64-zero-shot-0715/native-step96/manifest.json'));
const predictionManifest = resolve(String(args.get('--prediction-manifest') || '/private/tmp/kaminos-native-low-cross-grid-64-zero-shot-0715/predicted-step96/manifest.json'));
const out = resolve(String(args.get('--out') || '/tmp/kaminos-native-low-cross-grid-64-shared.png'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-native-low-cross-grid-64-shared.json'));
const timeoutMs = Number(args.get('--timeout-ms') || 300000);
const assetPort = Number(args.get('--asset-port') || randomInt(18000, 26000));
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const repoBasename = import.meta.url.match(/\/([^/]+)\/volume-native-low-cross-grid-64-witness\.mjs$/)?.[1] || 'kaminos-kaminos-pyro-selective-motion-witness-0713-kaminos-pyro-native-transfer-forgemaster-0714';
let failurePhase = 'argument-validation';
let browser = null;
let server = null;
let socket = null;
let lastTrustworthyEvidence = {};

class CdpSocket {
  constructor(socketUrl) {
    this.socketUrl = socketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.socketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  assert.ok(existsSync(sourceManifest), `missing source manifest: ${sourceManifest}`);
  assert.ok(existsSync(predictionManifest), `missing prediction manifest: ${predictionManifest}`);
  assert.ok(timeoutMs >= 30000, '--timeout-ms must leave room for 160-grid manifest materialization');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  failurePhase = 'asset-server-launch';
  server = spawn('python3', ['-m', 'http.server', String(assetPort), '--bind', '127.0.0.1'], {
    cwd: '/private/tmp',
    stdio: 'ignore',
  });
  await waitForHttp(`http://127.0.0.1:${assetPort}/`, timeoutMs);

  const routeUrl = buildRouteUrl();
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1500,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Page.navigate', { url: routeUrl });

  failurePhase = 'route-settle';
  const settleStarted = performance.now();
  let state = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive?.debugState?.()');
    lastTrustworthyEvidence = { routeSettle: state };
    if (state?.status === 'failed') throw new Error(state?.lastTrustworthyEvidence?.error || state?.failurePhase || 'native-64 route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'captured'
      && state?.frameIndex >= 1
      && state?.native64CrossGridDiscriminant?.identity === 'native-64-cross-grid-zero-shot-discriminant-v0'
      && state?.native64NoModelControl?.grid === 64
      && state?.native64SelectivePredicted?.grid === 160
      && state?.modelIdentity === MODEL
      && state?.modelSha256 === MODEL_SHA256
      && state?.supportThreshold === SUPPORT_THRESHOLD
      && state?.predictedPositiveCount === PREDICTED_POSITIVE_COUNT
      && state?.requestedComposition === 'splat-only-v0'
      && state?.effectiveComposition === 'splat-only-v0'
      && state?.requestedCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.effectiveCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.modelOutputMutation === false
      && state?.requestedBackend === 'WebGPU'
      && isWebGpuBackend(state?.effectiveBackend)
      && state?.fallbackBackend === null
      && state?.transportMode === TRANSPORT_MODE
      && state?.runtimeTruthAvailable === false
      && state?.syntheticDownsampleApplied === false
      && state?.sameNativeStateIdentity
      && !state?.sourceStepDrift
      && !state?.controlTreatmentCausalDivergence
      && Number(state?.treatmentSplatInstanceCount) > 0
      && Number(state?.controlSplatInstanceCount) >= 0
      && state?.native64ManifestMaterializationProfile?.writeCurrentBuffersOnly === true
      && state?.native64ManifestMaterializationProfile?.hiddenReceiverCopy === false
      && Number(state?.treatmentMaterializeMs) >= 0
      && Number(state?.treatmentRenderMs) >= 0
      && Number(state?.endToEndFrameMs) >= 0
    ) break;
    await delay(250);
  }

  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'captured', 'native-64 route did not capture');
  assert.equal(state?.native64CrossGridDiscriminant?.identity, 'native-64-cross-grid-zero-shot-discriminant-v0', 'wrong native-64 discriminant identity');
  assert.equal(state?.native64NoModelControl?.grid, 64, 'native64 no-model control is not grid 64');
  assert.equal(state?.native64SelectivePredicted?.grid, 160, 'native64 predicted treatment is not grid 160');
  assert.equal(state?.modelIdentity, MODEL, 'wrong model identity');
  assert.equal(state?.modelSha256, MODEL_SHA256, 'wrong model checksum');
  assert.equal(state?.supportThreshold, SUPPORT_THRESHOLD, 'wrong support threshold');
  assert.equal(state?.predictedPositiveCount, PREDICTED_POSITIVE_COUNT, 'wrong predicted support count');
  assert.equal(state?.requestedComposition, 'splat-only-v0', 'wrong requested composition');
  assert.equal(state?.effectiveComposition, 'splat-only-v0', 'requested/effective composition drift');
  assert.equal(state?.requestedCalibration, 'native-low-learned-splat-calibration-v0', 'wrong requested calibration');
  assert.equal(state?.effectiveCalibration, 'native-low-learned-splat-calibration-v0', 'wrong effective calibration');
  assert.equal(state?.modelOutputMutation, false, 'calibration mutated model outputs');
  assert.equal(state?.requestedBackend, 'WebGPU', 'wrong requested backend');
  assert.ok(isWebGpuBackend(state?.effectiveBackend), `fallback backend used: ${state?.effectiveBackend}`);
  assert.equal(state?.fallbackBackend, null, 'fallback backend evidence is not admissible');
  assert.equal(state?.transportMode, TRANSPORT_MODE, 'wrong shared-device transport mode');
  assert.equal(state?.runtimeTruthAvailable, false, 'truth authority leaked into runtime');
  assert.equal(state?.syntheticDownsampleApplied, false, 'synthetic downsample leaked into runtime');
  assert.equal(state?.sourceStepDrift, null, 'source-step drift detected');
  assert.equal(state?.controlTreatmentCausalDivergence, null, 'control/treatment causal divergence detected');
  assert.ok(Number(state?.treatmentSplatInstanceCount) > 0, 'splat materialization produced no treatment splats');
  assert.equal(state?.native64ManifestMaterializationProfile?.writeCurrentBuffersOnly, true, 'native-64 manifest route did not use current-buffer-only writes');
  assert.equal(state?.native64ManifestMaterializationProfile?.hiddenReceiverCopy, false, 'native-64 manifest route used a hidden receiver copy');

  failurePhase = 'blankFrameRejection';
  const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = Buffer.from(capture.data || '', 'base64');
  assert.ok(screenshot.byteLength > 1000, 'blankFrameRejection: screenshot missing or blank');
  failurePhase = 'cachedFrameRejection';
  assert.ok(state?.sameNativeStateIdentity, 'cachedFrameRejection: missing native state identity');
  assert.ok(state?.sourceManifestSha256 && state?.predictionManifestSha256, 'cachedFrameRejection: missing manifest checksums');
  assert.ok(state?.frameCacheKey?.includes(state.sameNativeStateIdentity), 'cachedFrameRejection: frame cache key does not bind source identity');
  writeFileSync(out, screenshot);

  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    requestedUrl: routeUrl,
    effectiveRoute: state.routeIdentity,
    native64CrossGridDiscriminant: state.native64CrossGridDiscriminant,
    native64NoModelControl: state.native64NoModelControl,
    native64SelectivePredicted: state.native64SelectivePredicted,
    macroStructureDecision: state.macroStructureDecision,
    coarseMacroStructurePreserved: state.coarseMacroStructurePreserved,
    templateReplacementRisk: state.templateReplacementRisk,
    sourceManifest: state.native64SourceManifestUrl,
    predictionManifest: state.native64PredictionManifestUrl,
    sourceManifestSha256: state.sourceManifestSha256,
    predictionManifestSha256: state.predictionManifestSha256,
    requestedComposition: state.requestedComposition,
    effectiveComposition: state.effectiveComposition,
    requestedCalibration: state.requestedCalibration,
    effectiveCalibration: state.effectiveCalibration,
    nativeLowTreatmentSplatCalibration: state.nativeLowTreatmentSplatCalibration,
    native64ManifestMaterializationProfile: state.native64ManifestMaterializationProfile,
    modelOutputMutation: state.modelOutputMutation,
    requestedBackend: state.requestedBackend,
    effectiveBackend: state.effectiveBackend,
    transportMode: state.transportMode,
    modelIdentity: state.modelIdentity,
    modelSha256: state.modelSha256,
    supportThreshold: state.supportThreshold,
    predictedPositiveCount: state.predictedPositiveCount,
    supportPrevalence: state.supportPrevalence,
    treatmentSplatCandidateCount: state.treatmentSplatCandidateCount,
    treatmentSplatInstanceCount: state.treatmentSplatInstanceCount,
    controlSplatCandidateCount: state.controlSplatCandidateCount,
    controlSplatInstanceCount: state.controlSplatInstanceCount,
    calibrationGain: state.calibrationGain,
    blankTreatmentAttribution: state.blankTreatmentAttribution,
    manifestFetchMs: state.stageTiming?.manifestFetchMs,
    controlMaterializeMs: state.stageTiming?.controlMaterializeMs,
    controlRebuildMs: state.stageTiming?.controlRebuildMs,
    controlWriteMs: state.stageTiming?.controlWriteMs,
    controlRenderMs: state.stageTiming?.controlRenderMs,
    treatmentMaterializeMs: state.stageTiming?.treatmentMaterializeMs,
    treatmentRebuildMs: state.stageTiming?.treatmentRebuildMs,
    treatmentWriteMs: state.stageTiming?.treatmentWriteMs,
    treatmentRenderMs: state.stageTiming?.treatmentRenderMs,
    endToEndFrameMs: state.endToEndFrameMs,
    stageTiming: state.stageTiming,
    blankFrameRejection: 'passed',
    cachedFrameRejection: 'passed',
    sameNativeStateIdentity: state.sameNativeStateIdentity,
    frameCacheKey: state.frameCacheKey,
    screenshot: out,
    finalState: state,
    markerContract: NATIVE64_MODE_MARKERS,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, support: state.predictedPositiveCount, splats: state.treatmentSplatInstanceCount }, null, 2));
} catch (error) {
  let failureScreenshot = null;
  try {
    if (socket) {
      const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(capture.data || '', 'base64');
      if (bytes.byteLength > 1000) {
        const failurePath = out.replace(/\.png$/i, '-failure.png');
        writeFileSync(failurePath, bytes);
        failureScreenshot = failurePath;
      }
    }
  } catch {}
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    sourceManifest,
    predictionManifest,
    minimumEvidenceContract: NATIVE64_MODE_MARKERS,
    lastTrustworthyEvidence,
    failureScreenshot,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
  server?.kill('SIGTERM');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function buildRouteUrl() {
  const params = new URLSearchParams({
    native64_source_manifest: tmpUrlPath(sourceManifest),
    native64_prediction_manifest: tmpUrlPath(predictionManifest),
    seconds: '5',
    step_ms: '500',
    treatment_splat_radiance_gain: String(args.get('--treatment-splat-radiance-gain') || '1.12'),
    treatment_splat_opacity_gain: String(args.get('--treatment-splat-opacity-gain') || '1.05'),
  });
  return `http://127.0.0.1:${assetPort}/${repoBasename}/volume-native-low-selective-live.html?${params}`;
}

function tmpUrlPath(path) {
  const resolved = resolve(path);
  if (!resolved.startsWith('/private/tmp/')) throw new Error(`path must be under /private/tmp for same-origin witness serving: ${resolved}`);
  return `/${resolved.slice('/private/tmp/'.length)}`;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForHttp(url, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`HTTP server did not respond: ${url}`);
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(isInspectablePageTarget);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

function isInspectablePageTarget(target) {
  const targetUrl = String(target?.url || '');
  return target?.type === 'page' && !targetUrl.startsWith('chrome-extension://');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function isWebGpuBackend(value) {
  return String(value || '').startsWith('WebGPU');
}
