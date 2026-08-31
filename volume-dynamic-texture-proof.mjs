#!/usr/bin/env node
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCHEMA = 'kaminos.volume.dynamic-texture-proof.v0';
const UPDATE_RULE_ID = 'pyro-cellular-detail-memory-deterministic-ca-v0';
const COUPLING_SOURCE = 'live-witness-sim-readback-v0';
const RESET_POLICY = 'live-authority-gated-reset-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const GRID = 72;
const TILE = 128;
const STEPS = 42;
const DEFAULT_CONFIDENCE_FLOOR = 0.18;
const DEFAULT_MAX_INPUT_AGE_MS = 1600;
const NEGATIVE_CONTROLS = [
  'fuel-off-decay',
  'snuff-quench-reset',
  'broad-smoke-no-fire',
  'camera-phase-mismatch',
  'stale-input',
];

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function hash2(x, y, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function makeFixtureReport(label) {
  const live = label === 'live-fire';
  const broadSmoke = label === 'broad-smoke-no-fire';
  const fuelOff = label === 'fuel-off-decay';
  const snuff = label === 'snuff-quench-reset';
  return {
    fixture: true,
    effectiveRoute: EXPECTED_ROUTE,
    prototypeIdentity: EXPECTED_PROTOTYPE,
    volumeScene: broadSmoke ? 'canonical_plume' : 'tall_plume',
    reactionFuelScale: fuelOff ? 0 : 1,
    lifecycleEffect: snuff ? 'snuff' : 'none',
    lifecycleT: snuff ? 0.85 : 0,
    quenchVaporStrength: snuff ? 1.35 : 0,
    flameQuenchModel: snuff ? 'quench-flame-body-v0' : 'inactive',
    frameCount: 240,
    simStepCount: 260,
    simReadback: {
      densityMean: broadSmoke ? 0.028 : 0.015,
      fireLayerMean: live ? 0.032 : 0,
      radianceMean: live ? 0.24 : 0,
      fuelMean: live ? 0.006 : 0,
      reactionMean: live ? 0.035 : 0,
      fireFuelOverlapRatio: live ? 0.86 : 0,
      smokeVisualRiseVelocity: broadSmoke ? 0.22 : 0.14,
      plumeFieldColumnCoherence: broadSmoke ? 0.72 : 0.68,
    },
    volumeReconstructionStyle: 'fixture-no-render',
  };
}

function reportForCase(args, label, fallbackLabel = label) {
  const argKey = `--${label}-report`;
  const path = args.get(argKey);
  if (path) {
    const report = readJson(resolve(path));
    const inputAuthority = report.simReadback
      ? COUPLING_SOURCE
      : report.state
        ? 'live-witness-debug-state-failure-report-v0'
        : 'unknown-report-shape';
    return { path: resolve(path), report, inputAuthority };
  }
  if (args.has('--allow-fixtures') || args.has('--dry-run')) {
    return { path: null, report: makeFixtureReport(fallbackLabel), inputAuthority: 'fixture-synthetic-readback-v0' };
  }
  const error = new Error(`missing report for ${label}; pass ${argKey} or --allow-fixtures`);
  error.failurePhase = 'input';
  error.code = 'missing-input-report';
  throw error;
}

function scalarFromReport(report, label, options = {}) {
  const state = report.state || {};
  const controls = report.controls || state.controls || {};
  const sim = report.simReadback || state.simReadback || {};
  const effectiveRoute = report.effectiveRoute || state.effectiveRoute || state.routeIdentity;
  const prototypeIdentity = report.prototypeIdentity || state.prototypeIdentity;
  const volumeScene = report.volumeScene || state.volumeScene || controls.volumeScene;
  const routeOk = effectiveRoute === EXPECTED_ROUTE && prototypeIdentity === EXPECTED_PROTOTYPE;
  const routeConfidence = routeOk ? 1 : 0;
  const fireSignal = clamp(Math.max(
    Number(sim.fireLayerMean || 0) / 0.018,
    Number(sim.radianceMean || 0) / 0.18,
    Number(sim.reactionMean || 0) / 0.030,
  ));
  const smokeAuthority = clamp(Math.max(
    Number(sim.densityMean || 0) / 0.020,
    Number(sim.smokeVisualRiseVelocity || 0) / 0.18,
  ));
  const reactionFuelScale = Number(report.reactionFuelScale ?? state.reactionFuelScale ?? controls.reactionFuelScale ?? 1);
  const fuelOff = reactionFuelScale <= 0.001 || label === 'fuel-off-decay';
  const lifecycleEffect = report.lifecycleEffect || state.lifecycleEffect || controls.lifecycleEffect || 'none';
  const quenchVaporStrength = Number(report.quenchVaporStrength ?? state.quenchVaporStrength ?? 0);
  const snuff = lifecycleEffect === 'snuff' && quenchVaporStrength > 0.05;
  const broadSmokeNoFire = label === 'broad-smoke-no-fire' || (smokeAuthority > 0.35 && fireSignal < 0.05);
  const phaseMismatch = Boolean(options.cameraPhaseMismatch);
  const inputAgeMs = Number(options.inputAgeMs || 0);
  const staleInput = inputAgeMs > options.maxInputAgeMs;
  const resetReasons = [];
  if (!routeOk) resetReasons.push('wrong-route-or-prototype');
  if (fuelOff) resetReasons.push('fuel-off-decay');
  if (snuff) resetReasons.push('snuff-quench-reset');
  if (broadSmokeNoFire) resetReasons.push('broad-smoke-no-fire');
  if (phaseMismatch) resetReasons.push('camera-phase-mismatch');
  if (staleInput) resetReasons.push('stale-input');
  const resetGate = resetReasons.length > 0 ? 1 : 0;
  const witnessConfidence = clamp(report.temporalReprojectionConfidence ?? state.temporalReprojectionConfidence ?? (fireSignal > 0 ? 0.74 : 0.10));
  const confidence = resetGate ? 0 : clamp(routeConfidence * Math.max(options.confidenceFloor, witnessConfidence));
  const liveFireAuthority = resetGate ? 0 : clamp(routeConfidence * fireSignal * confidence);
  return {
    routeOk,
    routeConfidence,
    fireSignal,
    smokeAuthority,
    reactionFuelScale: Number.isFinite(reactionFuelScale) ? reactionFuelScale : 1,
    fuelOff,
    snuff,
    broadSmokeNoFire,
    phaseMismatch,
    inputAgeMs,
    staleInput,
    resetGate,
    resetReasons,
    confidence,
    liveFireAuthority,
    fieldKeys: {
      effectiveRoute: effectiveRoute || null,
      prototypeIdentity: prototypeIdentity || null,
      volumeScene: volumeScene || null,
      frameCount: report.frameCount ?? state.frameCount ?? null,
      simStepCount: report.simStepCount ?? state.simStepCount ?? null,
      densityMean: sim.densityMean ?? null,
      fireLayerMean: sim.fireLayerMean ?? null,
      radianceMean: sim.radianceMean ?? null,
      reactionMean: sim.reactionMean ?? null,
      fireFuelOverlapRatio: sim.fireFuelOverlapRatio ?? null,
      smokeVisualRiseVelocity: sim.smokeVisualRiseVelocity ?? null,
      lifecycleEffect,
      quenchVaporStrength,
      temporalReprojectionConfidence: report.temporalReprojectionConfidence ?? state.temporalReprojectionConfidence ?? null,
    },
  };
}

function seedState(label) {
  const energy = new Float32Array(GRID * GRID);
  const phase = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const i = y * GRID + x;
      const nx = (x + 0.5) / GRID;
      const ny = (y + 0.5) / GRID;
      const root = Math.exp(-Math.pow((nx - 0.5) / 0.18, 2) - Math.pow((ny - 0.78) / 0.28, 2));
      energy[i] = 0.11 * root + 0.055 * hash2(x, y, label.length);
      phase[i] = hash2(x, y, label.length + 13);
    }
  }
  return { energy, phase };
}

