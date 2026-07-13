#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8096/';
const assetUrl = args.get('--asset-url') || '/artifacts/titan-hammer-source-cleanup-2026-07-13/provisional-glb/hammer-trellis-geometry-only.glb';
const assetFileName = args.get('--asset-file-name') || assetUrl.split('/').pop() || 'scene-object.glb';
const assetLabel = args.get('--asset-label') || 'Titan Hammer provisional GLB';
const reportSchema = args.get('--schema') || 'kaminos.titan-hammer-glb-viewer-witness.v0';
const truthBoundary = args.get('--truth-boundary') || 'Kaminos viewer route, GLB load, scene registration, and two camera captures only. This does not prove texture quality, topology repair, collision suitability, or free-orbit production usability.';
const outA = resolve(args.get('--out-a') || 'artifacts/titan-hammer-source-cleanup-2026-07-13/witnesses/hammer-provisional-glb-front.png');
const outB = resolve(args.get('--out-b') || 'artifacts/titan-hammer-source-cleanup-2026-07-13/witnesses/hammer-provisional-glb-oblique.png');
const reportPath = resolve(args.get('--report') || 'artifacts/titan-hammer-source-cleanup-2026-07-13/witnesses/hammer-provisional-glb-kaminos-witness.json');
const port = Number(args.get('--debug-port') || 9452);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-hammer-glb-witness-${port}-${process.pid}`;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';
const settleMs = Number(args.get('--settle-ms') || 2500);

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let effectiveUrl = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: reportSchema,
    requestedRoute: {
      url,
      assetUrl,
      viewerFunction: 'window.kaminosImportGLBSceneObject',
      debugFunction: 'window.kaminosSceneObjectDebugState',
    },
    effectiveUrl,
    chrome,
    userDataDir,
    debugPort: port,
    headless,
    settleMs,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    truthBoundary,
    ...report,
  }, null, 2));
}

async function cdpFetch(path, options = {}) {
  const { timeoutMs = 5000, ...fetchOptions } = options;
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, fetchOptions);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpOpen() {
  try {
    await cdpFetch('/json/version', { timeoutMs: 300 });
    return true;
  } catch {
    return false;
  }
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

function wsRequest(ws, method, params = {}, options = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, options.timeoutMs || 10000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
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

async function evaluate(ws, expression, timeoutMs = 15000) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function assertPng(buffer) {
  assert.ok(buffer.length > 4096, 'screenshot is too small to be credible visual evidence');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
}

async function capture(ws, path) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, { timeoutMs: 20000 });
  const png = Buffer.from(shot.data, 'base64');
  assertPng(png);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { path, bytes: png.length };
}

let chromeProcess = null;
let ws = null;

try {
  phase = 'checking-debug-port';
  if (await isCdpOpen()) throw new Error(`CDP debug port already in use: ${port}`);

  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : ['--no-first-run', '--no-default-browser-check', '--disable-extensions']),
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--window-size=1468,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const launchSignal = new Promise(resolveLaunch => {
    chromeProcess.once('error', error => resolveLaunch({ error }));
    chromeProcess.once('exit', (code, signal) => resolveLaunch({ exit: { code, signal } }));
  });

  phase = 'waiting-for-cdp';
  const launchResult = await Promise.race([
    waitForCdp().then(version => ({ version })),
    launchSignal,
  ]);
  if (launchResult.error) throw new Error(`Chrome launch failed: ${launchResult.error.message}`);
  if (launchResult.exit) throw new Error(`Chrome exited before DevTools opened: ${JSON.stringify(launchResult.exit)}`);
  browserVersion = launchResult.version;

  phase = 'opening-target';
  const targets = await cdpFetch('/json/list');
  const target = targets.find(item => item.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.bringToFront');
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'location.href');

  phase = 'loading-glb';
  const loadResult = await evaluate(ws, `
    (async () => {
      if (typeof window.kaminosImportGLBSceneObject !== 'function') throw new Error('kaminosImportGLBSceneObject unavailable');
      await window.kaminosImportGLBSceneObject(
        ${JSON.stringify(assetUrl)},
        ${JSON.stringify(assetFileName)},
        { title: ${JSON.stringify(assetLabel)}, raw_name: ${JSON.stringify(assetFileName)} }
      );
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scene = window.kaminosSceneObjectDebugState?.() || [];
      const object = scene.find(record => record.type === 'glb' && record.source === ${JSON.stringify(assetUrl)}) || null;
      return {
        scene,
        object,
        camera: window.kaminosCameraDebugState?.() || null,
        infoText: document.getElementById('info')?.textContent || null,
        rowCount: document.querySelectorAll('[data-scene-object-id]').length
      };
    })();
  `, 30000);
  assert.ok(loadResult.object, 'loaded GLB was not registered in scene object debug state');
  assert.equal(loadResult.object.type, 'glb');
  assert.equal(loadResult.object.source, assetUrl);

  phase = 'capturing-front';
  const frontCamera = await evaluate(ws, `
    window.kaminosSetCameraDebugPose({
      position: [0, 0, 4.2],
      target: [0, 0, 0]
    });
  `);
  await delay(600);
  const front = await capture(ws, outA);

  phase = 'capturing-oblique';
  const obliqueCamera = await evaluate(ws, `
    window.kaminosSetCameraDebugPose({
      position: [2.7, 1.55, 3.2],
      target: [0, 0, 0]
    });
  `);
  await delay(600);
  const oblique = await capture(ws, outB);

  phase = 'recording-report';
  const finalState = await evaluate(ws, `
    ({
      scene: window.kaminosSceneObjectDebugState?.() || [],
      camera: window.kaminosCameraDebugState?.() || null,
      infoText: document.getElementById('info')?.textContent || null,
      rowText: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.textContent.trim())
    });
  `);
  writeReport({
    status: 'passed',
    registration: {
      initial: loadResult.object,
      final: finalState.scene.find(record => record.id === loadResult.object.id) || null,
      rowCount: loadResult.rowCount,
      finalRowCount: finalState.scene.length,
    },
    captures: { front, oblique },
    cameras: { initial: loadResult.camera, front: frontCamera, oblique: obliqueCamera, final: finalState.camera },
    finalInfoText: finalState.infoText,
    finalRows: finalState.rowText,
  });
  console.log(JSON.stringify({ status: 'passed', reportPath, captures: [front.path, oblique.path] }, null, 2));
} catch (error) {
  writeReport({
    status: 'failed',
    error: error.stack || error.message,
  });
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  if (chromeProcess && chromeProcess.exitCode === null) chromeProcess.kill('SIGTERM');
}
