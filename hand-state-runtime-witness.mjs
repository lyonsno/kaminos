#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const requestedUrl = args.get('--url') || 'http://127.0.0.1:18142/index.html?kaminos_hand_state=1&hand_fixture=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-hand-state-runtime.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9517);
const width = Number(args.get('--viewport-width') || 1720);
const height = Number(args.get('--viewport-height') || 1080);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-hand-state-witness-${port}-${process.pid}`;
const consoleEvents = [];
let phase = 'initializing';
let effectiveUrl = null;
let debugState = null;
let emitterGrowthReceipt = null;
let inactiveEmitterRespawnReceipt = null;
let primaryOutputWritten = false;
let stderr = '';

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.hand-state-runtime-witness.v0',
    requestedUrl,
    effectiveUrl,
    fixtureMode: debugState?.fixtureMode ?? null,
    runtimeOwner: debugState?.runtimeOwner ?? null,
    primary_output_written: primaryOutputWritten,
    failure_phase: phase,
    viewport: { width, height },
    consoleEvents,
    debugState,
    emitterGrowthReceipt,
    inactiveEmitterRespawnReceipt,
    stderrTail: stderr.slice(-2000),
    ...extra,
  }, null, 2));
}

async function cdp(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await cdp('/json/version'); } catch { await delay(100); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await cdp('/json/list');
    const page = pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(100);
  }
  throw new Error('Chrome page target did not appear');
}

function openSocket(url) {
  const socket = new WebSocket(url);
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(socket), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed')), { once: true });
  });
}

function request(socket, method, params = {}) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => rejectRequest(new Error(`${method} timed out`)), 15000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({ type: message.params.type, text: message.params.args.map(arg => arg.value || arg.description || '').join(' ') });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({ type: 'exception', text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text });
      }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function evaluate(socket, expression) {
  const result = await request(socket, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function main() {
  const browser = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-webgpu',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect_cdp';
    await waitForCdp();
    const page = await waitForPage();
    const socket = await openSocket(page.webSocketDebuggerUrl);
    await request(socket, 'Runtime.enable');
    await request(socket, 'Page.enable');
    await request(socket, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    phase = 'navigate';
    await request(socket, 'Page.navigate', { url: requestedUrl });

    phase = 'wait_for_mesh';
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const receipt = await evaluate(socket, `(() => {
        const frame = document.getElementById('hand-state-runtime-frame');
        if (!frame?.contentWindow) return { diagnostic: 'iframe_missing' };
        const read = frame.contentWindow.__kaminosHandStateDebugState;
        return {
          effectiveUrl: frame.contentWindow.location.href,
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          panelHidden: document.getElementById('hand-state-runtime-panel')?.hidden,
          state: typeof read === 'function' ? read() : null,
        };
      })()`);
      effectiveUrl = receipt?.effectiveUrl || null;
      debugState = receipt?.state || null;
      if (receipt?.activeTab === 'hand-state' && receipt?.panelHidden === false && debugState?.meshVisible && debugState.vertexCount > 0 && debugState.faceCount > 0) break;
      await delay(250);
    }
    if (!debugState?.meshVisible) throw new Error('hand surface never became visible');
    if (!debugState.fixtureMode) throw new Error('visual witness must identify its fixture authority');
    if (debugState.runtimeOwner !== 'hand-state-runtime') throw new Error(`runtime owner mismatch: ${debugState.runtimeOwner}`);
    if ((debugState.vertexCount || 0) <= 0 || (debugState.faceCount || 0) <= 0) throw new Error('hand surface has no indexed geometry');

    phase = 'initialize_finger_fluid';
    const fluidReceipt = await evaluate(socket, `(async () => {
      const frame = document.getElementById('hand-state-runtime-frame');
      const initialize = frame?.contentWindow?.__kaminosHandStateInitFingerJuice;
      const probe = frame?.contentWindow?.__kaminosHandStateProbeFingerJuice;
      const fixturePacket = frame?.contentWindow?.__kaminosHandStateFixtureEmitterPacket;
      const read = frame?.contentWindow?.__kaminosHandStateDebugState;
      if (typeof initialize !== 'function' || typeof probe !== 'function' || typeof fixturePacket !== 'function' || typeof read !== 'function') throw new Error('finger-fluid witness API missing');
      await initialize();
      const { growth, respawn } = await probe(fixturePacket(), 12);
      return { state: read(), growth, respawn };
    })()`);
    debugState = fluidReceipt?.state || null;
    emitterGrowthReceipt = fluidReceipt?.growth || null;
    inactiveEmitterRespawnReceipt = fluidReceipt?.respawn || null;
    if (debugState?.fingerJuice?.solverBackend !== 'webgpu_compute') {
      throw new Error(`finger-fluid solver route mismatch: ${debugState?.fingerJuice?.solverBackend || 'missing'}`);
    }
    if (debugState?.fingerJuice?.renderBackend !== 'webgpu_direct_render') {
      throw new Error(`finger-fluid renderer route mismatch: ${debugState?.fingerJuice?.renderBackend || 'missing'}`);
    }
    if (emitterGrowthReceipt?.emitterCount !== 5) {
      throw new Error(`finger-fluid emitter growth count mismatch: ${emitterGrowthReceipt?.emitterCount ?? 'missing'}`);
    }
    if (!inactiveEmitterRespawnReceipt || inactiveEmitterRespawnReceipt.particleCount <= 0) {
      throw new Error(`finger-fluid inactive particle respawn failed: ${inactiveEmitterRespawnReceipt?.particleCount ?? 'missing'}`);
    }
    const emitterBuckets = Object.entries(inactiveEmitterRespawnReceipt.particlesPerEmitter || {}).filter(([, count]) => count > 0);
    if (emitterBuckets.length !== 5) {
      throw new Error(`finger-fluid particle allocation reached ${emitterBuckets.length}/5 emitters`);
    }
    if (debugState?.fingerJuice?.activeEmitterCount !== 5) {
      throw new Error('fixture witness must capture all five active emitters');
    }
    const fatalConsole = consoleEvents.filter(event => event.type === 'exception' || event.type === 'error');
    if (fatalConsole.length) throw new Error(`browser console emitted ${fatalConsole.length} fatal event(s)`);

    phase = 'capture';
    await delay(1000);
    const screenshot = await request(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
    phase = 'complete';
    writeReport({ status: 'passed', screenshot: out });
    socket.close();
    browser.kill('SIGTERM');
  } catch (error) {
    writeReport({ status: 'failed', error: `${error.name}: ${error.message}` });
    browser.kill('SIGTERM');
    throw error;
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
