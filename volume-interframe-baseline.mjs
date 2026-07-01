#!/usr/bin/env node
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
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
const HORN_SCHUNCK_BASELINE_ID = 'horn-schunck-bidirectional-warp-rgba-v0';
const BASELINE_IDS = [
  HOLD_LAST_BASELINE_ID,
  HOLD_NEXT_BASELINE_ID,
  MIDPOINT_BASELINE_ID,
  BLOCK_MATCH_BASELINE_ID,
  HORN_SCHUNCK_BASELINE_ID,
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

function parseExternalBaselineSpecs(argv) {
  const specs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--external-baseline') continue;
    const raw = argv[index + 1];
    if (!raw || raw.startsWith('--')) throw new Error('--external-baseline requires id::command');
    index += 1;
    const separator = raw.indexOf('::');
    if (separator <= 0) throw new Error(`external baseline spec must be id::command, got ${raw}`);
    const id = raw.slice(0, separator).trim();
    const command = raw.slice(separator + 2).trim();
    if (!/^[a-z0-9][a-z0-9-]*-v[0-9]+$/.test(id)) throw new Error(`external baseline id must be stable kebab schema id ending in -vN, got ${id}`);
    if (!command.includes('{out}')) throw new Error(`external baseline ${id} command must include {out}`);
    specs.push({ id, command });
  }
  return specs;
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
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

function rgbaToLumaFloat(rgba, width, height) {
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
  }
  return out;
}

function sampleFloatBilinear(source, width, height, x, y) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const a = source[y0 * width + x0];
  const b = source[y0 * width + x1];
  const c = source[y1 * width + x0];
  const d = source[y1 * width + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function resizeFloatImage(source, width, height, nextWidth, nextHeight) {
  const out = new Float64Array(nextWidth * nextHeight);
  const sx = width / nextWidth;
  const sy = height / nextHeight;
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      out[y * nextWidth + x] = sampleFloatBilinear(source, width, height, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
    }
  }
  return out;
}

function smoothFloatImage(source, width, height) {
  const out = new Float64Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let yy = -1; yy <= 1; yy += 1) {
        const sy = y + yy;
        if (sy < 0 || sy >= height) continue;
        for (let xx = -1; xx <= 1; xx += 1) {
          const sx = x + xx;
          if (sx < 0 || sx >= width) continue;
          sum += source[sy * width + sx];
          count += 1;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

function resizeFlow(previous, prevWidth, prevHeight, nextWidth, nextHeight) {
  const outU = new Float64Array(nextWidth * nextHeight);
  const outV = new Float64Array(nextWidth * nextHeight);
  const sx = prevWidth / nextWidth;
  const sy = prevHeight / nextHeight;
  const flowScaleX = nextWidth / prevWidth;
  const flowScaleY = nextHeight / prevHeight;
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sampleX = (x + 0.5) * sx - 0.5;
      const sampleY = (y + 0.5) * sy - 0.5;
      const dst = y * nextWidth + x;
      outU[dst] = sampleFloatBilinear(previous.u, prevWidth, prevHeight, sampleX, sampleY) * flowScaleX;
      outV[dst] = sampleFloatBilinear(previous.v, prevWidth, prevHeight, sampleX, sampleY) * flowScaleY;
    }
  }
  return { u: outU, v: outV, width: nextWidth, height: nextHeight };
}

function hornSchunckSingleLevel(firstLuma, secondLuma, width, height, initialFlow, options = {}) {
  const alpha = Number(options.alpha ?? 0.18);
  const iterations = Number(options.iterations ?? 90);
  let u = initialFlow?.u ? Float64Array.from(initialFlow.u) : new Float64Array(width * height);
  let v = initialFlow?.v ? Float64Array.from(initialFlow.v) : new Float64Array(width * height);
  const ix = new Float64Array(width * height);
  const iy = new Float64Array(width * height);
  const it = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const ym = Math.max(0, y - 1);
      const yp = Math.min(height - 1, y + 1);
      const i = y * width + x;
      ix[i] = (
        firstLuma[y * width + xp] - firstLuma[y * width + xm] +
        secondLuma[y * width + xp] - secondLuma[y * width + xm]
      ) * 0.25;
      iy[i] = (
        firstLuma[yp * width + x] - firstLuma[ym * width + x] +
        secondLuma[yp * width + x] - secondLuma[ym * width + x]
      ) * 0.25;
      it[i] = secondLuma[i] - firstLuma[i];
    }
  }
  const alphaSquared = alpha * alpha;
  for (let iter = 0; iter < iterations; iter += 1) {
    const nextU = new Float64Array(u.length);
    const nextV = new Float64Array(v.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        let sumU = 0;
        let sumV = 0;
        let count = 0;
        if (x > 0) {
          sumU += u[i - 1];
          sumV += v[i - 1];
          count += 1;
        }
        if (x + 1 < width) {
          sumU += u[i + 1];
          sumV += v[i + 1];
          count += 1;
        }
        if (y > 0) {
          sumU += u[i - width];
          sumV += v[i - width];
          count += 1;
        }
        if (y + 1 < height) {
          sumU += u[i + width];
          sumV += v[i + width];
          count += 1;
        }
        const avgU = count ? sumU / count : u[i];
        const avgV = count ? sumV / count : v[i];
        const numerator = ix[i] * avgU + iy[i] * avgV + it[i];
        const denominator = alphaSquared + ix[i] * ix[i] + iy[i] * iy[i];
        nextU[i] = avgU - ix[i] * numerator / denominator;
        nextV[i] = avgV - iy[i] * numerator / denominator;
      }
    }
    u = nextU;
    v = nextV;
  }
  return { u, v, width, height };
}

