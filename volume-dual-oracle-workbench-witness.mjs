#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.dual-oracle-workbench-witness.v0';
const ROUTE_IDENTITY = 'dual-live-oracle-receiver-workbench-v0';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8099/volume-dual-oracle-workbench.html?low_grid=64&high_grid=128&source_mode=highProjected&cadence=8&vorticity=0.20&curl_noise=0.00&material=0.00';
const out = resolve(args.get('--out') || '/tmp/kaminos-dual-oracle-workbench-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const fullScreenshot = args.has('--full-screenshot')
  ? resolve(args.get('--full-screenshot') || out.replace(/\.png$/i, '.full.png'))
  : '';
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-dual-oracle-profile-');
const windowSize = args.get('--window-size') || '1440,980';
const settleMs = Number(args.get('--settle-ms') || 1200);
const minCueUpdates = Number(args.get('--min-cue-updates') || 1);
const timeoutMs = Number(args.get('--timeout-ms') || 45_000);
const keepBrowserOpen = args.has('--keep-browser-open');

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      await cdpFetch('/json/version');
      return;
    } catch {
      await delay(150);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evalReturn(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function writeReport(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
}

async function captureScreenshot(ws, path) {
  if (!path) return null;
  mkdirSync(dirname(path), { recursive: true });
  const shot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const buffer = Buffer.from(shot.data, 'base64');
  writeFileSync(path, buffer);
  return {
    path,
    sha256: sha256Buffer(buffer),
    byteLength: buffer.length,
  };
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  let phase = 'launch';
  let ws = null;
  const browserProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
  const browser = {
    identity: 'per-capture-chrome-process-v0',
    port,
    userDataDir,
    keepBrowserOpen,
  };
  try {
    phase = 'cdp';
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('volume-dual-oracle-workbench.html')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    phase = 'workbench-ready';
    const started = Date.now();
    let state = null;
    while (Date.now() - started < timeoutMs) {
      state = await evalReturn(ws, 'window.__kaminosDualOracleWorkbench?.debugState?.()');
      if (state?.routeIdentity === ROUTE_IDENTITY && state?.status === 'running' && Number(state?.cueUpdateCount || 0) >= minCueUpdates) break;
      if (state?.status === 'failed') throw new Error(`${state.failurePhase || 'workbench-failed'}: ${state.error || 'unknown error'}`);
      await delay(500);
    }
    assert.equal(state?.routeIdentity, ROUTE_IDENTITY, 'wrong effective workbench route identity');
    assert.equal(state?.status, 'running', 'dual oracle workbench did not reach running status');
    assert.ok(Number(state?.cueUpdateCount || 0) >= minCueUpdates, 'dual oracle workbench did not produce required cue updates');
    assert.equal(state?.projectionIdentity, 'max-source-cell-to-target-grid-v0', 'unexpected projection identity');
    assert.equal(state?.cueTemporalMode, 'readback-cadence-held-between-uploads', 'unexpected cue temporal mode');
    phase = 'capture';
    const screenshot = await captureScreenshot(ws, out);
    const full = await captureScreenshot(ws, fullScreenshot);
    const report = {
      schema: SCHEMA,
      status: 'captured',
      failurePhase: null,
      authority: 'browser-dual-live-oracle-workbench-smoke',
      requestedUrl: url,
      effectiveRoute: state.routeIdentity,
      browser,
      sourceMode: state.sourceMode,
      lowGrid: state.lowGrid,
      highGrid: state.highGrid,
      cueAuthority: state.cueAuthority,
      cueUpdateCount: state.cueUpdateCount,
      heldCueFrameCount: state.heldCueFrameCount,
      droppedCueCount: state.droppedCueCount,
      lastCueAgeMs: state.lastCueAgeMs,
      lastCueFrameId: state.lastCueFrameId,
      projectionIdentity: state.projectionIdentity,
      cueTemporalMode: state.cueTemporalMode,
      lastCueExport: state.lastCueExport,
      receiver: state.lastReceiverState,
      low: {
        backend: state.low?.backend,
        simGrid: state.low?.simGrid,
        frameCount: state.low?.frameCount,
        scalarActivityReceiver: state.low?.scalarActivityReceiver,
      },
      high: {
        backend: state.high?.backend,
        simGrid: state.high?.simGrid,
        frameCount: state.high?.frameCount,
      },
      screenshot,
      fullScreenshot: full,
    };
    writeReport(reportPath, report);
    console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, cueUpdateCount: report.cueUpdateCount }, null, 2));
  } catch (error) {
    writeReport(reportPath, {
      schema: SCHEMA,
      status: 'failed',
      failurePhase: phase,
      reason: error?.message || String(error),
      requestedUrl: url,
      browser,
    });
    console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase: phase, reason: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    try {
      if (ws) ws.close();
    } catch {}
    if (!keepBrowserOpen) browserProcess.kill('SIGTERM');
  }
}

main();
