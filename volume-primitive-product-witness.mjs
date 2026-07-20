#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--')
  ? [value, values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : true]
  : null).filter(Boolean));
const routeReceiptPath = resolve(String(args.get('--route-receipt') || 'scratch/live-full-support-optics-18790/route-receipt.json'));
const outputDir = resolve(String(args.get('--output-dir') || `/tmp/kaminos-volume-dynamic-source-witness-${Date.now()}`));
const timeoutMs = Number(args.get('--timeout-ms') || 180_000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const reportPath = resolve(outputDir, 'report.json');
const leftScreenshotPath = resolve(outputDir, 'source-left.png');
const rightScreenshotPath = resolve(outputDir, 'source-right.png');
const cockpitScreenshotPath = resolve(outputDir, 'operator-cockpit.png');
const browserProfile = `/tmp/kaminos-volume-dynamic-source-chrome-${process.pid}-${Date.now()}`;
let browser = null;
let socket = null;
let failurePhase = 'route-receipt-validation';
let lastTrustworthyEvidence = { routeReceiptPath };
mkdirSync(outputDir, { recursive: true });

class CdpSocket {
  constructor(url) {
    this.url = url;
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
        const pending = this.pending.get(message.id);
        if (!pending) {
          if (message.method) this.events.push(message);
          return;
        }
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
  assert.ok(existsSync(routeReceiptPath), `route receipt missing:${routeReceiptPath}`);
  const routeReceipt = JSON.parse(readFileSync(routeReceiptPath, 'utf8'));
  assert.equal(routeReceipt.status, 'serving', 'route receipt is not serving');
  const url = new URL(routeReceipt.effectiveRoute);
  for (const key of ['full_support_live_step', 'full_support_source', 'volume_primitive_fixture', 'volume_primitive_product']) {
    url.searchParams.delete(key);
  }
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('warmup_steps', '0');
  url.searchParams.set('role', 'truthHigh');
  url.searchParams.set('composition', 'raymarch-only-v0');
  url.searchParams.set('volume_boundary_splat_mode', 'off');
  url.searchParams.set('volume_dynamic_sources', '1');
  url.searchParams.set('volume_presentation', 'beauty');
  url.searchParams.set('volume_raymarch_smoke', 'on');
  url.searchParams.set('volume_look_freeze', '0');
  const requestedRoute = url.href;
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, requestedRoute };

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
  const target = await waitForTarget(debugPort);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
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
  await socket.call('Page.navigate', { url: requestedRoute });

  failurePhase = 'live-source-bootstrap';
  const bootstrap = await waitForValue(`(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const debug = runtime.__kaminosVolumePrototype?.debugState?.();
    const receipt = runtime.__kaminosDynamicVolumeSourceReceipt;
    const panel = runtime.document?.querySelector('#volume-primitive-product-panel');
    if (!debug?.active || debug.simStepCount < 12 || !receipt || panel?.hidden !== false) return null;
    runtime.document.querySelector('#volume-primitive-product-motion').checked = false;
    return {
      route: runtime.location.href,
      prototypeIdentity: debug.identity,
      routeIdentity: debug.routeIdentity || debug.route,
      backend: debug.backend,
      simStepCount: debug.simStepCount,
      resetCount: debug.fluidStateResetCount,
      compositionRequested: debug.selectiveHeadLiveCompositionRequested,
      compositionEffective: debug.selectiveHeadLiveCompositionEffective,
      externalEmitterCount: debug.externalEmitterCount,
      receipt,
      panelVisible: panel.hidden === false,
    };
  })()`);
  assert.equal(bootstrap.receipt.identity, 'kaminos-dynamic-volume-source-runtime-v0');
  assert.equal(bootstrap.routeIdentity, 'native-3d-compute-fluid-raymarch-v0');
  assert.match(bootstrap.backend, /^WebGPU:/);
  assert.equal(bootstrap.compositionRequested, 'raymarch-only-v0');
  assert.equal(bootstrap.compositionEffective, 'raymarch-only-v0');
  assert.equal(bootstrap.externalEmitterCount, 1);
  assert.equal(bootstrap.receipt.gpuApplication, 'immediate-storage-buffer-write');
  assert.equal(bootstrap.receipt.effectiveSourceCount, 1);
  assert.equal(bootstrap.receipt.effectiveCoordinateSpace, 'volume-local-normalized-cube-v0');
  assert.equal(bootstrap.receipt.fluidStateResetApplied, false);
  assert.ok(bootstrap.receipt.appliedChannels.includes('velocity'));
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };

  failurePhase = 'left-source-update';
  await configureCapsule();
  const leftReceipt = await setTransform([-0.42, -0.5, 0]);
  await delay(2200);
  const leftState = await runtimeState();
  assert.equal(leftState.receipt.effectiveSourceCount, 1);
  assert.equal(leftState.externalEmitterCount, 1);
  assert.equal(leftState.compositionEffective, 'raymarch-only-v0');
  assert.equal(leftState.receipt.gpuApplication, 'immediate-storage-buffer-write');
  assert.equal(leftState.receipt.effectiveSources[0].shape, 'capsule');
  assert.equal(leftState.receipt.fluidStateResetApplied, false);
  assert.ok(leftState.simStepCount > bootstrap.simStepCount, 'simulation did not advance after left source update');
  const leftShot = await captureCanvas(leftScreenshotPath);
  const leftPixels = await analyzeScreenshot(leftShot.base64);
  assert.ok(leftPixels.litPixelFraction > 0.01, `left frame is blank:${leftPixels.litPixelFraction}`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, leftReceipt, leftState, leftPixels, leftScreenshotPath };

  failurePhase = 'right-source-update';
  const rightReceipt = await setTransform([0.42, -0.5, 0]);
  await delay(2200);
  const rightState = await runtimeState();
  assert.equal(rightState.receipt.effectiveSourceCount, 1);
  assert.equal(rightState.externalEmitterCount, 1);
  assert.equal(rightState.compositionEffective, 'raymarch-only-v0');
  assert.equal(rightState.receipt.gpuApplication, 'immediate-storage-buffer-write');
  assert.equal(rightState.receipt.fluidStateResetApplied, false);
  assert.equal(rightState.resetCount, leftState.resetCount, 'moving the dynamic source reset fluid state');
  assert.ok(rightState.simStepCount > leftState.simStepCount, 'simulation did not advance after right source update');
  assert.ok(rightState.receipt.updateCostMs < 20, `dynamic source update cost exceeded 20ms:${rightState.receipt.updateCostMs}`);
  const rightShot = await captureCanvas(rightScreenshotPath);
  const rightPixels = await analyzeScreenshot(rightShot.base64);
  assert.ok(rightPixels.litPixelFraction > 0.01, `right frame is blank:${rightPixels.litPixelFraction}`);
  const changedPixelFraction = compareSamples(leftPixels.samples, rightPixels.samples);
  assert.ok(changedPixelFraction > 0.02, `live simulation frames did not visibly change:${changedPixelFraction}`);
  const browserFailures = browserFailureEvents(socket.events);
  assert.deepEqual(browserFailures, [], `browser emitted failures:${browserFailures.join(' | ')}`);
  await capturePage(cockpitScreenshotPath);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    rightReceipt,
    rightState,
    rightPixels,
    changedPixelFraction,
    rightScreenshotPath,
  };

  const report = {
    schema: 'kaminos.dynamic-volume-source-witness.v0',
    status: 'passed',
    evidenceAuthority: 'operator-exploration-only',
    requestedRoute,
    effectiveRoute: rightState.route,
    bootstrap,
    leftState,
    rightState,
    visual: {
      left: { ...leftPixels, samples: undefined },
      right: { ...rightPixels, samples: undefined },
      changedPixelFraction,
    },
    screenshots: {
      left: leftScreenshotPath,
      right: rightScreenshotPath,
      cockpit: cockpitScreenshotPath,
    },
    browserFailures,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    schema: 'kaminos.dynamic-volume-source-witness.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill('SIGTERM');
}

