#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8090/hand-surface-compositor-demo.html';
const out = resolve(args.get('--out') || '/tmp/kaminos-hand-surface-browser-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9447);
const settleMs = Number(args.get('--settle-ms') || 1200);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-hand-surface-browser-witness-profile-${port}-${process.pid}`;

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let debugState = null;
let browserVersion = null;

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.tracked-hand-surface-browser-witness-report.v0',
    toolId: 'kaminos-hand-surface-browser-witness-v0',
    requestedUrl: url,
    effectiveUrl,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    phase,
    browserVersion,
    debugState,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path, options = {}) {
  const { timeoutMs = 5000, ...fetchOptions } = options;
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, fetchOptions);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { timeoutMs: 300 });
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  for (let index = 0; index < 80; index += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}, options = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, options.timeoutMs || 10000);
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs: options.timeoutMs || 10000 });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function capturePngScreenshot(ws, screenshotPath) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assert.ok(png.length > 4096, 'screenshot is too small to be credible visual evidence');
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return { path: screenshotPath, bytes: png.length };
}

try {
  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) {
    throw new Error(`CDP debug port already in use before launch: ${port}`);
  }

  phase = 'launching-chrome';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1280,720',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  chromeProcess.once('error', (error) => {
    stderr += `\nChrome launch failed: ${error.message}`;
  });

  phase = 'waiting-for-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find((entry) => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('no page websocket debugger url');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);

  phase = 'activating-page';
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.bringToFront');
  await delay(settleMs);

  phase = 'checking-route';
  effectiveUrl = await evaluate(ws, 'window.location.href');
  if (new URL(effectiveUrl).pathname !== new URL(url).pathname) {
    throw new Error(`effective URL mismatch: requested ${url} got ${effectiveUrl}`);
  }

  phase = 'reading-debug-state';
  debugState = await evaluate(ws, `
    (() => {
      const state = window.kaminosTrackedHandSurfaceDebugState?.();
      if (!state) throw new Error('missing kaminosTrackedHandSurfaceDebugState');
      return state;
    })()
  `);
  if (debugState.report?.schema !== 'kaminos.tracked-hand-surface-compositor.v0') {
    throw new Error('hand surface debug state did not expose compositor report');
  }
  if (debugState.report?.consumerBridge?.sourceTruthOwner !== 'kaminos') {
    throw new Error('hand surface route did not preserve Kaminos source-truth ownership');
  }
  if (debugState.report?.authority === 'live_tracked_hand_surface' && debugState.useFixture) {
    throw new Error('fixture route claimed live hand-surface authority');
  }

  phase = 'capturing-screenshot';
  const screenshot = await capturePngScreenshot(ws, out);
  await ws.close();
  chromeProcess.kill('SIGTERM');
  phase = 'complete';
  writeReport({ ok: true, screenshot });
  console.log(JSON.stringify({ ok: true, out, report: reportPath, authority: debugState.report.authority }, null, 2));
} catch (error) {
  writeReport({ ok: false, error: error instanceof Error ? error.message : String(error) });
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
