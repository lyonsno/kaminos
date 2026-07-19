#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

class CdpSocket {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((accept, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', accept, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.accept(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((accept, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { accept, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const requestedRoute = arg('--route', 'http://127.0.0.1:18791/volume-stage-b-rebake-cockpit.html');
const outputDir = resolve(arg('--out', 'artifacts/pyro-control-path-parity-audit/stage-b-rebake-live-smoke'));
const reportPath = resolve(outputDir, 'report.json');
const timeoutMs = Number(arg('--timeout-ms', '120000'));
const viewportWidth = Number(arg('--viewport-width', '1400'));
const viewportHeight = Number(arg('--viewport-height', '900'));
const debugPort = Number(arg('--debug-port', String(randomInt(42_000, 62_000))));
const profilePath = `/tmp/kaminos-stage-b-rebake-witness-${process.pid}-${Date.now()}`;
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(outputDir, { recursive: true });

let browser = null;
let cdp = null;
let failurePhase = 'browser-launch';
let lastTrustworthyEvidence = { requestedRoute };
const captures = [];

function writeReport(value) {
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitForTarget() {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find(row => row.type === 'page' && row.url.startsWith('http://127.0.0.1:18791/'));
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`Chrome CDP target did not appear: ${lastError?.message || 'timeout'}`);
}

async function evaluate(expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function waitForReceipt(previousPixelIdentity = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await evaluate('window.__kaminosStageBRebakeCockpit?.latestReceipt || null');
    if (receipt?.status === 'effective' && receipt.pixelIdentity !== previousPixelIdentity) return receipt;
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error('effective Stage B rebake receipt did not appear');
}

async function canvasMetrics(saveBaseline) {
  return evaluate(`(() => {
    const canvas = document.getElementById('frame');
    const context = canvas?.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!canvas || !context) throw new Error('blank-frame:canvas-missing');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let coloredPixels = 0;
    let sum = 0;
    let delta = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
      sum += value;
      if (value > 0) coloredPixels += 1;
      if (globalThis.__kaminosStageBBaselinePixels) {
        delta += Math.abs(pixels[index] - globalThis.__kaminosStageBBaselinePixels[index]);
        delta += Math.abs(pixels[index + 1] - globalThis.__kaminosStageBBaselinePixels[index + 1]);
        delta += Math.abs(pixels[index + 2] - globalThis.__kaminosStageBBaselinePixels[index + 2]);
      }
    }
    const result = {
      width: canvas.width,
      height: canvas.height,
      coloredPixels,
      nonblank: coloredPixels > 0,
      meanRgb: sum / (canvas.width * canvas.height * 3),
      meanAbsoluteChannelDelta: globalThis.__kaminosStageBBaselinePixels ? delta / (canvas.width * canvas.height * 3) : 0,
    };
    if (${saveBaseline ? 'true' : 'false'}) globalThis.__kaminosStageBBaselinePixels = new Uint8ClampedArray(pixels);
    return result;
  })()`);
}

async function capturePng(path, selector = null) {
  let clip;
  if (selector) {
    clip = await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('screenshot-target-missing:${selector}');
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    })()`);
  }
  const capture = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(path, Buffer.from(capture.data, 'base64'));
}

async function captureTreatment(name, previousPixelIdentity = null) {
  if (name !== 'baseline') {
    await evaluate(`document.querySelector('[data-preset="${name}"]').click()`);
  }
  const receipt = await waitForReceipt(previousPixelIdentity);
  const metrics = await canvasMetrics(name === 'baseline');
  assert.equal(metrics.nonblank, true, `blank-frame:${name}`);
  if (name !== 'baseline') assert.ok(metrics.meanAbsoluteChannelDelta > 0, `no-pixel-delta:${name}`);
  const screenshotPath = resolve(outputDir, `${name}.png`);
  await capturePng(screenshotPath, '#frame');
  const capture = { name, receipt, metrics, screenshotPath };
  captures.push(capture);
  lastTrustworthyEvidence = capture;
  return capture;
}

try {
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    requestedRoute,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  failurePhase = 'target-admission';
  const target = await waitForTarget();
  cdp = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await cdp.open();
  await Promise.all([cdp.call('Runtime.enable'), cdp.call('Page.enable'), cdp.call('Log.enable')]);
  failurePhase = 'baseline-capture';
  const baseline = await captureTreatment('baseline');
  failurePhase = 'sparse-capture';
  const sparse = await captureTreatment('sparse', baseline.receipt.pixelIdentity);
  failurePhase = 'dense-capture';
  const dense = await captureTreatment('dense', sparse.receipt.pixelIdentity);
  failurePhase = 'identity-audit';
  assert.equal(sparse.receipt.sourceStateIdentity, baseline.receipt.sourceStateIdentity, 'source-state-drift:sparse');
  assert.equal(dense.receipt.sourceStateIdentity, baseline.receipt.sourceStateIdentity, 'source-state-drift:dense');
  assert.notEqual(sparse.receipt.candidateIdentity, baseline.receipt.candidateIdentity, 'candidate-identity-noop:sparse');
  assert.notEqual(dense.receipt.candidateIdentity, baseline.receipt.candidateIdentity, 'candidate-identity-noop:dense');
  assert.notEqual(sparse.receipt.coefficientIdentity, baseline.receipt.coefficientIdentity, 'coefficient-identity-noop:sparse');
  assert.notEqual(dense.receipt.coefficientIdentity, baseline.receipt.coefficientIdentity, 'coefficient-identity-noop:dense');
  for (const capture of captures) {
    assert.equal(capture.receipt.fallback, null, `fallback:${capture.name}`);
    assert.equal(capture.receipt.simulatorAdvanced, false, `simulator-advanced:${capture.name}`);
    assert.equal(capture.receipt.controlStatus.every(row => row.status === 'rebake-coupled'), true, `control-status-missing:${capture.name}`);
  }
  failurePhase = 'browser-event-audit';
  const exceptions = cdp.browserEvents.filter(event => event.method === 'Runtime.exceptionThrown');
  assert.deepEqual(exceptions, [], `browser-exceptions:${JSON.stringify(exceptions)}`);
  failurePhase = 'cockpit-screenshot';
  const cockpitScreenshotPath = resolve(outputDir, 'cockpit.png');
  await capturePng(cockpitScreenshotPath);
  const effectiveRoute = await evaluate('location.href');
  const report = {
    schema: 'kaminos.volume.stage-b-rebake-live-smoke.v0',
    status: 'completed',
    failurePhase: null,
    effectiveRoute,
    requestedRoute,
    sourceStateIdentity: baseline.receipt.sourceStateIdentity,
    viewport: { width: viewportWidth, height: viewportHeight },
    captures,
    cockpitScreenshotPath,
    browserEvents: cdp.browserEvents,
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    schema: 'kaminos.volume.stage-b-rebake-live-smoke.v0',
    status: 'failed',
    failurePhase,
    effectiveRoute: null,
    requestedRoute,
    error: error?.message || String(error),
    lastTrustworthyEvidence,
    captures,
    browserEvents: cdp?.browserEvents || [],
  };
  writeReport(report);
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (browser?.exitCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([
      new Promise(accept => browser.once('exit', accept)),
      new Promise(accept => setTimeout(accept, 5000)),
    ]);
  }
  rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
