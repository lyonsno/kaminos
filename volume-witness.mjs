#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync, inflateSync as zlibInflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-volume-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9433);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-volume-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = args.get('--window-size') || '1280,960';
const routeParams = new URL(url).searchParams;
const VOLUME_SCENE_PRESETS = {
  compact_plume: {},
  tall_plume: {
    fireScale: 0.35,
    detailScale: 3.20,
    plumeHeight: 2.20,
    windStrength: 0,
    windAngle: 0,
    windHeight: 0.15,
  },
  bonfire_plume: {
    fireScale: 0.78,
    detailScale: 2.75,
    plumeHeight: 2.20,
    windStrength: 0,
    windAngle: 0,
    windHeight: 0.15,
  },
};
const requestedVolumeScene = routeParams.get('volume_scene') || 'compact_plume';
const expectedVolumeScene = Object.hasOwn(VOLUME_SCENE_PRESETS, requestedVolumeScene)
  ? requestedVolumeScene
  : 'compact_plume';
const scenePreset = VOLUME_SCENE_PRESETS[expectedVolumeScene] || {};
const requestedGrid = Number(routeParams.get('volume_resolution'));
const expectedGrid = [32, 48, 64, 96, 128, 160].includes(requestedGrid) ? requestedGrid : 96;
const requestedMajorantGrid = Number(routeParams.get('volume_majorant_grid'));
const expectedMajorantGrid = [24, 32, 48].includes(requestedMajorantGrid) ? requestedMajorantGrid : 48;
const requestedGridOverlay = Number(routeParams.get('volume_grid'));
const expectedGridOverlay = Number.isFinite(requestedGridOverlay)
  ? Math.max(0, Math.min(1, requestedGridOverlay))
  : 0;
const RAY_BUDGET_PRESETS = {
  draft: { raySteps: 48, adaptiveRays: 0.80 },
  live: { raySteps: 72, adaptiveRays: 0.65 },
  rich: { raySteps: 96, adaptiveRays: 0.45 },
  hero: { raySteps: 144, adaptiveRays: 0.30 },
};
const rayBudgetPreset = routeParams.get('volume_ray_budget_preset') || '';
const presetBudget = RAY_BUDGET_PRESETS[rayBudgetPreset] || null;
const requestedRaySteps = Number(routeParams.get('volume_steps'));
const expectedRaySteps = routeParams.has('volume_steps') && Number.isFinite(requestedRaySteps)
  ? Math.max(24, Math.min(160, requestedRaySteps))
  : presetBudget?.raySteps ?? 96;
const requestedAdaptiveRays = Number(routeParams.get('volume_adaptive_rays'));
const expectedAdaptiveRays = routeParams.has('volume_adaptive_rays') && Number.isFinite(requestedAdaptiveRays)
  ? Math.max(0, Math.min(1, requestedAdaptiveRays))
  : presetBudget?.adaptiveRays ?? 0.65;
const requestedOccupancySkip = Number(routeParams.get('volume_occupancy_skip'));
const expectedOccupancySkip = routeParams.has('volume_occupancy_skip') && Number.isFinite(requestedOccupancySkip)
  ? Math.max(0, Math.min(1, requestedOccupancySkip))
  : 0.35;
const requestedMajorantSkip = Number(routeParams.get('volume_majorant_skip'));
const expectedMajorantSkip = routeParams.has('volume_majorant_skip') && Number.isFinite(requestedMajorantSkip)
  ? Math.max(0, Math.min(1, requestedMajorantSkip))
  : 0.70;
const requestedMajorantSmooth = Number(routeParams.get('volume_majorant_smooth'));
const expectedMajorantSmooth = routeParams.has('volume_majorant_smooth') && Number.isFinite(requestedMajorantSmooth)
  ? Math.max(0, Math.min(1, requestedMajorantSmooth))
  : 0.85;
const requestedMajorantGuard = Number(routeParams.get('volume_majorant_guard'));
const expectedMajorantGuard = routeParams.has('volume_majorant_guard') && Number.isFinite(requestedMajorantGuard)
  ? Math.max(0, Math.min(1, requestedMajorantGuard))
  : 0.75;
const requestedTemporalAccum = Number(routeParams.get('volume_temporal_accum'));
const expectedTemporalAccum = routeParams.has('volume_temporal_accum') && Number.isFinite(requestedTemporalAccum)
  ? Math.max(0, Math.min(0.85, requestedTemporalAccum))
  : 0.25;
