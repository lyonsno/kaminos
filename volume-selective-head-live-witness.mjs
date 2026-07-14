#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.selective-head-live-witness.v0';
const ROUTE = 'exact-basin-selective-head-live-v0';
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const out = resolve(String(args.get('--out') || '/tmp/kaminos-selective-head-live.png'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-selective-head-live.json'));
const minimumContinuousSeconds = Number(args.get('--minimum-seconds') || 5);
const timeoutMs = Number(args.get('--timeout-ms') || 120000);
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
  if (!(minimumContinuousSeconds >= 5 && minimumContinuousSeconds <= 30)) throw new Error('--minimum-seconds must be within 5-30');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  failurePhase = 'browser-launch';
  const executable = chromeExecutable();
  browser = spawn(executable, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Page.navigate', { url });
  failurePhase = 'route-settle';
  const started = performance.now();
  let state = null;
  while (performance.now() - started < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosSelectiveHeadLive?.debugState?.()');
    if (state?.status === 'failed') throw new Error(state.error || state.fallbackReason || 'live route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'running'
      && state?.effectiveRole === state?.requestedRole
      && state?.modelIdentity === MODEL
      && !state?.fallbackReason
      && !state?.boundarySplatFallbackReason
      && Number(state?.encodedFrameCount || 0) >= 2
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'live route did not reach running state');
  assert.equal(state?.effectiveRole, state?.requestedRole, 'requested role silently fell back');
  assert.equal(state?.modelIdentity, MODEL, 'wrong frozen model identity');
  assert.equal(state?.fallbackReason, null, 'selective route reported fallback');
  assert.equal(state?.boundarySplatFallbackReason, null, 'boundary splat route reported fallback');
  const startState = state;
  const observationStartMs = performance.now();
  failurePhase = 'continuous-observation';
  await delay(minimumContinuousSeconds * 1000);
  const endState = await evaluate(socket, 'window.__kaminosSelectiveHeadLive?.debugState?.()');
  const observedSeconds = (performance.now() - observationStartMs) / 1000;
  const continuousFrameDelta = Number(endState?.frameCount || 0) - Number(startState?.frameCount || 0);
  const continuousSimStepDelta = Number(endState?.simStepCount || 0) - Number(startState?.simStepCount || 0);
  const continuousEncodedFrameDelta = Number(endState?.encodedFrameCount || 0) - Number(startState?.encodedFrameCount || 0);
  lastTrustworthyEvidence = { startState, endState, observedSeconds, continuousFrameDelta, continuousSimStepDelta, continuousEncodedFrameDelta };
  assert.ok(observedSeconds >= minimumContinuousSeconds * 0.98, 'observation window was truncated');
  assert.ok(continuousFrameDelta >= 2, 'render frames did not advance continuously');
  assert.ok(continuousSimStepDelta >= 2, 'simulation steps did not advance continuously');
  assert.ok(continuousEncodedFrameDelta >= 2, 'learned fields did not update continuously');
  assert.equal(endState?.effectiveRole, startState?.effectiveRole, 'effective role drifted during observation');
  assert.equal(endState?.fallbackReason, null, 'selective route fell back during observation');
  assert.equal(endState?.boundarySplatFallbackReason, null, 'splat route fell back during observation');
  failurePhase = 'capture';
  const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(capture.data, 'base64'));
  const report = {
    schema: SCHEMA,
    identity: 'continuous-same-history-selective-head-live-witness-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveRoute: endState.routeIdentity,
    requestedRole: endState.requestedRole,
    effectiveRole: endState.effectiveRole,
    fallbackReason: endState.fallbackReason,
    modelIdentity: endState.modelIdentity,
    featureAuthority: endState.featureAuthority,
    pairAuthority: endState.pairAuthority,
    backend: endState.backend,
    simGrid: endState.simGrid,
    minimumContinuousSeconds,
    observedSeconds,
    continuousFrameDelta,
    continuousSimStepDelta,
    continuousEncodedFrameDelta,
    startState,
    endState,
    screenshot: out,
  };
  writeReport(report);
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, continuousFrameDelta, continuousSimStepDelta }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    identity: 'continuous-same-history-selective-head-live-witness-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    minimumContinuousSeconds,
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
        const target = targets.find(item => item.type === 'page');
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}
