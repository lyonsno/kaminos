#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { analyzePngPixels, comparePngPixels } from './volume-png-pixel-evidence.mjs';

const SCHEMA = 'kaminos.volume.selective-head-splat-basin-gate.v0';
const ROUTE = 'exact-basin-selective-head-live-v0';
const EXPECTED_BACKEND = 'WebGPU:apple';
const COMPOSITION = 'splat-only-v0';
const ROLES = ['truthHigh', 'lowPhaseAligned'];
const ROLE_AUTHORITIES = Object.freeze({
  truthHigh: 'current-high-field-reference-no-learned-composition-v0',
  lowPhaseAligned: 'phase-aligned-low-field-control-v0',
});

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-selective-head-splat-basin-gate'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
let url = null;
let basinSettingsSha256 = null;
let timeoutMs = 240000;
let port = null;
let minimumSimStep = null;
let cameraPosition = null;
let cameraTarget = null;
const cameraAuthority = 'explicit-volume-debug-pose-from-boundary-splat-motion-witness-v0';
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let lastTrustworthyEvidence = {};

class CdpSocket {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.webSocketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
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
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  url = required('--url');
  basinSettingsSha256 = required('--basin-settings-sha256').toLowerCase();
  timeoutMs = Number(args.get('--timeout-ms') || 240000);
  port = Number(args.get('--debug-port') || randomInt(42000, 62000));
  minimumSimStep = Number(args.get('--min-sim-step') || 96);
  cameraPosition = parseVector(args.get('--camera-position') || '0.05,1.85,4.35', '--camera-position');
  cameraTarget = parseVector(args.get('--camera-target') || '0,-0.18,0.16', '--camera-target');
  const parsedUrl = new URL(url);
  assert.equal(parsedUrl.searchParams.get('role'), 'truthHigh', 'basin gate must start from truthHigh');
  assert.equal(parsedUrl.searchParams.get('composition'), COMPOSITION, 'basin gate requires splat-only composition');
  assert.equal(parsedUrl.searchParams.get('warmup_steps'), '0', 'basin gate requires fresh-live settings with no replay anchor');
  assert.match(basinSettingsSha256, /^[a-f0-9]{64}$/, 'invalid basin settings SHA-256');
  assert.ok(Number.isInteger(minimumSimStep) && minimumSimStep >= 1, '--min-sim-step must be a positive integer');

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,980',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url });

  failurePhase = 'route-settle';
  const settleStarted = performance.now();
  let state = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate('window.__kaminosSelectiveHeadLive?.debugState?.()');
    lastTrustworthyEvidence = { phase: failurePhase, state };
    if (state?.status === 'failed') throw new Error(state.error || state.fallbackReason || 'live route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'running'
      && state?.warmupComplete === true
      && state?.warmupAuthority === 'fresh-live-settings-no-anchor-v0'
      && state?.effectiveRole === 'truthHigh'
      && state?.effectiveComposition === COMPOSITION
      && state?.roleAuthority === ROLE_AUTHORITIES.truthHigh
      && state?.backend === EXPECTED_BACKEND
      && !state?.fallbackReason
      && !state?.compositionFallbackReason
      && !state?.boundarySplatFallbackReason
      && Number(state?.simStepCount || 0) >= minimumSimStep
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'route did not settle');
  assert.equal(state?.backend, EXPECTED_BACKEND, 'unexpected backend');
  assert.equal(state?.warmupAuthority, 'fresh-live-settings-no-anchor-v0', 'unexpected replay or imported anchor');
  assert.equal(state?.effectiveComposition, COMPOSITION, 'effective composition drift');

  failurePhase = 'camera-application';
  const requestedCamera = { position: cameraPosition, target: cameraTarget };
  const effectiveCamera = await evaluate(`(async () => {
    const basinWindow = document.getElementById('basin')?.contentWindow;
    if (typeof basinWindow?.kaminosSetCameraDebugPose !== 'function') throw new Error('inner volume camera setter unavailable');
    basinWindow.kaminosSetCameraDebugPose(${JSON.stringify(requestedCamera)});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (typeof basinWindow.kaminosCameraDebugState !== 'function') throw new Error('inner volume camera evidence unavailable');
    return basinWindow.kaminosCameraDebugState();
  })()`);
  assertVectorClose(effectiveCamera?.position, cameraPosition, 'effective camera position');
  assertVectorClose(effectiveCamera?.target, cameraTarget, 'effective camera target');
  lastTrustworthyEvidence = { phase: failurePhase, requestedCamera, effectiveCamera, cameraAuthority };

