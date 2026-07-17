#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { validateGpuCombustibleObjectPixelSequence } from './gpu-combustible-object-pixel-checks.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8097/gpu-combustible-object-ignition.html';
const out = resolve(args.get('--out') || '/tmp/kaminos-gpu-combustible-object-ignition.png');
const initialOut = out.replace(/\.png$/i, '.initial.png');
const ignitionOut = out.replace(/\.png$/i, '.ignition.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = positiveInteger(args.get('--debug-port'), 9472);
const width = positiveInteger(args.get('--width'), 1468);
const height = positiveInteger(args.get('--height'), 960);
const ignitionFrames = positiveInteger(args.get('--ignition-frames'), 145);
const finalFrames = positiveInteger(args.get('--final-frames'), 135);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-gpu-object-ignition-${port}-${process.pid}`;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';
const EXPECTED_AUTHORITY = 'same-device-pyro-material-emission-mechanics-v0';

let phase = 'initializing';
let effectiveUrl = null;
let browserVersion = null;
let stderr = '';
let initialState = null;
let ignitionState = null;
let finalState = null;
let terminalReceipt = null;
let pixelChecks = null;
let chromeProcess = null;
let chromeLaunchError = null;
let ws = null;
const browserEvents = [];
const screenshots = { initial: null, ignition: null, final: null };
const screenshotPngs = { initial: null, ignition: null, final: null };

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.gpu-combustible-object-ignition-witness-report.v0',
    requestedUrl,
    effectiveUrl,
    requestedRoute: 'kaminos.gpu-combustible-object-ignition.v0',
    effectiveRoute: finalState?.effectiveRoute || ignitionState?.effectiveRoute || initialState?.effectiveRoute || null,
    authority: terminalReceipt?.authority || finalState?.authority || null,
    phase,
    browserVersion,
    chrome,
    debugPort: port,
    requestedViewport: { width, height },
    ignitionFrames,
    finalFrames,
    userDataDir,
    screenshots,
    stderrTail: stderr.slice(-2400),
    browserEvents: browserEvents.slice(-80),
    initialState,
    ignitionState,
    finalState,
    terminalReceipt,
    pixelChecks,
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

function wsRequest(method, params = {}, timeoutMs = 30_000) {
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

async function evaluate(expression, timeoutMs = 30_000) {
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

async function waitForRunning() {
  return evaluate(`
    (async () => {
      const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline) {
        const state = window.kaminosGpuCombustibleObjectDebugState?.();
        if (state?.status === 'failed') throw new Error('GPU object route failed: ' + JSON.stringify(state));
        if (state?.status === 'running' && state.simStepCount > 5 && state.gpuLoop?.dispatchCount > 0) return state;
        await wait(100);
      }
      throw new Error('GPU object route did not reach running state: ' + JSON.stringify(window.kaminosGpuCombustibleObjectDebugState?.()));
    })()
  `, 35_000);
}

async function captureScreenshot(path, name) {
  const screenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: false }, 120_000);
  const png = Buffer.from(screenshot.data, 'base64');
  assert.ok(png.length > 18_000, `screenshot is too small: ${png.length}`);
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  screenshotPngs[name] = png;
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
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') browserEvents.push(message);
  });
  await wsRequest('Runtime.enable');
  await wsRequest('Page.enable');
  await wsRequest('Page.bringToFront');

  phase = 'waiting-for-initial';
  initialState = await waitForRunning();
  effectiveUrl = await evaluate('location.href');
  assert.equal(new URL(effectiveUrl).href, new URL(requestedUrl).href, 'effective URL mismatch');
  assert.equal(initialState.effectiveRoute, 'kaminos.gpu-combustible-object-ignition.v0');
  assert.equal(initialState.authority, EXPECTED_AUTHORITY);
  assert.equal(initialState.fallback, null);
  assert.equal(initialState.gpuLoop.hostCausalFeedbackCount, 0);
  assert.equal(initialState.gpuLoop.runtimeReadbackCount, 0);
  phase = 'capturing-initial';
  screenshots.initial = await captureScreenshot(initialOut, 'initial');

  phase = 'advancing-through-ignition';
  ignitionState = await evaluate(`window.kaminosGpuCombustibleObjectWaitFrames(${ignitionFrames})`, 60_000);
  assert.equal(ignitionState.gpuLoop.hostCausalFeedbackCount, 0);
  assert.equal(ignitionState.gpuLoop.runtimeReadbackCount, 0);
  phase = 'capturing-ignition';
  screenshots.ignition = await captureScreenshot(ignitionOut, 'ignition');

  phase = 'advancing-through-support-loss';
  await evaluate(`window.kaminosGpuCombustibleObjectWaitFrames(${finalFrames})`, 90_000);
  phase = 'freezing-terminal-state';
  terminalReceipt = await evaluate('window.kaminosGpuCombustibleObjectFreezeAndReadTerminal()', 120_000);
  finalState = await evaluate('window.kaminosGpuCombustibleObjectDebugState()');
  assert.equal(terminalReceipt.authority, EXPECTED_AUTHORITY);
  assert.equal(terminalReceipt.status, 'frozen-terminal-readback');
  assert.equal(terminalReceipt.hostCausalFeedbackCount, 0);
  assert.equal(terminalReceipt.runtimeReadbackCount, 1);
  assert.equal(terminalReceipt.terminalMapAsyncCount, 1);
  assert.equal(terminalReceipt.terminalMappedBufferCount, 1);
  assert.equal(terminalReceipt.terminalCopiedSourceBufferCount, 4);
  assert.equal(terminalReceipt.eventLog.overflow, 0);
  assert.equal(terminalReceipt.sourceHeader.overflowCount, 0);
  const targetMaterial = terminalReceipt.materials.find(material => material.objectId === 2);
  const controlMaterial = terminalReceipt.materials.find(material => material.objectId === 3);
  assert.ok(targetMaterial.firstExposureStep > 0, 'target never received GPU Pyro exposure');
  assert.ok(targetMaterial.ignitionStep > targetMaterial.firstExposureStep, 'target ignition did not follow exposure');
  assert.ok(targetMaterial.supportLossStep > targetMaterial.ignitionStep, 'support loss did not follow ignition');
  assert.ok(targetMaterial.impactStep > targetMaterial.supportLossStep, 'impact did not follow support loss');
  assert.ok(
    ignitionState.simStepCount >= targetMaterial.ignitionStep &&
      ignitionState.simStepCount < targetMaterial.supportLossStep,
    'ignition capture did not land between target ignition and support loss',
  );
  assert.ok(targetMaterial.emittedHeat > 0 && targetMaterial.remainingFuel < 0.56, 'target did not become a new GPU fire source');
  assert.equal(terminalReceipt.receiverAudit.auditObjectId, targetMaterial.objectId);
  assert.equal(terminalReceipt.receiverAudit.rejectedRecords, 0);
  assert.ok(terminalReceipt.receiverAudit.acceptedRecords > 0, 'target source was not accepted by the Pyro receiver');
  assert.ok(
    terminalReceipt.receiverAudit.injectedHeat > 0 && terminalReceipt.receiverAudit.injectedFuel > 0,
    'accepted target source did not inject heat and fuel into Pyro',
  );
  assert.ok(targetMaterial.angleRad > 0.2 && targetMaterial.verticalDrop > 0.2, 'target GPU mechanics did not rotate and fall');
  assert.equal(controlMaterial.phase, 0);
  assert.equal(controlMaterial.emittedHeat, 0);
  assert.equal(controlMaterial.supportCapacity, 1);
  phase = 'capturing-final';
  screenshots.final = await captureScreenshot(out, 'final');
  phase = 'validating-composed-pixels';
  pixelChecks = validateGpuCombustibleObjectPixelSequence(screenshotPngs);

  phase = 'completed';
  writeReport({ status: 'ok' });
  process.stdout.write(`${reportPath}\n`);
} catch (error) {
  if (ws && !finalState) {
    try {
      finalState = await evaluate('window.kaminosGpuCombustibleObjectDebugState()');
      terminalReceipt ||= finalState?.gpuLoop?.lastTerminalReceipt || null;
    } catch {}
  }
  writeReport({ status: 'failed', error: error?.stack || error?.message || String(error) });
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM');
}
