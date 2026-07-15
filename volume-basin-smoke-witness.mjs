#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const out = resolve(String(args.get('--out') || '/tmp/kaminos-volume-basin-smoke.png'));
const cockpitOut = resolve(String(args.get('--cockpit-out') || out.replace(/(\.png)?$/, '-cockpit.png')));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-volume-basin-smoke.json'));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};
let browser = null;
const sockets = [];

class CdpSocket {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }
  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.webSocketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => {
        const error = new Error(`CDP socket error: ${this.webSocketUrl}`);
        this.rejectPending(error);
        reject(error);
      });
      this.socket.addEventListener('close', () => this.rejectPending(new Error(`CDP socket closed: ${this.webSocketUrl}`)));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
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
        reject(new Error(`CDP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  close() { this.socket?.close(); }
}

try {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(cockpitOut), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-popup-blocking',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const initialTarget = await waitForTarget(target => target.type === 'page', timeoutMs);
  const initialSocket = await connect(initialTarget);
  await initialSocket.call('Page.enable');
  await initialSocket.call('Runtime.enable');
  await initialSocket.call('Page.navigate', { url });

  failurePhase = 'prototype-route-settle';
  const initialState = await waitForValue(initialSocket, `(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!state?.active || state?.volumeSceneAuthority?.status !== 'prototype') return null;
    return {
      volumeScene: state.volumeScene,
      volumeSceneAuthority: state.volumeSceneAuthority,
      simGrid: state.simGrid,
      boundarySplatMode: state.boundarySplatMode,
    };
  })()`, timeoutMs);
  assert.equal(initialState.volumeScene, 'tall_plume', 'cockpit did not resolve to tall_plume');
  assert.equal(initialState.volumeSceneAuthority.fallbackReason, null, 'scene authority silently substituted');

  const initialTargetIds = new Set((await targetList()).map(target => target.id));
  const button = await evaluate(initialSocket, `(() => {
    const element = document.getElementById('volume-basin-capture-smoke');
    if (!element || element.disabled || element.dataset.commandWired !== 'true') return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  assert.ok(button?.width > 0 && button?.height > 0, 'prototype basin smoke button was unavailable');
  const cockpitScreenshot = await initialSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const cockpitScreenshotBytes = Buffer.from(cockpitScreenshot.data, 'base64');
  assert.ok(cockpitScreenshotBytes.length > 1000, 'cockpit screenshot was blank or partial');
  writeFileSync(cockpitOut, cockpitScreenshotBytes);
  lastTrustworthyEvidence = {
    initialState,
    button,
    cockpitScreenshot: cockpitOut,
    cockpitScreenshotBytes: cockpitScreenshotBytes.length,
  };

  failurePhase = 'operator-command';
  const command = await initialSocket.call('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.__kaminosSaveVolumePrototypeBasinSmoke();
      return {
        result,
        statusText: document.getElementById('volume-agent-capture-state')?.textContent || null,
        domControls: {
          scene: document.getElementById('volume-scene')?.value || null,
          boundarySplatMode: document.getElementById('volume-boundary-splat-mode')?.value || null,
          resolution: document.getElementById('volume-resolution')?.value || null,
        },
      };
    })()`,
    returnByValue: true,
    userGesture: true,
    awaitPromise: true,
  });
  if (command.exceptionDetails) throw new Error(command.exceptionDetails.text || 'prototype basin smoke command threw');
  const commandEnvelope = command.result?.value;
  const commandResult = commandEnvelope?.result;
  lastTrustworthyEvidence.commandEnvelope = commandEnvelope;
  assert.ok(commandResult?.captureId, `prototype basin smoke command completed without a capture id: ${JSON.stringify(commandEnvelope)}`);
  assert.ok(commandResult.smokeUrl, `prototype basin smoke command completed without a durable smoke route: ${JSON.stringify(commandEnvelope)}`);

  const smokeTarget = await waitForTarget(target => (
    target.type === 'page'
    && !initialTargetIds.has(target.id)
    && target.url.includes('/volume-selective-head-live.html')
    && target.url.includes('basin_capture=')
  ), timeoutMs);
  const smokeSocket = await connect(smokeTarget);
  await smokeSocket.call('Page.enable');
  await smokeSocket.call('Runtime.enable');

  failurePhase = 'effective-wrapper-settle';
  const startState = await waitForValue(smokeSocket, `(() => {
    const state = window.__kaminosSelectiveHeadLive?.debugState?.();
    if (state?.status === 'failed') return state;
    if (state?.status !== 'running' || !state?.sourceCaptureId) return null;
    return state;
  })()`, timeoutMs);
  assert.equal(startState.status, 'running', startState.error || startState.fallbackReason || startState.compositionFallbackReason || 'effective wrapper failed');
  assert.equal(startState.requestedRole, 'truthHigh');
  assert.equal(startState.effectiveRole, 'truthHigh');
  assert.equal(startState.requestedComposition, 'splat-only-v0');
  assert.equal(startState.effectiveComposition, 'splat-only-v0');
  assert.equal(startState.warmupAuthority, 'fresh-live-settings-no-anchor-v0');
  assert.equal(startState.warmupReceipt?.importedAnchor, false);
  assert.equal(startState.selectiveHeadLivePassReceipt?.raymarchApplied, false);
  assert.equal(startState.selectiveHeadLivePassReceipt?.splatApplied, true);
  assert.equal(startState.selectiveHeadLivePassReceipt?.fallbackReason, null);
  assert.equal(startState.fallbackReason, null);
  assert.equal(startState.compositionFallbackReason, null);
  assert.equal(startState.boundarySplatFallbackReason, null);

  failurePhase = 'capture-artifact-verification';
  const captureResponse = await fetch(new URL(`/api/volume-capture?id=${encodeURIComponent(startState.sourceCaptureId)}`, url));
  const captureDocument = await captureResponse.json();
  assert.equal(captureResponse.ok, true, 'saved capture could not be read back');
  assert.equal(captureDocument.captureId, startState.sourceCaptureId, 'wrapper source id did not resolve to its saved artifact');
  assert.equal(captureDocument.capture?.sceneAuthority?.status, 'prototype');
  assert.equal(captureDocument.capture?.sceneAuthority?.effective, 'tall_plume');
  assert.equal(captureDocument.capture?.requestedSmoke?.composition, 'splat-only-v0');
  assert.equal(captureDocument.capture?.stateExclusions?.replayState, true);
  assert.equal(Object.hasOwn(captureDocument.capture, 'volumeDebugState'), false, 'capture persisted forbidden runtime debug state');
  assert.equal(Object.hasOwn(captureDocument.capture, 'camera'), false, 'capture persisted forbidden camera state');
  assert.equal(Object.hasOwn(captureDocument.capture, 'viewport'), false, 'capture persisted forbidden viewport state');
  assert.equal(captureDocument.smokeUrl, `/volume-basin-smoke.html?capture=${startState.sourceCaptureId}`);

  failurePhase = 'continuous-observation';
  await delay(5000);
  const endState = await evaluate(smokeSocket, 'window.__kaminosSelectiveHeadLive.debugState()');
  const continuousFrameDelta = Number(endState.frameCount) - Number(startState.frameCount);
  const continuousSimStepDelta = Number(endState.simStepCount) - Number(startState.simStepCount);
  assert.ok(continuousFrameDelta >= 2, 'render frames did not advance');
  assert.ok(continuousSimStepDelta >= 2, 'simulation steps did not advance');
  assert.equal(endState.sourceCaptureId, startState.sourceCaptureId, 'source capture identity drifted');
  assert.equal(endState.effectiveComposition, startState.effectiveComposition, 'renderer composition drifted');

  failurePhase = 'visual-output';
  const screenshot = await smokeSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'smoke screenshot was blank or partial');
  const pixelResult = await smokeSocket.call('Runtime.evaluate', {
    expression: `(async () => {
      const image = new Image();
      image.src = 'data:image/png;base64,${screenshot.data}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visibleColorPixelCount = 0;
      let peakLuma = 0;
      for (let y = 110; y < canvas.height; y += 2) {
        for (let x = 380; x < canvas.width; x += 2) {
          const offset = (y * canvas.width + x) * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          peakLuma = Math.max(peakLuma, luma);
          if (luma > 30 && Math.max(r, g, b) - Math.min(r, g, b) > 12) visibleColorPixelCount += 1;
        }
      }
      return { width: canvas.width, height: canvas.height, visibleColorPixelCount, peakLuma };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (pixelResult.exceptionDetails) throw new Error(pixelResult.exceptionDetails.text || 'smoke pixel inspection failed');
  const visualPixelEvidence = pixelResult.result?.value;
  assert.ok(visualPixelEvidence?.visibleColorPixelCount >= 100, `smoke viewport lacked visible colored renderer output: ${JSON.stringify(visualPixelEvidence)}`);
  assert.ok(visualPixelEvidence.peakLuma >= 60, `smoke viewport lacked visible renderer luminance: ${JSON.stringify(visualPixelEvidence)}`);
  writeFileSync(out, screenshotBytes);
  lastTrustworthyEvidence = { startState, endState, captureDocument, continuousFrameDelta, continuousSimStepDelta, visualPixelEvidence };
  writeReport({
    identity: 'kaminos-volume-basin-capture-smoke-witness-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveUrl: smokeTarget.url,
    sourceCaptureId: endState.sourceCaptureId,
    sceneAuthority: captureDocument.capture.sceneAuthority,
    requestedSmoke: captureDocument.capture.requestedSmoke,
    selectiveHeadLivePassReceipt: endState.selectiveHeadLivePassReceipt,
    continuousFrameDelta,
    continuousSimStepDelta,
    visualPixelEvidence,
    cockpitScreenshot: cockpitOut,
    cockpitScreenshotBytes: cockpitScreenshotBytes.length,
    screenshot: out,
    screenshotBytes: screenshotBytes.length,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, cockpitScreenshot: cockpitOut, screenshot: out, sourceCaptureId: endState.sourceCaptureId, continuousFrameDelta, continuousSimStepDelta }, null, 2));
} catch (error) {
  writeReport({
    identity: 'kaminos-volume-basin-capture-smoke-witness-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  browser?.kill('SIGTERM');
}

async function connect(target) {
  const socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  sockets.push(socket);
  return socket;
}

async function evaluate(socket, expression) {
  const result = await socket.call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'runtime evaluation failed');
  return result.result.value;
}

async function waitForValue(socket, expression, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = await evaluate(socket, expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error('timed out waiting for browser state');
}

async function targetList() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
}

async function waitForTarget(predicate, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const target = (await targetList()).find(predicate);
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for browser target');
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

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