  await evaluate('window.__kaminosSelectiveHeadLive.setCapturePaused(true)');
  const pausedState = await evaluate('window.__kaminosSelectiveHeadLive.debugState()');
  const sameStateSimStep = Number(pausedState.simStepCount);
  assert.ok(Number.isInteger(sameStateSimStep) && sameStateSimStep >= minimumSimStep, 'invalid frozen simulator step');
  const captures = [];
  const candidatePackageObservation = {
    authority: 'route-does-not-expose-vivisector-package-state-v0',
    applied: null,
    activeModelIdentity: pausedState.modelIdentity || null,
  };
  const candidatePackageExpectation = {
    requestedApplied: false,
    authority: 'operator-request-not-runtime-observation-v0',
  };

  failurePhase = 'same-state-role-capture';
  for (let index = 0; index < ROLES.length; index += 1) {
    const role = ROLES[index];
    await evaluate(`window.__kaminosSelectiveHeadLive.setRole(${JSON.stringify(role)})`);
    let receipt = await evaluate(`window.__kaminosSelectiveHeadLive.captureFrame({ advanceSim: false, presentToCanvas: true, frameIndex: ${index}, startNow: 1000, stepDeltaMs: 0 })`);
    assert.equal(receipt?.ok, true, `${role} render failed: ${receipt?.reason || 'unknown'}`);
    assert.equal(Number(receipt.beforeSimStepCount), sameStateSimStep, `${role} started from a different simulator step`);
    assert.equal(Number(receipt.simStepCount), sameStateSimStep, `${role} advanced the simulator`);
    const boundarySplatInitialOverflowCount = Number(receipt.boundarySplatOverflowCount);
    let boundarySplatCapacityRetryCount = 0;
    if (boundarySplatInitialOverflowCount > 0) {
      receipt = await evaluate(`window.__kaminosSelectiveHeadLive.captureFrame({ advanceSim: false, presentToCanvas: true, frameIndex: ${index}, startNow: 1000, stepDeltaMs: 0 })`);
      boundarySplatCapacityRetryCount = 1;
      assert.equal(receipt?.ok, true, `${role} capacity retry failed: ${receipt?.reason || 'unknown'}`);
      assert.equal(Number(receipt.beforeSimStepCount), sameStateSimStep, `${role} capacity retry started from a different simulator step`);
      assert.equal(Number(receipt.simStepCount), sameStateSimStep, `${role} capacity retry advanced the simulator`);
    }
    assert.equal(receipt.requestedRole, role, `${role} requested role drift`);
    assert.equal(receipt.effectiveRole, role, `${role} effective role drift`);
    assert.equal(receipt.roleAuthority, ROLE_AUTHORITIES[role], `${role} authority mismatch`);
    assert.equal(receipt.selectiveHeadLiveCompositionEffective, COMPOSITION, `${role} composition drift`);
    assert.equal(receipt.selectiveHeadLiveCompositionFallbackReason, null, `${role} composition fallback`);
    assert.equal(receipt.selectiveHeadLivePassReceipt?.raymarchApplied, false, `${role} unexpectedly applied raymarch`);
    assert.equal(receipt.selectiveHeadLivePassReceipt?.splatApplied, true, `${role} did not apply splats`);
    assert.equal(receipt.boundarySplatFallbackReason, null, `${role} splat fallback`);
    assert.equal(Number(receipt.boundarySplatOverflowCount), 0, `${role} splat overflow`);
    assert.equal(Number(receipt.boundarySplatCandidateCount), Number(receipt.boundarySplatInstanceCount), `${role} incomplete splat population`);
    assert.ok(Number(receipt.boundarySplatCandidateCount) > 0, `${role} produced no splats`);
    assert.ok(receipt.boundarySplatCountAuthority, `${role} omitted splat count authority`);

    const captureState = await evaluate('window.__kaminosSelectiveHeadLive.debugState()');
    const captureRouteIdentity = captureState?.routeIdentity || null;
    const captureBackend = captureState?.backend || null;
    assert.equal(captureRouteIdentity, ROUTE, `${role} capture route drift`);
    assert.equal(captureBackend, EXPECTED_BACKEND, `${role} capture backend drift`);
    const canvasCssRect = await evaluate(`(() => {
      const frame = document.getElementById('basin');
      const canvas = frame?.contentWindow?.__kaminosVolumePrototype?.canvasElement?.();
      if (!frame || !canvas) return null;
      const frameRect = frame.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        x: frameRect.x + canvasRect.x,
        y: frameRect.y + canvasRect.y,
        width: canvasRect.width,
        height: canvasRect.height,
      };
    })()`);
    assert.ok(canvasCssRect
      && canvasCssRect.width > 1
      && canvasCssRect.height > 1
      && canvasCssRect.x >= 0
      && canvasCssRect.y >= 0, `${role} canvas clip is invalid`);

    const screenshotPath = join(outDir, `${String(index + 1).padStart(2, '0')}-${role}.png`);
    const screenshot = await socket.call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { ...canvasCssRect, scale: 1 },
    });
    const bytes = Buffer.from(screenshot.data, 'base64');
    writeFileSync(screenshotPath, bytes);
    const pixelEvidence = analyzePngPixels(screenshotPath);
    assert.ok(pixelEvidence.foregroundPixelCount >= 100, `${role} canvas contains no visible splat foreground`);
    assert.ok(pixelEvidence.foregroundFraction < 0.8, `${role} canvas lacks bounded empty surround`);
    captures.push({
      role,
      roleAuthority: receipt.roleAuthority,
      requestedComposition: receipt.selectiveHeadLiveCompositionRequested,
      effectiveComposition: receipt.selectiveHeadLiveCompositionEffective,
      passReceipt: receipt.selectiveHeadLivePassReceipt,
      simStepCount: receipt.simStepCount,
      boundarySplatRendererIdentity: receipt.boundarySplatRendererIdentity,
      boundarySplatAttributeModelIdentity: receipt.boundarySplatAttributeModelIdentity,
      boundarySplatSourceAuthority: receipt.boundarySplatSourceAuthority,
      boundarySplatRadius: receipt.boundarySplatRadius,
      boundarySplatSharpness: receipt.boundarySplatSharpness,
      boundarySplatCandidateCount: receipt.boundarySplatCandidateCount,
      boundarySplatInstanceCount: receipt.boundarySplatInstanceCount,
      boundarySplatOverflowCount: receipt.boundarySplatOverflowCount,
      boundarySplatCountAuthority: receipt.boundarySplatCountAuthority,
      boundarySplatInitialOverflowCount,
      boundarySplatCapacityRetryCount,
      captureRouteIdentity,
      captureBackend,
      canvasCssRect,
      pixelEvidence,
      screenshot: artifact(screenshotPath),
    });
    lastTrustworthyEvidence = { sameStateSimStep, captures };
  }

  const roleDifferenceEvidence = comparePngPixels(captures[0].screenshot.path, captures[1].screenshot.path);
  assert.ok(roleDifferenceEvidence.changedPixelCount >= 100, 'reference/control images are not visibly distinct');

  lastTrustworthyEvidence = { sameStateSimStep, captures };
  const report = {
    schema: SCHEMA,
    identity: 'same-state-observed-splat-basin-gate-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    requestedUrlSha256: sha256(Buffer.from(url)),
    basinSettingsSha256,
    basinSettingsSha256Authority: 'caller-provided-settings-hash-not-live-derived-v0',
    cameraAuthority,
    requestedCamera,
    effectiveCamera,
    effectiveRoute: ROUTE,
    backend: state.backend,
    simGrid: state.simGrid,
    warmupAuthority: state.warmupAuthority,
    sameStateAuthority: 'same-state-observed-splat-reference-control-v0',
    minimumSimStep,
    sameStateSimStep,
    composition: COMPOSITION,
    roles: ROLES,
    candidatePackageApplied: null,
    candidatePackageExpectation,
    candidatePackageObservation,
    roleDifferenceEvidence,
    captures,
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    sameStateSimStep,
    captures: captures.map(capture => ({ role: capture.role, screenshot: capture.screenshot.path })),
  }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    identity: 'same-state-observed-splat-basin-gate-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    basinSettingsSha256,
    candidatePackageApplied: null,
    candidatePackageExpectation: {
      requestedApplied: false,
      authority: 'operator-request-not-runtime-observation-v0',
    },
    candidatePackageObservation: {
      authority: 'route-does-not-expose-vivisector-package-state-v0',
      applied: null,
    },
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
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

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function parseVector(value, name) {
  const vector = String(value).split(',').map(component => Number(component.trim()));
  assert.equal(vector.length, 3, `${name} must contain exactly three comma-separated values`);
  assert.ok(vector.every(Number.isFinite), `${name} must contain finite values`);
  return vector;
}

function assertVectorClose(actual, expected, label) {
  assert.ok(Array.isArray(actual) && actual.length === 3, `${label} is missing`);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(Number(actual[index]) - Number(expected[index])) <= 1e-6, `${label}[${index}] drift`);
  }
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function artifact(path) {
  const bytes = Buffer.from(existsSync(path) ? readFileSync(path) : []);
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

async function waitForTarget(debugPort, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
      if (target) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for browser target');
}

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
