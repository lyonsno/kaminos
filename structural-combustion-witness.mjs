#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { validateStructuralCombustionEvidence } from './structural-combustion-evidence.mjs';

const REPORT_SCHEMA = 'kaminos.structural-combustion.browser-witness-report.v0';
const PAGE_ROUTE = 'kaminos.structural-combustion-dimensional-browser.v0';
const AUTHORITY = 'same-device-pyro-node-material-bond-strength-v0';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const integer = (key, fallback) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
    return value;
  };
  const requestedUrl = values.get('--url') || 'http://127.0.0.1:8178/structural-combustion.html';
  const reportPath = resolve(values.get('--report') || 'artifacts/structural-combustion/browser-witness.json');
  const finalPath = resolve(values.get('--final') || reportPath.replace(/\.json$/i, '.final.png'));
  return {
    requestedUrl,
    reportPath,
    initialPath: resolve(values.get('--initial') || reportPath.replace(/\.json$/i, '.initial.png')),
    orbitPath: resolve(values.get('--orbit') || reportPath.replace(/\.json$/i, '.orbit.png')),
    finalPath,
    debugPort: integer('--debug-port', 9342),
    width: integer('--width', 1468),
    height: integer('--height', 960),
    finalFrames: integer('--final-frames', 900),
    chrome: process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: values.get('--user-data-dir') || `/tmp/kaminos-structural-combustion-${process.pid}`,
  };
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
    const reportPath = resolve(process.argv[reportIndex + 1]);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: 'configuration',
      requestedArguments: process.argv.slice(2),
      effectiveConfig: null,
      lastTrustworthyEvidence: null,
      error: error.stack || error.message,
    }, null, 2)}\n`);
  }
  throw error;
}

let phase = 'configuration';
let chromeProcess = null;
let websocket = null;
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
let evidence = null;
let validation = null;
const runtimeErrors = [];
const screenshots = {};

function writeReport(status, error = null) {
  const report = {
    schema: REPORT_SCHEMA,
    status,
    failurePhase: status === 'passed' ? null : phase,
    requestedConfig: {
      url: config.requestedUrl,
      requestedBackend: 'webgpu',
      viewport: { width: config.width, height: config.height },
      finalFrames: config.finalFrames,
      debugPort: config.debugPort,
      reportPath: config.reportPath,
      screenshotPaths: {
        initial: config.initialPath,
        orbit: config.orbitPath,
        final: config.finalPath,
      },
    },
    effectiveConfig: {
      url: effectiveUrl,
      backend: evidence?.effectiveBackend || null,
      browserVersion,
      pageRoute: evidence?.pageRoute || null,
      authority: evidence?.authority || null,
    },
    lastTrustworthyEvidence: evidence,
    validation,
    screenshots,
    runtimeErrors,
    stderrTail: stderr.slice(-2400),
    error: error ? (error.stack || error.message || String(error)) : null,
  };
  mkdirSync(dirname(config.reportPath), { recursive: true });
  writeFileSync(config.reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function cdpFetch(path, timeoutMs = 1000) {
  const response = await fetch(`http://127.0.0.1:${config.debugPort}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      return await cdpFetch('/json/version', 400);
    } catch {
      if (chromeProcess?.exitCode !== null) throw new Error(`Chrome exited during launch with ${chromeProcess.exitCode}`);
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForTarget() {
  const expected = new URL(config.requestedUrl).href;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const targets = await cdpFetch('/json/list');
    const target = targets.find(item => item.type === 'page' && item.url && new URL(item.url).href === expected);
    if (target?.webSocketDebuggerUrl) return target;
    await delay(100);
  }
  throw new Error(`requested route did not open: ${expected}`);
}

function connect(url) {
  websocket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  websocket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    websocket.addEventListener('open', resolveOpen, { once: true });
    websocket.addEventListener('error', rejectOpen, { once: true });
  });
  const send = async (method, params = {}, timeoutMs = 120_000) => {
    await opened;
    const id = ++nextId;
    websocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve(value) { clearTimeout(timer); resolveRequest(value); },
        reject(error) { clearTimeout(timer); rejectRequest(error); },
      });
    });
  };
  return { opened, send };
}

