#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = resolve(new URL('..', import.meta.url).pathname);
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-trellis-dinov3-patch-embed-webgpu.json');
const debugPort = Number(args.get('--debug-port') || 9576);
const serverPort = Number(args.get('--server-port') || 18576);
const timeoutMs = Number(args.get('--timeout-ms') || 60000);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const invocationId = randomUUID();
let userDataDir = null;
const requestedUrl = `http://127.0.0.1:${serverPort}/smokes/trellis-dinov3-patch-embed-browser.html?smokeId=${invocationId}`;
const reportSchema = 'kaminos.trellis-dinov3-patch-embed.browser-smoke.v0';
let phase = 'initializing';
let server;
let chromeProcess;
let browserVersion;
let browserState;
let stderr = '';

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
function writeReport(extra = {}) {
  const hasObservedExecution = browserState?.status === 'passed' && Boolean(browserState?.receipt);
  const witnessClaim = hasObservedExecution
    ? 'observed: WebGPU API execution on the reported adapter; hardware classification is separate'
    : 'intended only; no successful route execution observed';
  const report = {
    schema: reportSchema,
    ok: false,
    failure_phase: phase,
    requestedUrl,
    reportPath,
    invocationId,
    chrome,
    userDataDir,
    chromeProcessPid: chromeProcess?.pid || null,
    browserVersion,
    requestedRouteId: browserState?.requestedRouteId || 'trellis2.dinov3.patch-embed.phase-program.webgpu-local.v0',
    effectiveRouteId: browserState?.effectiveRouteId || null,
    browser: browserState?.browser || null,
    adapterInfo: browserState?.adapterInfo || null,
    adapterName: browserState?.adapterName || null,
    adapterClassification: browserState?.adapterClassification || 'unreported',
    witnessClaim,
    effectiveBackend: browserState?.receipt?.backend || null,
    device: browserState?.device || null,
    requestedFeatures: browserState?.requestedFeatures || [],
    fixture: browserState?.fixture || null,
    inputHashes: browserState?.inputHashes || null,
    expectedOutput: browserState?.expectedOutput || null,
    actualOutput: browserState?.actualOutput || null,
    expectedTokenEnergy: browserState?.expectedTokenEnergy || null,
    actualTokenEnergy: browserState?.actualTokenEnergy || null,
    consumerEvidence: browserState?.consumerEvidence || null,
    receipt: browserState?.receipt || null,
    browserState: browserState || null,
    stderrTail: stderr.slice(-4000),
    ...extra,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
}
function contentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}
function startServer() {
  server = createServer((request, response) => {
    try {
      const url = new URL(request.url, requestedUrl);
      const path = resolve(root, url.pathname.slice(1));
      if (path !== root && !path.startsWith(`${root}/`)) { response.writeHead(403); response.end('forbidden'); return; }
      let body;
      if (url.pathname === '/__smoke_state') {
        body = Buffer.from(JSON.stringify(browserState || null));
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      body = readFileSync(path);
      response.writeHead(200, {
        'content-type': contentType(path),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      response.end(body);
    } catch (error) { response.writeHead(404); response.end(String(error)); }
  });
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(serverPort, '127.0.0.1', resolveListen);
  });
}
async function cdp(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with HTTP ${response.status}`);
  return response.json();
}
async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await cdp('/json/version'); } catch { await delay(125); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}
function wsRequest(ws, method, params = {}) {
  const id = ws._requestId = (ws._requestId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    const listener = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', listener);
      if (message.error) reject(new Error(message.error.message)); else resolveRequest(message.result);
    };
    ws.addEventListener('message', listener);
  });
}
async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitForState(ws, expectedInvocationId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(ws, 'window.trellisPatchEmbedSmoke || null');
    if (state && state.invocationId !== expectedInvocationId) {
      throw new Error(`browser invocation identity mismatch: expected ${expectedInvocationId}, received ${state.invocationId || 'missing'}`);
    }
    if (state?.status === 'passed' || state?.status === 'failed') return state;
    await delay(100);
  }
  throw new Error(`browser smoke did not reach terminal state within ${timeoutMs}ms`);
}

let ws;
let exitCode = 1;
try {
  phase = 'start_server';
  await startServer();
  phase = 'create_browser_profile';
  userDataDir = mkdtempSync(`${tmpdir()}/kaminos-trellis-patch-embed-chrome-`);
  phase = 'launch_browser';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
    '--headless=new', requestedUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLaunchError = null;
  chromeProcess.once('error', error => { chromeLaunchError = error; });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  browserVersion = await waitForCdp();
  if (chromeLaunchError) throw new Error(`Chrome launch failed: ${chromeLaunchError.message}`);
  phase = 'browser_webgpu_route';
  const targets = await cdp('/json/list');
  const page = targets.find(target => target.type === 'page' && target.url === requestedUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error(`Chrome page target missing for ${requestedUrl}`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('Chrome DevTools WebSocket failed')), { once: true });
  });
  await wsRequest(ws, 'Runtime.enable');
  browserState = await waitForState(ws, invocationId);
  const report = writeReport({ ok: browserState.status === 'passed', failure_phase: browserState.status === 'passed' ? null : phase, error: browserState.error || null });
  console.log(JSON.stringify({ ok: report.ok, reportPath, requestedRouteId: report.requestedRouteId, effectiveRouteId: report.effectiveRouteId, browser: browserVersion?.Browser || null, adapterInfo: report.adapterInfo, adapterName: report.adapterName, effectiveBackend: report.effectiveBackend, consumerEvidence: report.consumerEvidence, error: report.browserState?.error || null }, null, 2));
  if (!report.ok) throw new Error(report.browserState?.error || 'browser smoke failed its assertions');
  exitCode = 0;
} catch (error) {
  const report = writeReport({ error: String(error?.stack || error) });
  console.error(JSON.stringify({ ok: false, failure_phase: phase, reportPath, error: String(error?.message || error) }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { chromeProcess?.kill(); } catch {}
  try { await new Promise(resolveClose => server?.close(resolveClose)); } catch {}
}
process.exitCode = exitCode;
