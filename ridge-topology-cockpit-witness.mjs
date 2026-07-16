#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    parsed.set(key, value);
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const requestedUrl = String(args.get('--url') || 'http://127.0.0.1:18225/ridge-topology-cockpit.html');
const outputDir = resolve(String(args.get('--out-dir') || '/tmp/ridge-topology-cockpit-witness'));
const reportPath = resolve(String(args.get('--report') || join(outputDir, 'report.json')));
const debugPort = Number(args.get('--debug-port') || 49233);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = String(args.get('--browser-profile') || mkdtempSync('/tmp/kaminos-ridge-topology-cockpit-'));
const desktop = { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false };
const mobile = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const operationTimeoutMs = 180_000;
const consoleEvents = [];
const captures = [];
let failurePhase = 'initialization';
let browserVersion = null;
let lastTrustworthyEvidence = null;
let primaryOutputWritten = false;
let chromeProcess = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeReport(extra = {}) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.ridge-topology-cockpit-witness.v0',
    status: extra.ok ? 'completed' : 'failed',
    requestedUrl,
    effectiveRoute: 'ridge-topology-cockpit.html',
    effectiveWrapperRoute: lastTrustworthyEvidence?.wrapper?.routeIdentity || null,
    effectiveRendererRoute: lastTrustworthyEvidence?.renderer?.effectiveRoute || null,
    effectiveBackend: lastTrustworthyEvidence?.wrapper?.backend || null,
    fallbackReason: lastTrustworthyEvidence?.wrapper?.fallbackReason || lastTrustworthyEvidence?.renderer?.boundarySplatFallbackReason || null,
    chrome,
    browserVersion,
    browserProfile: profile,
    debugPort,
    operationTimeoutMs,
    failurePhase: extra.ok ? null : failurePhase,
    primaryOutputWritten,
    outputCompleteness: {
      expected: ['splats-baseline.png', 'target.png', 'splats-cooled.png', 'mobile-cooled.png'],
      captured: captures.map(capture => capture.name),
      complete: captures.length === 4,
    },
    captures,
    consoleEvents,
    lastTrustworthyEvidence,
    ...extra,
  }, null, 2));
}

async function cdpJson(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      return await cdpJson('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForPage() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const pages = await cdpJson('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error('Chrome page target did not appear');
}

function openSocket(url) {
  const socket = new WebSocket(url);
  socket.nextId = 0;
  socket.pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: (message.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
      });
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception',
      });
    }
    if (!message.id || !socket.pending.has(message.id)) return;
    const pending = socket.pending.get(message.id);
    socket.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result);
  });
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(socket), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('Chrome DevTools WebSocket failed to open')), { once: true });
  });
}

function request(socket, method, params = {}) {
  const id = ++socket.nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      socket.pending.delete(id);
      rejectRequest(new Error(`${method}: operation exceeded ${operationTimeoutMs}ms`));
    }, operationTimeoutMs);
    socket.pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer });
  });
}

async function evaluate(socket, expression) {
  const response = await request(socket, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result.value;
}

const stateExpression = `(() => {
  const cockpit = window.__kaminosRidgeTopologyCockpit;
  if (!cockpit?.debugState) return { status: 'missing', href: location.href, readyState: document.readyState };
  const state = cockpit.debugState();
  return {
    status: state.status,
    error: state.error,
    activeMode: state.activeMode,
    requestedControls: state.requestedControls,
    admissionReceipt: state.admissionReceipt,
    controlsReceipt: state.controlsReceipt,
    wrapper: state.wrapper ? {
      routeIdentity: state.wrapper.routeIdentity,
      status: state.wrapper.status,
      backend: state.wrapper.backend,
      warmupAuthority: state.wrapper.warmupAuthority,
      warmupTarget: state.wrapper.warmupTarget,
      warmupReceipt: state.wrapper.warmupReceipt,
      frameCount: state.wrapper.frameCount,
      simStepCount: state.wrapper.simStepCount,
      effectiveComposition: state.wrapper.effectiveComposition,
      fallbackReason: state.wrapper.fallbackReason,
      boundarySplatFallbackReason: state.wrapper.boundarySplatFallbackReason,
      boundarySplatCandidateCount: state.wrapper.boundarySplatCandidateCount,
      boundarySplatInstanceCount: state.wrapper.boundarySplatInstanceCount,
      boundarySplatOverflowCount: state.wrapper.boundarySplatOverflowCount,
    } : null,
    renderer: state.renderer ? {
      effectiveRoute: state.renderer.effectiveRoute,
      simGrid: state.renderer.simGrid,
      frameCount: state.renderer.frameCount,
      simStepCount: state.renderer.simStepCount,
      boundarySplatMode: state.renderer.boundarySplatMode,
      boundarySplatCandidateCount: state.renderer.boundarySplatCandidateCount,
      boundarySplatInstanceCount: state.renderer.boundarySplatInstanceCount,
      boundarySplatOverflowCount: state.renderer.boundarySplatOverflowCount,
      boundarySplatFallbackReason: state.renderer.boundarySplatFallbackReason,
    } : null,
  };
})()`;

async function waitForCockpit(socket, predicate, label) {
  const deadline = Date.now() + operationTimeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(socket, stateExpression);
    lastTrustworthyEvidence = state;
    if (state.status === 'failed') throw new Error(`cockpit failed while waiting for ${label}: ${state.error || 'unknown browser-side error'}`);
    if (predicate(state)) return state;
    await delay(150);
  }
  throw new Error(`cockpit did not settle for ${label}`);
}

