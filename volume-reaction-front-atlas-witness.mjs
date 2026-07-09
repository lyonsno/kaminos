#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8137/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_resolution=96&volume_fire_render_mode=off&volume_fire=0';
const out = resolve(args.get('--out') || '/tmp/kaminos-reaction-front-atlas.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const minFrames = Number(args.get('--min-frames') || 4);
const settleMs = Number(args.get('--settle-ms') || 2400);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-reaction-front-atlas-profile-${port}-${process.pid}`;
const windowSize = args.get('--window-size') || '1280,960';

let phase = 'initializing';
let primaryOutputWritten = false;
let lastDebugState = null;
let sampleSummary = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.volume-reaction-front-atlas-witness.v0',
    requestedRoute: url,
    effectiveRoute: lastDebugState?.effectiveRoute || sampleSummary?.effectiveRoute || null,
    minFrames,
    settleMs,
    debugPort: port,
    chrome,
    userDataDir,
    windowSize,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    atlasPng: primaryOutputWritten ? out : null,
    consoleEvents,
    lastDebugState,
    sampleSummary,
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
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

async function waitForPage() {
  for (let i = 0; i < 80; i += 1) {
    const targets = await cdpFetch('/json/list');
    const page = targets.find(item => item.type === 'page' && item.url.includes('kaminos_volume_smoke=1'))
      || targets.find(item => item.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(125);
  }
  throw new Error('No debuggable page target');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 30000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
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

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
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
  mkdirSync(dirname(path), { recursive: true });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function assertReactionFrontAtlas(atlas) {
  assert.equal(atlas?.schema, 'kaminos.volume.reaction-front-atlas.v0', 'reactionFrontAtlas schema mismatch');
  assert.equal(atlas?.stageIdentity, 'reaction-front-stage-fields-v0', 'reactionFrontAtlas stage identity mismatch');
  assert.equal(atlas?.mode, 'reaction-front-stage-max-z-projection', 'reactionFrontAtlas projection mode mismatch');
  assert.ok(Number.isFinite(atlas.width) && atlas.width > 0, 'reactionFrontAtlas width missing');
  assert.ok(Number.isFinite(atlas.height) && atlas.height > 0, 'reactionFrontAtlas height missing');
  assert.equal(atlas.rgba?.length, atlas.width * atlas.height * 4, 'reactionFrontAtlas RGBA length mismatch');
  const requiredPanels = [
    'heatSupport',
    'fuelSupport',
    'flameSupport',
    'combustionFrontSupport',
    'reactionPotential',
    'gradientMagnitude',
    'narrowFrontCandidate',
    'coreReject',
    'topologyWrinkle',
    'shellCandidate',
  ];
  const panelKeys = new Set((atlas.panels || []).map(panel => panel.key));
  for (const key of requiredPanels) {
    assert.ok(panelKeys.has(key), `reactionFrontAtlas missing panel ${key}`);
    assert.ok(atlas.stageStats?.[key], `reactionFrontAtlas missing stats for ${key}`);
  }
  return requiredPanels;
}

async function main() {
  mkdirSync(dirname(reportPath), { recursive: true });
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });

  try {
    phase = 'launch';
    await waitForCdp();
    phase = 'target';
    const page = await waitForPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);

    phase = 'state';
    for (let i = 0; i < 80; i += 1) {
      lastDebugState = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
      if (lastDebugState?.frameCount >= minFrames) break;
      await delay(250);
    }
    assert.ok(lastDebugState, 'missing volume debug state');
    assert.equal(lastDebugState.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
    assert.equal(lastDebugState.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
    assert.equal(lastDebugState.active, true, 'volume route is not active');
    assert.ok(lastDebugState.frameCount >= minFrames, `volume route rendered ${lastDebugState.frameCount || 0} frames`);

    phase = 'sample-frame';
    const sample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
    assert.equal(sample?.ok, true, `sampleFrame failed: ${sample?.reason || 'unknown'}`);
    const reactionFrontAtlas = sample?.simReadback?.reactionFrontAtlas;
    const panelKeys = assertReactionFrontAtlas(reactionFrontAtlas);
    writeRgbaPng(out, reactionFrontAtlas.width, reactionFrontAtlas.height, reactionFrontAtlas.rgba);
    primaryOutputWritten = true;
    sampleSummary = {
      effectiveRoute: sample.effectiveRoute,
      frameCount: sample.frameCount,
      simStepCount: sample.simStepCount,
      simGrid: sample.simGrid,
      simGridLabel: sample.simGridLabel,
      frontFieldIdentity: sample.frontFieldIdentity,
      reactionFrontStageIdentity: sample.simReadback?.reactionFrontStageIdentity,
      atlasIdentity: reactionFrontAtlas.identity,
      atlasSchema: reactionFrontAtlas.schema,
      atlasMode: reactionFrontAtlas.mode,
      atlasWidth: reactionFrontAtlas.width,
      atlasHeight: reactionFrontAtlas.height,
      labelOverlay: reactionFrontAtlas.labelOverlay === true,
      panels: panelKeys,
      stageStats: reactionFrontAtlas.stageStats,
    };
    phase = 'done';
    writeReport({ ok: true, failure_phase: null, atlasPng: out });
  } catch (error) {
    writeReport({ ok: false, error: error?.message || String(error) });
    throw error;
  } finally {
    proc.kill();
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