function updateCase(label, authority) {
  const state = seedState(label);
  const next = new Float32Array(GRID * GRID);
  const history = [];
  let preMean = mean(state.energy);
  for (let step = 0; step < STEPS; step += 1) {
    const t = step / Math.max(1, STEPS - 1);
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const i = y * GRID + x;
        const xm = Math.max(0, x - 1);
        const xp = Math.min(GRID - 1, x + 1);
        const ym = Math.max(0, y - 1);
        const yp = Math.min(GRID - 1, y + 1);
        const avg = (
          state.energy[y * GRID + xm] +
          state.energy[y * GRID + xp] +
          state.energy[ym * GRID + x] +
          state.energy[yp * GRID + x]
        ) * 0.25;
        const nx = (x + 0.5) / GRID;
        const ny = (y + 0.5) / GRID;
        const plume = Math.exp(-Math.pow((nx - 0.5 - Math.sin((ny + t) * 5.2) * 0.035) / 0.17, 2)) *
          Math.exp(-Math.pow((ny - 0.68) / 0.38, 2));
        const lick = Math.max(0, Math.sin((ny * 9.5 + t * 4.0 + state.phase[i] * 6.28)) * 0.5 + 0.5);
        const liveInjection = authority.liveFireAuthority * plume * (0.45 + 0.55 * lick);
        const smokeDamp = authority.smokeAuthority * 0.018;
        const resetDecay = authority.resetGate ? 0.58 : 0.88;
        const memory = state.energy[i] * resetDecay + avg * (authority.resetGate ? 0.06 : 0.14);
        next[i] = clamp(memory + liveInjection * 0.34 - smokeDamp, 0, 1);
      }
    }
    state.energy.set(next);
    if (step === 0 || step === Math.floor(STEPS / 2) || step === STEPS - 1) {
      history.push({ step, energyMean: mean(state.energy), energyMax: max(state.energy) });
    }
  }
  const finalMean = mean(state.energy);
  const finalMax = max(state.energy);
  const shouldReset = authority.resetGate === 1;
  const passed = shouldReset ? finalMean < 0.050 && finalMax < 0.22 : finalMean > Math.max(0.035, preMean * 1.15);
  return {
    state,
    metrics: {
      preEnergyMean: preMean,
      finalEnergyMean: finalMean,
      finalEnergyMax: finalMax,
      energyDelta: finalMean - preMean,
      history,
      shouldReset,
      passed,
      verdict: passed
        ? (shouldReset ? 'reset-decayed' : 'live-coupled-detail-survived')
        : (shouldReset ? 'fake-fire-persistence' : 'live-fire-did-not-drive-detail'),
    },
  };
}

