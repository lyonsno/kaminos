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

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8096/combustible-object-pyro-bridge.html?bridge_autoplay=0';
const out = resolve(args.get('--out') || '/tmp/kaminos-combustible-object-pyro.png');
const initialOut = out.replace(/\.png$/i, '.initial.png');
const combustionOut = out.replace(/\.png$/i, '.combustion.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = positiveInteger(args.get('--debug-port'), 9471);
const width = positiveInteger(args.get('--width'), 1468);
const height = positiveInteger(args.get('--height'), 960);
const captureTimeoutMs = positiveInteger(args.get('--capture-timeout-ms'), 120_000);
const supportedSettleFrames = positiveInteger(args.get('--supported-settle-frames'), 1);
const finalSettleFrames = positiveInteger(args.get('--final-settle-frames'), 1);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-combustible-object-pyro-${port}-${process.pid}`;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';
const EXPECTED_FIELD_TRANSFER = 'combustible-plank-material-to-pyro-field-v0';
const EXPECTED_RENDER_CALIBRATION = 'combustible-object-native-pyro-render-v0';

let phase = 'initializing';
let effectiveUrl = null;
let browserVersion = null;
let stderr = '';
let initialState = null;
let initialField = null;
let combustionState = null;
let finalState = null;
let combustionField = null;
let finalField = null;
let chromeProcess = null;
let chromeLaunchError = null;
let ws = null;
const browserEvents = [];
const screenshotRecords = { initial: null, combustion: null, final: null };

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.combustible-object-native-pyro-witness-report.v0',
    requestedUrl,
    effectiveUrl,
    requestedRoute: 'kaminos.combustible-object-native-pyro-bridge.v0',
    effectiveRoute: finalState?.effectiveRoute || combustionState?.effectiveRoute || initialState?.effectiveRoute || null,
    materialAuthority: finalState?.materialAuthority || combustionState?.materialAuthority || initialState?.materialAuthority || null,
    exchangeAuthority: finalState?.exchangeAuthority || combustionState?.exchangeAuthority || initialState?.exchangeAuthority || null,
    learnedPresentationAuthority: finalState?.learnedPresentationAuthority || null,
    fallback: finalState?.fallback ?? combustionState?.fallback ?? initialState?.fallback ?? null,
    phase,
    browserVersion,
    chrome,
    debugPort: port,
    captureTimeoutMs,
    supportedSettleFrames,
    finalSettleFrames,
    requestedViewport: { width, height },
    userDataDir,
    screenshots: screenshotRecords,
    stderrTail: stderr.slice(-2400),
    browserEvents: browserEvents.slice(-80),
    initialState,
    initialField,
    combustionState,
    finalState,
    combustionField,
    finalField,
    ...extra,
  }, null, 2));
}

async function cdpFetch(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(options.timeoutMs || 5000) });
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (chromeLaunchError) throw chromeLaunchError;
    try {
      return await cdpFetch('/json/version', { timeoutMs: 400 });
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForRequestedTarget() {
  const expected = new URL(requestedUrl).href;
  let stableTargetId = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const targets = await cdpFetch('/json/list');
    const target = targets.find(record => record.type === 'page' && record.url && new URL(record.url).href === expected);
    if (target?.webSocketDebuggerUrl && target.id === stableTargetId) return target;
    stableTargetId = target?.id || null;
    await delay(100);
  }
  throw new Error(`Requested page target did not stabilize: ${requestedUrl}`);
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
    const timer = timeoutMs === null ? null : setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, timeoutMs);
    function onMessage(event) {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      if (timer !== null) clearTimeout(timer);
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

async function waitForState(condition, label, timeoutMs = 30000) {
  return evaluate(`
    (async () => {
      const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
      const deadline = performance.now() + ${timeoutMs};
      while (performance.now() < deadline) {
        const state = window.kaminosCombustibleObjectPyroDebugState?.();
        if (state?.status === 'failed') throw new Error('bridge failed: ' + JSON.stringify(state));
        if (state && (${condition})) return state;
        await wait(100);
      }
      throw new Error(${JSON.stringify(`${label} timed out`)} + ': ' + JSON.stringify(window.kaminosCombustibleObjectPyroDebugState?.()));
    })()
  `, timeoutMs + 5000);
}

async function captureScreenshot(path) {
  const screenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: false }, captureTimeoutMs);
  const png = Buffer.from(screenshot.data, 'base64');
  const minimumCredibleBytes = Math.max(18_000, Math.min(45_000, Math.floor(width * height * 0.075)));
  assert.ok(png.length > minimumCredibleBytes, `screenshot is too small: ${png.length} <= ${minimumCredibleBytes}`);
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
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`,
    requestedUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.on('error', error => { chromeLaunchError = error; });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  browserVersion = await waitForCdp();

  phase = 'opening-target';
  const target = await waitForRequestedTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') {
      browserEvents.push(message);
    }
  });
  await wsRequest('Runtime.enable');
  await wsRequest('Page.enable');
  await wsRequest('Page.bringToFront');

  phase = 'waiting-for-initial';
  initialState = await waitForState(
    `state.status === 'running' && state.frameCount > 4 && state.primaryOutput?.status === 'rendering'`,
    'initial bridge state',
  );
  effectiveUrl = await evaluate('location.href');
  assert.equal(new URL(effectiveUrl).href, new URL(requestedUrl).href, 'effective URL mismatch');
  assert.equal(initialState.effectiveRoute, 'kaminos.combustible-object-native-pyro-bridge.v0');
  assert.equal(initialState.materialAuthority, 'internal-object-side-combustion-v0');
  assert.equal(initialState.exchangeAuthority, 'same-device-source-accounted-native-pyro-scatter-v0');
  assert.equal(initialState.learnedPresentationAuthority, 'not-claimed');
  assert.equal(initialState.fieldTransferIdentity, EXPECTED_FIELD_TRANSFER);
  assert.equal(initialState.renderCalibrationIdentity, EXPECTED_RENDER_CALIBRATION);
  assert.equal(initialState.fallback, null);
  assert.equal(initialState.burning.support.failed, false);
  assert.equal(initialState.control.support.failed, false);
  assert.equal(initialState.controlSourceCount, 0);
  initialField = await evaluate('window.kaminosCombustibleObjectPyroSampleNativeField()');
  assert.equal(initialField.pixelDelta.status, 'baseline-recorded');
  assert.equal(initialField.pixelDelta.changedPixels, 0);
  phase = 'capturing-initial';
  await evaluate('window.kaminosCombustibleObjectPyroSetRenderActive(false)');
  screenshotRecords.initial = await captureScreenshot(initialOut);
  await evaluate('window.kaminosCombustibleObjectPyroSetRenderActive(true)');

  phase = 'advancing-to-supported-combustion';
  await evaluate('window.kaminosCombustibleObjectPyroAdvanceLive(90)');
  combustionState = await waitForState(
    `state.burning.combustion.active === true
      && state.burning.support.failed === false
      && state.source?.sourceCount === 1
      && state.source?.packedCount === 1
      && state.source?.overflowCount === 0
      && state.controlSourceCount === 0
      && state.gpuReceipt?.status === 'applied'
      && state.gpuReceipt?.materialStep === state.source.materialStep
      && state.gpuReceipt?.acceptedRecords === 1
      && state.gpuReceipt?.sameDevice === true
      && state.observedTransferReceipt?.injectedHeat > 0
      && state.observedTransferReceipt?.injectedFuel > 0
      && state.observedTransferReceipt?.injectedSoot > 0
      && state.observedSpatialTransferReceipt?.touchedCells > 1`,
    'supported combustion GPU receipt',
  );
  assert.equal(combustionState.source.accountingResidual, 0);
  assert.ok(combustionState.source.writeTick > 10, 'supported combustion was not published as a sustained live source');
  assert.deepEqual(combustionState.gpuReceipt.acceptedCell.length, 3);
  await evaluate(`window.kaminosCombustibleObjectPyroSettle(${supportedSettleFrames})`);
  combustionField = await evaluate('window.kaminosCombustibleObjectPyroSampleNativeField()');
  assert.equal(combustionField.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.ok(combustionField.densityMax > 0 && combustionField.heatMean > 0, 'native field readback did not retain object combustion material');
  assert.ok(combustionField.fireWeight > 0 || combustionField.smokeWeight > 0, 'native field readback did not retain fire or smoke weight');
  assert.equal(combustionField.pixelDelta.status, 'compared-to-initial-native-field');
  assert.ok(combustionField.pixelDelta.changedPixels > 8, 'native field contribution did not alter enough rendered pixels');
  assert.ok(combustionField.pixelDelta.maxChannelDelta > 2, 'native field contribution was indistinguishable from the initial native field');
  await evaluate('window.kaminosCombustibleObjectPyroSetRenderActive(false)');
  combustionState = await evaluate('window.kaminosCombustibleObjectPyroDebugState()');
  phase = 'capturing-combustion';
  screenshotRecords.combustion = await captureScreenshot(combustionOut);
  await evaluate('window.kaminosCombustibleObjectPyroSetRenderActive(true)');

  phase = 'advancing-to-fallen-source';
  await evaluate('window.kaminosCombustibleObjectPyroAdvanceLive(45)');
  finalState = await waitForState(
    `state.burning.support.failed === true
      && state.burning.motion.impacted === true
      && state.control.support.failed === false
      && state.control.motion.angleRad === 0
      && state.source?.materialStep >= 129
      && state.source?.overflowCount === 0
      && state.controlSourceCount === 0
      && state.gpuReceipt?.status === 'applied'
      && state.gpuReceipt?.materialStep === state.source.materialStep
      && state.gpuReceipt?.acceptedRecords === 1
      && state.gpuReceipt?.sameDevice === true`,
    'fallen moving-source GPU receipt',
  );
  assert.equal(finalState.burning.support.failureCause, 'combustion-support-capacity-below-load-demand');
  assert.ok(finalState.source.writeTick > combustionState.source.writeTick, 'fallen source did not continue live publication');
  assert.equal(finalState.burning.material.accountingResidual, 0);
  assert.notDeepEqual(
    finalState.gpuReceipt.acceptedCell,
    combustionState.gpuReceipt.acceptedCell,
    'accepted Pyro cell did not follow the rotating combustible member',
  );
  await evaluate(`window.kaminosCombustibleObjectPyroSettle(${finalSettleFrames})`);
  finalField = await evaluate('window.kaminosCombustibleObjectPyroSampleNativeField()');
  assert.equal(finalField.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.ok(finalField.fireWeight > 0 || finalField.smokeWeight > 0, 'native field readback did not retain visible combustion material');
  assert.notDeepEqual(
    finalState.source.worldSource,
    combustionState.source.worldSource,
    'world-space source did not follow the rotating combustible member',
  );
  await evaluate('window.kaminosCombustibleObjectPyroSetRenderActive(false)');
  finalState = await evaluate('window.kaminosCombustibleObjectPyroDebugState()');
  phase = 'capturing-final';
  screenshotRecords.final = await captureScreenshot(out);

  phase = 'completed';
  writeReport({ status: 'ok' });
  process.stdout.write(`${reportPath}\n`);
} catch (error) {
  writeReport({ status: 'failed', error: error?.stack || error?.message || String(error) });
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM');
}
