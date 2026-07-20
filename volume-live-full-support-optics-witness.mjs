#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const routeReceiptPath = requiredPath('--route-receipt');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-live-full-support-optics/report.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-live-full-support-optics/operator.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 180_000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const routeReceipt = JSON.parse(readFileSync(routeReceiptPath, 'utf8'));
const browserProfile = `/tmp/kaminos-live-full-support-optics-chrome-${process.pid}-${Date.now()}`;
const startedAtMs = performance.now();
let browser = null;
let socket = null;
let failurePhase = 'route-receipt-validation';
let lastTrustworthyEvidence = { routeReceiptPath };
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(screenshotPath), { recursive: true });

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          this.events.push(message);
          return;
        }
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
        reject(new Error(`CDP call timed out:${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  assert.equal(routeReceipt.schema, 'kaminos.pyro.live-full-support-optics-session.v0');
  assert.equal(routeReceipt.status, 'serving');
  assert.equal(routeReceipt.sourceFieldImportApplied, false);
  assert.equal(routeReceipt.stageBMediaBootstrapApplied, false);
  const expectedUrl = new URL(routeReceipt.effectiveRoute).href;
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, expectedUrl };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`,
    '--window-size=1800,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1800,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: expectedUrl });

  failurePhase = 'live-optics-bootstrap';
  const bootstrap = await waitForValue(socket, timeoutMs, `(() => {
    if (document.readyState !== 'complete') return null;
    const runtime = document.querySelector('#basin')?.contentWindow;
    const receipt = runtime?.__kaminosLiveFullSupportOpticsBootstrapReceipt;
    if (!receipt || receipt.status === 'loading') return null;
    return receipt;
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };
  assert.equal(bootstrap.status, 'effective');
  assert.equal(bootstrap.authority, 'live-simulator-exact-step-v0');
  assert.equal(bootstrap.evidenceAuthority, 'operator-exploration-only');
  assert.equal(bootstrap.decisionBearing, false);
  assert.equal(bootstrap.sourceFieldImportApplied, false);
  assert.equal(bootstrap.stageBMediaBootstrapApplied, false);
  assert.equal(bootstrap.fullGridHashReadbackApplied, false);
  assert.equal(bootstrap.fullPopulationReadbackApplied, false);
  assert.equal(bootstrap.requestedSimStepCount, 120);
  assert.ok(bootstrap.effectiveSimStepCount > 120);
  assert.equal(bootstrap.simulationMotionEffective, 'live');
  assert.equal(bootstrap.cameraMotionEffective, 'interactive');
  assert.equal(bootstrap.requestedComposition, 'splat-only-v0');
  assert.equal(bootstrap.effectiveComposition, 'splat-only-v0');
  assert.equal(bootstrap.requestedOpticalRecurrence, 'matched-optical-recurrence-v0');
  assert.equal(bootstrap.effectiveOpticalRecurrence, 'matched-optical-recurrence-v0');
  assert.equal(bootstrap.rendererEncoded, true);
  assert.equal(bootstrap.rendererApplied, true);
  assert.equal(bootstrap.coefficientAuthority, 'live-raymarch-complete-flame-native-cell-coefficients-v0');
  assert.equal(bootstrap.coefficientReceipt?.status, 'effective');
  assert.equal(bootstrap.coefficientReceipt?.rowCount, 160 ** 3);
  assert.equal(bootstrap.coefficientReceipt?.cpuCoefficientReadbackApplied, false);
  assert.equal(bootstrap.liveFrameReceipt?.status, 'effective');
  assert.equal(bootstrap.liveFrameReceipt?.producedSimStepCount, bootstrap.liveFrameReceipt?.consumedSimStepCount);
  assert.equal(bootstrap.liveFrameReceipt?.producedSimStepCount, bootstrap.liveFrameReceipt?.presentedSimStepCount);
  assert.equal(bootstrap.loadReceipt?.overlayApplied, false);
  assert.equal(bootstrap.overlayReceipt?.status, 'off');

  failurePhase = 'live-coefficient-producer-probe';
  const coefficientStats = await evaluate(socket, `(async () => {
    const prototype = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
    if (!prototype?.sampleLiveCompleteFlameOpticalCoefficientStats) {
      throw new Error('live-coefficient-sample-api-missing');
    }
    return prototype.sampleLiveCompleteFlameOpticalCoefficientStats({ sampleCount: 8192 });
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, coefficientStats };
  assert.equal(coefficientStats.producerHeader?.rowCount, 160 ** 3, 'live coefficient producer did not visit the complete grid');
  assert.equal(coefficientStats.producerHeader?.capacity, 160 ** 3, 'live coefficient producer capacity was substituted');
  assert.equal(coefficientStats.producerHeader?.mode, 4, 'live coefficient producer did not execute mode 4');
  assert.equal(coefficientStats.producerHeader?.overflowCount, 0, 'live coefficient producer overflowed its native-cell target');
  assert.equal(coefficientStats.nonFiniteCoefficientCount, 0);
  assert.ok(coefficientStats.positiveCoefficientCount > 0, 'live coefficient producer sampled only zero rows');
  assert.ok(coefficientStats.maximumEmission > 0, 'live coefficient producer has no emission');
  assert.ok(coefficientStats.maximumExtinction > 0, 'live coefficient producer has no extinction');

  failurePhase = 'live-motion-probe';
  const first = await captureLiveSample(socket);
  await delay(1200);
  const second = await captureLiveSample(socket);
  const motionScreenshotPath = screenshotPath.replace(/(\.[^./]+)?$/, '-motion-probe$1');
  const motionScreenshot = await socket.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(motionScreenshotPath, Buffer.from(motionScreenshot.data, 'base64'));
  const liveMotionProbe = {
    ...compareLiveSamples(first, second),
    first: sampleMetrics(first),
    second: sampleMetrics(second),
    motionScreenshotPath,
  };
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, liveMotionProbe };
  assert.ok(liveMotionProbe.frameStepDelta > 0, `live simulation did not advance:${liveMotionProbe.frameStepDelta}`);
  assert.ok(liveMotionProbe.changedPixelFraction > 0.001, `live pixels remained frozen:${liveMotionProbe.changedPixelFraction}`);
  assert.ok(second.litFraction > 0.001, `live optical frame was blank:${second.litFraction}`);
  assert.ok(second.maximumLuma > 3, `live optical frame had no visible energy:${second.maximumLuma}`);
  assert.equal(second.rendererEncoded, true);
  assert.equal(second.rendererApplied, true);
  assert.equal(second.effectiveComposition, 'splat-only-v0');
  assert.equal(second.effectivePresentation, 'matched-optical-recurrence-v0');
  assert.equal(second.effectiveDeposition, 'flow-kernel-moment-gaussian-raster-v0');
  assert.equal(second.fallbackReason, null);

  failurePhase = 'camera-motion-probe';
  const cameraBefore = await runtimeState(socket);
  const viewportPoint = await evaluate(socket, `(() => {
    const frame = document.querySelector('#basin');
    const canvas = frame?.contentDocument?.querySelector('#kaminos-host-renderer-canvas');
    if (!frame || !canvas) throw new Error('volume-canvas-missing');
    const outer = frame.getBoundingClientRect();
    const inner = canvas.getBoundingClientRect();
    return { x: outer.left + inner.left + inner.width * 0.5, y: outer.top + inner.top + inner.height * 0.5 };
  })()`);
  await socket.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: viewportPoint.x, y: viewportPoint.y, button: 'left', buttons: 1, clickCount: 1 });
  await socket.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: viewportPoint.x + 90, y: viewportPoint.y + 20, button: 'left', buttons: 1 });
  await socket.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: viewportPoint.x + 90, y: viewportPoint.y + 20, button: 'left', buttons: 0, clickCount: 1 });
  await delay(500);
  const cameraAfter = await runtimeState(socket);
  const cameraMotionProbe = {
    beforeSignature: cameraBefore.cameraSignature,
    afterSignature: cameraAfter.cameraSignature,
    simStepDelta: cameraAfter.simStepCount - cameraBefore.simStepCount,
    changed: cameraBefore.cameraSignature !== cameraAfter.cameraSignature,
  };
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, cameraMotionProbe };
  assert.equal(cameraMotionProbe.changed, true, 'camera drag did not change the live camera');
  assert.ok(cameraMotionProbe.simStepDelta >= 0, 'camera interaction rewound simulation state');

  failurePhase = 'operator-frame-capture';
  const screenshot = await socket.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'operator screenshot was blank');
  writeFileSync(screenshotPath, screenshotBytes);

  failurePhase = 'browser-error-audit';
  const browserErrors = socket.events.filter(event =>
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'));
  assert.deepEqual(browserErrors, [], `browser errors observed:${JSON.stringify(browserErrors)}`);

  const report = {
    schema: 'kaminos.pyro.live-full-support-optics-witness.v1',
    status: 'passed',
    failurePhase: null,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    bootstrap,
    coefficientStats,
    liveMotionProbe,
    cameraMotionProbe,
    pixelProbe: sampleMetrics(second),
    screenshotPath,
    elapsedMs: performance.now() - startedAtMs,
    browserErrors,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    screenshotPath,
    liveMotionProbe,
    cameraMotionProbe,
    pixelProbe: sampleMetrics(second),
  }, null, 2));
} catch (error) {
  const report = {
    schema: 'kaminos.pyro.live-full-support-optics-witness.v1',
    status: 'failed',
    failurePhase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence,
    screenshotPath: null,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser?.exitCode === null) browser.kill('SIGTERM');
}