async function setModeAndControls(socket, mode, controls = {}) {
  await evaluate(socket, `(async () => {
    const cockpit = window.__kaminosRidgeTopologyCockpit;
    cockpit.setMode(${JSON.stringify(mode)});
    cockpit.setControls(${JSON.stringify(controls)});
    await cockpit.present();
    await cockpit.whenRenderIdle();
    return true;
  })()`);
  const requestedKeys = {
    topology: 'reactionBoundaryTopology',
    radiance: 'boundarySplatRadianceGain',
    opacity: 'boundarySplatOpacityGain',
    radius: 'boundarySplatRadius',
    sharpness: 'boundarySplatSharpness',
  };
  const state = await waitForCockpit(socket, candidate => {
    if (candidate.status !== 'running' || candidate.activeMode !== mode || !candidate.controlsReceipt?.ok) return false;
    return Object.entries(controls).every(([key, value]) => Math.abs(Number(candidate.requestedControls?.[requestedKeys[key]]) - Number(value)) <= 1e-6);
  }, `${mode} controls`);
  assert.equal(state.wrapper?.simStepCount, 96, `${mode} changed the frozen simulation step`);
  assert.equal(state.renderer?.simStepCount, 96, `${mode} changed the renderer simulation step`);
  assert.equal(state.wrapper?.fallbackReason, null, `${mode} activated wrapper fallback`);
  assert.equal(state.renderer?.boundarySplatFallbackReason, null, `${mode} activated splat fallback`);
  return state;
}

async function capture(socket, name, viewport) {
  const screenshot = await request(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(bytes.length > 10_000, `${name} screenshot is blank or partial`);
  const path = join(outputDir, name);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path, bytes);
  primaryOutputWritten = true;
  captures.push({ name, path, bytes: bytes.length, sha256: sha256(bytes), viewport });
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  chromeProcess = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--window-size=${desktop.width},${desktop.height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  let socket = null;
  try {
    failurePhase = 'browser-launch';
    browserVersion = await waitForCdp();
    const page = await waitForPage();
    socket = await openSocket(page.webSocketDebuggerUrl);
    await request(socket, 'Runtime.enable');
    await request(socket, 'Page.enable');
    await request(socket, 'Log.enable');
    await request(socket, 'Emulation.setDeviceMetricsOverride', desktop);
    failurePhase = 'route-admission';
    await request(socket, 'Page.navigate', { url: requestedUrl });
    let state = await waitForCockpit(socket, candidate => candidate.status === 'running' && candidate.admissionReceipt?.ok === true, 'checksum admission');
    assert.equal(state.admissionReceipt.authority, 'checksum-bound-ridge-topology-cockpit-admission-v0');
    assert.ok(String(state.wrapper?.backend || '').startsWith('WebGPU'), 'effective backend is not WebGPU');
    assert.equal(state.wrapper?.routeIdentity, 'exact-basin-selective-head-live-v0');
    assert.equal(state.renderer?.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
    assert.ok(state.renderer?.boundarySplatCandidateCount > 0, 'candidate rows are missing');
    assert.equal(state.renderer?.boundarySplatCandidateCount, state.renderer?.boundarySplatInstanceCount, 'candidate rows are partial');
    assert.equal(state.renderer?.boundarySplatOverflowCount, 0, 'candidate rows overflowed');

    failurePhase = 'desktop-baseline';
    state = await setModeAndControls(socket, 'splats', { topology: 0.96, radiance: 1, opacity: 1, radius: 0.98, sharpness: 12 });
    await capture(socket, 'splats-baseline.png', desktop);

    failurePhase = 'desktop-target';
    state = await setModeAndControls(socket, 'target', { topology: 0.96 });
    await capture(socket, 'target.png', desktop);

    failurePhase = 'desktop-cooled';
    state = await setModeAndControls(socket, 'splats', { topology: 0.96, radiance: 0.55, opacity: 0.75, radius: 0.98, sharpness: 12 });
    await capture(socket, 'splats-cooled.png', desktop);

    failurePhase = 'mobile-cooled';
    await request(socket, 'Emulation.setDeviceMetricsOverride', mobile);
    await delay(300);
    state = await setModeAndControls(socket, 'splats', { topology: 0.96, radiance: 0.55, opacity: 0.75, radius: 0.98, sharpness: 12 });
    await capture(socket, 'mobile-cooled.png', mobile);

    assert.equal(new Set(captures.map(row => row.sha256)).size, captures.length, 'captured modes collapsed to cached/static output');
    failurePhase = null;
    writeReport({
      ok: true,
      failurePhase: null,
      stderrTail: stderr.slice(-3000),
      finalState: state,
      admissionReceipt: state.admissionReceipt,
    });
    socket.close();
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    chromeProcess?.kill('SIGTERM');
  }
}

main().catch(error => {
  writeReport({ ok: false, error: error?.stack || error?.message || String(error) });
  console.error(error);
  process.exitCode = 1;
});
