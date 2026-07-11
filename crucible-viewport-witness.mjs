#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const part = process.argv[i];
  if (!part.startsWith('--')) continue;
  const key = part.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const usage = 'crucible-viewport-witness.mjs --url <kaminos-url> --out <screenshot.png> --report <report.json> [--cdp-port <port>]';
if (args.has('help')) {
  console.log(usage);
  process.exit(0);
}

const url = args.get('url') || 'http://127.0.0.1:8095/';
const out = args.get('out') || '/tmp/kaminos-crucible-viewport-witness.png';
const reportPath = args.get('report') || '/tmp/kaminos-crucible-viewport-witness.json';
const chrome = args.get('chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = Number(args.get('cdp-port') || 9341);
const userDataDir = mkdtempSync(path.join(tmpdir(), 'kaminos-crucible-viewport-'));
const startedAt = new Date().toISOString();
const openGenerateTabExpression = 'document.querySelector(\'[data-tab="generate"]\').click()';

let phase = 'starting';
let browser = null;
let primaryOutputWritten = false;
let stderr = '';
const runtimeExceptions = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(payload) {
  ensureParent(reportPath);
  writeFileSync(reportPath, JSON.stringify({
    schema: 'crucible-viewport-witness.v0',
    url,
    screenshot: primaryOutputWritten ? out : null,
    reportPath,
    primaryOutputWritten,
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

async function cdp(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP ${pathname} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      await cdp('/json/version');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let seq = 0;
function wsRequest(ws, method, params = {}, timeoutMs = 20000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result || {});
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluation failed during ${phase}: ${result.exceptionDetails.text || 'exception'}`);
  }
  return result.result?.value;
}

try {
  phase = 'launching-chrome';
  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--window-size=1600,1100',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  phase = 'opening-cdp';
  await waitForCdp();
  const targets = await cdp('/json/list');
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('no CDP page target found');
  const ws = await connectWebSocket(page.webSocketDebuggerUrl);

  phase = 'arming-runtime';
  await wsRequest(ws, 'Runtime.enable');
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.text || 'Runtime.exceptionThrown');
    }
  });
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });

  phase = 'loading-page';
  await wsRequest(ws, 'Page.navigate', { url }, 20000);
  await sleep(Number(args.get('settle-ms') || 2500));

  phase = 'opening-generate-tab';
  await evaluate(ws, openGenerateTabExpression);
  await sleep(900);

  phase = 'reading-workroom-state';
  const state = await evaluate(ws, `(() => {
    const workspace = document.getElementById('crucible-viewport-workspace');
    const stage = document.getElementById('crucible-worktable-stage');
    const sourceThumb = document.getElementById('crucible-viewport-source-thumb');
    const stageRect = stage?.getBoundingClientRect();
    return {
      requestedSelectors: {
        workspace: { id: 'crucible-viewport-workspace', data: 'data-crucible-workroom' },
        heat: { attribute: 'data-crucible-heat-state' },
        stage: { id: 'crucible-worktable-stage' },
      },
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      workspaceHidden: Boolean(workspace?.hidden),
      workroom: workspace?.dataset.crucibleWorkroom || null,
      heatState: workspace?.dataset.crucibleHeatState || null,
      stageRect: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
      sourceThumbHidden: Boolean(sourceThumb?.hidden),
      title: document.getElementById('crucible-viewport-title')?.textContent || null,
      source: document.getElementById('crucible-viewport-source')?.textContent || null,
      firing: document.getElementById('crucible-viewport-firing')?.textContent || null,
      cast: document.getElementById('crucible-viewport-cast')?.textContent || null,
      receipt: document.getElementById('crucible-viewport-receipt')?.textContent || null,
    };
  })()`);
  if (state.activeTab !== 'generate') throw new Error(`Generate tab did not activate: ${state.activeTab}`);
  if (state.workspaceHidden) throw new Error('Crucible viewport workspace is hidden');
  if (state.workroom !== 'active') throw new Error(`Crucible workroom identity missing: ${state.workroom}`);
  if (!state.stageRect || state.stageRect.width < 300 || state.stageRect.height < 220) {
    throw new Error(`Crucible worktable stage is not visibly mounted: ${JSON.stringify(state.stageRect)}`);
  }
  if (runtimeExceptions.length) throw new Error(`browser runtime exceptions: ${runtimeExceptions.join('; ')}`);

  phase = 'capturing-screenshot';
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(screenshot.data, 'base64');
  if (png.length < 4096) throw new Error('screenshot is too small to be credible evidence');
  ensureParent(out);
  writeFileSync(out, png);
  primaryOutputWritten = true;

  phase = 'writing-report';
  writeReport({
    ok: true,
    state,
    bytes: png.length,
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  });
  console.log(JSON.stringify({ ok: true, out, report: reportPath, state }, null, 2));
  ws.close();
  browser.kill('SIGTERM');
} catch (error) {
  writeReport({
    ok: false,
    error: error.message || String(error),
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  });
  if (browser) browser.kill('SIGTERM');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
