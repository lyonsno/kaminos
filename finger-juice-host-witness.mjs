#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8100/index.html?kaminos_finger_juice_host=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-finger-juice-host.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9492);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-finger-juice-host-profile-${port}-${process.pid}`;
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const settleMs = Number(args.get('--settle-ms') || 2500);
const hookWaitMs = Number(args.get('--hook-wait-ms') || Math.max(settleMs, 15000));

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastDebugState = null;
let canvasActivity = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.finger-juice-host-witness.v0',
    requestedUrl: url,
    debugPort: port,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
    hookWaitMs,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    consoleEvents,
    lastDebugState,
    canvasActivity,
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForTargetPage() {
  for (let i = 0; i < 80; i += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.url.includes('kaminos_finger_juice_host=1'))
      || pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error(`Chrome page for native host route did not appear: ${url}`);
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          method: msg.method,
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          method: msg.method,
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function collectRuntimeEvents(ws) {
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        method: msg.method,
        type: msg.params.type,
        text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        method: msg.method,
        type: 'exception',
        text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
      });
    }
  });
}

async function main() {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const page = await waitForTargetPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    collectRuntimeEvents(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    phase = 'navigate';
    await wsRequest(ws, 'Page.navigate', { url });

    phase = 'wait_debug_state';
    const hookDeadline = Date.now() + hookWaitMs;
    while (Date.now() < hookDeadline) {
      lastDebugState = await evaluate(ws, `(() => {
        const read = window.kaminosFingerJuiceHostDebugState || window.__kaminosFingerJuiceHostDebugState;
        if (typeof read === 'function') return read();
        return {
          diagnostic: 'missing_debug_hook',
          href: window.location.href,
          readyState: document.readyState,
          title: document.title,
          scriptCount: document.scripts.length,
          moduleScripts: Array.from(document.scripts).filter(script => script.type === 'module').length,
          bodyText: document.body ? document.body.innerText.slice(0, 240) : null
        };
      })()`);
      if (lastDebugState?.schema === 'kaminos.finger-juice-host.state.v0' && lastDebugState.status !== 'loading') break;
      await delay(250);
    }
    phase = 'read_debug_state';
    if (!lastDebugState) {
      throw new Error('missing kaminosFingerJuiceHostDebugState');
    }
    if (lastDebugState.diagnostic === 'missing_debug_hook') throw new Error('missing kaminosFingerJuiceHostDebugState');
    if (lastDebugState.schema !== 'kaminos.finger-juice-host.state.v0') throw new Error(`host state schema mismatch: ${lastDebugState.schema}`);
    if (lastDebugState.route !== 'kaminos/finger-juice-host') throw new Error(`host route mismatch: ${lastDebugState.route}`);
    if (lastDebugState.packetSchema !== 'big-papa-finger-juice.host-packet.v0') throw new Error(`packet schema mismatch: ${lastDebugState.packetSchema}`);
    if (lastDebugState.packetRoute !== 'big-papa/finger-juice/host-packet') throw new Error(`packet route mismatch: ${lastDebugState.packetRoute}`);
    if (!lastDebugState.downgrades?.includes('host_packet_preview_payload_not_native_render_buffer')) throw new Error('missing native render-buffer downgrade');
    if ((lastDebugState.previewParticleCount || 0) <= 0) throw new Error('no preview particles in native host state');

    phase = 'measure_canvas';
    canvasActivity = await evaluate(ws, `(() => {
      const canvas = document.getElementById('finger-juice-host-canvas');
      if (!canvas || !canvas.width || !canvas.height) return { ok: false, reason: 'missing_canvas' };
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const sample = ctx.getImageData(0, 0, width, height).data;
      let activePixels = 0;
      for (let i = 0; i < sample.length; i += 4) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max > 80 && max - min > 24) activePixels += 1;
      }
      return {
        ok: true,
        width,
        height,
        activePixels,
        activeRatio: Number((activePixels / Math.max(1, width * height)).toFixed(5)),
      };
    })()`);
    if (!canvasActivity?.ok) throw new Error(`canvas unavailable: ${canvasActivity?.reason || 'unknown'}`);
    if (canvasActivity.activePixels < 120) throw new Error(`native host canvas looks blank: ${JSON.stringify(canvasActivity)}`);

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
    phase = null;
    writeReport({
      ok: true,
      failure_phase: null,
      output: out,
    });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  writeReport({
    ok: false,
    error: error.message || String(error),
  });
  console.error(error);
  process.exitCode = 1;
});
