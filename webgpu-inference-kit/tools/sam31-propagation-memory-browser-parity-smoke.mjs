#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.sam31-propagation-memory.browser-parity-smoke.v0';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const packageRoot = resolve(new URL('..', import.meta.url).pathname);
const packetDir = resolve(args.get('--packet-dir') || mkdtempSync(join(tmpdir(), 'kaminos-sam31-browser-packet-')));
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-sam31-propagation-memory-webgpu.json');
const screenshotPath = resolve(args.get('--screenshot') || '/tmp/kaminos-sam31-propagation-memory-webgpu.png');
const debugPort = Number(args.get('--debug-port') || 9561);
const serverPort = Number(args.get('--server-port') || 18561);
const hookWaitMs = Number(args.get('--hook-wait-ms') || 120000);
const cdpTimeoutMs = Number(args.get('--cdp-timeout-ms') || 120000);
const settleMs = Number(args.get('--settle-ms') || 300);
const headless = args.get('--headless') !== '0';
const reusePacket = args.get('--reuse-packet') === '1';
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const torchPython = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const packetTool = resolve(packageRoot, 'tools/sam31-propagation-memory-meta-packet.py');
const userDataDir = resolve(args.get('--user-data-dir') || mkdtempSync(join(tmpdir(), `kaminos-sam31-chrome-${process.pid}-`)));
const requestedUrl = `http://127.0.0.1:${serverPort}/smokes/sam31-propagation-memory-parity.html?manifest=/oracle/tensor-manifest.json`;

let phase = 'initializing';
let server = null;
let chromeProcess = null;
let browserVersion = null;
let lastState = null;
let stderr = '';
let screenshotWritten = false;
const consoleEvents = [];

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.png') return 'image/png';
  return 'application/octet-stream';
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    schema: REPORT_SCHEMA,
    ok: false,
    failure_phase: phase,
    requestedUrl,
    packetDir,
    packetSource: reusePacket ? 'caller-provided-existing' : 'generated',
    packetTool,
    reportPath,
    screenshot: screenshotWritten ? screenshotPath : null,
    primary_output_written: screenshotWritten,
    debugPort,
    serverPort,
    chrome,
    torchPython,
    userDataDir,
    browserVersion,
    stderrTail: stderr.slice(-4000),
    consoleEvents,
    lastState,
    requestedRouteIds: lastState?.requestedRouteIds || null,
    effectiveRouteIds: lastState?.effectiveRouteIds || null,
    adapterInfo: lastState?.adapterInfo || null,
    propagationReceipt: lastState?.propagationReceipt || null,
    memoryReceipt: lastState?.memoryReceipt || null,
    parity: lastState?.parity || null,
    reference: lastState?.manifest?.reference || null,
    checkpointAudit: lastState?.manifest?.checkpointAudit || null,
    ...extra,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
}

function terminalSummary(report) {
  return {
    schema: report.schema,
    ok: report.ok,
    failure_phase: report.failure_phase,
    error: report.error || null,
    reportPath: report.reportPath,
    screenshot: report.screenshot,
    primary_output_written: report.primary_output_written,
    browser: report.browserVersion?.Browser || null,
    adapterInfo: report.adapterInfo,
    requestedRouteIds: report.requestedRouteIds,
    effectiveRouteIds: report.effectiveRouteIds,
    parity: report.parity,
    uncapturedErrors: report.lastState?.uncapturedErrors || [],
  };
}

