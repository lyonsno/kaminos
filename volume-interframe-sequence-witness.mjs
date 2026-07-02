#!/usr/bin/env node
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.interframe-sequence-witness.v0';
const SEQUENCE_CONTEXT_SCHEMA = 'kaminos.volume.interframe-sequence-candidate-context.v0';
const DENSE_CAPTURE_CHUNKED_SCHEMA = 'kaminos.volume.dense-frame-capture.chunked.v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const SEQUENCE_AUTHORITY = 'full-rate-live-sim-truth';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const CADENCE_ABLATION_GAPPED_BASELINE = 'cadence-ablation-gapped-baseline';
const DEFAULT_TOTAL_FRAME_COUNT = 29;
const DEFAULT_FRAME_STEP = 1;
const DEFAULT_CADENCE = 2;
const DEFAULT_REAL_ANCHOR_PARITY = 'even';
const BUILTIN_CANDIDATES = [
  CADENCE_ABLATION_GAPPED_BASELINE,
  'hold-last-rgba-v0',
  'hold-next-rgba-v0',
  'pixel-midpoint-rgba-v0',
  'pixel-linear-ratio-rgba-v0',
];
const FAILURE_MODE_BUCKETS = [
  'ghosting',
  'smearing',
  'topology-lie',
  'snuff-quench-miss',
  'low-fire-shimmer',
  'broad-smoke-mush',
];
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_sim_cadence=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';

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

function wsRequest(ws, method, params = {}, timeoutMs = 15000) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      cleanup();
      if (msg.error) {
        const error = new Error(`${method}: ${msg.error.message}`);
        error.code = 'cdp-request-error';
        error.failurePhase = 'capture';
        rejectReq(error);
      } else {
        resolveReq(msg.result);
      }
    };
    const onClose = () => {
      if (settled) return;
      cleanup();
      const error = new Error(`${method}: CDP WebSocket closed before response`);
      error.code = 'cdp-websocket-closed';
      error.failurePhase = 'capture';
      rejectReq(error);
    };
    const onError = () => {
      if (settled) return;
      cleanup();
      const error = new Error(`${method}: CDP WebSocket error before response`);
      error.code = 'cdp-websocket-error';
      error.failurePhase = 'capture';
      rejectReq(error);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      const error = new Error(`${method}: timed out waiting for CDP response`);
      error.code = 'cdp-request-timeout';
      error.failurePhase = 'capture';
      error.details = { method, id };
      rejectReq(error);
    }, timeoutMs);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
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
  const expectedBytes = sample?.preview?.width * sample?.preview?.height * 4;
  const hasRgbaArray = Array.isArray(sample?.preview?.rgba) && sample.preview.rgba.length === expectedBytes;
  const hasRgbaBase64 = typeof sample?.preview?.rgbaBase64 === 'string' && Buffer.from(sample.preview.rgbaBase64, 'base64').length === expectedBytes;
  const pngBytes = typeof sample?.preview?.pngBase64 === 'string' ? Buffer.from(sample.preview.pngBase64, 'base64') : null;
  const hasPngBase64 = pngBytes?.length > 8 && pngBytes.readUInt32BE(0) === 0x89504e47;
  if (
    sample?.ok !== true ||
    !Number.isFinite(sample.preview?.width) ||
    !Number.isFinite(sample.preview?.height) ||
    (!hasRgbaArray && !hasRgbaBase64 && !hasPngBase64)
  ) {
    const error = new Error(`${label} sample missing complete preview RGBA`);
    error.code = 'missing-primary-output';
    error.failurePhase = 'sample';
    error.details = { label, sample };
    throw error;
  }
}

function previewRgbaBytes(sample) {
  if (Array.isArray(sample.preview?.rgba)) return Uint8Array.from(sample.preview.rgba);
  if (typeof sample.preview?.rgbaBase64 === 'string') return Uint8Array.from(Buffer.from(sample.preview.rgbaBase64, 'base64'));
  if (typeof sample.preview?.pngBase64 === 'string') {
    const parsed = parsePngRgba(Buffer.from(sample.preview.pngBase64, 'base64'));
    if (parsed.width !== sample.preview.width || parsed.height !== sample.preview.height) {
      const error = new Error(`PNG preview dimensions ${parsed.width}x${parsed.height} did not match declared ${sample.preview.width}x${sample.preview.height}`);
      error.code = 'dimension-drift';
      error.failurePhase = 'sample';
      error.details = { frameCount: sample?.frameCount, sequenceIndex: sample?.sequenceIndex };
      throw error;
    }
    return parsed.rgba;
  }
  const error = new Error('sample missing materialized preview RGBA bytes');
  error.code = 'missing-primary-output';
  error.failurePhase = 'sample';
  error.details = { frameCount: sample?.frameCount, sequenceIndex: sample?.sequenceIndex };
  throw error;
}

