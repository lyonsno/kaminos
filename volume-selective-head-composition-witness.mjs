#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.selective-head-composition-witness.v0';
const ROUTE = 'exact-basin-selective-head-live-v0';
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const COMPOSITIONS = [
  'splat-only-v0',
  'smoke-raymarch-under-splats-v0',
  'full-raymarch-under-splats-diagnostic-v0',
];
const EXPECTED_PASSES = Object.freeze({
  'splat-only-v0': { raymarchApplied: false, splatApplied: true, raymarchFireAuthority: 0 },
  'smoke-raymarch-under-splats-v0': { raymarchApplied: true, splatApplied: true, raymarchFireAuthority: 0 },
  'full-raymarch-under-splats-diagnostic-v0': { raymarchApplied: true, splatApplied: true, raymarchFireAuthority: 1 },
});

const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-selective-head-composition-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
const timeoutMs = Number(args.get('--timeout-ms') || 240000);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let lastTrustworthyEvidence = {};

class CdpSocket {
  constructor(url) { this.url = url; this.socket = null; this.nextId = 1; this.pending = new Map(); }
  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1620,760',
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
    width: 1620, height: 760, deviceScaleFactor: 2, mobile: false,
  });
  await socket.call('Page.navigate', { url });

  failurePhase = 'route-settle';
  const settleStarted = performance.now();
  let state = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate('window.__kaminosSelectiveHeadLive?.debugState?.()');
    lastTrustworthyEvidence = { phase: 'route-settle', state };
    if (state?.status === 'failed') throw new Error(state.error || state.fallbackReason || 'live route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'running'
      && state?.warmupComplete === true
      && state?.modelIdentity === MODEL
      && state?.effectiveRole === state?.requestedRole
      && !state?.fallbackReason
      && !state?.compositionFallbackReason
      && !state?.boundarySplatFallbackReason
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'route did not settle');
  assert.equal(state?.warmupComplete, true, 'warmup did not complete');
  assert.equal(state?.modelIdentity, MODEL, 'wrong model identity');
  await evaluate('window.__kaminosSelectiveHeadLive.setCapturePaused(true)');
  const pausedState = await evaluate('window.__kaminosSelectiveHeadLive.debugState()');
  const sameStateSimStep = Number(pausedState.simStepCount);
  const captures = [];

  failurePhase = 'same-state-composition-capture';
  for (let index = 0; index < COMPOSITIONS.length; index += 1) {
    const composition = COMPOSITIONS[index];
    await evaluate(`window.__kaminosSelectiveHeadLive.setComposition(${JSON.stringify(composition)})`);
    const renderStart = performance.now();
    const receipt = await evaluate(`window.__kaminosSelectiveHeadLive.captureFrame({ advanceSim: false, presentToCanvas: true, frameIndex: ${index}, startNow: 1000, stepDeltaMs: 0 })`);
    const renderElapsedMs = performance.now() - renderStart;
    assert.equal(receipt?.ok, true, `${composition} render failed: ${receipt?.reason || 'unknown'}`);
    assert.equal(Number(receipt.beforeSimStepCount), sameStateSimStep, `${composition} started from a different source step`);
    assert.equal(Number(receipt.simStepCount), sameStateSimStep, `${composition} advanced the source step`);
    assert.equal(receipt.selectiveHeadLiveCompositionEffective, composition, `${composition} effective composition drift`);
    assert.equal(receipt.selectiveHeadLiveCompositionFallbackReason, null, `${composition} composition fallback`);
    const expected = EXPECTED_PASSES[composition];
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(receipt.selectiveHeadLivePassReceipt?.[key], value, `${composition} pass receipt ${key} mismatch`);
    }
    const screenshotPath = join(outDir, `${String(index + 1).padStart(2, '0')}-${composition}.png`);
    const shotStart = performance.now();
    const screenshot = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotElapsedMs = performance.now() - shotStart;
    const screenshotBytes = Buffer.from(screenshot.data, 'base64');
    assert.ok(screenshotBytes.length > 1000, `${composition} screenshot was blank or missing`);
    writeFileSync(screenshotPath, screenshotBytes);
    const afterState = await evaluate('window.__kaminosSelectiveHeadLive.debugState()');
    if (composition === 'splat-only-v0') {
      assert.equal(afterState.requestedRaymarchSmokePresentation, 'on', 'splat-only smoke accounting control did not preserve Smoke On');
      assert.equal(afterState.raymarchSmokeApplied, false, 'splat-only reported raymarched smoke applied while its raymarch pass was absent');
    }
    captures.push({
      composition,
      requestedComposition: receipt.selectiveHeadLiveCompositionRequested,
      effectiveComposition: receipt.selectiveHeadLiveCompositionEffective,
      compositionAuthority: receipt.selectiveHeadLiveCompositionAuthority,
      passReceipt: receipt.selectiveHeadLivePassReceipt,
      role: receipt.effectiveRole,
      roleAuthority: receipt.roleAuthority,
      simStepCount: receipt.simStepCount,
      beforeSimStepCount: receipt.beforeSimStepCount,
      frameCount: receipt.frameCount,
      renderElapsedMs,
      screenshotElapsedMs,
      timing: afterState.timing || null,
      raymarchSmokeApplied: afterState.raymarchSmokeApplied,
      boundarySplatGpuProfile: afterState.boundarySplatGpuProfile || null,
      screenshot: artifact(screenshotPath),
    });
  }
  lastTrustworthyEvidence = { sameStateSimStep, captures };
  const report = {
    schema: SCHEMA,
    identity: 'same-state-selective-head-render-composition-witness-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveRoute: ROUTE,
    modelIdentity: MODEL,
    sameStateAuthority: 'same-state-selective-render-composition-v0',
    sameStateSimStep,
    compositions: COMPOSITIONS,
    captures,
  };
  writeReport(report);
  console.log(JSON.stringify({ ok: true, report: reportPath, outDir, sameStateSimStep, captures: captures.map(capture => capture.screenshot.path) }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    identity: 'same-state-selective-head-render-composition-witness-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
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
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
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

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'runtime evaluation failed';
    throw new Error(`${detail}\nExpression: ${expression}`);
  }
  return result.result.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function artifact(path) {
  const bytes = readFileSync(path);
  return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
