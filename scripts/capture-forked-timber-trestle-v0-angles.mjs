#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'artifacts/sinter-forked-timber-trestle-v0-2026-07-18/witnesses');
const reportPath = join(outDir, 'trestle-visual-angle-witness.json');
const url = 'http://127.0.0.1:8098/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-structural-bell-0718-handy-candyman-sinter-trestle-0718%2Fartifacts%2Fsinter-forked-timber-trestle-v0-2026-07-18%2Fvisual%2Fforked-timber-reliquary-trestle-v0.glb';
const port = 9474;
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = `/tmp/kaminos-trestle-angle-witness-${port}-${process.pid}`;

let phase = 'initializing';
let stderr = '';
let chromeProcess = null;

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    debugPort: port,
    chrome,
    userDataDir,
    phase,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function fetchJson(path, options = {}) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(options.timeoutMs || 5000),
  });
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function launchChrome() {
  phase = 'checking-debug-port';
  try {
    await fetchJson('/json/version', { timeoutMs: 750 });
    throw new Error(`CDP debug port already in use before launch: ${port}`);
  } catch (error) {
    if (!/fetch failed|ECONNREFUSED|failed.*fetch/i.test(String(error?.message || error))) throw error;
  }
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1468,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });
  for (let i = 0; i < 80; i += 1) {
    try {
      return await fetchJson('/json/version', { timeoutMs: 1000 });
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome launch timed out before CDP was available');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error('CDP WebSocket open timed out')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolveOpen();
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      rejectOpen(new Error('CDP WebSocket failed to open'));
    }, { once: true });
  });
}

let cdpId = 0;
function wsRequest(ws, method, params = {}, options = {}) {
  const id = ++cdpId;
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`CDP request timed out: ${method}`));
    }, options.timeoutMs || 20000);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
      else resolveRequest(message.result || {});
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function captureScreenshot(ws, path) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assert.ok(png.length > 1024, 'screenshot is too small to be credible visual evidence');
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { path, bytes: png.length };
}

const captures = [
  {
    id: 'front',
    path: join(outDir, 'trestle-visual-front.png'),
    pose: { position: [0, 0.72, 2.55], target: [0, 0.43, 0.02] },
  },
  {
    id: 'oblique',
    path: join(outDir, 'trestle-visual-oblique.png'),
    pose: { position: [1.75, 1.05, 2.05], target: [0, 0.42, 0.02] },
  },
  {
    id: 'side-seam',
    path: join(outDir, 'trestle-visual-side-seam.png'),
    pose: { position: [2.45, 0.76, 0.24], target: [0, 0.42, 0.18] },
  },
];

try {
  const version = await launchChrome();
  phase = 'opening-target';
  const targets = await fetchJson('/json/list');
  const target = targets.find(item => item.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await delay(3500);

  phase = 'checking-route';
  const effectiveUrl = await evaluate(ws, 'location.href');
  if (new URL(effectiveUrl).href !== new URL(url).href) {
    throw new Error(`effective URL mismatch: requested ${url} but browser loaded ${effectiveUrl}`);
  }
  const registration = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 120; i += 1) {
        const state = window.kaminosAssetSmokeLinkDebugState?.();
        const objects = window.kaminosSceneObjectDebugState?.() || [];
        if (state?.status === 'loaded' && state.registeredObjectId && objects.some(object => object.id === state.registeredObjectId)) {
          return { state, objects };
        }
        if (state?.status === 'failed') throw new Error('asset route failed before registration: ' + JSON.stringify(state));
        await wait(125);
      }
      return { state: window.kaminosAssetSmokeLinkDebugState?.() || null, objects: window.kaminosSceneObjectDebugState?.() || [] };
    })()
  `);
  if (registration.state?.status !== 'loaded' || registration.state.assetType !== 'mesh') {
    throw new Error(`angle witness asset registration missing: ${JSON.stringify(registration)}`);
  }

  const screenshotResults = [];
  for (const capture of captures) {
    phase = `capture-${capture.id}`;
    const cameraState = await evaluate(ws, `window.kaminosSetCameraDebugPose(${JSON.stringify(capture.pose)})`);
    await delay(400);
    screenshotResults.push({
      id: capture.id,
      cameraState,
      screenshot: await captureScreenshot(ws, capture.path),
    });
  }

  phase = 'complete';
  writeReport({
    ok: true,
    browserVersion: version,
    effectiveUrl,
    registration,
    captures: screenshotResults,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, captures: screenshotResults.map(item => item.screenshot.path) }, null, 2));
} catch (error) {
  writeReport({ ok: false, error: error.stack || String(error) });
  console.error(error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM');
}
