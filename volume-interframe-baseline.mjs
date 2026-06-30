#!/usr/bin/env node
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const EVIDENCE_SCHEMA = 'kaminos.volume.interframe-baseline.v0';
const TRIPLET_SCHEMA = 'kaminos.volume.interframe-triplet.v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const TRIPLET_AUTHORITY = 'same-route-live-sequence';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const HOLD_LAST_BASELINE_ID = 'hold-last-rgba-v0';
const HOLD_NEXT_BASELINE_ID = 'hold-next-rgba-v0';
const MIDPOINT_BASELINE_ID = 'pixel-midpoint-rgba-v0';
const BLOCK_MATCH_BASELINE_ID = 'block-match-bidirectional-warp-rgba-v0';
const BASELINE_IDS = [
  HOLD_LAST_BASELINE_ID,
  HOLD_NEXT_BASELINE_ID,
  MIDPOINT_BASELINE_ID,
  BLOCK_MATCH_BASELINE_ID,
];
const FAILURE_MODE_BUCKETS = [
  'ghosting',
  'smearing',
  'topology-lie',
  'snuff-quench-miss',
  'low-fire-shimmer',
  'broad-smoke-mush',
];
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function cdpFetchFactory(port) {
  return async function cdpFetch(path, options) {
    const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
    if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
    return resp.json();
  };
}