async function captureLiveSample(cdp) {
  return evaluate(cdp, `(async () => {
    const prototype = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
    if (!prototype?.sampleFrame) throw new Error('live-optics-sample-api-missing');
    const sample = await prototype.sampleFrame({ advanceSim: false, includeRgba: false });
    if (!sample?.ok || !sample.preview?.rgba?.length) throw new Error('live-optics-preview-readback-missing');
    let litPixels = 0;
    let lumaSum = 0;
    let maximumLuma = 0;
    for (let index = 0; index < sample.preview.rgba.length; index += 4) {
      const luma = 0.2126 * sample.preview.rgba[index]
        + 0.7152 * sample.preview.rgba[index + 1]
        + 0.0722 * sample.preview.rgba[index + 2];
      if (luma > 3) litPixels += 1;
      lumaSum += luma;
      maximumLuma = Math.max(maximumLuma, luma);
    }
    const state = prototype.debugState();
    const pixelCount = sample.preview.rgba.length / 4;
    return {
      rgba: sample.preview.rgba,
      width: sample.preview.width,
      height: sample.preview.height,
      pixelCount,
      litPixels,
      litFraction: litPixels / Math.max(1, pixelCount),
      meanLuma: lumaSum / Math.max(1, pixelCount),
      maximumLuma,
      simStepCount: state.simStepCount,
      rendererEncoded: state.selectiveHeadLivePassReceipt?.splatEncoded === true,
      rendererApplied: state.selectiveHeadLivePassReceipt?.splatApplied === true,
      effectiveComposition: state.selectiveHeadLiveCompositionEffective,
      effectivePresentation: state.boundarySplatPresentationModeEffective,
      effectiveDeposition: state.fullSupportDepositionEffective,
      fallbackReason: state.liveCompleteFlameOpticalFrameReceipt?.fallbackReason
        || state.boundarySplatFallbackReason
        || state.boundarySplatPresentationModeFallbackReason
        || null,
    };
  })()`);
}

