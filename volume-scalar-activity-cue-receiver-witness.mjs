#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.scalar-activity-cue-receiver-witness.v0';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const receiverControlParams = [
  'volume_oracle_activity_cue',
  'volume_oracle_activity_display',
  'volume_oracle_activity_vorticity',
  'volume_oracle_activity_curl_noise',
  'volume_oracle_activity_material',
];

const url = args.get('--url') || 'http://127.0.0.1:8098/?kaminos_volume_smoke=1&volume_resolution=96&volume_oracle_activity_cue=1&volume_oracle_activity_display=0&volume_oracle_activity_vorticity=0.75&volume_oracle_activity_curl_noise=0.75&volume_oracle_activity_material=0';
const cuePath = args.has('--cue') ? resolve(args.get('--cue')) : '';
const sourceGrid = Number(args.get('--source-grid') || args.get('--grid') || 96);
const cueAuthority = args.get('--cue-authority') || 'learned-diagnostic-rgb-norm-scalar-activity-cue-v0';
const frameId = args.get('--frame-id') || 'learned-scalar-activity-cue-witness';
const out = resolve(args.get('--out') || '/tmp/kaminos-scalar-activity-cue-receiver-witness.png');
const fullScreenshot = args.has('--full-screenshot')
  ? resolve(args.get('--full-screenshot') || out.replace(/\.png$/i, '.full.png'))
  : '';
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-scalar-cue-witness-profile-');
const windowSize = args.get('--window-size') || '1280,960';
const settleMs = Number(args.get('--settle-ms') || 1800);
const postUploadSettleMs = Number(args.get('--post-upload-settle-ms') || 1200);
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

function writeReport(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
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

function readCuePayload(path, grid) {
  if (!path) throw new Error('missing --cue path');
  const buffer = readFileSync(path);
  const expectedBytes = grid * grid * grid * 4;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`cue byte length mismatch: expected ${expectedBytes} for ${grid}^3 float32, got ${buffer.byteLength}`);
  }
  return {
    path,
    sha256: sha256Buffer(buffer),
    byteLength: buffer.byteLength,
    valueCount: grid * grid * grid,
    base64: buffer.toString('base64'),
  };
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  let phase = 'launch';
  let browser = null;
  let ws = null;
  const cue = readCuePayload(cuePath, sourceGrid);
  const browserProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
  browser = {
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
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    phase = 'route-ready';
    let before = null;
    for (let i = 0; i < 80; i += 1) {
      before = await evalReturn(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
      if (before?.active && before?.frameCount > 8 && before?.scalarActivityReceiver) break;
      await delay(250);
    }
    assert.ok(before?.active, 'volume route is not active before cue upload');
    assert.equal(before.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route before cue upload');
    assert.ok(before.scalarActivityReceiver, 'missing scalar activity receiver debug state before cue upload');
    phase = 'upload-cue';
    const uploadResult = await evalReturn(ws, `(() => {
      const binary = atob(${JSON.stringify(cue.base64)});
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const values = new Float32Array(bytes.buffer);
      return window.__kaminosVolumePrototype.setTruthOracleActivityCue({
        grid: ${JSON.stringify(sourceGrid)},
        cueAuthority: ${JSON.stringify(cueAuthority)},
        values,
        frameId: ${JSON.stringify(frameId)},
      });
    })()`);
    await delay(postUploadSettleMs);
    phase = 'post-upload-state';
    const after = await evalReturn(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
    assert.equal(after?.scalarActivityReceiver?.externalCueStatus, 'uploaded', 'cue upload did not become active');
    assert.equal(after?.scalarActivityReceiver?.effectiveCueAuthority, cueAuthority, 'effectiveCueAuthority did not report uploaded cue authority');
    assert.equal(after?.scalarActivityReceiver?.externalCueSourceGrid, sourceGrid, 'external cue source grid mismatch');
    phase = 'capture';
    const screenshot = await captureScreenshot(ws, out);
    const full = await captureScreenshot(ws, fullScreenshot);
    const report = {
      schema: SCHEMA,
      status: 'captured',
      failurePhase: null,
      authority: 'browser-receiver-smoke-with-uploaded-scalar-activity-cue',
      requestedUrl: url,
      receiverControlParams,
      browser,
      sourceGrid,
      cueAuthority,
      frameId,
      uploadedCuePath: cue.path,
      uploadedCueSha256: cue.sha256,
      uploadedCueByteLength: cue.byteLength,
      uploadedCueValueCount: cue.valueCount,
      uploadResult,
      before,
      after,
      scalarActivityReceiver: after.scalarActivityReceiver,
      effectiveCueAuthority: after.scalarActivityReceiver.effectiveCueAuthority,
      screenshot,
      fullScreenshot: full,
    };
    writeReport(reportPath, report);
    console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, effectiveCueAuthority: report.effectiveCueAuthority }, null, 2));
  } catch (error) {
    writeReport(reportPath, {
      schema: SCHEMA,
      status: 'failed',
      failurePhase: phase,
      authority: 'browser-receiver-smoke-with-uploaded-scalar-activity-cue',
      error: error?.stack || error?.message || String(error),
      requestedUrl: url,
      uploadedCuePath: cue.path,
      uploadedCueSha256: cue.sha256,
      sourceGrid,
      cueAuthority,
      frameId,
      browser,
    });
    throw error;
  } finally {
    try { ws?.close?.(); } catch {}
    if (!keepBrowserOpen) browserProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