async function configureCapsule() {
  return evaluate(`(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const values = { shape: 'capsule', length: 0.42, radius: 0.07, smoke: 0.5, heat: 2.8, fuel: 1.4, flame: 3.0, detail: 1.5, impulse: 1.2 };
    for (const [name, value] of Object.entries(values)) {
      const control = runtime.document.querySelector('#volume-primitive-product-' + name);
      if (!control) throw new Error('dynamic-source-control-missing:' + name);
      control.value = String(value);
      control.dispatchEvent(new Event(name === 'shape' ? 'change' : 'input', { bubbles: true }));
    }
    return runtime.__kaminosDynamicVolumeSourceReceipt;
  })()`);
}

async function setTransform(position) {
  return evaluate(`(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    return runtime.kaminosSetVolumeDynamicSourceTransform({
      position: ${JSON.stringify(position)},
      rotation: [0, 0, 0.45],
      scale: [1, 1, 1],
    });
  })()`);
}

async function runtimeState() {
  return evaluate(`(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const debug = runtime.__kaminosVolumePrototype?.debugState?.();
    return {
      route: runtime.location.href,
      active: debug?.active,
      simStepCount: debug?.simStepCount,
      resetCount: debug?.fluidStateResetCount,
      backend: debug?.backend,
      compositionRequested: debug?.selectiveHeadLiveCompositionRequested,
      compositionEffective: debug?.selectiveHeadLiveCompositionEffective,
      externalEmitterCount: debug?.externalEmitterCount,
      receipt: runtime.__kaminosDynamicVolumeSourceReceipt,
    };
  })()`);
}