function mean(array) {
  let sum = 0;
  for (const value of array) sum += value;
  return sum / Math.max(1, array.length);
}

function max(array) {
  let top = 0;
  for (const value of array) if (value > top) top = value;
  return top;
}

function paintTile(rgba, sheetWidth, tileX, tileY, caseResult) {
  const { state, authority } = caseResult;
  const passed = caseResult.metrics.passed;
  const border = passed ? [74, 190, 129] : [220, 58, 42];
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const gx = Math.min(GRID - 1, Math.floor((x / TILE) * GRID));
      const gy = Math.min(GRID - 1, Math.floor((y / TILE) * GRID));
      const e = state.energy[gy * GRID + gx];
      const smoke = authority.smokeAuthority;
      const confidence = authority.confidence;
      const outX = tileX + x;
      const outY = tileY + y;
      const o = (outY * sheetWidth + outX) * 4;
      const edge = x < 4 || y < 4 || x >= TILE - 4 || y >= TILE - 4;
      const resetTint = authority.resetGate ? 1 : 0;
      rgba[o] = edge ? border[0] : Math.round(18 + e * 220 + confidence * 18);
      rgba[o + 1] = edge ? border[1] : Math.round(22 + e * 108 + smoke * 34 + resetTint * 28);
      rgba[o + 2] = edge ? border[2] : Math.round(28 + smoke * 105 + resetTint * 80);
      rgba[o + 3] = 255;
    }
  }
}

