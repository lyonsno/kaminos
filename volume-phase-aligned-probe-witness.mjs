#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const PHASE_ALIGNED_DEFAULTS = {
  defaultGrid: 128,
  referenceGrid: 160,
  basinIdentity: 'boundary_fire_bonfire_a_la_ruffles_0709',
  downsampleOperatorIdentity: 'pending-vivisector-phase-aligned-corpus-downsample-operator-v0',
  bakeDataAvailable: false,
  bakeDataIdentity: null,
};

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const requestedGrid = Number(args.get('--grid') || PHASE_ALIGNED_DEFAULTS.defaultGrid);
const referenceGrid = Number(args.get('--reference-grid') || PHASE_ALIGNED_DEFAULTS.referenceGrid);
const expectedFireRenderMode = (args.get('--expected-fire-render-mode') || 'inspect').replace(/-/g, '_');
const url = args.get('--url') || [
  'http://127.0.0.1:8137/?kaminos_volume_smoke=1',
  `volume_tall_preset=${PHASE_ALIGNED_DEFAULTS.basinIdentity}`,
  `volume_resolution=${requestedGrid}`,
  `volume_fire_render_mode=${expectedFireRenderMode}`,
  'volume_reaction_live_view=boundary_fire',
].join('&');
const out = resolve(args.get('--out') || '/tmp/kaminos-phase-aligned-probe-preview.png');
const atlasOut = resolve(args.get('--atlas-out') || out.replace(/\.png$/i, '.reaction-atlas.png'));
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const minFrames = Number(args.get('--min-frames') || 4);
const settleMs = Number(args.get('--settle-ms') || 2600);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-phase-aligned-probe-profile-${port}-${process.pid}`;
const windowSize = args.get('--window-size') || '1280,960';

let phase = 'initializing';
let primaryOutputWritten = false;
let atlasOutputWritten = false;
let lastDebugState = null;
let sampleSummary = null;
let visualEvidence = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.volume.phase-aligned-probe-witness.v0',
    requestedRoute: url,
    effectiveRoute: lastDebugState?.effectiveRoute || sampleSummary?.effectiveRoute || null,
    basinIdentity: PHASE_ALIGNED_DEFAULTS.basinIdentity,
    requestedGrid,
    effectiveGrid: sampleSummary?.effectiveGrid ?? lastDebugState?.simGrid ?? null,
    defaultGrid: PHASE_ALIGNED_DEFAULTS.defaultGrid,
    referenceGrid,
    expectedFireRenderMode,
    bakeDataAvailable: false,
    bakeDataIdentity: null,
    downsampleOperatorIdentity: PHASE_ALIGNED_DEFAULTS.downsampleOperatorIdentity,
    visualInspectionRequired: true,
    minFrames,
    settleMs,
    debugPort: port,
    chrome,
    userDataDir,
    windowSize,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    previewPng: primaryOutputWritten ? out : null,
    reactionAtlasPng: atlasOutputWritten ? atlasOut : null,
    consoleEvents,
    lastDebugState,
    sampleSummary,
    visualEvidence,
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

function assertPreview(sample) {
  assert.ok(sample?.preview?.rgba, `sampleFrame did not return preview pixels: ${JSON.stringify({
    ok: sample?.ok,
    reason: sample?.reason,
    width: sample?.preview?.width,
    height: sample?.preview?.height,
  })}`);
  assert.equal(sample.preview.rgba.length, sample.preview.width * sample.preview.height * 4, 'preview RGBA length mismatch');
  return sample.preview;
}

function assertReactionFrontAtlas(atlas) {
  assert.equal(atlas?.schema, 'kaminos.volume.reaction-front-atlas.v0', 'reactionFrontAtlas schema mismatch');
  assert.equal(atlas?.stageIdentity, 'reaction-front-stage-fields-v0', 'reactionFrontAtlas stage identity mismatch');
  assert.equal(atlas?.mode, 'reaction-front-stage-max-z-projection', 'reactionFrontAtlas projection mode mismatch');
  assert.equal(atlas?.rgba?.length, atlas.width * atlas.height * 4, 'reactionFrontAtlas RGBA length mismatch');
  assert.ok(atlas.stageStats?.shellCandidate, 'reactionFrontAtlas missing shellCandidate stats');
  return atlas;
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
    assert.equal(lastDebugState.fireRenderMode, expectedFireRenderMode, 'phase-aligned witness fire render mode did not match route');

    phase = 'sample-frame';
    const sample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
    assert.equal(sample?.ok, true, `sampleFrame failed: ${sample?.reason || 'unknown'}`);
    assert.equal(sample.simReadback?.grid, requestedGrid, 'sampleFrame grid does not match requested phase-aligned witness grid');
    const preview = assertPreview(sample);
    const reactionFrontAtlas = assertReactionFrontAtlas(sample.simReadback?.reactionFrontAtlas);
    writeRgbaPng(out, preview.width, preview.height, preview.rgba);
    primaryOutputWritten = true;
    writeRgbaPng(atlasOut, reactionFrontAtlas.width, reactionFrontAtlas.height, reactionFrontAtlas.rgba);
    atlasOutputWritten = true;

    const carrierDebug = lastDebugState.pyroMaterialRendererCoupling?.carrierDebug || {};
    sampleSummary = {
      effectiveRoute: sample.effectiveRoute,
      frameCount: sample.frameCount,
      simStepCount: sample.simStepCount,
      simGrid: sample.simGrid,
      simGridLabel: sample.simGridLabel,
      effectiveGrid: sample.simReadback?.grid ?? null,
      frontFieldIdentity: sample.frontFieldIdentity,
      reactionFrontStageIdentity: sample.simReadback?.reactionFrontStageIdentity,
      topologyShellIdentity: carrierDebug.topologyShellIdentity || null,
      topologyShellAuthority: carrierDebug.topologyShellAuthority || null,
      fireRenderMode: lastDebugState.fireRenderMode,
      reactionLiveView: lastDebugState.reactionLiveView || lastDebugState.controls?.reactionLiveView || null,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      smokeLikePixels: sample.smokeLikePixels,
      reactionFrontAtlas: {
        identity: reactionFrontAtlas.identity,
        schema: reactionFrontAtlas.schema,
        stageIdentity: reactionFrontAtlas.stageIdentity,
        mode: reactionFrontAtlas.mode,
        width: reactionFrontAtlas.width,
        height: reactionFrontAtlas.height,
        controls: reactionFrontAtlas.controls,
        shellCandidateStats: reactionFrontAtlas.stageStats?.shellCandidate,
      },
    };
    visualEvidence = {
      previewPng: out,
      reactionAtlasPng: atlasOut,
      note: 'Inspect both images before using this witness as visual evidence; nonblank route proof is not model progress.',
    };

    phase = 'done';
    writeReport({ ok: true, failure_phase: null });
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
