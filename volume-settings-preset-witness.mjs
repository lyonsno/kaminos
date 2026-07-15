#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const out = resolve(String(args.get('--out') || '/tmp/kaminos-volume-settings-preset.png'));
const cockpitOut = resolve(String(args.get('--cockpit-out') || out.replace(/(\.png)?$/, '-cockpit.png')));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-volume-settings-preset.json'));
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
      this.socket.addEventListener('error', () => reject(new Error(`CDP socket error: ${this.webSocketUrl}`)), { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
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
      this.socket.send(JSON.stringify({ id, method, params }));
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

  failurePhase = 'source-live-settle';
  const initialState = await waitForValue(initialSocket, `(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!state?.active || Number(state.frameCount) < 2) return null;
    return { frameCount: state.frameCount, simStepCount: state.simStepCount, volumeScene: state.volumeScene };
  })()`, timeoutMs);
  const button = await evaluate(initialSocket, `(() => {
    const element = document.getElementById('volume-settings-preset-save');
    if (!element || element.disabled || element.dataset.commandWired !== 'true') return null;
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: element.textContent };
  })()`);
  assert.ok(button?.width > 0 && button?.height > 0, 'settings preset button was unavailable');
  assert.equal(button.text.trim(), 'Save Settings Preset + Open Live');
  const cockpitScreenshot = await initialSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(cockpitOut, Buffer.from(cockpitScreenshot.data, 'base64'));
  lastTrustworthyEvidence = { initialState, button, cockpitScreenshot: cockpitOut };

  const initialTargetIds = new Set((await targetList()).map(target => target.id));
  failurePhase = 'operator-command';
  const command = await initialSocket.call('Runtime.evaluate', {
    expression: `(async () => window.__kaminosSaveVolumeSettingsPresetAndOpen())()`,
    returnByValue: true,
    userGesture: true,
    awaitPromise: true,
  });
  if (command.exceptionDetails) throw new Error(command.exceptionDetails.text || 'settings preset command threw');
  const commandResult = command.result?.value;
  const commandDiagnostic = await evaluate(initialSocket, `(() => ({
    captureState: document.getElementById('volume-agent-capture-state')?.textContent || null,
    info: document.getElementById('info')?.textContent || null,
  }))()`);
  lastTrustworthyEvidence.commandResult = commandResult ?? null;
  lastTrustworthyEvidence.commandDiagnostic = commandDiagnostic;
  assert.ok(commandResult?.captureId, 'settings preset command completed without an artifact id');
  assert.ok(commandResult.presetUrl, 'settings preset command completed without a durable live route');

  failurePhase = 'effective-live-target';
  const liveTarget = await waitForTarget(target => (
    target.type === 'page'
    && !initialTargetIds.has(target.id)
    && target.url.includes('settings_preset=')
  ), timeoutMs);
  const liveUrl = new URL(liveTarget.url);
  const sourcePresetId = liveUrl.searchParams.get('settings_preset');
  const sourcePresetAuthority = liveUrl.searchParams.get('settings_preset_authority');
  assert.equal(sourcePresetId, commandResult.captureId);
  assert.equal(sourcePresetAuthority, 'native-volume-settings-preset-v1');
  for (const forbidden of ['role', 'composition', 'warmup_steps', 'basin_capture', 'basin_source_authority']) {
    assert.equal(liveUrl.searchParams.has(forbidden), false, `live settings target invented renderer parameter ${forbidden}`);
  }

  const liveSocket = await connect(liveTarget);
  await liveSocket.call('Page.enable');
  await liveSocket.call('Runtime.enable');
  const startState = await waitForValue(liveSocket, `(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!state?.active || Number(state.frameCount) < 2) return null;
    return state;
  })()`, timeoutMs);

  failurePhase = 'preset-artifact-verification';
  const presetResponse = await fetch(new URL(`/api/volume-capture?id=${encodeURIComponent(sourcePresetId)}`, url));
  const presetDocument = await presetResponse.json();
  assert.equal(presetResponse.ok, true, 'saved settings preset could not be read back');
  assert.equal(presetDocument.captureId, sourcePresetId);
  assert.equal(presetDocument.capture?.identity, 'kaminos-volume-settings-preset-v1');
  assert.equal(presetDocument.capture?.kind, 'settings-preset');
  assert.equal(presetDocument.capture?.controlCount, 191);
  for (const field of ['fluidField', 'frontField', 'boundarySidecar', 'splatInstances', 'historyBuffers', 'pressureState', 'replayState', 'volumeDebugState', 'camera', 'viewport']) {
    assert.equal(Object.hasOwn(presetDocument.capture, field), false, `settings preset persisted forbidden state field ${field}`);
  }
  const savedRoute = new URL(presetDocument.capture.route);
  for (const [key, value] of savedRoute.searchParams) {
    assert.deepEqual(liveUrl.searchParams.getAll(key), [value], `effective live route changed saved setting ${key}`);
  }
  const savedVolumeKeys = [...savedRoute.searchParams].filter(([key]) => key.startsWith('volume_')).map(([key]) => key);
  const liveVolumeKeys = [...liveUrl.searchParams].filter(([key]) => key.startsWith('volume_')).map(([key]) => key);
  assert.deepEqual(liveVolumeKeys, savedVolumeKeys, 'effective live route added or omitted volume settings');

  failurePhase = 'continuous-observation';
  await delay(5000);
  const endState = await evaluate(liveSocket, 'window.__kaminosVolumePrototype.debugState()');
  const continuousFrameDelta = Number(endState.frameCount) - Number(startState.frameCount);
  const continuousSimStepDelta = Number(endState.simStepCount) - Number(startState.simStepCount);
  assert.ok(continuousFrameDelta >= 2, 'live render frames did not advance');
  assert.ok(continuousSimStepDelta >= 2, 'live simulation steps did not advance');

  failurePhase = 'ui-screenshot';
  const screenshot = await liveSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'live settings screenshot was missing or partial');
  writeFileSync(out, screenshotBytes);

  writeReport({
    identity: 'kaminos-volume-settings-preset-witness-v1',
    status: 'persisted-and-live',
    failurePhase: null,
    requestedUrl: url,
    effectiveUrl: liveTarget.url,
    sourcePresetId,
    sourcePresetAuthority,
    visualAuthority: 'not-evaluated-settings-persistence-only',
    controlCount: presetDocument.capture.controlCount,
    continuousFrameDelta,
    continuousSimStepDelta,
    cockpitScreenshot: cockpitOut,
    screenshot: out,
    screenshotBytes: screenshotBytes.length,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, sourcePresetId, continuousFrameDelta, continuousSimStepDelta }, null, 2));
} catch (error) {
  writeReport({
    identity: 'kaminos-volume-settings-preset-witness-v1',
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