async function waitForCdp(cdpFetch) {
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
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
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

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG');
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
      assert.equal(data[8], 8, 'only 8-bit PNG is supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let p = 0;
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
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = row[src];
      rgba[dst + 1] = row[src + 1];
      rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}

function assertSamplePreview(sample, label) {
  if (
    sample?.ok !== true ||
    !Number.isFinite(sample.preview?.width) ||
    !Number.isFinite(sample.preview?.height) ||
    !Array.isArray(sample.preview?.rgba) ||
    sample.preview.rgba.length !== sample.preview.width * sample.preview.height * 4
  ) {
    const error = new Error(`${label} sample missing complete preview RGBA`);
    error.code = 'missing-primary-output';
    error.failurePhase = 'sample';
    error.details = { label, sample };
    throw error;
  }
}

function summarizeSample(sample, role, path) {
  return {
    role,
    path,
    frameCount: sample.frameCount,
    simStepCount: sample.simStepCount,
    width: sample.preview.width,
    height: sample.preview.height,
    renderWidth: sample.renderWidth,
    renderHeight: sample.renderHeight,
    displayWidth: sample.displayWidth,
    displayHeight: sample.displayHeight,
    renderScale: sample.renderScale,
    renderPixelRatio: sample.renderPixelRatio,
    volumeReconstructionStyle: sample.volumeReconstructionStyle,
    effectiveRoute: sample.effectiveRoute,
    prototypeIdentity: sample.prototypeIdentity,
    backend: sample.backend,
    volumeScene: sample.volumeScene,
    lifecycleEffect: sample.lifecycleEffect,
    lifecycleT: sample.lifecycleT,
    quenchVaporStrength: sample.quenchVaporStrength,
    snuffVisualModel: sample.snuffVisualModel,
    flameQuenchModel: sample.flameQuenchModel,
    simGrid: sample.simGrid,
    pressureStrategy: sample.pressureStrategy,
    pressureProjectionIterations: sample.pressureProjectionIterations,
    timing: sample.timing || null,
    simCostLedger: sample.simCostLedger || null,
    metrics: {
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      emissiveLikePixels: sample.emissiveLikePixels,
      smokeLikePixels: sample.smokeLikePixels,
      fireRoughnessMean: sample.fireRoughnessMean,
      fireEdgeEnergy: sample.fireEdgeEnergy,
      smokeVerticalStripeRatio: sample.smokeVerticalStripeRatio,
      volumeBounds: sample.volumeBounds,
      fireBounds: sample.fireBounds,
      smokeBounds: sample.smokeBounds,
    },
    simReadback: sample.simReadback ? {
      densityMean: sample.simReadback.densityMean,
      densityMax: sample.simReadback.densityMax,
      velocityMean: sample.simReadback.velocityMean,
      fireLayerMean: sample.simReadback.fireLayerMean,
      radianceMean: sample.simReadback.radianceMean,
      fuelMean: sample.simReadback.fuelMean,
      reactionMean: sample.simReadback.reactionMean,
      fuelConsumptionMean: sample.simReadback.fuelConsumptionMean,
      fireFuelOverlapRatio: sample.simReadback.fireFuelOverlapRatio,
      smokeVisualRiseVelocity: sample.simReadback.smokeVisualRiseVelocity,
      fireVisualRiseVelocity: sample.simReadback.fireVisualRiseVelocity,
      plumeFieldColumnCoherence: sample.simReadback.plumeFieldColumnCoherence,
      plumeFieldBinCenterSpread: sample.simReadback.plumeFieldBinCenterSpread,
    } : null,
  };
}

function midpointRgba(first, third) {
  const out = new Uint8Array(first.length);
  for (let i = 0; i < first.length; i += 1) out[i] = Math.round((first[i] + third[i]) / 2);
  return out;
}

function cloneRgba(source) {
  return Uint8Array.from(source);
}

function lumaAt(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
}

function blockMatchCost(first, third, width, height, x, y, dx, dy, blockSize) {
  let cost = 0;
  let samples = 0;
  for (let by = 0; by < blockSize; by += 2) {
    const y0 = y + by;
    const y2 = y + dy + by;
    if (y0 < 0 || y0 >= height || y2 < 0 || y2 >= height) continue;
    for (let bx = 0; bx < blockSize; bx += 2) {
      const x0 = x + bx;
      const x2 = x + dx + bx;
      if (x0 < 0 || x0 >= width || x2 < 0 || x2 >= width) continue;
      const d = lumaAt(first, width, x0, y0) - lumaAt(third, width, x2, y2);
      cost += d * d;
      samples += 1;
    }
  }
  return samples ? cost / samples : Number.POSITIVE_INFINITY;
}

function blockMatchBidirectionalWarpRgba(first, third, width, height, options = {}) {
  const blockSize = Number(options.blockSize || 8);
  const searchRadius = Number(options.searchRadius || 14);
  const searchStep = Number(options.searchStep || 2);
  const fallback = midpointRgba(first, third);
  const accum = new Float64Array(first.length);
  const weights = new Uint16Array(width * height);
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let bestDx = 0;
      let bestDy = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let dy = -searchRadius; dy <= searchRadius; dy += searchStep) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += searchStep) {
          const cost = blockMatchCost(first, third, width, height, x, y, dx, dy, blockSize);
          if (cost < bestCost) {
            bestCost = cost;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      const halfDx = Math.round(bestDx / 2);
      const halfDy = Math.round(bestDy / 2);
      for (let by = 0; by < blockSize; by += 1) {
        for (let bx = 0; bx < blockSize; bx += 1) {
          const x0 = x + bx;
          const y0 = y + by;
          const x2 = x0 + bestDx;
          const y2 = y0 + bestDy;
          const xm = x0 + halfDx;
          const ym = y0 + halfDy;
          if (x0 < 0 || x0 >= width || y0 < 0 || y0 >= height) continue;
          if (x2 < 0 || x2 >= width || y2 < 0 || y2 >= height) continue;
          if (xm < 0 || xm >= width || ym < 0 || ym >= height) continue;
          const src0 = (y0 * width + x0) * 4;
          const src2 = (y2 * width + x2) * 4;
          const dst = (ym * width + xm) * 4;
          const weightIndex = ym * width + xm;
          for (let c = 0; c < 4; c += 1) {
            accum[dst + c] += (first[src0 + c] + third[src2 + c]) / 2;
          }
          weights[weightIndex] += 1;
        }
      }
    }
  }
  const out = new Uint8Array(first.length);
  for (let i = 0; i < weights.length; i += 1) {
    const dst = i * 4;
    const weight = weights[i];
    if (weight > 0) {
      out[dst] = Math.round(accum[dst] / weight);
      out[dst + 1] = Math.round(accum[dst + 1] / weight);
      out[dst + 2] = Math.round(accum[dst + 2] / weight);
      out[dst + 3] = 255;
    } else {
      out[dst] = fallback[dst];
      out[dst + 1] = fallback[dst + 1];
      out[dst + 2] = fallback[dst + 2];
      out[dst + 3] = 255;
    }
  }
  return out;
}