function summarizeSample(sample, role, path, sequenceIndex) {
  return {
    role,
    sequenceIndex,
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
  return {
    meanAbsoluteError: absolute / Math.max(1, channels),
    rootMeanSquaredError: Math.sqrt(squared / Math.max(1, channels)),
    maxChannelError,
    highErrorPixelRatio: highErrorPixels / Math.max(1, width * height),
    fireRegionMeanAbsoluteError: fireWeightedAbsolute / Math.max(1, fireWeight),
    smokeRegionMeanAbsoluteError: smokeWeightedAbsolute / Math.max(1, smokeWeight),
    firePixelCount: fireWeight,
    smokePixelCount: smokeWeight,
  };
}

function meanMetrics(metricsList) {
  const keys = [
    'meanAbsoluteError',
    'rootMeanSquaredError',
    'maxChannelError',
    'highErrorPixelRatio',
    'fireRegionMeanAbsoluteError',
    'smokeRegionMeanAbsoluteError',
  ];
  const out = { comparedFrameCount: metricsList.length };
  for (const key of keys) {
    out[key] = metricsList.reduce((sum, metrics) => sum + Number(metrics[key] || 0), 0) / Math.max(1, metricsList.length);
  }
  return out;
}

function classifyFailureModes(metrics) {
  const modes = [];
  if (metrics.highErrorPixelRatio > 0.12) modes.push('ghosting');
  if (metrics.meanAbsoluteError > 18 || metrics.rootMeanSquaredError > 28) modes.push('smearing');
  if (metrics.fireRegionMeanAbsoluteError > Math.max(14, metrics.meanAbsoluteError * 1.18)) modes.push('topology-lie');
  if (metrics.fireRegionMeanAbsoluteError > 18) modes.push('snuff-quench-miss');
  if (metrics.firePixelCount < 20 && metrics.fireRegionMeanAbsoluteError > 10) modes.push('low-fire-shimmer');
  if (metrics.smokeRegionMeanAbsoluteError > Math.max(12, metrics.meanAbsoluteError * 1.10)) modes.push('broad-smoke-mush');
  return modes.length ? modes : ['no-obvious-bucket-from-cheap-metrics'];
}

function builtinCandidateRgba(id, first, third, ratio = 0.5) {
  if (id === CADENCE_ABLATION_GAPPED_BASELINE || id === 'hold-last-rgba-v0') return Uint8Array.from(first);
  if (id === 'hold-next-rgba-v0') return Uint8Array.from(third);
  if (id === 'pixel-midpoint-rgba-v0') {
    const out = new Uint8Array(first.length);
    for (let i = 0; i < first.length; i += 1) out[i] = Math.round((first[i] + third[i]) / 2);
    return out;
  }
  if (id === 'pixel-linear-ratio-rgba-v0') {
    const t = Math.min(1, Math.max(0, Number(ratio)));
    const out = new Uint8Array(first.length);
    for (let i = 0; i < first.length; i += 1) out[i] = Math.round(first[i] * (1 - t) + third[i] * t);
    return out;
  }
  throw new Error(`unknown built-in candidate ${id}`);
}

async function currentDebugState(ws) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype && window.__kaminosVolumePrototype.debugState ? window.__kaminosVolumePrototype.debugState() : null',
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function waitForFrame(ws, minimumFrameCount) {
  for (let i = 0; i < 240; i += 1) {
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

async function captureDenseSequence(ws, options) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.captureDenseFrames(${JSON.stringify(options)})`,
    awaitPromise: true,
    returnByValue: true,
  }, Math.max(15000, options.timeoutMs + 5000));
  const payload = result.result.value;
  if (!payload?.ok || !Array.isArray(payload.frames)) {
    const error = new Error(`dense capture failed: ${payload?.reason || 'missing frames'}`);
    error.code = 'dense-capture-failed';
    error.failurePhase = 'capture';
    error.details = payload || null;
    throw error;
  }
  for (const sample of payload.frames) assertSamplePreview(sample, `dense-frame-${sample.sequenceIndex}`);
  return payload;
}

async function captureDenseSequenceChunked(ws, options) {
  const requestedFrameCount = Math.max(1, Math.floor(Number(options.frameCount)));
  const chunkFrameCount = Math.max(1, Math.floor(Number(options.chunkFrameCount)));
  const frames = [];
  const denseCaptureChunks = [];
  let chunkIndex = 0;
  while (frames.length < requestedFrameCount) {
    const remainingFrameCount = requestedFrameCount - frames.length;
    const requestedChunkFrameCount = Math.min(chunkFrameCount, remainingFrameCount);
    const chunkPayload = await captureDenseSequence(ws, {
      frameCount: requestedChunkFrameCount,
      everyNthFrame: options.everyNthFrame,
      previewWidth: options.previewWidth,
      timeoutMs: options.timeoutMs,
    });
    const firstOutputIndex = frames.length;
    for (const sample of chunkPayload.frames) {
      sample.sequenceIndex = frames.length;
      frames.push(sample);
    }
    denseCaptureChunks.push({
      chunkIndex,
      requestedFrameCount: requestedChunkFrameCount,
      copiedFrameCount: chunkPayload.capturedFrameCount,
      completedFrameCount: chunkPayload.frames.length,
      firstOutputIndex,
      lastOutputIndex: frames.length - 1,
      firstFrameCount: chunkPayload.frames[0]?.frameCount ?? null,
      lastFrameCount: chunkPayload.frames.at(-1)?.frameCount ?? null,
      denseCaptureFrameDeltas: chunkPayload.denseCaptureFrameDeltas || [],
      denseCaptureSimStepDeltas: chunkPayload.denseCaptureSimStepDeltas || [],
    });
    chunkIndex += 1;
  }
  return {
    ok: true,
    schema: DENSE_CAPTURE_CHUNKED_SCHEMA,
    requestedFrameCount,
    chunkFrameCount,
    frames,
    denseCaptureChunks,
    denseCaptureFrameDeltas: frames.slice(1).map((frame, index) => frame.frameCount - frames[index].frameCount),
    denseCaptureSimStepDeltas: frames.slice(1).map((frame, index) => frame.simStepCount - frames[index].simStepCount),
  };
}

function validateSequence(samples) {
  const dimensions = samples.map(sample => `${sample.preview.width}x${sample.preview.height}`);
  if (new Set(dimensions).size !== 1) {
    const error = new Error(`sequence preview dimensions changed across samples: ${dimensions.join(', ')}`);
    error.code = 'dimension-drift';
    error.failurePhase = 'validation';
    error.details = { dimensions };
    throw error;
  }
  for (let index = 1; index < samples.length; index += 1) {
    if (!(samples[index - 1].frameCount < samples[index].frameCount)) {
      const error = new Error('sequence frame counts are not strictly increasing');
      error.code = 'stale-or-cached-output';
      error.failurePhase = 'validation';
      error.details = { frameCounts: samples.map(sample => sample.frameCount) };
      throw error;
    }
    if (!(samples[index - 1].simStepCount < samples[index].simStepCount)) {
      const error = new Error('sequence sim step counts are not strictly increasing');
      error.code = 'stale-or-cached-output';
      error.failurePhase = 'validation';
      error.details = { simStepCounts: samples.map(sample => sample.simStepCount) };
      throw error;
    }
  }
}

function validateDenseCaptureDeltas(payload, maxFrameDelta) {
  const denseCaptureFrameDeltas = payload.denseCaptureFrameDeltas || [];
  const largestFrameDelta = denseCaptureFrameDeltas.reduce((max, delta) => Math.max(max, delta), 0);
  if (largestFrameDelta > maxFrameDelta) {
    const error = new Error(`dense capture exceeded maxFrameDelta=${maxFrameDelta}; largest delta was ${largestFrameDelta}`);
    error.code = 'dense-capture-sparse';
    error.failurePhase = 'validation';
    error.details = {
      maxFrameDelta,
      largestFrameDelta,
      denseCaptureFrameDeltas,
      denseCaptureSimStepDeltas: payload.denseCaptureSimStepDeltas || [],
    };
    throw error;
  }
}

function renderExternalBaselineCommand(spec, context) {
  return spec.command
    .replaceAll('{first}', shellQuote(context.firstPath))
    .replaceAll('{third}', shellQuote(context.thirdPath))
    .replaceAll('{out}', shellQuote(context.outPath))
    .replaceAll('{outDir}', shellQuote(context.outDir))
    .replaceAll('{gapDir}', shellQuote(context.gapDir))
    .replaceAll('{target}', shellQuote(context.targetPath))
    .replaceAll('{report}', shellQuote(context.candidateContextPath))
    .replaceAll('{candidateContext}', shellQuote(context.candidateContextPath))
    .replaceAll('{gapIndex}', shellQuote(context.gapIndexLabel))
    .replaceAll('{cadence}', shellQuote(context.cadence))
    .replaceAll('{phase}', shellQuote(context.cadencePhase))
    .replaceAll('{ratio}', shellQuote(context.ratio))
    .replaceAll('{candidateId}', shellQuote(spec.id));
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
      candidateId: spec.id,
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
      candidateId: spec.id,
      externalBaselineCommand,
      stdoutPath,
      stderrPath,
      stdout,
      stderr,
    };
    throw error;
  }
  return { externalBaselineCommand, stdoutPath, stderrPath, stdout, stderr };
}

function pathForHtml(outputPath, imagePath) {
  return relative(dirname(outputPath), imagePath).split('/').map(encodeURIComponent).join('/');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function writePlaybackHtml(path, report) {
  const width = report.sequence.width;
  const height = report.sequence.height;
  const fps = 24;
  const truthFrames = report.sequence.frames.map(frame => ({
    label: `F${String(frame.sequenceIndex).padStart(2, '0')} ${frame.role || 'real'}`,
    src: pathForHtml(path, frame.path),
    frameCount: frame.frameCount,
    simStepCount: frame.simStepCount,
    role: frame.role,
    cadencePhase: frame.cadencePhase ?? 0,
  }));
  const candidates = (report.candidates || []).map(candidate => {
    const syntheticFrames = candidate.syntheticCadenceFrames || candidate.syntheticOddFrames || [];
    const syntheticByIndex = new Map(syntheticFrames.map(item => [item.sequenceIndex, item]));
    return {
      id: candidate.id,
      sourceKind: candidate.sourceKind,
      syntheticAuthority: candidate.syntheticAuthority,
      actualMiddleUsed: candidate.actualMiddleUsed,
      summaryMetrics: candidate.summaryMetrics,
      failureModes: candidate.failureModes,
      failures: candidate.failures,
      frames: report.sequence.frames.map(frame => {
        const synthetic = syntheticByIndex.get(frame.sequenceIndex);
        return synthetic
          ? {
            label: `F${String(frame.sequenceIndex).padStart(2, '0')} synthetic p${synthetic.cadencePhase}`,
            src: pathForHtml(path, synthetic.path),
            frameCount: frame.frameCount,
            simStepCount: frame.simStepCount,
            role: 'syntheticCadenceFill',
            cadencePhase: synthetic.cadencePhase,
            metrics: synthetic.metrics,
          }
          : {
            label: `F${String(frame.sequenceIndex).padStart(2, '0')} full-rate truth anchor`,
            src: pathForHtml(path, frame.path),
            frameCount: frame.frameCount,
            simStepCount: frame.simStepCount,
            role: frame.role,
            cadencePhase: frame.cadencePhase ?? 0,
          };
      }),
    };
  });
  const payload = jsonForScript({
    truthFrames,
    candidates,
    fps,
    cadence: report.cadence,
    defaultCandidateId: report.summary?.bestByMeanAbsoluteError?.id || candidates[0]?.id || null,
  });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kaminos Interframe Sequence Playback</title>
<style>
  :root { color-scheme: dark; background: #07090b; color: #eef3f6; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #07090b; }
  header, main { max-width: 1280px; margin: 0 auto; }
  header { display: grid; gap: 10px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
  h2 { margin: 0 0 5px; font-size: 14px; letter-spacing: 0; }
  p { margin: 0; }
  .meta { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .chip { min-height: 50px; border: 1px solid #20303a; background: #101820; padding: 8px 10px; }
  .chip b { display: block; font-size: 10px; color: #85a7ba; text-transform: uppercase; }
  .chip span { display: block; font-size: 12px; overflow-wrap: anywhere; }
  main { display: grid; gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
  .panel { border: 1px solid #1b2830; background: #0c1014; padding: 10px; min-width: 0; }
  .panel p { color: #b7c5ce; font-size: 12px; margin-bottom: 8px; }
  .stage { position: relative; width: 100%; aspect-ratio: ${width} / ${height}; background: #000; overflow: hidden; }
  .stage img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .crop-stage { position: relative; width: 100%; aspect-ratio: ${width} / ${Math.max(1, Math.round(height / 3))}; background: #000; overflow: hidden; }
  .crop-stage img { width: 100%; height: 300%; object-fit: fill; object-position: top left; display: block; }
  .readout { min-height: 54px; display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px; align-items: center; margin-top: 8px; color: #d2dde3; font-size: 12px; }
  .bar { height: 9px; background: #16232b; position: relative; overflow: hidden; }
  .bar span { position: absolute; top: 0; bottom: 0; left: 0; width: 0%; background: #f0b85a; }
  .authority { color: #f0b85a; }
  .transport { display: grid; grid-template-columns: repeat(3, 34px) minmax(160px, 1fr) 76px minmax(260px, 380px); gap: 8px; align-items: center; }
  button, select, input[type="range"] { min-height: 30px; border: 1px solid #315062; background: #111c24; color: #eef3f6; }
  button { width: 34px; cursor: pointer; }
  select { min-width: 0; width: 100%; padding: 0 8px; }
  input[type="range"] { width: 100%; accent-color: #f0b85a; }
  .stats { min-height: 32px; color: #b7c5ce; font-size: 12px; overflow-wrap: anywhere; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
  .stat { border: 1px solid #20303a; background: #101820; padding: 7px 8px; min-height: 42px; }
  .stat b { display: block; font-size: 10px; color: #85a7ba; text-transform: uppercase; }
  .stat span { display: block; font-size: 12px; overflow-wrap: anywhere; }
  @media (max-width: 860px) { body { padding: 10px; } .meta, .grid, .stats-grid, .transport { grid-template-columns: 1fr; } button { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>Kaminos Interframe Sequence Playback</h1>
  <div class="meta">
    <div class="chip"><b>Schema</b><span>${SCHEMA}</span></div>
    <div class="chip"><b>Route</b><span>${escapeHtml(report.sequence.effectiveRoute)}</span></div>
    <div class="chip"><b>Total frames</b><span>${report.totalFrameCount}; cadence ${report.cadence}</span></div>
    <div class="chip"><b>Truth</b><span>${SEQUENCE_AUTHORITY}</span></div>
    <div class="chip"><b>Synthetic</b><span class="authority">${SYNTHETIC_AUTHORITY}; actualMiddleUsed=false</span></div>
  </div>
  <div class="transport">
    <button data-step-back aria-label="Previous frame">&lt;</button>
    <button data-play-toggle aria-label="Pause playback">||</button>
    <button data-step-forward aria-label="Next frame">&gt;</button>
    <input data-frame-scrubber type="range" min="0" max="${Math.max(0, truthFrames.length - 1)}" value="0" step="1" aria-label="Frame scrubber">
    <select data-fps aria-label="Playback frame rate"><option>12</option><option selected>24</option><option>60</option></select>
    <select data-candidate-select aria-label="Comparison candidate"></select>
  </div>
  <div class="stats" id="global-label">F00</div>
</header>
<main>
  <section class="grid">
    <article class="panel" data-truth-panel>
      <h2>Ground truth sequence</h2>
      <p>All frames are exact full-rate simulator captures from this route. Cadence candidates do not receive withheld phase frames.</p>
      <div class="stage" data-truth-stage><img alt="Full-rate live simulator truth frame"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
      <div class="stats" data-truth-stats>${SEQUENCE_AUTHORITY}</div>
    </article>
    <article class="panel" data-candidate-panel>
      <h2 data-candidate-title>Synthetic cadence-fill sequence</h2>
      <p class="authority" data-candidate-authority></p>
      <div class="stage" data-candidate-stage><img alt="Selected synthetic cadence comparison frame"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
      <div class="stats" data-candidate-stats></div>
    </article>
  </section>
  <section class="grid">
    <article class="panel" data-truth-crop-panel>
      <h2>Top smoke crop</h2>
      <p>Upper third of the full-rate truth frame; use this strip to judge smoke-cap crawl without losing the full-frame context above.</p>
      <div class="crop-stage" data-truth-crop-stage><img alt="Full-rate live simulator truth top smoke crop"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
    </article>
    <article class="panel" data-candidate-crop-panel>
      <h2>Top smoke crop: selected candidate</h2>
      <p class="authority">Same upper-third crop from the selected synthetic cadence-fill timeline.</p>
      <div class="crop-stage" data-candidate-crop-stage><img alt="Selected synthetic cadence comparison top smoke crop"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
    </article>
  </section>
  <section class="panel">
    <h2>Selected candidate metrics</h2>
    <p class="authority">Synthetic cadence-fill frames are comparison evidence, never normal live simulator output. In cadence-2 compatibility mode this is the old Synthetic odd-frame sequence.</p>
    <div class="stats-grid" data-metric-grid></div>
  </section>
</main>
<script type="application/json" id="sequence-data">${payload}</script>
<script>
const data = JSON.parse(document.getElementById('sequence-data').textContent);
let index = 0;
let playing = true;
let fps = data.fps;
let lastTime = performance.now();
const truthPanel = document.querySelector('[data-truth-panel]');
const candidatePanel = document.querySelector('[data-candidate-panel]');
const candidateSelect = document.querySelector('[data-candidate-select]');
const frameScrubber = document.querySelector('[data-frame-scrubber]');
const metricGrid = document.querySelector('[data-metric-grid]');
const truthCropPanel = document.querySelector('[data-truth-crop-panel]');
const candidateCropPanel = document.querySelector('[data-candidate-crop-panel]');
let selectedCandidate = data.candidates.find(candidate => candidate.id === data.defaultCandidateId) || data.candidates[0] || null;
function fmt(value) { return Number.isFinite(value) ? value.toFixed(3) : 'n/a'; }
function metricCell(label, value) {
  return '<div class="stat"><b>' + label + '</b><span>' + value + '</span></div>';
}
function candidateStats(candidate) {
  const summary = candidate.summaryMetrics || {};
  return 'target MAE ' + fmt(summary.meanAbsoluteError) + '; RMSE ' + fmt(summary.rootMeanSquaredError) + '; max channel ' + fmt(summary.maxChannelError) + '; failures ' + (candidate.failures || []).length;
}
for (const candidate of data.candidates) {
  const option = document.createElement('option');
  option.value = candidate.id;
  option.textContent = candidate.id + ' | MAE ' + fmt(candidate.summaryMetrics?.meanAbsoluteError);
  candidateSelect.appendChild(option);
}
candidateSelect.value = selectedCandidate ? selectedCandidate.id : '';
function paintPanel(root, frame, frameCount) {
  if (!frame || !frameCount) return;
  root.querySelector('img').src = frame.src;
  root.querySelector('[data-label]').textContent = frame.label + ' / route frame ' + frame.frameCount + ' sim ' + frame.simStepCount;
  root.querySelector('[data-bar]').style.width = ((index + 1) / frameCount * 100).toFixed(2) + '%';
}
function paintCropPanel(root, frame, frameCount) {
  if (!frame || !frameCount) return;
  root.querySelector('img').src = frame.src;
  root.querySelector('[data-label]').textContent = frame.label + ' / top-third smoke crop';
  root.querySelector('[data-bar]').style.width = ((index + 1) / frameCount * 100).toFixed(2) + '%';
}
function paintCandidateMeta() {
  if (!selectedCandidate) return;
  const summary = selectedCandidate.summaryMetrics || {};
  candidatePanel.querySelector('[data-candidate-title]').textContent = 'Synthetic cadence-fill sequence: ' + selectedCandidate.id;
  candidatePanel.querySelector('[data-candidate-authority]').textContent = selectedCandidate.syntheticAuthority + '; actualMiddleUsed=' + selectedCandidate.actualMiddleUsed + '; sourceKind=' + selectedCandidate.sourceKind;
  candidatePanel.querySelector('[data-candidate-stats]').textContent = candidateStats(selectedCandidate);
  metricGrid.innerHTML = [
    metricCell('Mean absolute error', fmt(summary.meanAbsoluteError)),
    metricCell('RMSE', fmt(summary.rootMeanSquaredError)),
    metricCell('Max channel error', fmt(summary.maxChannelError)),
    metricCell('High error pixels', fmt(summary.highErrorPixelRatio)),
    metricCell('Fire MAE', fmt(summary.fireRegionMeanAbsoluteError)),
    metricCell('Smoke MAE', fmt(summary.smokeRegionMeanAbsoluteError)),
    metricCell('Failure modes', (selectedCandidate.failureModes || []).join(', ') || 'none'),
    metricCell('Failures', String((selectedCandidate.failures || []).length)),
  ].join('');
}
function paint() {
  const truthFrame = data.truthFrames[index % data.truthFrames.length];
  const candidateFrame = selectedCandidate?.frames[index % selectedCandidate.frames.length];
  paintPanel(truthPanel, truthFrame, data.truthFrames.length);
  paintPanel(candidatePanel, candidateFrame, selectedCandidate?.frames.length || 0);
  paintCropPanel(truthCropPanel, truthFrame, data.truthFrames.length);
  paintCropPanel(candidateCropPanel, candidateFrame, selectedCandidate?.frames.length || 0);
  frameScrubber.value = String(index % data.truthFrames.length);
  document.getElementById('global-label').textContent = 'F' + String(index).padStart(2, '0');
}
function stepFrame(delta) {
  index = (index + delta + data.truthFrames.length) % data.truthFrames.length;
  paint();
}
function tick(now) {
  if (playing && now - lastTime >= 1000 / fps) {
    lastTime = now;
    stepFrame(1);
  }
  requestAnimationFrame(tick);
}
paintCandidateMeta();
paint();
requestAnimationFrame(tick);
document.querySelector('[data-play-toggle]').addEventListener('click', event => {
  playing = !playing;
  event.currentTarget.textContent = playing ? '||' : '>';
});
document.querySelector('[data-step-back]').addEventListener('click', () => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  stepFrame(-1);
});
document.querySelector('[data-step-forward]').addEventListener('click', () => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  stepFrame(1);
});
document.querySelector('[data-fps]').addEventListener('change', event => {
  fps = Number(event.target.value);
});
frameScrubber.addEventListener('input', event => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  index = Number(event.target.value);
  paint();
});
candidateSelect.addEventListener('change', event => {
  selectedCandidate = data.candidates.find(candidate => candidate.id === event.target.value) || selectedCandidate;
  paintCandidateMeta();
  paint();
});
</script>
</body>
</html>`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

const args = parseArgs(process.argv.slice(2));
const externalBaselineSpecs = parseExternalBaselineSpecs(process.argv.slice(2));
const externalBaselineById = new Map(externalBaselineSpecs.map(spec => [spec.id, spec]));
const candidateIds = [...BUILTIN_CANDIDATES, ...externalBaselineSpecs.map(spec => spec.id)];
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-interframe-sequence-witness');
const renderReportPath = args.get('--render-report') ? resolve(args.get('--render-report')) : null;
const reportPath = resolve(args.get('--report') || renderReportPath || `${outDir}/interframe-sequence-report.json`);
const playbackPath = resolve(args.get('--playback') || `${outDir}/interframe-sequence-playback.html`);
const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
const port = Number(args.get('--debug-port') || 9631);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-interframe-sequence-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 5000);
const totalFrameCount = Number(args.get('--total-frames') || DEFAULT_TOTAL_FRAME_COUNT);
const frameStep = Number(args.get('--frame-step') || DEFAULT_FRAME_STEP);
const cadence = Number(args.get('--cadence') || DEFAULT_CADENCE);
const realAnchorParity = args.get('--real-anchor-parity') || DEFAULT_REAL_ANCHOR_PARITY;
const windowSize = args.get('--window-size') || '1280,960';
const dryRun = args.has('--dry-run');
const reuseDebugPort = args.has('--reuse-debug-port');
const denseCapture = args.has('--dense-capture');
const maxFrameDelta = args.has('--max-frame-delta')
  ? Number(args.get('--max-frame-delta'))
  : denseCapture ? 2 : Number.POSITIVE_INFINITY;
const denseCaptureTimeoutMs = Number(args.get('--dense-capture-timeout-ms') || Math.max(10000, totalFrameCount * frameStep * 500));
const densePreviewWidth = Number(args.get('--dense-preview-width') || 128);
const denseCaptureChunkFrames = args.has('--dense-capture-chunk-frames')
  ? Number(args.get('--dense-capture-chunk-frames'))
  : null;
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');

if (realAnchorParity !== 'even') throw new Error('only realAnchorParity=even is implemented for this witness');
if (!Number.isInteger(cadence) || cadence < 2) throw new Error('--cadence must be an integer >= 2');
if (!Number.isInteger(totalFrameCount) || totalFrameCount < cadence + 1 || (totalFrameCount - 1) % cadence !== 0) {
  throw new Error('--total-frames must be >= cadence + 1 and satisfy (totalFrames - 1) % cadence === 0 so every gap has a closing anchor');
}
if (!Number.isInteger(frameStep) || frameStep < 1) throw new Error('--frame-step must be an integer >= 1');
if (args.has('--max-frame-delta') && (!Number.isFinite(maxFrameDelta) || maxFrameDelta < 1)) throw new Error('--max-frame-delta must be >= 1 when set');
if (!Number.isInteger(densePreviewWidth) || densePreviewWidth < 16) throw new Error('--dense-preview-width must be an integer >= 16');
if (denseCaptureChunkFrames !== null && (!Number.isInteger(denseCaptureChunkFrames) || denseCaptureChunkFrames < 1)) throw new Error('--dense-capture-chunk-frames must be an integer >= 1 when set');

if (renderReportPath) {
  const report = readJson(renderReportPath);
  const targetPlaybackPath = resolve(args.get('--playback') || report.playbackPath || report.artifacts?.playbackHtml || `${dirname(renderReportPath)}/interframe-sequence-playback.html`);
  writePlaybackHtml(targetPlaybackPath, report);
  const sidecarPath = targetPlaybackPath.replace(/\.html$/i, '.json');
  writeJson(sidecarPath, {
    schema: `${SCHEMA}.playback-render.v0`,
    sourceReportPath: renderReportPath,
    playbackPath: targetPlaybackPath,
    renderedAt: new Date().toISOString(),
    totalFrameCount: report.totalFrameCount,
    cadence: report.cadence,
    syntheticOddFrameCount: report.syntheticOddFrameCount,
    syntheticCadenceFrameCount: report.syntheticCadenceFrameCount,
    candidates: (report.candidates || []).map(candidate => candidate.id),
  });
  console.log(JSON.stringify({
    schema: `${SCHEMA}.playback-render.v0`,
    sourceReportPath: renderReportPath,
    playbackPath: targetPlaybackPath,
    sidecarPath,
  }, null, 2));
  process.exit(0);
}

const baseReport = {
  schema: SCHEMA,
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
  playbackPath,
  dryRun,
  reuseDebugPort,
  denseCapture,
  maxFrameDelta: Number.isFinite(maxFrameDelta) ? maxFrameDelta : null,
  denseCaptureTimeoutMs,
  densePreviewWidth: denseCapture ? densePreviewWidth : null,
  denseCaptureChunkFrames,
  settleMs,
  windowSize,
  debugPort: port,
  totalFrameCount,
  cadence,
  realAnchorParity: 'even',
  frameStep,
  realFrameCount: totalFrameCount,
  anchorFrameCount: Math.floor((totalFrameCount - 1) / cadence) + 1,
  cadenceGapCount: Math.floor((totalFrameCount - 1) / cadence),
  syntheticOddFrameCount: totalFrameCount - (Math.floor((totalFrameCount - 1) / cadence) + 1),
  syntheticCadenceFrameCount: totalFrameCount - (Math.floor((totalFrameCount - 1) / cadence) + 1),
  sequenceAuthority: SEQUENCE_AUTHORITY,
  syntheticAuthority: SYNTHETIC_AUTHORITY,
  cadenceAblationBaseline: CADENCE_ABLATION_GAPPED_BASELINE,
  failureModeBuckets: FAILURE_MODE_BUCKETS,
  externalBaselines: externalBaselineSpecs.map(spec => ({ id: spec.id, commandTemplate: spec.command })),
  sequence: null,
  withheldRealOddFrames: [],
  withheldCadenceFrames: [],
  candidates: [],
  summary: {},
  artifacts: {
    playbackHtml: playbackPath,
    realFrameDir: resolve(outDir, 'real-frames'),
    gapDir: resolve(outDir, 'gaps'),
  },
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
  if (!reuseDebugPort) {
    const stdoutPath = resolve(outDir, 'chrome.stdout.log');
    const stderrPath = resolve(outDir, 'chrome.stderr.log');
    const stdoutFd = openSync(stdoutPath, 'w');
    const stderrFd = openSync(stderrPath, 'w');
    proc = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--window-size=${windowSize}`,
      baseUrl,
    ], { stdio: ['ignore', stdoutFd, stderrFd] });
    proc.on('exit', () => {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    });
  }

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
    const error = new Error(`wrong route identity before sequence capture: ${state.effectiveRoute || 'none'} / ${state.prototypeIdentity || 'none'}`);
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
  let denseCapturePayload = null;
  let samples = [];
  if (denseCapture) {
    const denseCaptureOptions = {
      frameCount: totalFrameCount,
      everyNthFrame: frameStep,
      previewWidth: densePreviewWidth,
      timeoutMs: denseCaptureTimeoutMs,
    };
    denseCapturePayload = denseCaptureChunkFrames && denseCaptureChunkFrames < totalFrameCount
      ? await captureDenseSequenceChunked(ws, { ...denseCaptureOptions, chunkFrameCount: denseCaptureChunkFrames })
      : await captureDenseSequence(ws, denseCaptureOptions);
    validateDenseCaptureDeltas(denseCapturePayload, maxFrameDelta);
    samples = denseCapturePayload.frames;
  } else {
    let minimumFrameCount = state.frameCount;
    for (let index = 0; index < totalFrameCount; index += 1) {
      const sample = await captureSample(ws, `sequence-frame-${index}`, minimumFrameCount);
      samples.push(sample);
      minimumFrameCount = sample.frameCount + frameStep;
    }
  }
  validateSequence(samples);

  const width = samples[0].preview.width;
  const height = samples[0].preview.height;
  const frameSummaries = [];
  const frameRgba = [];
  for (let index = 0; index < samples.length; index += 1) {
    const cadencePhaseOffset = index % cadence;
    const role = cadencePhaseOffset === 0 ? 'cadenceAnchor' : 'withheldCadenceFrame';
    const framePath = resolve(outDir, 'real-frames', `real-frame-${String(index).padStart(3, '0')}.png`);
    const rgba = previewRgbaBytes(samples[index]);
    writeRgbaPng(framePath, width, height, rgba);
    frameRgba.push(rgba);
    frameSummaries.push({
      ...summarizeSample(samples[index], role, framePath, index),
      cadence,
      cadencePhaseOffset,
      cadencePhase: cadencePhaseOffset / cadence,
      fullRateTruthAuthority: SEQUENCE_AUTHORITY,
    });
  }

  const sequenceSummary = {
    authority: SEQUENCE_AUTHORITY,
    requestedRoute: baseUrl,
    effectiveRoute: samples[0].effectiveRoute,
    prototypeIdentity: samples[0].prototypeIdentity,
    backend: samples[0].backend,
    width,
    height,
    totalFrameCount,
    cadence,
    realFrameCount: totalFrameCount,
    realAnchorParity,
    fullRateTruthAuthority: SEQUENCE_AUTHORITY,
    frameStep,
    captureMode: denseCapture ? 'render-loop-dense-capture' : 'sampleFrame-polling',
    maxFrameDelta: Number.isFinite(maxFrameDelta) ? maxFrameDelta : null,
    denseCaptureFrameDeltas: denseCapturePayload?.denseCaptureFrameDeltas || null,
    denseCaptureSimStepDeltas: denseCapturePayload?.denseCaptureSimStepDeltas || null,
    denseCaptureChunks: denseCapturePayload?.denseCaptureChunks || null,
    frames: frameSummaries,
    frameCountDeltas: frameSummaries.slice(1).map((frame, index) => frame.frameCount - frameSummaries[index].frameCount),
    simStepCountDeltas: frameSummaries.slice(1).map((frame, index) => frame.simStepCount - frameSummaries[index].simStepCount),
  };
  const withheldCadenceFrames = frameSummaries.filter(frame => frame.sequenceIndex % cadence !== 0);
  const withheldRealOddFrames = withheldCadenceFrames;
  const runningReport = {
    ...baseReport,
    status: 'sequence-captured',
    updatedAt: new Date().toISOString(),
    sequence: sequenceSummary,
    withheldRealOddFrames,
    withheldCadenceFrames,
  };
  writeJson(reportPath, runningReport);

  phase = 'candidate-synthesis';
  const expectedSyntheticFrameCount = withheldCadenceFrames.length;
  const candidateReportsById = new Map(candidateIds.map(id => [id, {
    id,
    sourceKind: externalBaselineById.has(id) ? 'external-command' : 'in-process-baseline',
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    actualMiddleUsed: false,
    syntheticOddFrames: [],
    syntheticCadenceFrames: [],
    perGapMetrics: [],
    failureModes: [],
    failures: [],
  }]));

  for (let anchorIndex = 0; anchorIndex + cadence < totalFrameCount; anchorIndex += cadence) {
    const nextAnchorIndex = anchorIndex + cadence;
    for (let phaseOffset = 1; phaseOffset < cadence; phaseOffset += 1) {
      const targetIndex = anchorIndex + phaseOffset;
      const ratio = phaseOffset / cadence;
      const cadencePhase = ratio;
      const gapIndexLabel = `${String(anchorIndex).padStart(3, '0')}-${String(targetIndex).padStart(3, '0')}-${String(nextAnchorIndex).padStart(3, '0')}`;
      const gapDir = resolve(outDir, 'gaps', `gap-${gapIndexLabel}`);
      mkdirSync(gapDir, { recursive: true });
      const firstFrame = frameSummaries[anchorIndex];
      const thirdFrame = frameSummaries[nextAnchorIndex];
      const targetFrame = frameSummaries[targetIndex];
      const candidateContextPath = resolve(gapDir, `candidate-context-${gapIndexLabel}.json`);
      const candidateContext = {
        schema: SEQUENCE_CONTEXT_SCHEMA,
        status: 'gap-captured',
        authority: SEQUENCE_AUTHORITY,
        fullRateTruthAuthority: SEQUENCE_AUTHORITY,
        syntheticAuthority: SYNTHETIC_AUTHORITY,
        requestedRoute: baseUrl,
        effectiveRoute: sequenceSummary.effectiveRoute,
        prototypeIdentity: sequenceSummary.prototypeIdentity,
        backend: sequenceSummary.backend,
        width,
        height,
        totalFrameCount,
        cadence,
        cadencePhase,
        ratio,
        phaseOffset,
        realAnchorParity: 'even',
        sequenceIndex: targetIndex,
        gapAnchorIndex: anchorIndex,
        nextAnchorIndex,
        t0: firstFrame,
        t1: targetFrame,
        t2: thirdFrame,
        framesAvailableToCandidate: [firstFrame, thirdFrame],
        framesWithheldFromCandidate: [targetFrame],
        actualMiddleUsed: false,
        frameStride: thirdFrame.frameCount - firstFrame.frameCount,
        frameCountDelta: {
          t0ToT1: targetFrame.frameCount - firstFrame.frameCount,
          t1ToT2: thirdFrame.frameCount - targetFrame.frameCount,
          t0ToT2: thirdFrame.frameCount - firstFrame.frameCount,
          firstToWithheld: targetFrame.frameCount - firstFrame.frameCount,
          withheldToThird: thirdFrame.frameCount - targetFrame.frameCount,
          firstToThird: thirdFrame.frameCount - firstFrame.frameCount,
        },
        simStepCountDelta: {
          t0ToT1: targetFrame.simStepCount - firstFrame.simStepCount,
          t1ToT2: thirdFrame.simStepCount - targetFrame.simStepCount,
          t0ToT2: thirdFrame.simStepCount - firstFrame.simStepCount,
          firstToWithheld: targetFrame.simStepCount - firstFrame.simStepCount,
          withheldToThird: thirdFrame.simStepCount - targetFrame.simStepCount,
          firstToThird: thirdFrame.simStepCount - firstFrame.simStepCount,
        },
      };
      writeJson(candidateContextPath, candidateContext);

      for (const id of candidateIds) {
        const candidateReport = candidateReportsById.get(id);
        const outPath = resolve(gapDir, `${id}.png`);
        let commandReceipt = null;
        try {
          if (externalBaselineById.has(id)) {
            commandReceipt = runExternalBaseline(externalBaselineById.get(id), {
              firstPath: firstFrame.path,
              thirdPath: thirdFrame.path,
              targetPath: targetFrame.path,
              outPath,
              outDir,
              gapDir,
              cadence,
              cadencePhase,
              ratio,
              gapIndexLabel,
              candidateContextPath,
            });
          } else {
            const synthetic = builtinCandidateRgba(id, frameRgba[anchorIndex], frameRgba[nextAnchorIndex], ratio);
            writeRgbaPng(outPath, width, height, synthetic);
          }
          const parsed = parsePngRgba(readFileSync(outPath));
          if (parsed.width !== width || parsed.height !== height) throw new Error(`candidate ${id} wrote ${parsed.width}x${parsed.height}, expected ${width}x${height}`);
          const metrics = compareRgba(frameRgba[targetIndex], parsed.rgba, width, height);
          const failureModes = classifyFailureModes(metrics);
          const syntheticFrame = {
            sequenceIndex: targetIndex,
            cadence,
            cadencePhase,
            ratio,
            phaseOffset,
            path: outPath,
            candidateContextPath,
            targetPath: targetFrame.path,
            actualMiddleUsed: false,
            syntheticAuthority: SYNTHETIC_AUTHORITY,
            metrics,
            failureModes,
            commandReceipt,
          };
          candidateReport.syntheticOddFrames.push(syntheticFrame);
          candidateReport.syntheticCadenceFrames.push(syntheticFrame);
          candidateReport.perGapMetrics.push({ sequenceIndex: targetIndex, cadencePhase, ratio, metrics, failureModes });
        } catch (error) {
          candidateReport.failures.push({
            sequenceIndex: targetIndex,
            cadencePhase,
            ratio,
            code: error.code || 'candidate-gap-failed',
            message: error.message,
            failurePhase: error.failurePhase || 'candidate-synthesis',
            details: error.details || null,
          });
        }
      }

      writeJson(reportPath, {
        ...runningReport,
        status: 'candidate-synthesis-in-progress',
        updatedAt: new Date().toISOString(),
        candidates: [...candidateReportsById.values()],
      });
    }
  }

  const candidates = [...candidateReportsById.values()].map(candidate => {
    const metricsList = candidate.perGapMetrics.map(entry => entry.metrics);
    const summaryMetrics = meanMetrics(metricsList);
    const failureModes = [...new Set(candidate.perGapMetrics.flatMap(entry => entry.failureModes))];
    return {
      ...candidate,
      summaryMetrics,
      failureModes: failureModes.length ? failureModes : ['no-completed-gaps'],
    };
  });
  const successfulCandidates = candidates.filter(candidate => candidate.syntheticCadenceFrames.length === expectedSyntheticFrameCount);
  const bestByMeanAbsoluteError = successfulCandidates
    .toSorted((a, b) => a.summaryMetrics.meanAbsoluteError - b.summaryMetrics.meanAbsoluteError)[0] || null;
  const finalReport = {
    ...runningReport,
    status: candidates.some(candidate => candidate.failures.length) ? 'completed-with-candidate-failures' : 'completed',
    updatedAt: new Date().toISOString(),
    candidates,
    summary: {
      bestByMeanAbsoluteError: bestByMeanAbsoluteError ? {
        id: bestByMeanAbsoluteError.id,
        meanAbsoluteError: bestByMeanAbsoluteError.summaryMetrics.meanAbsoluteError,
      } : null,
      candidateOrder: candidates.map(candidate => candidate.id),
    },
  };
  writePlaybackHtml(playbackPath, finalReport);
  writeJson(reportPath, {
    ...finalReport,
    artifacts: {
      ...finalReport.artifacts,
      playbackHtml: playbackPath,
    },
  });
  console.log(JSON.stringify({
    schema: SCHEMA,
    status: finalReport.status,
    reportPath,
    playbackPath,
    totalFrameCount,
    cadence,
    syntheticOddFrameCount: expectedSyntheticFrameCount,
    syntheticCadenceFrameCount: expectedSyntheticFrameCount,
    candidates: candidates.map(candidate => ({
      id: candidate.id,
      completedSyntheticOddFrames: candidate.syntheticOddFrames.length,
      completedSyntheticCadenceFrames: candidate.syntheticCadenceFrames.length,
      failures: candidate.failures.length,
      summaryMetrics: candidate.summaryMetrics,
      failureModes: candidate.failureModes,
    })),
  }, null, 2));
} catch (error) {
  const failed = {
    ...baseReport,
    status: 'failed',
    updatedAt: new Date().toISOString(),
    failurePhase: error.failurePhase || phase,
    failures: [{
      code: error.code || 'interframe-sequence-witness-failed',
      message: error.message,
      failurePhase: error.failurePhase || phase,
      details: error.details || null,
      stack: error.stack,
    }],
  };
  writeJson(reportPath, failed);
  console.error(JSON.stringify(failed.failures[0], null, 2));
  process.exitCode = 1;
} finally {
  if (proc && !proc.killed) proc.kill();
}