function compareLiveSamples(first, second) {
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  assert.equal(first.rgba.length, second.rgba.length);
  let changedPixels = 0;
  for (let index = 0; index < first.rgba.length; index += 4) {
    const delta = Math.abs(first.rgba[index] - second.rgba[index])
      + Math.abs(first.rgba[index + 1] - second.rgba[index + 1])
      + Math.abs(first.rgba[index + 2] - second.rgba[index + 2]);
    if (delta > 3) changedPixels += 1;
  }
  return {
    firstSimStepCount: first.simStepCount,
    secondSimStepCount: second.simStepCount,
    frameStepDelta: second.simStepCount - first.simStepCount,
    changedPixels,
    pixelCount: first.pixelCount,
    changedPixelFraction: changedPixels / Math.max(1, first.pixelCount),
  };
}

function sampleMetrics(sample) {
  const { rgba: _rgba, ...metrics } = sample;
  return metrics;
}

async function runtimeState(cdp) {
  return evaluate(cdp, `(() => {
    const prototype = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
    const state = prototype?.debugState?.();
    if (!state) throw new Error('live-optics-runtime-state-missing');
    return { simStepCount: state.simStepCount, cameraSignature: state.cameraSignature };
  })()`);
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

function requiredPath(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  const path = resolve(String(value));
  if (!existsSync(path)) throw new Error(`missing ${name} file:${path}`);
  return path;
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

async function waitForTarget(debugPortValue, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPortValue}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(candidate => candidate.type === 'page' && !String(candidate.url).startsWith('chrome-extension://'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function waitForValue(cdp, timeout, expression) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = await evaluate(cdp, expression);
    if (value !== null && value !== undefined) return value;
    await delay(200);
  }
  throw new Error('timed out waiting for browser value');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'runtime evaluation failed');
  }
  return result.result.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
