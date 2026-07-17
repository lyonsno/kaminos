#!/usr/bin/env node

import { createHash, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  validateAdaptiveVolumeGpuReport,
  validateAdaptiveVolumeScaleLawReport,
} from './smoke-adaptive-volume-gpu-falsifier.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  const value = next && !next.startsWith('--') ? next : true;
  args.set(key, value);
  if (value !== true) index += 1;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

const root = new URL('.', import.meta.url).pathname;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-adaptive-volume-gpu-falsifier'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/witness-report.json`));
const browserReportPath = resolve(String(args.get('--browser-report') || `${outDir}/browser-report.json`));
const screenshotPath = resolve(String(args.get('--screenshot') || `${outDir}/context.png`));
const serverPort = positiveInteger(args.get('--server-port') || randomInt(20000, 32000), '--server-port');
const debugPort = positiveInteger(args.get('--debug-port') || randomInt(42000, 62000), '--debug-port');
const chrome = String(args.get('--chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const userDataDir = resolve(String(args.get('--user-data-dir') || `/tmp/kaminos-adaptive-volume-gpu-profile-${debugPort}-${process.pid}`));
const windowSize = String(args.get('--window-size') || '1600,1100');
function gitValue(gitArgs, fallback = '') {
  try { return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return fallback; }
}
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short']);
const requestedUrlObject = new URL(String(args.get('--url') || `http://127.0.0.1:${serverPort}/smoke-adaptive-volume-gpu-falsifier.html`));
requestedUrlObject.searchParams.set('git_commit', gitCommit);
requestedUrlObject.searchParams.set('git_branch', gitBranch);
requestedUrlObject.searchParams.set('git_status_short', gitStatusShort);
const requestedUrl = requestedUrlObject.toString();
const runTimeoutMs = Number(args.get('--run-timeout-ms') || 0);
const reuseBrowser = true;

let failurePhase = 'initialization';
let primaryOutputWritten = false;
let browserReportWritten = false;
let screenshotWritten = false;
let browserReport = null;
let serverProcess = null;
let chromeProcess = null;
let consoleEvents = [];
let cdpGpuIdentity = null;

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

function sha256(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }

function normalizeCdpGpuIdentity(systemInfo) {
  const devices = (systemInfo?.gpu?.devices || []).map(device => ({
    vendorId: device.vendorId ?? null,
    deviceId: device.deviceId ?? null,
    vendorString: device.vendorString || '',
    deviceString: device.deviceString || '',
    driverVendor: device.driverVendor || '',
    driverVersion: device.driverVersion || '',
  }));
  const appleDeviceObserved = devices.some(device => /apple/i.test(JSON.stringify(device)));
  return { source: 'cdp-system-info', appleDeviceObserved, devices };
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    schema: 'kaminos.smoke-adaptive-volume-gpu-witness.v0',
    status: primaryOutputWritten ? 'completed' : 'failed-before-primary-output',
    createdAt: new Date().toISOString(),
    requestedRoute: requestedUrl,
    effectiveRoute: browserReport?.effective?.route || null,
    backend: browserReport?.effective?.backend || null,
    timestampStatus: browserReport?.effective?.timestampStatus || null,
    failurePhase,
    primaryOutputWritten,
    reportPath,
    browserReportWritten,
    browserReportPath: browserReportWritten ? browserReportPath : null,
    browserReportSha256: browserReportWritten ? sha256(readFileSync(browserReportPath)) : null,
    screenshotWritten,
    screenshotPath: screenshotWritten ? screenshotPath : null,
    screenshotSha256: screenshotWritten ? sha256(readFileSync(screenshotPath)) : null,
    serverPort,
    debugPort,
    chrome,
    userDataDir,
    windowSize,
    reuseBrowser,
    browserCount: chromeProcess ? 1 : 0,
    runTimeoutMs: runTimeoutMs > 0 ? runTimeoutMs : null,
    gitCommit,
    gitBranch,
    gitStatusShort,
    sourceFileSha256s: browserReport?.runtime?.sourceFileSha256s || null,
    cdpGpuIdentity,
    consoleEvents,
    optimizationClaimAllowed: browserReport?.optimizationClaimAllowed === true,
    scaleLawEvidenceAllowed: browserReport?.scaleLawEvidenceAllowed === true,
    browserReport: browserReportWritten ? browserReport : null,
    ...extra,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function fetchJson(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForEndpoint(url, label, attempts = 160) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(125);
  }
  throw new Error(`${label} did not become reachable: ${lastError?.message || 'unknown'}`);
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function wsRequest(socket, method, params = {}, timeoutMs = 0) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    }
    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectRequest(error);
    }
    function onClose() { rejectOnce(new Error(`${method}: CDP target closed before response`)); }
    function onError() { rejectOnce(new Error(`${method}: CDP target socket failed before response`)); }
    timer = timeoutMs > 0 ? setTimeout(() => {
      rejectOnce(new Error(`${method}: CDP request timed out`));
    }, timeoutMs) : null;
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          type: message.params.type,
          text: (message.params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '),
        });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          type: 'exception',
          text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (message.id !== id) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, { once: true });
    socket.addEventListener('error', onError, { once: true });
  });
}