function differenceRgba(actual, synthetic) {
  const out = new Uint8Array(actual.length);
  for (let i = 0; i < actual.length; i += 4) {
    const dr = Math.abs(actual[i] - synthetic[i]);
    const dg = Math.abs(actual[i + 1] - synthetic[i + 1]);
    const db = Math.abs(actual[i + 2] - synthetic[i + 2]);
    out[i] = dr;
    out[i + 1] = dg;
    out[i + 2] = db;
    out[i + 3] = 255;
  }
  return out;
}

function compareRgba(actual, synthetic, width, height) {
  let absolute = 0;
  let squared = 0;
  let maxChannelError = 0;
  let highErrorPixels = 0;
  let fireWeightedAbsolute = 0;
  let fireWeight = 0;
  let smokeWeightedAbsolute = 0;
  let smokeWeight = 0;
  const channels = width * height * 3;
  for (let i = 0; i < actual.length; i += 4) {
    const r = actual[i];
    const g = actual[i + 1];
    const b = actual[i + 2];
    const sr = synthetic[i];
    const sg = synthetic[i + 1];
    const sb = synthetic[i + 2];
    const dr = Math.abs(r - sr);
    const dg = Math.abs(g - sg);
    const db = Math.abs(b - sb);
    const pixelError = (dr + dg + db) / 3;
    absolute += dr + dg + db;
    squared += dr * dr + dg * dg + db * db;
    maxChannelError = Math.max(maxChannelError, dr, dg, db);
    if (pixelError > 32) highErrorPixels += 1;
    const fireLike = r > 120 && g > 70 && b < 95;
    const smokeLike = b > 28 && g > 28 && r < 110 && Math.abs(g - b) < 65;
    if (fireLike) {
      fireWeightedAbsolute += pixelError;
      fireWeight += 1;
    }
    if (smokeLike) {
      smokeWeightedAbsolute += pixelError;
      smokeWeight += 1;
    }
  }
  const meanAbsoluteError = absolute / Math.max(1, channels);
  const rootMeanSquaredError = Math.sqrt(squared / Math.max(1, channels));
  return {
    meanAbsoluteError,
    rootMeanSquaredError,
    maxChannelError,
    highErrorPixelRatio: highErrorPixels / Math.max(1, width * height),
    fireRegionMeanAbsoluteError: fireWeightedAbsolute / Math.max(1, fireWeight),
    smokeRegionMeanAbsoluteError: smokeWeightedAbsolute / Math.max(1, smokeWeight),
    firePixelCount: fireWeight,
    smokePixelCount: smokeWeight,
  };
}

function classifyFailureModes(metrics, triplet) {
  const modes = [];
  if (metrics.highErrorPixelRatio > 0.12) modes.push('ghosting');
  if (metrics.meanAbsoluteError > 18 || metrics.rootMeanSquaredError > 28) modes.push('smearing');
  if (metrics.fireRegionMeanAbsoluteError > Math.max(14, metrics.meanAbsoluteError * 1.18)) modes.push('topology-lie');
  const middle = triplet.actualMiddle?.simReadback || {};
  if (
    (triplet.actualMiddle?.lifecycleEffect === 'snuff' || triplet.actualMiddle?.quenchVaporStrength > 0) &&
    metrics.fireRegionMeanAbsoluteError > 18
  ) {
    modes.push('snuff-quench-miss');
  }
  if ((middle.fireLayerMean || 0) < 0.01 && metrics.fireRegionMeanAbsoluteError > 10) modes.push('low-fire-shimmer');
  if (metrics.smokeRegionMeanAbsoluteError > Math.max(12, metrics.meanAbsoluteError * 1.10)) modes.push('broad-smoke-mush');
  return modes.length ? modes : ['no-obvious-bucket-from-cheap-metrics'];
}