const requestedTemporalJitter = Number(routeParams.get('volume_temporal_jitter'));
const expectedTemporalJitter = routeParams.has('volume_temporal_jitter') && Number.isFinite(requestedTemporalJitter)
  ? Math.max(0, Math.min(1, requestedTemporalJitter))
  : 0.85;
const requestedHistoryClamp = Number(routeParams.get('volume_history_clamp'));
const expectedHistoryClamp = routeParams.has('volume_history_clamp') && Number.isFinite(requestedHistoryClamp)
  ? Math.max(0, Math.min(1, requestedHistoryClamp))
  : 0.70;
const requestedFireScale = Number(routeParams.get('volume_fire_scale'));
const expectedFireScale = routeParams.has('volume_fire_scale') && Number.isFinite(requestedFireScale)
  ? Math.max(0.35, Math.min(1.3, requestedFireScale))
  : scenePreset.fireScale ?? 0.86;
const requestedDetailScale = Number(routeParams.get('volume_detail_scale'));
const expectedDetailScale = routeParams.has('volume_detail_scale') && Number.isFinite(requestedDetailScale)
  ? Math.max(0.45, Math.min(3.2, requestedDetailScale))
  : scenePreset.detailScale ?? 1.75;
const requestedPlumeHeight = Number(routeParams.get('volume_plume_height'));
const expectedPlumeHeight = routeParams.has('volume_plume_height') && Number.isFinite(requestedPlumeHeight)
  ? Math.max(0.7, Math.min(2.2, requestedPlumeHeight))
  : scenePreset.plumeHeight ?? 1.45;
const requestedWindStrength = Number(routeParams.get('volume_wind_strength'));
const expectedWindStrength = routeParams.has('volume_wind_strength') && Number.isFinite(requestedWindStrength)
  ? Math.max(0, Math.min(1.5, requestedWindStrength))
  : scenePreset.windStrength ?? 0;
const requestedWindAngle = Number(routeParams.get('volume_wind_angle'));
const expectedWindAngle = routeParams.has('volume_wind_angle') && Number.isFinite(requestedWindAngle)
  ? Math.max(-180, Math.min(180, requestedWindAngle))
  : scenePreset.windAngle ?? 0;
const requestedWindHeight = Number(routeParams.get('volume_wind_height'));
const expectedWindHeight = routeParams.has('volume_wind_height') && Number.isFinite(requestedWindHeight)
  ? Math.max(-0.8, Math.min(0.8, requestedWindHeight))
  : scenePreset.windHeight ?? 0.15;
const requestedRenderScale = Number(routeParams.get('volume_render_scale'));
const expectedRenderScale = routeParams.has('volume_render_scale') && Number.isFinite(requestedRenderScale)
  ? Math.max(0.6, Math.min(1, requestedRenderScale))
  : 0.85;
const expectedExternalEmitterMode = routeParams.get('volume_external_emitters') || '';

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
  const rows = [];
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, channels, rows };
}

