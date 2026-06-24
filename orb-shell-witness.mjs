#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_orb_shell_witness=1&orb_shell_seed=17';
const out = resolve(args.get('--out') || '/tmp/kaminos-orb-shell-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9468);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-orb-shell-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 2200);
let phase = 'startup';

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
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

function wsRequest(ws, method, params = {}, timeoutMs = 15000) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method} timed out during ${phase}`));
    }, timeoutMs);
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
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterPngRow(row, prev, filter, bytesPerPixel) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = prev[i] || 0;
    const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (row[i] + paethPredictor(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
  }
}

function pngVisualStats(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'blank frame or missing PNG output');
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  assert.ok(ihdr && idat.length, 'blank frame or missing PNG output');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  assert.equal(bitDepth, 8, 'orb shell witness only supports 8-bit PNG screenshots');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let rawOffset = 0;
  let prev = Buffer.alloc(stride);
  let minLuma = 255;
  let maxLuma = 0;
  const buckets = new Set();
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    unfilterPngRow(row, prev, filter, channels);
    for (let x = 0; x < width; x += 8) {
      const i = x * channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
    }
    prev = row;
  }
  return { width, height, lumaRange: maxLuma - minLuma, colorBuckets: buckets.size };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl: report.effectiveUrl || null,
    routeGate: 'kaminos_orb_shell_witness=1',
    expectedIdentity: 'orb-shell-single-layer-witness-v0',
    phase,
    ...report,
  }, null, 2));
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += String(chunk); });
  let ws = null;
  try {
    phase = 'cdp';
    const version = await waitForCdp();
    const pages = await cdpFetch('/json');
    const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_orb_shell_witness=1')) || pages.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page websocket for orb shell witness');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'settle';
    await delay(settleMs);
    phase = 'debug-state';
    const state = await evaluate(ws, 'window.__kaminosOrbShellWitness?.debugState?.()');
    assert.equal(state?.identity, 'orb-shell-single-layer-witness-v0', 'wrong orb shell witness identity');
    assert.equal(state?.active, true, 'orb shell witness inactive');
    assert.equal(state?.supportManifold, 'orb-shell-support-manifold-v0', 'wrong support manifold');
    assert.equal(state?.shellSkeleton?.visibleLayerCount, 1, 'orb shell witness must remain single-layer');
    assert.ok((state?.ShellSkeletonDescriptor || []).length >= 8, 'missing ShellSkeletonDescriptor leaves');
    assert.ok((state?.ApertureGraphDescriptor || []).length >= 3, 'missing ApertureGraphDescriptor apertures');
    assert.ok(state?.CoreSocketDescriptor?.placeholderOnly === true, 'core socket must be placeholder only');
    assert.ok(state?.forbiddenFirstSliceScope?.includes('multi-layer-interleaving'), 'forbidden scope missing multi-layer interleaving');
    phase = 'screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, 20000);
    const png = Buffer.from(screenshot.data, 'base64');
    const visualStats = pngVisualStats(png);
    assert.ok(png.length > 10000, 'blank frame or missing PNG output');
    assert.ok(visualStats.lumaRange >= 24, 'blank frame lacks luminance diversity');
    assert.ok(visualStats.colorBuckets >= 16, 'blank frame lacks color diversity');
    writeFileSync(out, png);
    writeReport({
      effectiveUrl: page.url,
      browserVersion: version.Browser || null,
      screenshot: { path: out, bytes: png.length },
      visualStats,
      state,
      ShellSkeletonDescriptor: state.ShellSkeletonDescriptor,
      ApertureGraphDescriptor: state.ApertureGraphDescriptor,
      CoreSocketDescriptor: state.CoreSocketDescriptor,
      stderrTail: stderr.slice(-2000),
    });
  } catch (error) {
    writeReport({ error: String(error.stack || error), stderrTail: stderr.slice(-2000) });
    throw error;
  } finally {
    try { ws?.close?.(); } catch {}
    proc.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
