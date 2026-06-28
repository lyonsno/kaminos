#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const requestedSource = args.get('--source') || '';
const url = args.get('--url') || 'http://127.0.0.1:8095/';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-glb-viewset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/viewset-manifest.json`);
const angles = parseAngles(args.get('--angles') || '0,45,90,135,180,225,270,315');
const elevation = Number(args.get('--elevation') || 18);
const radius = Number(args.get('--radius') || 3.2);
const width = Math.max(64, Math.floor(Number(args.get('--width') || 1024)));
const height = Math.max(64, Math.floor(Number(args.get('--height') || 1024)));
const settleMs = Math.max(0, Math.floor(Number(args.get('--settle-ms') || 450)));
const port = Number(args.get('--debug-port') || 9457);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-glb-viewset-profile-${port}-${process.pid}`;
const label = args.get('--label') || null;

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
const frames = [];
let lastEvidence = {};

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function parseAngles(value) {
  return String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(valuePart => Number.isFinite(valuePart));
}

function sourcePathCandidate(source) {
  if (!source) return null;
  if (source.startsWith('file://')) return new URL(source).pathname;
  if (isAbsolute(source) && existsSync(source)) return source;
  return null;
}

function hashFile(path) {
  if (!path || !existsSync(path)) return null;
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function pngMagic(buffer) {
  return buffer.subarray(0, 8).toString('hex');
}

function assertPngScreenshot(buffer) {
  if (buffer.length <= 1024) throw new Error('screenshot is too small to be credible visual evidence');
  const magic = pngMagic(buffer);
  if (magic !== '89504e470d0a1a0a') throw new Error(`screenshot is not a PNG: ${magic}`);
  return magic;
}

function viewsetFramePath(index, angle) {
  const normalized = String(Math.round(angle)).padStart(3, '0');
  return resolve(outDir, `view-${String(index).padStart(2, '0')}-az${normalized}.png`);
}

function cameraForAngle(angleDeg) {
  const az = angleDeg * Math.PI / 180;
  const el = elevation * Math.PI / 180;
  const horizontal = Math.cos(el) * radius;
  return {
    position: [
      Number((Math.sin(az) * horizontal).toFixed(5)),
      Number((Math.sin(el) * radius).toFixed(5)),
      Number((Math.cos(az) * horizontal).toFixed(5)),
    ],
    target: [0, 0, 0],
  };
}

function writeManifest(report) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  const sourcePath = sourcePathCandidate(requestedSource);
  writeFileSync(manifestPath, JSON.stringify({
    schema: 'kaminos.glb-viewset-bake.v0',
    requestedSource,
    effectiveSource: requestedSource,
    sourcePath,
    sourceSha256: hashFile(sourcePath),
    requestedUrl: url,
    effectiveUrl,
    outDir,
    manifestPath,
    angles,
    elevation,
    radius,
    width,
    height,
    settleMs,
    transparentBackground: true,
    debugPort: port,
    chrome,
    userDataDir,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    frames: frames,
    ...lastEvidence,
    ...report,
  }, null, 2));
}

function fail(error) {
  writeManifest({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { signal: AbortSignal.timeout(300) });
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

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs: options.timeoutMs || 10000 });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function viewportClip(ws) {
  return evaluate(ws, `(() => {
    const canvas = document.querySelector('#viewport canvas') || document.querySelector('canvas');
    const element = canvas || document.querySelector('#viewport');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      scale: 1
    };
  })()`);
}

async function capturePngScreenshot(ws, screenshotPath, clip) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, omitBackground: true, clip: clip || undefined }, { timeoutMs: 10000 });
  const png = Buffer.from(shot.data, 'base64');
  const magic = assertPngScreenshot(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return { path: screenshotPath, bytes: png.length, pngMagic: magic };
}

async function main() {
  phase = 'validating-args';
  if (!requestedSource) throw new Error('Missing --source');
  if (!angles.length) throw new Error('No valid --angles values');

  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) throw new Error(`CDP debug port already in use before launch: ${port}`);

  phase = 'launching-chrome';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints',
    '--enable-unsafe-webgpu',
    `--window-size=${width},${height}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    browserVersion = await waitForCdp();
    const tabs = await cdpFetch('/json');
    const page = tabs.find(tab => tab.type === 'page') || tabs[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('No Chrome page websocket available');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wsRequest(ws, 'Page.navigate', { url });

    phase = 'waiting-for-kaminos';
    for (let i = 0; i < 80; i += 1) {
      effectiveUrl = normalizeUrl((await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      })).result.value);
      if (effectiveUrl === normalizeUrl(url)) break;
      await delay(125);
    }
    if (normalizeUrl(url) !== effectiveUrl) {
      throw new Error(`effective URL mismatch: requested ${normalizeUrl(url)} got ${effectiveUrl}`);
    }
    for (let i = 0; i < 120; i += 1) {
      const available = await evaluate(ws, 'Boolean(window.kaminosViewGLBDebugRoute && window.kaminosSetCameraDebugPose)');
      if (available) break;
      await delay(125);
      if (i === 119) throw new Error('Kaminos GLB debug/camera surfaces did not become available');
    }

    phase = 'loading-glb';
    lastEvidence.debugLoad = await evaluate(ws, `
      window.kaminosViewGLBDebugRoute({
        source: ${JSON.stringify(requestedSource)},
        fileName: ${JSON.stringify(args.get('--file-name') || null)},
        label: ${JSON.stringify(label)},
        opaque: true
      })
    `, { timeoutMs: 60000 });
    await delay(Math.max(settleMs, 250));

    phase = 'capturing-viewset';
    mkdirSync(outDir, { recursive: true });
    for (let index = 0; index < angles.length; index += 1) {
      const angle = angles[index];
      const camera = cameraForAngle(angle);
      const pose = await evaluate(ws, `
        window.kaminosSetCameraDebugPose(${JSON.stringify(camera)})
      `);
      await delay(settleMs);
      const framePath = viewsetFramePath(index, angle);
      const clip = await viewportClip(ws);
      const screenshot = await capturePngScreenshot(ws, framePath, clip);
      frames.push({
        index,
        angle,
        path: framePath,
        bytes: screenshot.bytes,
        pngMagic: screenshot.pngMagic,
        viewportClip: clip,
        camera: pose || camera,
      });
    }

    phase = 'complete';
    writeManifest({ ok: true });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

function normalizeUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

main().catch(fail);