function hornSchunckPyramidFlow(first, second, width, height) {
  const firstBase = smoothFloatImage(rgbaToLumaFloat(first, width, height), width, height);
  const secondBase = smoothFloatImage(rgbaToLumaFloat(second, width, height), width, height);
  const levels = [
    { width: Math.max(16, Math.round(width / 4)), height: Math.max(16, Math.round(height / 4)), alpha: 0.22, iterations: 120 },
    { width: Math.max(24, Math.round(width / 2)), height: Math.max(24, Math.round(height / 2)), alpha: 0.18, iterations: 100 },
    { width, height, alpha: 0.14, iterations: 80 },
  ].filter((level, index, all) => index === 0 || level.width !== all[index - 1].width || level.height !== all[index - 1].height);
  let flow = null;
  for (const level of levels) {
    const firstLevel = level.width === width && level.height === height
      ? firstBase
      : smoothFloatImage(resizeFloatImage(firstBase, width, height, level.width, level.height), level.width, level.height);
    const secondLevel = level.width === width && level.height === height
      ? secondBase
      : smoothFloatImage(resizeFloatImage(secondBase, width, height, level.width, level.height), level.width, level.height);
    const initial = flow ? resizeFlow(flow, flow.width, flow.height, level.width, level.height) : null;
    flow = hornSchunckSingleLevel(firstLevel, secondLevel, level.width, level.height, initial, level);
  }
  return flow;
}

function sampleRgbaBilinear(source, width, height, x, y) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const a = source[(y0 * width + x0) * 4 + c];
    const b = source[(y0 * width + x1) * 4 + c];
    const d = source[(y1 * width + x1) * 4 + c];
    const e = source[(y1 * width + x0) * 4 + c];
    out[c] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + e * (1 - tx) * ty + d * tx * ty;
  }
  return out;
}

function hornSchunckBidirectionalWarpRgba(first, third, width, height) {
  const forward = hornSchunckPyramidFlow(first, third, width, height);
  const backward = hornSchunckPyramidFlow(third, first, width, height);
  const out = new Uint8Array(first.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const dst = i * 4;
      const a = sampleRgbaBilinear(first, width, height, x - forward.u[i] * 0.5, y - forward.v[i] * 0.5);
      const b = sampleRgbaBilinear(third, width, height, x - backward.u[i] * 0.5, y - backward.v[i] * 0.5);
      out[dst] = Math.round((a[0] + b[0]) * 0.5);
      out[dst + 1] = Math.round((a[1] + b[1]) * 0.5);
      out[dst + 2] = Math.round((a[2] + b[2]) * 0.5);
      out[dst + 3] = 255;
    }
  }
  return out;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function artifactHref(path) {
  return escapeHtml(basename(path));
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a';
}

function frameStamp(frame) {
  return `frame ${frame.frameCount}, sim step ${frame.simStepCount}`;
}