async function captureCanvas(path) {
  const rect = await evaluate(`(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const canvas = runtime.document.querySelector('#kaminos-volume-canvas');
    if (!canvas) throw new Error('volume-canvas-missing');
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  })()`);
  assert.ok(rect.width >= 320 && rect.height >= 240, `volume canvas is too small:${rect.width}x${rect.height}`);
  const shot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { ...rect, scale: 1 },
  });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  return { base64: shot.data, rect };
}

async function capturePage(path) {
  const result = await socket.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  writeFileSync(path, Buffer.from(result.data, 'base64'));
  return path;
}

async function analyzeScreenshot(base64) {
  return evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${base64}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 128, 128);
    const rgba = context.getImageData(0, 0, 128, 128).data;
    const samples = [];
    let lit = 0;
    let lumaTotal = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      const luma = Math.round(rgba[index] * 0.2126 + rgba[index + 1] * 0.7152 + rgba[index + 2] * 0.0722);
      samples.push(luma);
      lumaTotal += luma;
      if (luma > 8) lit += 1;
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      litPixelFraction: lit / samples.length,
      meanLuma: lumaTotal / samples.length,
      samples,
    };
  })()`);
}

function compareSamples(left, right) {
  assert.equal(left.length, right.length, 'pixel sample lengths differ');
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > 8) changed += 1;
  }
  return changed / left.length;
}

function browserFailureEvents(events) {
  return events.flatMap(event => {
    if (event.method === 'Runtime.exceptionThrown') {
      return [event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || 'runtime-exception'];
    }
    if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)) {
      const text = event.params.entry.text || 'browser-log-failure';
      if (/favicon|Referrer header/i.test(text)) return [];
      return [text];
    }
    return [];
  });
}

async function waitForValue(expression) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const value = await evaluate(expression);
    if (value !== null && value !== undefined) return value;
    await delay(200);
  }
  throw new Error('timed out waiting for browser value');
}

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'runtime evaluation failed');
  }
  return result.result.value;
}

async function waitForTarget(port) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(candidate => candidate.type === 'page');
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
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

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
