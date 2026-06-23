#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  buildMotionDecisionComparison,
  buildMotionWitnessTimeline,
} from './motion-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_motion_agency=1';
const isPhraseRoute = url.includes('kaminos_motion_phrase=1');
const out = resolve(args.get('--out') || '/tmp/kaminos-motion-agency-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const filmstripPath = resolve(args.get('--filmstrip') || out.replace(/\.png$/i, '-filmstrip.png'));
const port = Number(args.get('--debug-port') || 9444);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-agency-witness-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 2200);

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
let lastEvidence = {};

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
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
  for (let i = 0; i < 80; i++) {
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
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function assertPngScreenshot(buffer) {
  assert.ok(buffer.length > 1024, 'screenshot is too small to be credible visual evidence');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const outBuf = Buffer.alloc(12 + data.length);
  outBuf.writeUInt32BE(data.length, 0);
  typeBuf.copy(outBuf, 4);
  data.copy(outBuf, 8);
  outBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return outBuf;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function hexToRgb(hex) {
  const value = String(hex || '#d8c38e').replace('#', '');
  const n = Number.parseInt(value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCircle(rgba, width, height, cx, cy, radius, color, alpha = 1) {
  const [r, g, b] = color;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const i = (y * width + x) * 4;
      const falloff = (1 - d / radius) * alpha;
      rgba[i] = Math.max(rgba[i], Math.round(r * falloff));
      rgba[i + 1] = Math.max(rgba[i + 1], Math.round(g * falloff));
      rgba[i + 2] = Math.max(rgba[i + 2], Math.round(b * falloff));
      rgba[i + 3] = 255;
    }
  }
}

function drawFilmstrip(timeline, path) {
  const panelWidth = 220;
  const panelHeight = 160;
  const width = panelWidth * timeline.filmstrip.length;
  const height = panelHeight;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 5;
    rgba[i + 1] = 6;
    rgba[i + 2] = 8;
    rgba[i + 3] = 255;
  }
  timeline.filmstrip.forEach((frame, panelIndex) => {
    const x0 = panelIndex * panelWidth;
    for (let y = 0; y < panelHeight; y++) {
      const borderIndex = (y * width + x0) * 4;
      rgba[borderIndex] = 88;
      rgba[borderIndex + 1] = 72;
      rgba[borderIndex + 2] = 35;
    }
    for (const actor of frame.actors) {
      const cx = x0 + panelWidth * 0.5 + actor.root[0] * 42;
      const cy = panelHeight * 0.68 - actor.root[2] * 38 - actor.root[1] * 12;
      const color = hexToRgb(actor.color);
      drawCircle(rgba, width, height, cx, cy, 11 + actor.effort * 9, color, 0.92);
      drawCircle(rgba, width, height, cx + actor.facing[0] * 15, cy - actor.facing[2] * 15, 3.5, [255, 255, 255], 0.9);
    }
  });
  writeRgbaPng(path, width, height, rgba);
  return { path, width, height, frames: timeline.filmstrip.length };
}

let chromeProcess = null;

try {
  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) throw new Error(`CDP debug port already in use before launch: ${port}`);

  phase = 'rendering-filmstrip';
  const timeline = isPhraseRoute
    ? buildMotionDecisionComparison({ duration: 7.2, fps: 12, filmstripFrames: 7 })
    : buildMotionWitnessTimeline({ duration: 5.2, fps: 12, filmstripFrames: 6 });
  const filmstrip = drawFilmstrip(timeline, filmstripPath);
  if (isPhraseRoute) {
    lastEvidence.decisionComparison = {
      schema: timeline.schema,
      route: timeline.route,
      naive: {
        actor: timeline.naive.actor,
        metrics: timeline.naive.metrics,
      },
      phrased: {
        actor: timeline.phrased.actor,
        metrics: timeline.phrased.metrics,
      },
      filmstrip,
    };
  } else {
    lastEvidence.timeline = {
      schema: timeline.schema,
      route: timeline.route,
      requestedClipIds: timeline.requestedClipIds,
      effectiveClipIds: timeline.effectiveClipIds,
      fallbackCount: timeline.fallbackCount,
      metrics: timeline.metrics,
      filmstrip,
    };
  }

  phase = 'launching-chrome';
  mkdirSync(userDataDir, { recursive: true });
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1400,900',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');

  phase = 'settling-route';
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'window.location.href');
  const routeParam = isPhraseRoute ? 'kaminos_motion_phrase=1' : 'kaminos_motion_agency=1';
  if (!effectiveUrl.includes(routeParam)) throw new Error(`effective URL lost motion route ${routeParam}: ${effectiveUrl}`);
  const debugExpression = isPhraseRoute
    ? 'window.kaminosMotionDecisionDebugState?.()'
    : 'window.kaminosMotionAgencyDebugState?.()';
  const debug = await evaluate(ws, debugExpression, { timeoutMs: 10000 });
  lastEvidence.debug = debug;
  if (debug?.route !== 'procedural-orb-motion-grammar-v0') throw new Error(`motion route identity mismatch: ${JSON.stringify(debug)}`);
  if (isPhraseRoute) {
    const decisionComparison = debug?.decisionComparison;
    if (!debug?.active || debug.actorCount < 2) throw new Error(`motion phrase route did not spawn comparison actors: ${JSON.stringify(debug)}`);
    if (decisionComparison?.schema !== 'kaminos.motion-decision-comparison.v0') throw new Error(`motion phrase route lost comparison schema: ${JSON.stringify(debug)}`);
    if (!(decisionComparison.phrased.metrics.anticipationDepth > decisionComparison.naive.metrics.anticipationDepth)) {
      throw new Error(`motion phrase route lost anticipationDepth advantage: ${JSON.stringify(debug)}`);
    }
    if (!(decisionComparison.phrased.metrics.overshootDistance > decisionComparison.naive.metrics.overshootDistance)) {
      throw new Error(`motion phrase route lost overshootDistance advantage: ${JSON.stringify(debug)}`);
    }
  } else {
    if (!debug?.active || debug.actorCount < 5) throw new Error(`motion route did not spawn actor fixture: ${JSON.stringify(debug)}`);
    if (debug.fallbackCount !== 0) throw new Error(`default fixture unexpectedly used fallbacks: ${JSON.stringify(debug)}`);
    if (!debug.requestedClipIds?.includes('stalk_bad_intent')) throw new Error(`motion route lost requestedClipIds: ${JSON.stringify(debug)}`);
    if (!debug.effectiveClipIds?.includes('orbit_inspect')) throw new Error(`motion route lost effectiveClipIds: ${JSON.stringify(debug)}`);
  }

  phase = 'capturing-screenshot';
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);

  phase = 'writing-report';
  writeReport({
    ok: true,
    screenshot: { path: out, bytes: png.length },
    filmstrip,
    requestedClipIds: debug.requestedClipIds || [],
    effectiveClipIds: debug.effectiveClipIds || [],
    fallbackCount: debug.fallbackCount || 0,
    decisionComparison: debug.decisionComparison || lastEvidence.decisionComparison || null,
    debug,
    timeline: lastEvidence.timeline,
  });
  ws.close();
  chromeProcess.kill('SIGTERM');
} catch (error) {
  writeReport({
    ok: false,
    error: error.stack || String(error),
    lastEvidence,
  });
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  throw error;
}