function buildSheet(cases, path) {
  const sheetWidth = TILE * cases.length;
  const sheetHeight = TILE;
  const rgba = new Uint8ClampedArray(sheetWidth * sheetHeight * 4);
  rgba.fill(14);
  cases.forEach((caseResult, index) => {
    paintTile(rgba, sheetWidth, index * TILE, 0, caseResult);
  });
  writeRgbaPng(path, sheetWidth, sheetHeight, rgba);
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-dynamic-texture-proof');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/manifest.json`);
const sheetPath = resolve(args.get('--out') || `${outDir}/dynamic-texture-proof.png`);
const confidenceFloor = clamp(args.get('--confidence-floor') ?? DEFAULT_CONFIDENCE_FLOOR, 0, 0.95);
const maxInputAgeMs = Math.max(1, Number(args.get('--max-input-age-ms') || DEFAULT_MAX_INPUT_AGE_MS));
const createdAt = new Date().toISOString();

const manifest = {
  schema: SCHEMA,
  status: 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit: gitValue(['rev-parse', 'HEAD']),
  gitBranch: gitValue(['branch', '--show-current']),
  gitStatusShort: gitValue(['status', '--short'], ''),
  updateRule: UPDATE_RULE_ID,
  couplingSource: COUPLING_SOURCE,
  resetPolicy: RESET_POLICY,
  confidenceFloor,
  maxInputAgeMs,
  grid: { width: GRID, height: GRID, steps: STEPS },
  negativeControls: NEGATIVE_CONTROLS,
  sheet: sheetPath,
  cases: [],
  failures: [],
};

writeJson(manifestPath, { dynamicTextureProof: manifest });

try {
  const liveInput = reportForCase(args, 'live-fire');
  const inputs = [
    { label: 'live-fire', input: liveInput, options: {} },
    { label: 'fuel-off-decay', input: reportForCase(args, 'fuel-off-decay'), options: {} },
    { label: 'snuff-quench-reset', input: reportForCase(args, 'snuff-quench-reset'), options: {} },
    { label: 'broad-smoke-no-fire', input: reportForCase(args, 'broad-smoke-no-fire'), options: {} },
    {
      label: 'camera-phase-mismatch',
      input: liveInput,
      options: { cameraPhaseMismatch: true },
    },
    {
      label: 'stale-input',
      input: liveInput,
      options: { inputAgeMs: maxInputAgeMs + 1 },
    },
  ];
  const results = [];
  for (const entry of inputs) {
    const authority = scalarFromReport(entry.input.report, entry.label, {
      confidenceFloor,
      maxInputAgeMs,
      ...entry.options,
    });
    const updated = updateCase(entry.label, authority);
    const caseReport = {
      label: entry.label,
      reportPath: entry.input.path,
      inputAuthority: entry.input.inputAuthority,
      authority,
      metrics: updated.metrics,
      tile: { x: results.length * TILE, y: 0, width: TILE, height: TILE },
    };
    results.push({ ...caseReport, state: updated.state.energy });
    manifest.cases.push(caseReport);
    if (!updated.metrics.passed) {
      manifest.failures.push({
        label: entry.label,
        code: updated.metrics.verdict,
        failurePhase: 'update-rule-validation',
        authority,
        metrics: updated.metrics,
      });
    }
  }
  buildSheet(results.map((result) => ({
    authority: result.authority,
    metrics: result.metrics,
    state: { energy: result.state },
  })), sheetPath);
  manifest.status = manifest.failures.length ? 'failed' : 'captured';
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, { dynamicTextureProof: manifest });
  console.log(JSON.stringify({ dynamicTextureProof: manifest }, null, 2));
  if (manifest.failures.length) process.exit(1);
} catch (error) {
  manifest.status = 'failed';
  manifest.updatedAt = new Date().toISOString();
  manifest.failures.push({
    code: error.code || 'dynamic-texture-proof-failed',
    failurePhase: error.failurePhase || 'unknown',
    message: error.message,
  });
  writeJson(manifestPath, { dynamicTextureProof: manifest });
  console.error(JSON.stringify({ dynamicTextureProof: manifest }, null, 2));
  process.exit(1);
}