async function evaluate(send, expression, timeoutMs = 120_000) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function capture(send, evaluatePage, path) {
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: false,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(result.data, 'base64');
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'browser capture is not a PNG');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const pixelProbe = await evaluatePage(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${result.data}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonDarkPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 28) nonDarkPixels += 1;
    }
    return { nonDarkPixels, sampledPixels: canvas.width * canvas.height };
  })()`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { path, bytes: png.length, sha256, ...pixelProbe };
}

try {
  phase = 'debug-port-preflight';
  try {
    await cdpFetch('/json/version', 250);
    throw new Error(`CDP debug port is already occupied: ${config.debugPort}`);
  } catch (error) {
    if (/already occupied/.test(error.message)) throw error;
  }

  phase = 'chrome-launch';
  chromeProcess = spawn(config.chrome, [
    `--remote-debugging-port=${config.debugPort}`,
    `--user-data-dir=${config.userDataDir}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${config.width},${config.height}`,
    config.requestedUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  browserVersion = await waitForCdp();

  phase = 'route-connection';
  const target = await waitForTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.bringToFront');
  const evaluatePage = (expression, timeoutMs) => evaluate(cdp.send, expression, timeoutMs);

  phase = 'running-state';
  const initialState = await evaluatePage(`(async () => {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const state = window.kaminosStructuralCombustionDebugState?.();
      if (state?.status === 'failed') throw new Error(JSON.stringify(state));
      if (state?.status === 'running' && state.simStepCount > 8 && state.gpuLoop?.dispatchCount > 0) return state;
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error('structural combustion route did not enter running state');
  })()`, 35_000);
  effectiveUrl = await evaluatePage('location.href');
  assert.equal(initialState.schema, PAGE_ROUTE);
  assert.equal(initialState.authority, AUTHORITY);
  assert.equal(initialState.fallback, null);
  assert.equal(initialState.gpuLoop.liveRuntimeReadbackCount, 0);
  screenshots.initial = await capture(cdp.send, evaluatePage, config.initialPath);

  phase = 'camera-input';
  const start = { x: Math.round(config.width * 0.50), y: Math.round(config.height * 0.48) };
  const end = { x: Math.round(config.width * 0.59), y: Math.round(config.height * 0.40) };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...end, deltaX: 0, deltaY: -220 });
  const orbitState = await evaluatePage('window.kaminosStructuralCombustionWaitFrames(10)');
  screenshots.orbit = await capture(cdp.send, evaluatePage, config.orbitPath);

  phase = 'combustion-advance';
  await evaluatePage(`window.kaminosStructuralCombustionWaitFrames(${config.finalFrames})`, 120_000);
  phase = 'frozen-terminal-readback';
  const terminalReceipt = await evaluatePage('window.kaminosStructuralCombustionFreezeAndReadTerminal()', 120_000);
  const finalState = await evaluatePage('window.kaminosStructuralCombustionDebugState()');
  screenshots.final = await capture(cdp.send, evaluatePage, config.finalPath);

  evidence = {
    requestedUrl: config.requestedUrl,
    effectiveUrl,
    requestedBackend: 'webgpu',
    effectiveBackend: finalState.backend,
    pageRoute: finalState.effectiveRoute,
    authority: finalState.authority,
    initial: {
      screenshot: screenshots.initial,
      frame: initialState.frameCount,
      simStep: initialState.simStepCount,
      camera: initialState.cameraControl,
    },
    orbited: {
      screenshot: screenshots.orbit,
      frame: orbitState.frameCount,
      simStep: orbitState.simStepCount,
      camera: orbitState.cameraControl,
    },
    final: {
      screenshot: screenshots.final,
      frame: finalState.frameCount,
      simStep: finalState.simStepCount,
      camera: finalState.cameraControl,
      terminalReceipt,
    },
    runtimeErrors,
  };
  phase = 'evidence-validation';
  validation = validateStructuralCombustionEvidence(evidence);
  phase = 'completed';
  writeReport('passed');
  process.stdout.write(`${config.reportPath}\n`);
} catch (error) {
  writeReport('failed', error);
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
} finally {
  try { websocket?.close(); } catch {}
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM');
}