function blitTile(sheet, sheetWidth, tile, tileWidth, tileHeight, dstX, dstY, barColor) {
  for (let y = 0; y < tileHeight; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const src = (y * tileWidth + x) * 4;
      const dst = ((dstY + y) * sheetWidth + dstX + x) * 4;
      sheet[dst] = tile[src];
      sheet[dst + 1] = tile[src + 1];
      sheet[dst + 2] = tile[src + 2];
      sheet[dst + 3] = 255;
    }
  }
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const dst = ((dstY + y) * sheetWidth + dstX + x) * 4;
      sheet[dst] = barColor[0];
      sheet[dst + 1] = barColor[1];
      sheet[dst + 2] = barColor[2];
      sheet[dst + 3] = 255;
    }
  }
}

function writeContactSheet(path, width, height, tiles) {
  const columns = 3;
  const rows = Math.ceil(tiles.length / columns);
  const gap = 6;
  const sheetWidth = columns * width + (columns + 1) * gap;
  const sheetHeight = rows * height + (rows + 1) * gap;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let i = 0; i < sheet.length; i += 4) {
    sheet[i] = 8;
    sheet[i + 1] = 8;
    sheet[i + 2] = 8;
    sheet[i + 3] = 255;
  }
  const tileOrder = [];
  tiles.forEach((tile, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const dstX = gap + col * (width + gap);
    const dstY = gap + row * (height + gap);
    blitTile(sheet, sheetWidth, tile.rgba, width, height, dstX, dstY, tile.barColor || [120, 120, 120]);
    tileOrder.push({
      index,
      row,
      col,
      label: tile.label,
      path: tile.path || null,
      baselineId: tile.baselineId || null,
      role: tile.role || null,
      barColor: tile.barColor || [120, 120, 120],
    });
  });
  writeRgbaPng(path, sheetWidth, sheetHeight, sheet);
  return {
    path,
    width: sheetWidth,
    height: sheetHeight,
    tileColumns: columns,
    tileRows: rows,
    tileOrder,
  };
}

function baselineRgba(id, first, third, width, height) {
  if (id === HOLD_LAST_BASELINE_ID) return cloneRgba(first);
  if (id === HOLD_NEXT_BASELINE_ID) return cloneRgba(third);
  if (id === MIDPOINT_BASELINE_ID) return midpointRgba(first, third);
  if (id === BLOCK_MATCH_BASELINE_ID) return blockMatchBidirectionalWarpRgba(first, third, width, height);
  throw new Error(`Unknown baseline id ${id}`);
}

async function currentDebugState(ws) {
  const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype?.debugState?.()',
    returnByValue: true,
  });
  return stateEval.result.value;
}

async function waitForFrame(ws, minimumFrameCount) {
  for (let i = 0; i < 120; i += 1) {
    const state = await currentDebugState(ws);
    if (state?.frameCount >= minimumFrameCount) return state;
    await delay(100);
  }
  const error = new Error(`timed out waiting for frameCount >= ${minimumFrameCount}`);
  error.code = 'frame-wait-timeout';
  error.failurePhase = 'capture';
  error.details = { minimumFrameCount };
  throw error;
}