function generatePacket() {
  if (reusePacket) {
    if (!existsSync(join(packetDir, 'tensor-manifest.json'))) throw new Error(`reused packet manifest missing: ${packetDir}`);
    return;
  }
  mkdirSync(packetDir, { recursive: true });
  const command = [packetTool, '--out-dir', packetDir];
  if (process.env.KAMINOS_SAM31_CHECKPOINT) command.push('--checkpoint', process.env.KAMINOS_SAM31_CHECKPOINT);
  if (process.env.KAMINOS_SAM31_CONVERTED_WEIGHTS) command.push('--converted-weights', process.env.KAMINOS_SAM31_CONVERTED_WEIGHTS);
  if (process.env.KAMINOS_SAM31_SOURCE_ROOT) command.push('--source-root', process.env.KAMINOS_SAM31_SOURCE_ROOT);
  const result = spawnSync(torchPython, command, { cwd: packageRoot, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`official packet generation failed: ${result.stderr || result.stdout}`);
}

function startServer() {
  server = createServer((request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${serverPort}`);
      const isPacket = url.pathname.startsWith('/oracle/');
      const root = isPacket ? packetDir : packageRoot;
      const relative = isPacket ? url.pathname.slice('/oracle/'.length) : url.pathname.slice(1);
      const filePath = resolve(root, relative || 'smokes/sam31-propagation-memory-parity.html');
      if (filePath !== root && !filePath.startsWith(`${root}/`)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      if (!existsSync(filePath)) {
        response.writeHead(404);
        response.end(`missing ${url.pathname}`);
        return;
      }
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      response.end(readFileSync(filePath));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error?.stack || error));
    }
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(serverPort, '127.0.0.1', resolveListen);
  });
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function waitForWebSocketOpen(webSocket) {
  return new Promise((resolveOpen, rejectOpen) => {
    webSocket.addEventListener('open', resolveOpen, { once: true });
    webSocket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(webSocket, method, params = {}, timeoutMs = cdpTimeoutMs) {
  const id = webSocket._nextId = (webSocket._nextId || 0) + 1;
  webSocket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      webSocket.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({ type: message.params.type, text: (message.params.args || []).map(arg => arg.value || arg.description || '').join(' ') });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({ type: 'exception', text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception' });
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      webSocket.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    webSocket.addEventListener('message', onMessage);
  });
}

async function evaluate(webSocket, expression, timeoutMs = cdpTimeoutMs) {
  const result = await wsRequest(webSocket, 'Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result.value;
}

async function main() {
  let webSocket = null;
  try {
    phase = 'generate_official_packet';
    generatePacket();
    phase = 'start_server';
    await startServer();
    phase = 'launch_chrome';
    const chromeArgs = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
      '--window-size=1000,520',
    ];
    if (headless) chromeArgs.push('--headless=new');
    chromeArgs.push(requestedUrl);
    chromeProcess = spawn(chrome, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const spawnError = new Promise((_, rejectSpawn) => chromeProcess.once('error', rejectSpawn));
    chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
    browserVersion = await Promise.race([waitForCdp(), spawnError]);
    phase = 'connect_cdp';
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url.includes('sam31-propagation-memory-parity.html')) || pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target missing debugger URL');
    webSocket = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(webSocket);
    await wsRequest(webSocket, 'Runtime.enable');
    await wsRequest(webSocket, 'Page.enable');
    phase = 'wait_browser_parity';
    const deadline = Date.now() + hookWaitMs;
    while (Date.now() < deadline) {
      lastState = await evaluate(webSocket, `(() => {
        const read = window.sam31PropagationMemoryParitySmokeState;
        return typeof read === 'function' ? read() : null;
      })()`, Math.min(cdpTimeoutMs, Math.max(1, deadline - Date.now())));
      if (lastState?.status === 'passed' || lastState?.status === 'failed') break;
      await delay(250);
    }
    if (!lastState) throw new Error('browser parity state is missing');
    if (lastState.status !== 'passed') throw new Error(lastState.error || `browser parity ended in ${lastState.status}`);
    phase = 'capture_screenshot';
    await delay(settleMs);
    const screenshot = await wsRequest(webSocket, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    screenshotWritten = true;
    phase = 'write_report';
    const report = writeReport({ ok: true, failure_phase: null });
    process.stdout.write(`${JSON.stringify(terminalSummary(report), null, 2)}\n`);
  } catch (error) {
    const report = writeReport({ ok: false, failure_phase: phase, error: String(error?.stack || error?.message || error) });
    process.stderr.write(`${JSON.stringify(terminalSummary(report), null, 2)}\n`);
    throw error;
  } finally {
    try { webSocket?.close(); } catch {}
    if (chromeProcess) chromeProcess.kill('SIGTERM');
    if (server) server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