function writeOperatorEvidenceHtml(path, report) {
  const triplet = report.triplet;
  const timelineOrder = [
    {
      id: 't0',
      heading: 'T0 live start anchor',
      role: 'live simulator input',
      path: triplet.t0.path,
      stamp: frameStamp(triplet.t0),
      note: 'First real captured frame. Baselines may use this as input.',
    },
    {
      id: 'actualMiddle',
      heading: 'T1 actual middle',
      role: 'Ground truth live simulator middle',
      path: triplet.actualMiddle.path,
      stamp: frameStamp(triplet.actualMiddle),
      note: 'This is the real simulator frame every synthetic frame is judged against.',
    },
    {
      id: 't2',
      heading: 'T2 live end anchor',
      role: 'live simulator input',
      path: triplet.t2.path,
      stamp: frameStamp(triplet.t2),
      note: 'Third real captured frame. Baselines may use this as input.',
    },
  ];
  const rows = report.baselines.map(baseline => {
    const metrics = baseline.metrics;
    const failureModes = baseline.failureModes.join(', ');
    return `
      <section class="comparison-row" data-comparison-mode="actual-vs-synthetic" data-baseline-id="${escapeHtml(baseline.id)}">
        <header>
          <div>
            <p class="kicker">actual-vs-synthetic row</p>
            <h2>${escapeHtml(baseline.id)}</h2>
          </div>
          <dl class="metrics">
            <div><dt>MAE</dt><dd>${formatMetric(metrics.meanAbsoluteError)}</dd></div>
            <div><dt>RMSE</dt><dd>${formatMetric(metrics.rootMeanSquaredError)}</dd></div>
            <div><dt>fire MAE</dt><dd>${formatMetric(metrics.fireRegionMeanAbsoluteError)}</dd></div>
            <div><dt>smoke MAE</dt><dd>${formatMetric(metrics.smokeRegionMeanAbsoluteError)}</dd></div>
          </dl>
        </header>
        <p class="failure">Failure buckets: ${escapeHtml(failureModes)}</p>
        <div class="comparison-grid">
          <figure>
            <figcaption><strong>Ground truth live simulator middle</strong><span>T1 actual, ${escapeHtml(frameStamp(triplet.actualMiddle))}</span></figcaption>
            <img src="${artifactHref(triplet.actualMiddle.path)}" alt="Actual middle frame from the live simulator">
          </figure>
          <figure>
            <figcaption><strong>Synthetic comparison T1</strong><span>${escapeHtml(baseline.syntheticAuthority)} from T0 and T2</span></figcaption>
            <img src="${artifactHref(baseline.syntheticMiddle.path)}" alt="Synthetic middle frame for ${escapeHtml(baseline.id)}">
          </figure>
          <figure>
            <figcaption><strong>Error map</strong><span>Absolute RGB difference: actual T1 minus synthetic T1</span></figcaption>
            <img src="${artifactHref(baseline.difference.path)}" alt="Error map for ${escapeHtml(baseline.id)}">
          </figure>
        </div>
      </section>
    `;
  }).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kaminos Interframe Perjury Evidence</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0d10;
      color: #f3f1e8;
    }
    body {
      margin: 0;
      background: #0b0d10;
    }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
    }
    h1, h2, p, dl, figure {
      margin: 0;
    }
    h1 {
      font-size: 28px;
      line-height: 1.15;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 18px;
      line-height: 1.2;
    }
    .subhead {
      max-width: 980px;
      color: #c9c4b6;
      line-height: 1.45;
      margin-bottom: 18px;
    }
    .authority {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin: 18px 0 22px;
    }
    .authority div,
    .timeline figure,
    .comparison-row {
      border: 1px solid #303842;
      background: #11161d;
      border-radius: 6px;
    }
    .authority div {
      padding: 10px 12px;
      min-width: 0;
    }
    .authority dt,
    .metrics dt,
    .kicker {
      color: #92a0ad;
      font-size: 11px;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .authority dd {
      margin: 3px 0 0;
      overflow-wrap: anywhere;
      color: #f3f1e8;
      font-size: 13px;
    }
    .legend {
      padding: 12px 14px;
      border-left: 4px solid #58c48a;
      background: #121912;
      margin-bottom: 18px;
      color: #dce7d5;
      line-height: 1.45;
    }
    .timeline {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    figure {
      min-width: 0;
    }
    figcaption {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: #161d26;
      border-bottom: 1px solid #303842;
      font-size: 13px;
      line-height: 1.3;
    }
    figcaption span {
      color: #aeb7c0;
      text-align: right;
    }
    img {
      display: block;
      width: 100%;
      image-rendering: auto;
      background: #050607;
    }
    .timeline img {
      aspect-ratio: ${triplet.width} / ${triplet.height};
      object-fit: contain;
    }
    .timeline-note {
      padding: 10px 12px;
      color: #c6ccd2;
      font-size: 13px;
      line-height: 1.35;
    }
    .comparison-row {
      margin: 14px 0;
      overflow: hidden;
    }
    .comparison-row header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      border-bottom: 1px solid #303842;
      background: #151b23;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(76px, 1fr));
      gap: 8px;
      min-width: min(560px, 100%);
    }
    .metrics div {
      background: #0d1117;
      border: 1px solid #2b333c;
      border-radius: 4px;
      padding: 7px 8px;
    }
    .metrics dd {
      margin: 2px 0 0;
      font-variant-numeric: tabular-nums;
      font-size: 15px;
    }
    .failure {
      padding: 10px 14px;
      color: #ffd7a1;
      background: #1d160f;
      border-bottom: 1px solid #303842;
      font-size: 13px;
    }
    .comparison-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0;
    }
    .comparison-grid figure + figure {
      border-left: 1px solid #303842;
    }
    footer {
      color: #8e98a3;
      font-size: 12px;
      line-height: 1.45;
      padding: 18px 0 4px;
    }
    @media (max-width: 980px) {
      main {
        padding: 14px;
      }
      .authority,
      .timeline,
      .comparison-grid {
        grid-template-columns: 1fr;
      }
      .comparison-grid figure + figure {
        border-left: 0;
        border-top: 1px solid #303842;
      }
      .comparison-row header {
        display: block;
      }
      .metrics {
        margin-top: 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Kaminos Interframe Perjury Evidence</h1>
    <p class="subhead">This page compares synthetic middle frames against the real simulator middle frame from the same live route. Synthetic frames are comparison evidence only, not live simulator output.</p>
    <dl class="authority">
      <div><dt>route authority</dt><dd>${escapeHtml(triplet.authority)}</dd></div>
      <div><dt>effective route</dt><dd>${escapeHtml(triplet.effectiveRoute)}</dd></div>
      <div><dt>prototype</dt><dd>${escapeHtml(triplet.prototypeIdentity)}</dd></div>
      <div><dt>best cheap baseline by MAE</dt><dd>${escapeHtml(report.summary.bestByMeanAbsoluteError?.id || 'none')}</dd></div>
    </dl>
    <p class="legend"><strong>How to read this:</strong> top section reads left to right as live time: T0 start anchor -> T1 actual middle -> T2 end anchor. Every baseline row below reads left to right as actual-vs-synthetic: actual T1 ground truth -> synthetic T1 made from T0/T2 -> error map.</p>
    <section class="timeline" data-timeline-order="t0 actualMiddle t2">
      ${timelineOrder.map(frame => `
      <figure data-frame-role="${escapeHtml(frame.id)}">
        <figcaption><strong>${escapeHtml(frame.heading)}</strong><span>${escapeHtml(frame.stamp)}</span></figcaption>
        <img src="${artifactHref(frame.path)}" alt="${escapeHtml(frame.heading)}">
        <p class="timeline-note">${escapeHtml(frame.role)}. ${escapeHtml(frame.note)}</p>
      </figure>
      `).join('\n')}
    </section>
    ${rows}
    <footer>
      Report: ${escapeHtml(report.reportPath)}. Contact-sheet PNG remains a secondary debug collage at ${escapeHtml(report.contactSheet.path)}; this HTML page is the operator-facing comparison artifact.
    </footer>
  </main>
</body>
</html>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return {
    path,
    format: 'html',
    timelineOrder: timelineOrder.map(frame => frame.id),
    comparisonMode: 'actual-vs-synthetic',
    rowOrder: report.baselines.map(baseline => baseline.id),
    readingOrder: 'Top section left-to-right: T0 live start anchor, T1 actual middle ground truth, T2 live end anchor. Baseline rows left-to-right: Ground truth live simulator middle, synthetic comparison T1, absolute RGB error map.',
  };
}

function renderExternalBaselineCommand(spec, context) {
  return spec.command
    .replaceAll('{first}', shellQuote(context.firstPath))
    .replaceAll('{third}', shellQuote(context.thirdPath))
    .replaceAll('{out}', shellQuote(context.outPath))
    .replaceAll('{outDir}', shellQuote(context.outDir))
    .replaceAll('{report}', shellQuote(context.reportPath));
}

function runExternalBaseline(spec, context) {
  mkdirSync(dirname(context.outPath), { recursive: true });
  const externalBaselineCommand = renderExternalBaselineCommand(spec, context);
  const stdoutPath = `${context.outPath}.stdout.txt`;
  const stderrPath = `${context.outPath}.stderr.txt`;
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(externalBaselineCommand, {
      cwd,
      shell: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const stdout = readFileSync(stdoutPath, 'utf8');
  const stderr = readFileSync(stderrPath, 'utf8');
  if (result.status !== 0) {
    const error = new Error(`external baseline ${spec.id} failed with status ${result.status}`);
    error.code = 'external-baseline-failed';
    error.failurePhase = 'external-baseline';
    error.details = {
      baselineId: spec.id,
      externalBaselineCommand,
      stdoutPath,
      stderrPath,
      stdout,
      stderr,
      signal: result.signal,
    };
    throw error;
  }
  if (!existsSync(context.outPath)) {
    const error = new Error(`external baseline ${spec.id} did not write ${context.outPath}`);
    error.code = 'external-baseline-missing-output';
    error.failurePhase = 'external-baseline';
    error.details = {
      baselineId: spec.id,
      externalBaselineCommand,
      stdoutPath,
      stderrPath,
      stdout,
      stderr,
    };
    throw error;
  }
  return {
    id: spec.id,
    externalBaselineCommand,
    stdoutPath,
    stderrPath,
    stdout,
    stderr,
  };
}

function baselineRgba(id, first, third, width, height) {
  if (id === HOLD_LAST_BASELINE_ID) return cloneRgba(first);
  if (id === HOLD_NEXT_BASELINE_ID) return cloneRgba(third);
  if (id === MIDPOINT_BASELINE_ID) return midpointRgba(first, third);
  if (id === BLOCK_MATCH_BASELINE_ID) return blockMatchBidirectionalWarpRgba(first, third, width, height);
  if (id === HORN_SCHUNCK_BASELINE_ID) return hornSchunckBidirectionalWarpRgba(first, third, width, height);
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
const externalBaselineSpecs = parseExternalBaselineSpecs(process.argv.slice(2));
const externalBaselineById = new Map(externalBaselineSpecs.map(spec => [spec.id, spec]));
const baselineIds = [...BASELINE_IDS, ...externalBaselineSpecs.map(spec => spec.id)];
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
  operatorEvidenceHtml: resolve(outDir, 'interframe-baseline-evidence.html'),
  baselines: Object.fromEntries(baselineIds.map(id => [id, {
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
    baselineIds,
    failureModeBuckets: FAILURE_MODE_BUCKETS,
  },
  externalBaselines: externalBaselineSpecs.map(spec => ({
    id: spec.id,
    commandTemplate: spec.command,
  })),
  baselines: [],
  contactSheet: null,
  operatorEvidenceHtml: null,
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
  const baselineReports = baselineIds.map(id => {
    const paths = artifactPaths.baselines[id];
    const externalSpec = externalBaselineById.get(id);
    const externalRun = externalSpec ? runExternalBaseline(externalSpec, {
      firstPath: artifactPaths.t0,
      thirdPath: artifactPaths.t2,
      outPath: paths.syntheticMiddle,
      outDir,
      reportPath,
    }) : null;
    if (!externalSpec) {
      const syntheticMiddleRgba = baselineRgba(id, t0Rgba, t2Rgba, width, height);
      writeRgbaPng(paths.syntheticMiddle, width, height, syntheticMiddleRgba);
    }
    const finalSyntheticBuffer = readFileSync(paths.syntheticMiddle);
    const finalSyntheticPng = parsePngRgba(finalSyntheticBuffer);
    assert.equal(finalSyntheticPng.width, width, `${id} synthetic PNG width drifted after final write`);
    assert.equal(finalSyntheticPng.height, height, `${id} synthetic PNG height drifted after final write`);
    const finalSyntheticRgba = finalSyntheticPng.rgba;
    const differenceRgbaImage = differenceRgba(actualMiddleRgba, finalSyntheticRgba);
    writeRgbaPng(paths.difference, width, height, differenceRgbaImage);
    const metrics = compareRgba(actualMiddleRgba, finalSyntheticRgba, width, height);
    return {
      id,
      syntheticAuthority: SYNTHETIC_AUTHORITY,
      sourceKind: externalSpec ? 'external-command' : 'in-process-baseline',
      externalBaselineCommand: externalRun?.externalBaselineCommand || null,
      externalBaselineStdout: externalRun?.stdoutPath || null,
      externalBaselineStderr: externalRun?.stderrPath || null,
      inputFrames: ['t0', 't2'],
      targetFrame: 'actualMiddle',
      syntheticMiddle: {
        path: paths.syntheticMiddle,
        authority: SYNTHETIC_AUTHORITY,
        imageSha256: sha256Buffer(finalSyntheticBuffer),
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
  let report = {
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
  const operatorEvidenceHtml = writeOperatorEvidenceHtml(artifactPaths.operatorEvidenceHtml, report);
  report = {
    ...report,
    operatorEvidenceHtml,
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
