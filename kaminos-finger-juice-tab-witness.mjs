#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inflateSync as zlibInflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8100/index.html?kaminos_lerms_finger_juice=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-finger-juice-tab-full-viewport.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9490);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-finger-juice-tab-profile-${port}-${process.pid}`;
const viewportWidth = Number(args.get('--viewport-width') || 2048);
const viewportHeight = Number(args.get('--viewport-height') || 1124);
const settleMs = Number(args.get('--settle-ms') || 2400);

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastDebugState = null;
let fullViewportActivityMetrics = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.finger-juice-tab-witness.v0',
    requestedUrl: url,
    debugPort: port,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    consoleEvents,
    lastDebugState,
    fullViewportActivityMetrics,
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
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

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          method: msg.method,
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          method: msg.method,
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (msg.method === 'Log.entryAdded') {
        consoleEvents.push({
          method: msg.method,
          type: msg.params.entry?.level || 'log',
          text: msg.params.entry?.text || '',
        });
      }
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

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let p = 0;
  let outP = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - upLeft - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const base = x * channels;
      pixels[outP++] = row[base];
      pixels[outP++] = row[base + 1];
      pixels[outP++] = row[base + 2];
      pixels[outP++] = channels === 4 ? row[base + 3] : 255;
    }
    prev = row;
  }
  return { width, height, pixels };
}

function measureFullViewportActivity(pngBuffer) {
  const { width, height, pixels } = parsePngRgba(pngBuffer);
  const sidebarExclusion = Math.min(width - 1, 390);
  let inspectedPixels = 0;
  let activePixels = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = sidebarExclusion; x < width; x += 1) {
      inspectedPixels += 1;
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const juiceLike = max > 115 && max - min > 36 && (r > 130 || g > 130 || b > 150);
      if (!juiceLike) continue;
      activePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const activeRatio = inspectedPixels ? activePixels / inspectedPixels : 0;
  const boundsAreaRatio = activePixels
    ? ((maxX - minX + 1) * (maxY - minY + 1)) / Math.max(1, inspectedPixels)
    : 0;
  return {
    width,
    height,
    inspectedRegion: { x: sidebarExclusion, y: 0, width: width - sidebarExclusion, height },
    activePixels,
    inspectedPixels,
    activeRatio: Number(activeRatio.toFixed(4)),
    boundsAreaRatio: Number(boundsAreaRatio.toFixed(4)),
    bounds: activePixels ? { minX, minY, maxX, maxY } : null,
  };
}

async function main() {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
    `--window-size=${viewportWidth},${viewportHeight}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.url.includes('kaminos_lerms_finger_juice=1')) || pages[0];
    assert.ok(page?.webSocketDebuggerUrl, 'Chrome page target missing debugger URL');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Log.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    phase = 'wait_for_kaminos_tab_state';
    const deadline = Date.now() + settleMs + 10000;
    while (Date.now() < deadline) {
      lastDebugState = await evaluate(ws, `(() => {
        const state = window.kaminosFingerJuiceTabDebugState?.();
        return state ? JSON.parse(JSON.stringify(state)) : null;
      })()`);
      if (
        lastDebugState?.childReady
        && lastDebugState.embedRoute === 'kaminos-finger-juice-tab-embed-v0'
        && lastDebugState.solverBackend === 'webgpu_compute'
        && lastDebugState.renderBackend === 'webgpu_direct_render'
        && lastDebugState.sourceAuthority === 'synthetic_fixture'
        && lastDebugState.particleCount > 0
      ) {
        break;
      }
      await delay(250);
    }
    assert.ok(lastDebugState?.childReady, 'childReady false: embedded finger-juice smoke route did not become live');
    assert.equal(lastDebugState.embedRoute, 'kaminos-finger-juice-tab-embed-v0', 'Kaminos tab embed route identity mismatch');
    assert.equal(lastDebugState.sourceAuthority, 'synthetic_fixture', 'current embedded smoke should remain source-honest synthetic fixture evidence');
    assert.equal(lastDebugState.solverBackend, 'webgpu_compute', 'embedded smoke did not use WebGPU compute solver');
    assert.equal(lastDebugState.renderBackend, 'webgpu_direct_render', 'embedded smoke did not use direct WebGPU render');
    assert.ok(lastDebugState.particleCount > 0, 'embedded smoke reported no particles');

    phase = 'capture_full_viewport';
    await delay(settleMs);
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const pngBuffer = Buffer.from(screenshot.data, 'base64');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, pngBuffer);
    primaryOutputWritten = true;
    fullViewportActivityMetrics = measureFullViewportActivity(pngBuffer);
    assert.ok(fullViewportActivityMetrics.activePixels > 0, 'blank frame: no colored finger-juice activity in the embedded Kaminos viewport');
    assert.ok(fullViewportActivityMetrics.activeRatio > 0.025, `blank frame risk: embedded activity ratio too low (${fullViewportActivityMetrics.activeRatio})`);

    phase = 'write_report';
    writeReport({
      ok: true,
      screenshot: out,
      debugState: lastDebugState,
      fullViewportActivityMetrics,
    });
    await ws.close?.();
  } catch (error) {
    writeReport({
      ok: false,
      error: String(error?.stack || error?.message || error),
      screenshot: primaryOutputWritten ? out : null,
    });
    throw error;
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