function measureScreenshot(buffer) {
  const png = parsePngRgba(buffer);
  let lit = 0;
  let fireLike = 0;
  let smokeLike = 0;
  let totalLum = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.08); y < Math.floor(png.height * 0.92); y += 2) {
    const row = png.rows[y];
    for (let x = Math.floor(png.width * 0.08); x < Math.floor(png.width * 0.92); x += 2) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLum += lum;
      samples++;
      if (lum > 20) lit++;
      if (r > 120 && g > 70 && b < 80) fireLike++;
      if (b > 28 && g > 28 && r < 95 && Math.abs(g - b) < 55) smokeLike++;
    }
  }
  return {
    width: png.width,
    height: png.height,
    meanLuma: totalLum / Math.max(1, samples),
    litPixels: lit,
    fireLikePixels: fireLike,
    smokeLikePixels: smokeLike,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
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
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
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
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });

  let phase = 'launch';
  try {
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    if (expectedExternalEmitterMode === 'synthetic_hand_trails') {
      await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const prototype = window.__kaminosVolumePrototype;
          const timestampMs = performance.now();
          return prototype?.setExternalEmitters?.({
            mode: 'synthetic_hand_trails',
            frameId: prototype.debugState().frameCount,
            timestampMs,
            coordinateSpace: 'volume-local',
            emitters: prototype.syntheticHandTrailEmitters(timestampMs),
          });
        })()`,
        returnByValue: true,
      });
      await delay(750);
    }
    phase = 'identity';
    let state = null;
    for (let i = 0; i < 40; i++) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosVolumePrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (state?.frameCount > 8) break;
      await delay(250);
    }
    assert.ok(state, 'missing volume debug state');
    assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
    assert.equal(state.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
    assert.equal(state.active, true, 'volume route is not active');
    assert.ok(state.frameCount > 5, 'volume route did not render enough frames');
    assert.equal(state.volumeScene, expectedVolumeScene, 'volume scene route/control did not apply');
    assert.equal(state.controls?.volumeScene, expectedVolumeScene, 'volume scene debug controls did not preserve route identity');
    assert.equal(state.simGrid, expectedGrid, `fluid sim is not running on the expected ${expectedGrid}^3 grid`);
    assert.equal(state.simGridLabel, `${expectedGrid}^3 velocity-material-fire-microdetail-storage-buffer`, 'fluid sim label does not match selected grid');
    assert.ok(Math.abs((state.controls?.gridOverlay || 0) - expectedGridOverlay) < 0.001, 'fluid grid overlay did not apply route/debug state');
    assert.ok(Math.abs((state.controls?.raySteps ?? 0) - expectedRaySteps) < 0.001, 'ray-step route/control did not apply');
    assert.ok(Math.abs((state.controls?.adaptiveRays ?? 0) - expectedAdaptiveRays) < 0.001, 'adaptive raymarch route/control did not apply');
    if (rayBudgetPreset && !routeParams.has('volume_steps') && !routeParams.has('volume_adaptive_rays')) {
      assert.equal(state.controls?.rayBudgetPreset, rayBudgetPreset, 'ray-budget preset route identity was not preserved in debug controls');
    }
    assert.ok(Math.abs((state.adaptiveRaymarch ?? 0) - expectedAdaptiveRays) < 0.001, 'effective adaptive raymarch state did not match route/control');
    assert.ok(Math.abs((state.controls?.occupancySkip ?? 0) - expectedOccupancySkip) < 0.001, 'occupancy skip route/control did not apply');
    assert.ok(Math.abs((state.occupancySkip ?? 0) - expectedOccupancySkip) < 0.001, 'effective occupancy skip state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantSkip ?? 0) - expectedMajorantSkip) < 0.001, 'majorant skip route/control did not apply');
    assert.ok(Math.abs((state.majorantSkip ?? 0) - expectedMajorantSkip) < 0.001, 'effective majorant skip state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantSmooth ?? 0) - expectedMajorantSmooth) < 0.001, 'majorant smooth route/control did not apply');
    assert.ok(Math.abs((state.majorantSmooth ?? 0) - expectedMajorantSmooth) < 0.001, 'effective majorant smooth state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantGuard ?? 0) - expectedMajorantGuard) < 0.001, 'majorant guard route/control did not apply');
    assert.ok(Math.abs((state.majorantGuard ?? 0) - expectedMajorantGuard) < 0.001, 'effective majorant guard state did not match route/control');
    assert.ok(Math.abs((state.controls?.temporalAccum ?? 0) - expectedTemporalAccum) < 0.001, 'temporal accumulation route/control did not apply');
    assert.ok(Math.abs((state.temporalAccum ?? 0) - expectedTemporalAccum) < 0.001, 'effective temporal accumulation state did not match route/control');
    assert.ok(Math.abs((state.controls?.temporalJitter ?? 0) - expectedTemporalJitter) < 0.001, 'temporal jitter route/control did not apply');
    assert.ok(Math.abs((state.temporalJitter ?? 0) - expectedTemporalJitter) < 0.001, 'effective temporal jitter state did not match route/control');
    assert.ok(Math.abs((state.controls?.historyClamp ?? 0) - expectedHistoryClamp) < 0.001, 'temporal history clamp route/control did not apply');
    assert.ok(Math.abs((state.historyClamp ?? 0) - expectedHistoryClamp) < 0.001, 'effective temporal history clamp state did not match route/control');
    assert.ok(Math.abs((state.controls?.fireScale ?? 0) - expectedFireScale) < 0.001, 'fire scale route/control did not apply');
    assert.ok(Math.abs((state.fireScale ?? 0) - expectedFireScale) < 0.001, 'effective fire scale state did not match route/control');
    assert.ok(Math.abs((state.controls?.detailScale ?? 0) - expectedDetailScale) < 0.001, 'detail scale route/control did not apply');
    assert.ok(Math.abs((state.detailScale ?? 0) - expectedDetailScale) < 0.001, 'effective detail scale state did not match route/control');
    assert.ok(Math.abs((state.controls?.plumeHeight ?? 0) - expectedPlumeHeight) < 0.001, 'plume height route/control did not apply');
    assert.ok(Math.abs((state.plumeHeight ?? 0) - expectedPlumeHeight) < 0.001, 'effective plume height state did not match route/control');
    assert.ok(Math.abs((state.controls?.windStrength ?? 0) - expectedWindStrength) < 0.001, 'wind strength route/control did not apply');
    assert.ok(Math.abs((state.windStrength ?? 0) - expectedWindStrength) < 0.001, 'effective wind strength state did not match route/control');
    assert.ok(Math.abs((state.controls?.windAngle ?? 0) - expectedWindAngle) < 0.001, 'wind direction route/control did not apply');
    assert.ok(Math.abs((state.windAngle ?? 0) - expectedWindAngle) < 0.001, 'effective wind direction state did not match route/control');
    assert.ok(Math.abs((state.controls?.windHeight ?? 0) - expectedWindHeight) < 0.001, 'wind height/ramp route/control did not apply');
    assert.ok(Math.abs((state.windHeight ?? 0) - expectedWindHeight) < 0.001, 'effective wind height/ramp state did not match route/control');
    assert.ok(Math.abs((state.controls?.renderScale ?? 0) - expectedRenderScale) < 0.001, 'render scale route/control did not apply');
    assert.ok(Math.abs((state.renderScale ?? 0) - expectedRenderScale) < 0.001, 'effective render scale state did not match route/control');
    assert.ok((state.displayWidth ?? 0) >= (state.renderWidth ?? 0), 'internal render width exceeded display width');
    assert.ok((state.displayHeight ?? 0) >= (state.renderHeight ?? 0), 'internal render height exceeded display height');
    assert.ok(Math.abs((state.renderPixelRatio ?? 0) - expectedRenderScale) < 0.015, 'render-to-display pixel ratio did not match render scale');
    if (expectedExternalEmitterMode) {
      assert.equal(state.externalEmitterMode, expectedExternalEmitterMode, 'external emitter route identity did not apply');
      assert.equal(state.externalEmitterCoordinateSpace, 'volume-local', 'external emitter coordinate space did not reach debug state');
      assert.ok((state.externalEmitterCount ?? 0) > 0, 'external emitter route did not seed any emitters');
      assert.ok(Number.isFinite(state.externalEmitterAgeMs), 'external emitter age did not reach debug state');
    }
    if (expectedTemporalAccum > 0) {
      assert.equal(state.temporalHistoryValid, true, 'temporal history did not become valid after settling');
      assert.ok((state.temporalHistoryFrames ?? 0) > 4, 'temporal history did not accumulate enough frames after settling');
      assert.ok((state.temporalHistoryResetCount ?? 0) >= 1, 'temporal history did not record reset/rejection state');
      assert.ok(Number.isFinite(state.temporalReprojectionConfidence), 'temporal reprojection confidence did not reach debug state');
      assert.ok(Number.isFinite(state.temporalHistoryWeight), 'temporal history weight did not reach debug state');
      assert.ok(Number.isFinite(state.temporalRejectedHistory), 'temporal history rejection did not reach debug state');
      assert.ok(Number.isFinite(state.temporalSmokeHistoryTrust), 'material-aware smoke history trust did not reach debug state');
      assert.ok(Number.isFinite(state.temporalFireHistoryProtect), 'material-aware fire history protection did not reach debug state');
      assert.ok(Number.isFinite(state.temporalInterfaceHistoryProtect), 'material-aware interface history protection did not reach debug state');
      assert.equal(state.temporalEvidenceSource, 'cpu-estimate-control-proxy', 'temporal evidence source label did not reach debug state');
    }
    assert.equal(state.controls?.majorantGrid, expectedMajorantGrid, 'majorant grid route/control did not apply');
    assert.equal(state.majorantGrid, expectedMajorantGrid, 'coarse majorant grid identity did not apply');
    assert.equal(state.majorantBuilt, true, 'coarse majorant field was not built before witness');
    assert.ok(state.simStepCount > 5, 'fluid sim did not advance enough compute steps');
    const stateTiming = state.timing || {};
    assert.equal(stateTiming.timingEvidenceSource, 'raf-and-queue-proxy', 'timing evidence source label did not reach debug state');
    assert.equal(stateTiming.timingDisclaimer, 'not-gpu-exclusive-or-present-latency', 'timing proxy disclaimer did not reach debug state');
    assert.ok(Number.isFinite(stateTiming.rafFps) && stateTiming.rafFps > 0, 'route-local RAF timing did not report a positive cadence');
    assert.ok(Number.isFinite(stateTiming.frameP95Ms) && stateTiming.frameP95Ms > 0, 'route-local frame p95 timing is missing');
    assert.ok(Number.isFinite(stateTiming.cpuFrameMs) && stateTiming.cpuFrameMs >= 0, 'route-local CPU frame timing is missing');

    phase = 'gpu-readback';
    const sampleEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumePrototype.sampleFrame()',
      awaitPromise: true,
      returnByValue: true,
    });
    const sample = sampleEval.result.value;
    if (sample?.ok !== true) {
      throw new Error(`GPU frame readback failed: ${JSON.stringify(sample)}`);
    }
    if (!sample.simReadback || sample.simReadback.grid !== expectedGrid) {
      throw new Error(`GPU sim readback missing expected grid identity: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!sample.majorantReadback || sample.majorantReadback.grid !== expectedMajorantGrid || sample.majorantReadback.occupiedBricks < 2 || sample.majorantReadback.importanceMax <= 0.01) {
      throw new Error(`GPU majorant readback does not show a live coarse occupancy field: ${JSON.stringify(sample.majorantReadback)}`);
    }
    const sampleTiming = sample.timing || stateTiming;
    if (!Number.isFinite(sampleTiming.rafFps) || sampleTiming.rafFps <= 0 || !Number.isFinite(sampleTiming.frameP95Ms) || sampleTiming.frameP95Ms <= 0) {
      throw new Error(`Route-local timing did not survive GPU readback: ${JSON.stringify(sampleTiming)}`);
    }
    if (sampleTiming.queueTimingAvailable === true && sampleTiming.queueSamples > 0) {
      if (!Number.isFinite(sampleTiming.queueDoneMs) || !Number.isFinite(sampleTiming.queueDoneP95Ms)) {
        throw new Error(`GPU queue completion timing was sampled but did not report finite latency: ${JSON.stringify(sampleTiming)}`);
      }
    }
    if (sample.simReadback.densityMax <= 0.01 || sample.simReadback.velocityMean <= 0.001 || sample.simReadback.liveVoxels < 8) {
      throw new Error(`GPU sim readback does not show live fluid state: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.detailMean) || sample.simReadback.detailMean <= 0.0005) {
      throw new Error(`GPU sim readback does not show transported material detail: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.fireLayerMean) || sample.simReadback.fireLayerMean <= 0.0005) {
      throw new Error(`GPU sim readback does not show a transported fire layer: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.radianceMean) || sample.simReadback.radianceMean <= 0.0005) {
      throw new Error(`GPU sim readback does not show fire radiance evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.extinctionMean) || sample.simReadback.extinctionMean <= 0.0005) {
      throw new Error(`GPU sim readback does not show smoke extinction evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.microdetailMean) || sample.simReadback.microdetailMean <= 0.0005) {
      throw new Error(`GPU sim readback does not show transported microdetail: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.interfaceShredMean) || sample.simReadback.interfaceShredMean <= 0.00025) {
      throw new Error(`GPU sim readback does not show interface shredding: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.fireLickMean) || sample.simReadback.fireLickMean <= 0.00025) {
      throw new Error(`GPU sim readback does not show fire-lick breakup: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.curlMean) || sample.simReadback.curlMax <= 0.0005) {
      throw new Error(`GPU sim readback does not show curl/vorticity evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!Number.isFinite(sample.simReadback.divergenceMean) || !Number.isFinite(sample.simReadback.divergenceMax)) {
      throw new Error(`GPU sim readback does not show divergence/projection evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    const metrics = {
      width: sample.width,
      height: sample.height,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      emissiveLikePixels: sample.emissiveLikePixels,
      smokeLikePixels: sample.smokeLikePixels,
      volumeBounds: sample.volumeBounds,
      fireBounds: sample.fireBounds,
      smokeBounds: sample.smokeBounds,
      verticalFillRatio: sample.volumeBounds?.verticalFillRatio ?? 0,
    };
    writeRgbaPng(out, sample.preview.width, sample.preview.height, sample.preview.rgba);
    const captureBackend = 'webgpu-copy-src-readback';
    if (metrics.litPixels < 1500 || metrics.fireLikePixels < 300 || metrics.emissiveLikePixels < 80 || metrics.meanLuma < 8) {
      throw new Error(`blank frame or missing fire volume: ${JSON.stringify(metrics)}`);
    }
    const reportControls = {
      ...(state.controls || {}),
      rayBudgetPreset: state.controls?.rayBudgetPreset || rayBudgetPreset,
    };
    const report = {
      requestedRoute: url,
      settleMs,
      windowSize,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      captureBackend,
      frameCount: state.frameCount,
      simStepCount: sample.simStepCount,
      simGrid: sample.simGrid,
      simGridLabel: sample.simGridLabel,
      simReadback: sample.simReadback,
      majorantReadback: sample.majorantReadback,
      gridOverlay: sample.gridOverlay,
      raySteps: state.controls?.raySteps,
      volumeScene: sample.volumeScene,
      expectedVolumeScene,
      adaptiveRaymarch: sample.adaptiveRaymarch,
      occupancySkip: sample.occupancySkip,
      majorantSkip: sample.majorantSkip,
      majorantSmooth: sample.majorantSmooth,
      majorantGuard: sample.majorantGuard,
      temporalAccum: sample.temporalAccum,
      temporalJitter: sample.temporalJitter,
      historyClamp: sample.historyClamp,
      fireScale: sample.fireScale,
      detailScale: sample.detailScale,
      plumeHeight: sample.plumeHeight,
      windStrength: sample.windStrength,
      windAngle: sample.windAngle,
      windHeight: sample.windHeight,
      expectedFireScale,
      expectedDetailScale,
      expectedPlumeHeight,
      expectedWindStrength,
      expectedWindAngle,
      expectedWindHeight,
      expectedRenderScale,
      renderScale: sample.renderScale,
      renderPixelRatio: sample.renderPixelRatio,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
      renderWidth: sample.renderWidth,
      renderHeight: sample.renderHeight,
      volumeReconstructionStyle: sample.volumeReconstructionStyle,
      externalEmitterMode: sample.externalEmitterMode,
      externalEmitterCoordinateSpace: sample.externalEmitterCoordinateSpace,
      externalEmitterCount: sample.externalEmitterCount,
      externalEmitterAgeMs: sample.externalEmitterAgeMs,
      externalEmitterFrameId: sample.externalEmitterFrameId,
      temporalAccumEffective: sample.temporalAccumEffective,
      temporalReprojectionConfidence: sample.temporalReprojectionConfidence,
      temporalHistoryWeight: sample.temporalHistoryWeight,
      temporalRejectedHistory: sample.temporalRejectedHistory,
      temporalSmokeHistoryTrust: sample.temporalSmokeHistoryTrust,
      temporalFireHistoryProtect: sample.temporalFireHistoryProtect,
      temporalInterfaceHistoryProtect: sample.temporalInterfaceHistoryProtect,
      temporalEvidenceSource: sample.temporalEvidenceSource,
      temporalHistoryFrames: sample.temporalHistoryFrames,
      temporalHistoryResetCount: sample.temporalHistoryResetCount,
      temporalHistoryResetReason: sample.temporalHistoryResetReason,
      temporalHistoryValid: sample.temporalHistoryValid,
      majorantGrid: sample.majorantGrid,
      majorantBuilt: sample.majorantBuilt,
      rayBudgetPreset: reportControls.rayBudgetPreset,
      timing: sample.timing || stateTiming,
      timingEvidenceSource: (sample.timing || stateTiming).timingEvidenceSource,
      timingDisclaimer: (sample.timing || stateTiming).timingDisclaimer,
      controls: reportControls,
      screenshot: out,
      metrics,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    let state = null;
    try {
      const targets = await cdpFetch('/json/list');
      const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await waitForWebSocketOpen(ws);
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosVolumePrototype?.debugState?.()',
          returnByValue: true,
        });
        state = stateEval.result.value || null;
        ws.close();
      }
    } catch {
      state = null;
    }
    const report = {
      requestedRoute: url,
      windowSize,
      phase,
      error: err?.message || String(err),
      state,
      screenshot: out,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