async function captureSample(ws, label, minimumFrameCount) {
  await waitForFrame(ws, minimumFrameCount);
  const sampleEval = await wsRequest(ws, 'Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype.sampleFrame()',
    awaitPromise: true,
    returnByValue: true,
  });
  const sample = sampleEval.result.value;
  assertSamplePreview(sample, label);
  if (sample.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID || sample.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`wrong route identity in ${label}: ${sample.effectiveRoute || 'none'} / ${sample.prototypeIdentity || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'validation';
    error.details = {
      label,
      expectedRoute: EXPECTED_VOLUME_ROUTE_ID,
      effectiveRoute: sample.effectiveRoute,
      expectedPrototype: EXPECTED_PROTOTYPE_ID,
      prototypeIdentity: sample.prototypeIdentity,
    };
    throw error;
  }
  return sample;
}

function validateTriplet(samples) {
  const [t0, actualMiddle, t2] = samples;
  const dimensions = samples.map(sample => `${sample.preview.width}x${sample.preview.height}`);
  if (new Set(dimensions).size !== 1) {
    const error = new Error(`triplet preview dimensions changed across samples: ${dimensions.join(', ')}`);
    error.code = 'dimension-drift';
    error.failurePhase = 'validation';
    error.details = { dimensions };
    throw error;
  }
  if (!(t0.frameCount < actualMiddle.frameCount && actualMiddle.frameCount < t2.frameCount)) {
    const error = new Error('triplet frame counts are not strictly increasing');
    error.code = 'stale-or-cached-output';
    error.failurePhase = 'validation';
    error.details = {
      frameCounts: samples.map(sample => sample.frameCount),
      simStepCounts: samples.map(sample => sample.simStepCount),
    };
    throw error;
  }
  if (!(t0.simStepCount < actualMiddle.simStepCount && actualMiddle.simStepCount < t2.simStepCount)) {
    const error = new Error('triplet sim step counts are not strictly increasing');
    error.code = 'stale-or-cached-output';
    error.failurePhase = 'validation';
    error.details = {
      frameCounts: samples.map(sample => sample.frameCount),
      simStepCounts: samples.map(sample => sample.simStepCount),
    };
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-interframe-baseline');
const reportPath = resolve(args.get('--report') || `${outDir}/interframe-baseline-report.json`);
const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
const port = Number(args.get('--debug-port') || 9630);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-interframe-baseline-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 5000);
const frameStride = Number(args.get('--frame-stride') || 12);
const windowSize = args.get('--window-size') || '1280,960';
const dryRun = args.has('--dry-run');
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');
const artifactPaths = {
  t0: resolve(outDir, 'triplet-t0.png'),
  actualMiddle: resolve(outDir, 'triplet-t1-actual-middle.png'),
  t2: resolve(outDir, 'triplet-t2.png'),
  contactSheet: resolve(outDir, 'interframe-baseline-contact-sheet.png'),
  baselines: Object.fromEntries(BASELINE_IDS.map(id => [id, {
    syntheticMiddle: resolve(outDir, `${id}-synthetic-middle.png`),
    difference: resolve(outDir, `${id}-error.png`),
  }])),
};

const baseReport = {
  schema: EVIDENCE_SCHEMA,
  status: dryRun ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  requestedRoute: baseUrl,
  outDir,
  reportPath,
  dryRun,
  settleMs,
  frameStride,
  windowSize,
  debugPort: port,
  triplet: {
    schema: TRIPLET_SCHEMA,
    authority: TRIPLET_AUTHORITY,
    frameRoles: ['t0', 'actualMiddle', 't2'],
    actualMiddle: null,
  },
  baseline: {
    id: MIDPOINT_BASELINE_ID,
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    inputFrames: ['t0', 't2'],
    targetFrame: 'actualMiddle',
    syntheticMiddle: null,
    baselineIds: BASELINE_IDS,
    failureModeBuckets: FAILURE_MODE_BUCKETS,
  },
  baselines: [],
  contactSheet: null,
  summary: {
    bestByMeanAbsoluteError: null,
  },
  artifacts: artifactPaths,
  failures: [],
};

writeJson(reportPath, baseReport);

if (dryRun) {
  console.log(JSON.stringify(baseReport, null, 2));
  process.exit(0);
}

let proc = null;
let phase = 'launch';
try {
  mkdirSync(outDir, { recursive: true });
  const stdoutPath = resolve(outDir, 'chrome.stdout.log');
  const stderrPath = resolve(outDir, 'chrome.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    baseUrl,
  ], { stdio: ['ignore', stdoutFd, stderrFd] });
  proc.on('exit', () => {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  });

  const cdpFetch = cdpFetchFactory(port);
  await waitForCdp(cdpFetch);
  phase = 'target';
  const targets = await cdpFetch('/json/list');
  const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  phase = 'load';
  await wsRequest(ws, 'Page.navigate', { url: baseUrl });
  await wsRequest(ws, 'Page.bringToFront');
  await delay(settleMs);
  phase = 'identity';
  const state = await waitForFrame(ws, 8);
  if (state.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID || state.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`wrong route identity before triplet capture: ${state.effectiveRoute || 'none'} / ${state.prototypeIdentity || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'identity';
    error.details = {
      expectedRoute: EXPECTED_VOLUME_ROUTE_ID,
      effectiveRoute: state.effectiveRoute,
      expectedPrototype: EXPECTED_PROTOTYPE_ID,
      prototypeIdentity: state.prototypeIdentity,
    };
    throw error;
  }

  phase = 'capture';
  const t0 = await captureSample(ws, 't0', state.frameCount);
  const actualMiddle = await captureSample(ws, 'actualMiddle', t0.frameCount + frameStride);
  const t2 = await captureSample(ws, 't2', actualMiddle.frameCount + frameStride);
  validateTriplet([t0, actualMiddle, t2]);

  const width = t0.preview.width;
  const height = t0.preview.height;
  const t0Rgba = Uint8Array.from(t0.preview.rgba);
  const actualMiddleRgba = Uint8Array.from(actualMiddle.preview.rgba);
  const t2Rgba = Uint8Array.from(t2.preview.rgba);
  writeRgbaPng(artifactPaths.t0, width, height, t0Rgba);
  writeRgbaPng(artifactPaths.actualMiddle, width, height, actualMiddleRgba);
  writeRgbaPng(artifactPaths.t2, width, height, t2Rgba);
  const actualBuffer = readFileSync(artifactPaths.actualMiddle);
  const tripletSummary = {
    schema: TRIPLET_SCHEMA,
    authority: TRIPLET_AUTHORITY,
    requestedRoute: baseUrl,
    effectiveRoute: t0.effectiveRoute,
    prototypeIdentity: t0.prototypeIdentity,
    backend: t0.backend,
    width,
    height,
    frameStride,
    t0: summarizeSample(t0, 't0', artifactPaths.t0),
    actualMiddle: summarizeSample(actualMiddle, 'actualMiddle', artifactPaths.actualMiddle),
    t2: summarizeSample(t2, 't2', artifactPaths.t2),
    frameCountDelta: {
      t0ToActualMiddle: actualMiddle.frameCount - t0.frameCount,
      actualMiddleToT2: t2.frameCount - actualMiddle.frameCount,
      t0ToT2: t2.frameCount - t0.frameCount,
    },
    simStepCountDelta: {
      t0ToActualMiddle: actualMiddle.simStepCount - t0.simStepCount,
      actualMiddleToT2: t2.simStepCount - actualMiddle.simStepCount,
      t0ToT2: t2.simStepCount - t0.simStepCount,
    },
  };
  const baselineReports = BASELINE_IDS.map(id => {
    const paths = artifactPaths.baselines[id];
    const syntheticMiddleRgba = baselineRgba(id, t0Rgba, t2Rgba, width, height);
    const differenceRgbaImage = differenceRgba(actualMiddleRgba, syntheticMiddleRgba);
    writeRgbaPng(paths.syntheticMiddle, width, height, syntheticMiddleRgba);
    writeRgbaPng(paths.difference, width, height, differenceRgbaImage);
    const syntheticBuffer = readFileSync(paths.syntheticMiddle);
    const syntheticPng = parsePngRgba(syntheticBuffer);
    assert.equal(syntheticPng.width, width, `${id} synthetic PNG width drifted after write`);
    assert.equal(syntheticPng.height, height, `${id} synthetic PNG height drifted after write`);
    const metrics = compareRgba(actualMiddleRgba, syntheticMiddleRgba, width, height);
    return {
      id,
      syntheticAuthority: SYNTHETIC_AUTHORITY,
      inputFrames: ['t0', 't2'],
      targetFrame: 'actualMiddle',
      syntheticMiddle: {
        path: paths.syntheticMiddle,
        authority: SYNTHETIC_AUTHORITY,
        imageSha256: sha256Buffer(syntheticBuffer),
      },
      actualMiddle: {
        path: artifactPaths.actualMiddle,
        imageSha256: sha256Buffer(actualBuffer),
      },
      difference: {
        path: paths.difference,
      },
      metrics,
      failureModes: classifyFailureModes(metrics, tripletSummary),
    };
  });
  const bestByMeanAbsoluteError = baselineReports
    .slice()
    .sort((a, b) => a.metrics.meanAbsoluteError - b.metrics.meanAbsoluteError)[0];
  const contactSheet = writeContactSheet(artifactPaths.contactSheet, width, height, [
    { label: 't0', role: 't0', path: artifactPaths.t0, rgba: t0Rgba, barColor: [80, 120, 220] },
    { label: 'actualMiddle', role: 'actualMiddle', path: artifactPaths.actualMiddle, rgba: actualMiddleRgba, barColor: [80, 220, 120] },
    { label: 't2', role: 't2', path: artifactPaths.t2, rgba: t2Rgba, barColor: [80, 120, 220] },
    ...baselineReports.flatMap((baseline, index) => {
      const synthetic = parsePngRgba(readFileSync(baseline.syntheticMiddle.path)).rgba;
      const error = parsePngRgba(readFileSync(baseline.difference.path)).rgba;
      const hue = [
        [230, 180, 70],
        [190, 150, 230],
        [230, 100, 80],
        [80, 210, 220],
      ][index] || [160, 160, 160];
      return [
        {
          label: `${baseline.id}:syntheticMiddle`,
          role: 'syntheticMiddle',
          baselineId: baseline.id,
          path: baseline.syntheticMiddle.path,
          rgba: synthetic,
          barColor: hue,
        },
        {
          label: `${baseline.id}:error`,
          role: 'difference',
          baselineId: baseline.id,
          path: baseline.difference.path,
          rgba: error,
          barColor: [Math.max(0, hue[0] - 40), Math.max(0, hue[1] - 40), Math.max(0, hue[2] - 40)],
        },
      ];
    }),
  ]);
  const report = {
    ...baseReport,
    status: 'captured',
    updatedAt: new Date().toISOString(),
    triplet: tripletSummary,
    baseline: {
      ...baseReport.baseline,
      ...baselineReports.find(entry => entry.id === MIDPOINT_BASELINE_ID),
      interpretation: 'Cheap midpoint interpolation is on trial against the actual simulator middle frame; smoothness is not evidence unless the actual-middle comparison survives.',
    },
    baselines: baselineReports,
    contactSheet,
    summary: {
      bestByMeanAbsoluteError: bestByMeanAbsoluteError ? {
        id: bestByMeanAbsoluteError.id,
        meanAbsoluteError: bestByMeanAbsoluteError.metrics.meanAbsoluteError,
        rootMeanSquaredError: bestByMeanAbsoluteError.metrics.rootMeanSquaredError,
        failureModes: bestByMeanAbsoluteError.failureModes,
      } : null,
    },
  };
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  ws.close();
} catch (error) {
  const failure = {
    code: error.code || 'interframe-baseline-failed',
    failurePhase: error.failurePhase || phase,
    message: error.message,
    details: error.details || {},
  };
  const failed = {
    ...baseReport,
    status: 'failed',
    updatedAt: new Date().toISOString(),
    failurePhase: failure.failurePhase,
    failures: [failure],
  };
  writeJson(reportPath, failed);
  console.error(JSON.stringify(failed, null, 2));
  process.exitCode = 1;
} finally {
  if (proc && !proc.killed) proc.kill('SIGTERM');
}