async function evaluate(socket, expression) {
  const result = await wsRequest(socket, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result.value;
}

async function waitForBrowserReport(socket) {
  const started = Date.now();
  for (;;) {
    const current = await evaluate(socket, 'window.__kaminosAdaptiveVolumeGpuFalsifier?.state?.() || null');
    if (current?.phase === 'complete') return current.report;
    if (current?.phase === 'failed') throw new Error(current.error || 'browser falsifier failed');
    if (runTimeoutMs > 0 && Date.now() - started > runTimeoutMs) throw new Error(`browser falsifier exceeded requested run timeout ${runTimeoutMs}ms`);
    await delay(250);
  }
}

async function closeProcess(process, label) {
  if (!process || process.exitCode != null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise(resolveExit => process.once('exit', resolveExit)),
    delay(2000),
  ]);
  if (process.exitCode == null) process.kill('SIGKILL');
  consoleEvents.push({ type: 'cleanup', text: `${label} closed` });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeReport({ status: 'running' });
  if (!existsSync(chrome)) throw new Error(`Chrome executable is missing: ${chrome}`);

  try {
    failurePhase = 'server-launch';
    const routeResponse = await fetch(requestedUrl, { cache: 'no-store' }).catch(() => null);
    if (routeResponse?.ok) {
      const text = await routeResponse.text();
      if (!text.includes('<title>Adaptive Smoke Volume GPU Falsifier</title>')) throw new Error('requested server port is occupied by the wrong route');
    } else {
      serverProcess = spawn('python3', ['serve.py', String(serverPort)], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
      let serverStderr = '';
      serverProcess.stderr.on('data', chunk => { serverStderr += String(chunk); });
      serverProcess.once('error', error => { consoleEvents.push({ type: 'server-error', text: error.message }); });
      await waitForEndpoint(requestedUrl, 'Kaminos falsifier route');
      if (serverProcess.exitCode != null) throw new Error(`Kaminos server exited during launch: ${serverStderr}`);
    }

    failurePhase = 'browser-launch';
    const stale = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    if (stale?.ok) throw new Error(`CDP debug port ${debugPort} is already in use`);
    chromeProcess = spawn(chrome, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=UseSkiaRenderer',
      `--window-size=${windowSize}`,
      requestedUrl,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chromeProcess.stderr.on('data', chunk => {
      const text = String(chunk);
      if (/ERROR|GPU|WebGPU/i.test(text)) consoleEvents.push({ type: 'chrome-stderr', text: text.slice(0, 2000) });
    });
    chromeProcess.once('error', error => { consoleEvents.push({ type: 'chrome-launch-error', text: error.message }); });
    await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome CDP endpoint');
    const version = await fetchJson('/json/version');
    if (!version?.webSocketDebuggerUrl) throw new Error('Chrome browser CDP target is missing');
    const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
    await waitForWebSocketOpen(browserSocket);
    const systemInfo = await wsRequest(browserSocket, 'SystemInfo.getInfo', {}, 30000);
    browserSocket.close();
    cdpGpuIdentity = normalizeCdpGpuIdentity(systemInfo);
    const targets = await fetchJson('/json/list');
    const page = targets.find(target => target.type === 'page' && target.url.includes('smoke-adaptive-volume-gpu-falsifier.html'))
      || targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('no falsifier page target appeared');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(socket);
    await wsRequest(socket, 'Runtime.enable');
    await wsRequest(socket, 'Page.enable');
    await wsRequest(socket, 'Page.bringToFront');

    failurePhase = 'browser-run';
    browserReport = await waitForBrowserReport(socket);
    browserReport = await evaluate(socket, `window.__kaminosAdaptiveVolumeGpuFalsifier.applyHostGpuIdentity(${JSON.stringify(cdpGpuIdentity)})`);
    const validation = validateAdaptiveVolumeGpuReport(browserReport);
    if (validation.optimizationClaimAllowed !== browserReport.optimizationClaimAllowed) {
      throw new Error(`browser/host report validation disagreement: ${validation.reasons.join(',')}`);
    }
    const scaleLawValidation = validateAdaptiveVolumeScaleLawReport(browserReport);
    if (scaleLawValidation.scaleLawEvidenceAllowed !== browserReport.scaleLawEvidenceAllowed) {
      throw new Error(`browser/host scale-law validation disagreement: ${scaleLawValidation.reasons.join(',')}`);
    }

    failurePhase = 'browser-report-output';
    writeFileSync(browserReportPath, `${JSON.stringify(browserReport, null, 2)}\n`);
    browserReportWritten = true;
    writeReport({ status: 'validated-browser-report-pending-screenshot' });

    failurePhase = 'primary-output';
    const screenshot = await wsRequest(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 60000);
    const pngBytes = Buffer.from(screenshot.data, 'base64');
    if (pngBytes.byteLength < 1000 || pngBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('captured screenshot is blank or partial');
    writeFileSync(screenshotPath, pngBytes);
    screenshotWritten = true;
    primaryOutputWritten = true;
    failurePhase = null;
    const report = writeReport({
      status: browserReport.scaleLawEvidenceAllowed ? 'valid-scale-law-evidence' : 'invalid-for-scale-law-claim',
      optimizationClaimRejectionReasons: browserReport.optimizationClaimRejectionReasons,
    });
    socket.close();
    process.stdout.write(`${JSON.stringify({ status: report.status, reportPath, browserReportPath, screenshotPath, optimizationClaimAllowed: report.optimizationClaimAllowed })}\n`);
  } catch (error) {
    writeReport({ status: 'failed-before-primary-output', error: error?.stack || error?.message || String(error) });
    throw error;
  } finally {
    await closeProcess(chromeProcess, 'Chrome');
    if (serverProcess) await closeProcess(serverProcess, 'Kaminos server');
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
