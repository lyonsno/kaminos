#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url');
if (!url) throw new Error('--url is required');
const reportPath = resolve(args.get('--report') || 'artifacts/structural-bell-citadel-v0-2026-07-18/witnesses/citadel-bell-v0-angle-witness.json');
const outDir = resolve(args.get('--out-dir') || dirname(reportPath));
const port = Number(args.get('--debug-port') || 9455);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-bell-angle-profile-${port}-${process.pid}`;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertPng(buffer, label) {
  if (buffer.length <= 1024) throw new Error(`${label} screenshot too small`);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${label} screenshot is not PNG`);
}

async function cdpFetch(path) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!resp.ok) throw new Error(`CDP fetch failed ${resp.status}: ${path}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

async function waitForWebSocketOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', rejectOpen, { once: true });
  });
}

let commandId = 0;
const pending = new Map();
function wsRequest(ws, method, params = {}) {
  const id = ++commandId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`CDP request timed out: ${method}`));
    }, 30000);
    pending.set(id, message => {
      clearTimeout(timeout);
      if (message.error) rejectRequest(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
      else resolveRequest(message.result);
    });
  });
}

async function evaluate(ws, expression, timeoutMs = 30000) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (result.exceptionDetails) throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function capture(ws, path) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPng(png, path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { path, bytes: png.length };
}

const poses = [
  { id: 'front', position: [0, 0.05, 3.2], target: [0, 0.02, 0] },
  { id: 'oblique', position: [2.2, 0.65, 2.25], target: [0, 0.02, 0] },
  { id: 'crown', position: [0.35, 2.15, 1.1], target: [0, 0.55, 0] },
  { id: 'underside', position: [0, -1.55, 2.15], target: [0, -0.25, 0] },
];

let chromeProcess = null;
let ws = null;
try {
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : ['--no-first-run', '--no-default-browser-check', '--disable-extensions']),
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--window-size=1468,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const browserVersion = await waitForCdp();
  phase = 'opening-target';
  const targets = await cdpFetch('/json/list');
  const target = targets.find(entry => entry.type === 'page') || targets[0];
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await delay(4500);
  effectiveUrl = await evaluate(ws, 'location.href');
  if (effectiveUrl !== url) throw new Error(`effective URL mismatch: expected ${url} got ${effectiveUrl}`);
  phase = 'waiting-for-asset';
  const loaded = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 160; i += 1) {
        const state = window.kaminosAssetSmokeLinkDebugState?.();
        const objects = window.kaminosSceneObjectDebugState?.() || [];
        if (state?.status === 'loaded' && state.registeredObjectId && objects.some(object => object.id === state.registeredObjectId)) {
          return { state, objects };
        }
        if (state?.status === 'failed') throw new Error('asset failed before angle capture: ' + JSON.stringify(state));
        await wait(125);
      }
      throw new Error('asset did not load before angle capture');
    })()
  `);
  phase = 'capturing-angles';
  mkdirSync(outDir, { recursive: true });
  const shots = [];
  for (const pose of poses) {
    const camera = await evaluate(ws, `
      (() => {
        window.setGizmoMode?.(null);
        document.getElementById('transform-bar')?.classList.remove('visible');
        return window.kaminosSetCameraDebugPose(${JSON.stringify({ position: pose.position, target: pose.target })});
      })()
    `);
    await delay(800);
    shots.push({
      id: pose.id,
      pose,
      camera,
      screenshot: await capture(ws, `${outDir}/citadel-bell-v0-${pose.id}.png`),
    });
  }
  writeJson(reportPath, {
    schema: 'kaminos.structural-bell.angle-witness.v0',
    ok: true,
    requestedUrl: url,
    effectiveUrl,
    browserVersion,
    asset: loaded.state,
    sceneObjects: loaded.objects,
    shots,
    phase,
  });
  console.log(JSON.stringify({ report: reportPath, ok: true, shots: shots.map(shot => shot.screenshot) }, null, 2));
} catch (error) {
  writeJson(reportPath, {
    schema: 'kaminos.structural-bell.angle-witness.v0',
    ok: false,
    requestedUrl: url,
    effectiveUrl,
    phase,
    error: error?.stack || error?.message || String(error),
    stderrTail: stderr.slice(-2000),
  });
  throw error;
} finally {
  try { ws?.close?.(); } catch {}
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM');
}
