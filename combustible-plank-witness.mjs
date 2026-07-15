#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8095/combustible-plank.html?plank_autoplay=0';
const out = resolve(args.get('--out') || '/tmp/kaminos-combustible-plank-witness.png');
const initialOut = out.replace(/\.png$/i, '.initial.png');
const combustionOut = out.replace(/\.png$/i, '.combustion.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = positiveInteger(args.get('--debug-port'), 9467);
const width = positiveInteger(args.get('--width'), 1468);
const height = positiveInteger(args.get('--height'), 960);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-combustible-plank-profile-${port}-${process.pid}`;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';

let phase = 'initializing';
let effectiveUrl = null;
let browserVersion = null;
let stderr = '';
let initialState = null;
let combustionState = null;
let finalState = null;
let chromeProcess = null;
let chromeLaunchError = null;
let ws = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.combustible-plank-witness-report.v0',
    requestedUrl,
    effectiveUrl,
    requestedRoute: 'kaminos.combustible-plank-support-collapse.v0',
    effectiveRoute: finalState?.effectiveRoute || initialState?.effectiveRoute || null,
    sourceAuthority: finalState?.sourceAuthority || initialState?.sourceAuthority || null,
    fallback: finalState?.fallback ?? initialState?.fallback ?? null,
    phase,
    browserVersion,
    chrome,
    debugPort: port,
    requestedViewport: { width, height },
    effectiveViewport: finalState?.canvas || combustionState?.canvas || initialState?.canvas || null,
    userDataDir,
    screenshots: { initial: initialOut, combustion: combustionOut, final: out },
    stderrTail: stderr.slice(-2000),
    initialState,
    combustionState,
    finalState,
    ...extra,
  }, null, 2));
}

async function cdpFetch(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(options.timeoutMs || 5000) });
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chromeLaunchError) throw chromeLaunchError;
    try {
      return await cdpFetch('/json/version', { timeoutMs: 400 });
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(method, params = {}, timeoutMs = 15000) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, timeoutMs);
    function onMessage(event) {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    }
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(expression, timeoutMs = 15000) {
  const result = await wsRequest('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function captureScreenshot(path) {
  const screenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: false });
  const png = Buffer.from(screenshot.data, 'base64');
  const minimumCredibleBytes = Math.max(18_000, Math.min(40_000, Math.floor(width * height * 0.08)));
  assert.ok(
    png.length > minimumCredibleBytes,
    `screenshot is too small to be credible visual evidence: ${png.length} bytes <= ${minimumCredibleBytes}`,
  );
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { path, bytes: png.length };
}

try {
  phase = 'checking-debug-port';
  try {
    await cdpFetch('/json/version', { timeoutMs: 250 });
    throw new Error(`CDP debug port already in use before launch: ${port}`);
  } catch (error) {
    if (/already in use/.test(String(error?.message))) throw error;
  }

  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : ['--no-first-run', '--no-default-browser-check', '--disable-extensions']),
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    `--window-size=${width},${height}`,
    requestedUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.on('error', error => { chromeLaunchError = error; });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  browserVersion = await waitForCdp();

  phase = 'opening-target';
  const targets = await cdpFetch('/json/list');
  const target = targets.find(record => record.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Runtime.enable');
  await wsRequest('Page.enable');
  await wsRequest('Page.bringToFront');

  phase = 'waiting-for-renderer';
  initialState = await evaluate(`
    (async () => {
      const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const state = window.kaminosCombustiblePlankDebugState?.();
        if (state?.status === 'failed') throw new Error('plank renderer failed: ' + JSON.stringify(state));
        if (state?.status === 'running' && state.frameCount > 2 && state.canvas?.width > 0 && state.canvas?.height > 0) return state;
        await wait(100);
      }
      return window.kaminosCombustiblePlankDebugState?.() || null;
    })()
  `, 25000);
  assert.ok(initialState, 'initial combustible plank state is missing');
  assert.equal(initialState.effectiveRoute, 'kaminos.combustible-plank-support-collapse.v0', 'initial state used wrong route');
  assert.equal(initialState.sourceAuthority, 'internal-object-side-combustion-v0', 'initial state used wrong source authority');
  assert.equal(initialState.fallback, null, 'initial state silently used a fallback');
  assert.equal(initialState.burning.support.failed, false, 'burning plank starts supported');
  assert.equal(initialState.control.support.failed, false, 'control plank starts supported');
  await delay(1500);
  initialState = await evaluate('window.kaminosCombustiblePlankDebugState()');
  effectiveUrl = await evaluate('location.href');
  if (new URL(effectiveUrl).href !== new URL(requestedUrl).href) {
    throw new Error(`effective URL mismatch: requested ${requestedUrl}, loaded ${effectiveUrl}`);
  }
  const initialShot = await captureScreenshot(initialOut);

  phase = 'advancing-to-combustion';
  combustionState = await evaluate(`window.kaminosCombustiblePlankAdvance(90)`);
  await delay(1500);
  combustionState = await evaluate('window.kaminosCombustiblePlankDebugState()');
  assert.equal(combustionState.burning.combustion.active, true, 'combustion phase is not actively burning');
  assert.equal(combustionState.burning.support.failed, false, 'combustion proof skipped past the supported burn phase');
  assert.ok(combustionState.burning.material.charMass > 0, 'combustion phase has no char formation');
  const combustionShot = await captureScreenshot(combustionOut);

  phase = 'advancing-to-collapse';
  finalState = await evaluate(`window.kaminosCombustiblePlankAdvance(90)`);
  await delay(1500);
  finalState = await evaluate('window.kaminosCombustiblePlankDebugState()');
  assert.equal(finalState.status, 'running', 'final renderer state is not running');
  assert.equal(finalState.effectiveRoute, 'kaminos.combustible-plank-support-collapse.v0', 'final state used wrong route');
  assert.equal(finalState.sourceAuthority, 'internal-object-side-combustion-v0', 'final state used wrong source authority');
  assert.equal(finalState.fallback, null, 'final state silently used a fallback');
  assert.equal(finalState.burning.support.failed, true, 'combustion did not remove plank support');
  assert.equal(finalState.burning.support.failureCause, 'combustion-support-capacity-below-load-demand', 'support loss has wrong cause');
  assert.equal(finalState.burning.motion.impacted, true, 'plank did not fall to impact after support loss');
  assert.equal(finalState.control.support.failed, false, 'matched unburned control lost support');
  assert.equal(finalState.control.motion.angleRad, 0, 'matched unburned control rotated');
  assert.equal(finalState.burning.material.accountingResidual, 0, 'combustion material accounting does not reconcile');
  const supportLossIndex = finalState.events.findIndex(event => event.kind === 'support-loss');
  const impactIndex = finalState.events.findIndex(event => event.kind === 'impact');
  assert.ok(supportLossIndex >= 0, 'support-loss event is missing');
  assert.ok(impactIndex > supportLossIndex, 'impact did not follow support-loss');
  const finalShot = await captureScreenshot(out);

  phase = 'completed';
  writeReport({ status: 'ok', screenshots: { initial: initialShot, combustion: combustionShot, final: finalShot } });
  process.stdout.write(`${JSON.stringify({ status: 'ok', reportPath, initialOut, combustionOut, out })}\n`);
} catch (error) {
  phase = `failed:${phase}`;
  writeReport({ status: 'failed', error: error?.stack || String(error) });
  throw error;
} finally {
  try { ws?.close(); } catch {}
  if (chromeProcess && chromeProcess.exitCode === null) chromeProcess.kill('SIGTERM');
}
