#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const CORPUS_SCHEMA = 'kaminos.volume.frame-locked-pair-corpus.v0';
const PAIR_AUTHORITY = 'frame-locked-render-scale-set-v0';
const IMAGE_AUTHORITY = 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state';
const SEQUENCE_AUTHORITY = 'ordered-settle-time-sequence-v0';
const HARD_LOW_SCALE_PRESET = 'hard-low-scale-v0';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (parsed.has(key)) {
      const current = parsed.get(key);
      parsed.set(key, Array.isArray(current) ? [...current, value] : [current, value]);
    } else {
      parsed.set(key, value);
    }
    if (value !== true) index += 1;
  }
  return parsed;
}

function numberList(value, fallback) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || fallback);
  const numbers = raw
    .split(',')
    .map(entry => Number(entry.trim()))
    .filter(entry => Number.isFinite(entry));
  return numbers.length ? numbers : String(fallback).split(',').map(Number);
}

function clampRenderScale(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 0.1;
  return Math.max(0.1, Math.min(1, requested));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function padIndex(value) {
  return String(value + 1).padStart(3, '0');
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function builtInVariants(preset, defaultSettleMs) {
  if (preset !== HARD_LOW_SCALE_PRESET) {
    throw new Error(`unknown variant preset: ${preset}`);
  }
  return [
    {
      id: 'state-001-canonical-hot-4300',
      label: 'canonical hot early time slice',
      tags: ['canonical', 'time-slice', 'hot'],
      settleMs: 4300,
      overrides: {},
    },
    {
      id: 'state-002-canonical-hot-5400',
      label: 'canonical hot later time slice',
      tags: ['canonical', 'time-slice', 'hot'],
      settleMs: 5400,
      overrides: {},
    },
    {
      id: 'state-003-thin-licks-curl',
      label: 'thin flame licks and curl-heavy edge texture',
      tags: ['thin-licks', 'curl', 'edge-detail'],
      settleMs: Math.max(defaultSettleMs, 5600),
      overrides: {
        volume_curl: 4.0,
        volume_fire: 0.65,
        volume_smoke: 2.25,
        volume_radiance: 3.0,
        volume_microdetail: 2.5,
        volume_interface_shred: 1.4,
        volume_fire_licks: 2.8,
        volume_input_radius: 0.09,
        volume_flow_rate: 0.25,
        volume_detail_scale: 0.9,
      },
    },
    {
      id: 'state-004-smoke-heavy-gradient',
      label: 'dense smoke gradients with broad occupancy',
      tags: ['smoke-heavy', 'gradient', 'occupancy'],
      settleMs: Math.max(defaultSettleMs, 6000),
      overrides: {
        volume_density: 3.45,
        volume_fire: 0.45,
        volume_smoke: 2.8,
        volume_radiance: 2.65,
        volume_glow: 2.5,
        volume_curl: 4.0,
        volume_microdetail: 2.5,
        volume_fire_licks: 0.8,
      },
    },
    {
      id: 'state-005-snuff-quench-vapor',
      label: 'snuff/quench vapor lifecycle front',
      tags: ['snuff', 'quench', 'lifecycle', 'vapor'],
      settleMs: Math.max(defaultSettleMs, 6200),
      overrides: {
        volume_lifecycle_effect: 'snuff',
        volume_lifecycle_t: 0.48,
        volume_quench_vapor: 1,
        volume_fire: 0.55,
        volume_smoke: 2.8,
        volume_radiance: 2.8,
        volume_glow: 2.5,
        volume_curl: 4.0,
        volume_microdetail: 2.5,
        volume_fire_licks: 1.8,
      },
    },
  ];
}

function normalizeVariant(raw, index, defaultSettleMs) {
  const id = String(raw.id || raw.variantId || `variant-${String(index + 1).padStart(3, '0')}`).replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return {
    id,
    label: String(raw.label || raw.name || id),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    settleMs: Number.isFinite(Number(raw.settleMs)) ? Number(raw.settleMs) : defaultSettleMs,
    overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
  };
}

function loadVariants(args, defaultSettleMs) {
  const variantFile = args.get('--variant-file');
  if (variantFile) {
    const payload = readJson(resolve(String(variantFile)));
    const variants = Array.isArray(payload) ? payload : payload.variants;
    if (!Array.isArray(variants) || !variants.length) {
      throw new Error(`variant file has no variants: ${variantFile}`);
    }
    return variants.map((variant, index) => normalizeVariant(variant, index, defaultSettleMs));
  }
  const preset = String(args.get('--variant-preset') || HARD_LOW_SCALE_PRESET);
  return builtInVariants(preset, defaultSettleMs).map((variant, index) => normalizeVariant(variant, index, defaultSettleMs));
}

function routeWithOverrides(baseUrl, overrides) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function readDatasetManifest(path) {
  if (!existsSync(path)) return null;
  const payload = readJson(path);
  return payload.dataset || payload;
}

function temporalPairSortKey(pair) {
  const frameIndex = Number(pair.temporalFrameIndex);
  return [
    Number.isFinite(frameIndex) ? frameIndex : Number.MAX_SAFE_INTEGER,
    String(pair.pairId || ''),
  ];
}

function temporalPairGroupKey(pair) {
  const sequenceId = pair.temporalSequenceId || pair.sequenceId || pair.variantId || 'unsequenced';
  return `${sequenceId}::${Number(pair.lowRenderScale).toFixed(3)}`;
}

function summarizeTemporalSequences(corpus) {
  const bySequence = new Map();
  const adjacentPairs = [];
  for (const pair of corpus.pairs) {
    if (!pair.temporalSequenceId || !Number.isFinite(Number(pair.temporalFrameIndex))) continue;
    const sequence = bySequence.get(pair.temporalSequenceId) || {
      temporalSequenceId: pair.temporalSequenceId,
      sequenceAuthority: pair.sequenceAuthority || SEQUENCE_AUTHORITY,
      sequenceLabel: pair.sequenceLabel || pair.variantLabel || pair.temporalSequenceId,
      sequenceTags: pair.sequenceTags || pair.variantTags || [],
      lowRenderScales: new Set(),
      frameIndices: new Set(),
      pairCount: 0,
      temporalAdjacentPairCount: 0,
    };
    sequence.lowRenderScales.add(Number(pair.lowRenderScale));
    sequence.frameIndices.add(Number(pair.temporalFrameIndex));
    sequence.pairCount += 1;
    bySequence.set(pair.temporalSequenceId, sequence);
  }
  const groups = new Map();
  for (const pair of corpus.pairs) {
    if (!pair.temporalSequenceId || !Number.isFinite(Number(pair.temporalFrameIndex))) continue;
    const key = temporalPairGroupKey(pair);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pair);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const leftKey = temporalPairSortKey(left);
      const rightKey = temporalPairSortKey(right);
      return leftKey[0] - rightKey[0] || leftKey[1].localeCompare(rightKey[1]);
    });
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      const sequence = bySequence.get(current.temporalSequenceId);
      if (sequence) sequence.temporalAdjacentPairCount += 1;
      adjacentPairs.push({
        temporalSequenceId: current.temporalSequenceId,
        lowRenderScale: current.lowRenderScale,
        previousPairId: previous.pairId,
        currentPairId: current.pairId,
        previousTemporalFrameIndex: previous.temporalFrameIndex,
        currentTemporalFrameIndex: current.temporalFrameIndex,
      });
    }
  }
  return {
    temporalAdjacentPairCount: adjacentPairs.length,
    temporalAdjacentPairs: adjacentPairs,
    temporalSequences: Array.from(bySequence.values()).map(sequence => ({
      ...sequence,
      lowRenderScales: Array.from(sequence.lowRenderScales).sort((a, b) => a - b),
      frameIndices: Array.from(sequence.frameIndices).sort((a, b) => a - b),
      capturedFrameCount: sequence.frameIndices.size,
    })).sort((left, right) => left.temporalSequenceId.localeCompare(right.temporalSequenceId)),
  };
}

function variantFailureFromDataset(variant, dataset, fallback) {
  const failure = dataset?.failures?.[0] || fallback || {};
  return {
    variantId: variant.id,
    code: failure.code || 'variant-failed',
    failurePhase: failure.failurePhase || 'unknown',
    message: failure.message || 'variant capture failed',
    details: failure.details || {},
  };
}

function runVariant({ variant, index, args, corpus, cwd }) {
  const variantDir = resolve(corpus.outRoot, variant.id);
  const route = routeWithOverrides(corpus.baseUrl, variant.overrides);

  const summary = {
    id: variant.id,
    label: variant.label,
    tags: variant.tags,
    status: 'running',
    settleMs: variant.settleMs,
    overrides: variant.overrides,
    debugPort: corpus.debugPort + index * 32,
    route,
    manifestPath: null,
    stdout: null,
    stderr: null,
    pairCount: 0,
    sequenceAuthority: corpus.temporalSequenceMode ? SEQUENCE_AUTHORITY : null,
    sequenceFrameCount: corpus.temporalSequenceMode ? corpus.framesPerSequence : 1,
    sequenceFrames: [],
  };
  corpus.variants.push(summary);
  writeJson(corpus.manifestPath, corpus);
  mkdirSync(variantDir, { recursive: true });

  for (let frameIndex = 0; frameIndex < summary.sequenceFrameCount; frameIndex += 1) {
    const frameId = corpus.temporalSequenceMode ? `${variant.id}-frame-${padIndex(frameIndex)}` : variant.id;
    const frameDir = corpus.temporalSequenceMode ? resolve(variantDir, `frame-${padIndex(frameIndex)}`) : variantDir;
    const manifestPath = resolve(frameDir, 'manifest.json');
    const stdout = resolve(frameDir, 'dataset.stdout.log');
    const stderr = resolve(frameDir, 'dataset.stderr.log');
    const sequenceSettleMs = variant.settleMs + frameIndex * corpus.frameStrideMs;
    const debugPort = corpus.debugPort + index * 32 + frameIndex * 4;
    const command = [
      process.execPath,
      'volume-render-pair-dataset.mjs',
      '--out-dir', frameDir,
      '--manifest', manifestPath,
      '--base-url', route,
      '--low-render-scales', corpus.lowRenderScales.join(','),
      '--high-render-scale', String(corpus.highRenderScale),
      '--debug-port', String(debugPort),
      '--settle-ms', String(sequenceSettleMs),
      '--window-size', corpus.windowSize,
      '--evidence-mode', corpus.evidenceMode,
    ];
    if (corpus.dryRun) command.push('--dry-run');
    const frameSummary = {
      frameId,
      temporalFrameIndex: frameIndex,
      sequenceSettleMs,
      frameStrideMs: corpus.frameStrideMs,
      debugPort,
      manifestPath,
      stdout,
      stderr,
      command,
      status: 'running',
      pairCount: 0,
    };
    summary.sequenceFrames.push(frameSummary);
    if (frameIndex === 0) {
      summary.manifestPath = manifestPath;
      summary.stdout = stdout;
      summary.stderr = stderr;
      summary.command = command;
    }
    writeJson(corpus.manifestPath, corpus);
    mkdirSync(frameDir, { recursive: true });
    const started = Date.now();
    const stdoutFd = openSync(stdout, 'w');
    const stderrFd = openSync(stderr, 'w');
    let child;
    try {
      child = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: ['ignore', stdoutFd, stderrFd],
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    frameSummary.durationMs = Date.now() - started;
    const dataset = readDatasetManifest(manifestPath);
    if (child.status !== 0 || !dataset || dataset.failures?.length) {
      frameSummary.status = 'failed';
      summary.status = 'failed';
      summary.failure = variantFailureFromDataset(variant, dataset, {
        code: 'dataset-command-failed',
        failurePhase: dataset ? 'dataset-validation' : 'dataset-spawn',
        message: `volume-render-pair-dataset failed for ${variant.id} frame ${frameIndex}`,
        details: {
          status: child.status,
          signal: child.signal,
          spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
          manifestPath,
          stdout,
          stderr,
        },
      });
      corpus.failures.push({
        ...summary.failure,
        temporalSequenceId: variant.id,
        temporalFrameIndex: frameIndex,
        sequenceSettleMs,
      });
      return summary;
    }
    const capturedPairs = Array.isArray(dataset.pairs)
      ? dataset.pairs.filter(pair => pair.status === 'captured' || corpus.dryRun)
      : [];
    for (const pair of capturedPairs) {
      const sequencePairId = corpus.temporalSequenceMode
        ? `${frameId}-${pair.pairId}`
        : pair.pairId;
      corpus.pairs.push({
        ...pair,
        pairId: sequencePairId,
        sourcePairId: pair.pairId,
        variantId: variant.id,
        variantLabel: variant.label,
        variantTags: variant.tags,
        variantOverrides: variant.overrides,
        variantManifestPath: manifestPath,
        sequenceAuthority: corpus.temporalSequenceMode ? SEQUENCE_AUTHORITY : null,
        sequenceId: corpus.temporalSequenceMode ? variant.id : null,
        sequenceLabel: corpus.temporalSequenceMode ? variant.label : null,
        sequenceTags: corpus.temporalSequenceMode ? variant.tags : null,
        sequenceFrameId: corpus.temporalSequenceMode ? frameId : null,
        sequenceFrameCount: corpus.temporalSequenceMode ? corpus.framesPerSequence : null,
        sequenceSettleMs: corpus.temporalSequenceMode ? sequenceSettleMs : null,
        frameStrideMs: corpus.temporalSequenceMode ? corpus.frameStrideMs : null,
        temporalSequenceId: corpus.temporalSequenceMode ? variant.id : null,
        temporalFrameIndex: corpus.temporalSequenceMode ? frameIndex : null,
        sequenceManifestPath: corpus.temporalSequenceMode ? manifestPath : null,
      });
    }
    frameSummary.status = corpus.dryRun ? 'dry-run' : 'captured';
    frameSummary.pairCount = capturedPairs.length;
    frameSummary.datasetStatus = dataset.status;
    summary.pairCount += capturedPairs.length;
    const temporalSummary = summarizeTemporalSequences(corpus);
    corpus.temporalAdjacentPairCount = temporalSummary.temporalAdjacentPairCount;
    corpus.temporalAdjacentPairs = temporalSummary.temporalAdjacentPairs;
    corpus.temporalSequences = temporalSummary.temporalSequences;
    writeJson(corpus.manifestPath, corpus);
  }
  summary.status = corpus.dryRun ? 'dry-run' : 'captured';
  return summary;
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outRoot = resolve(args.get('--out-dir') || '/tmp/kaminos-frame-locked-pair-corpus');
const manifestPath = resolve(args.get('--manifest') || `${outRoot}/corpus-manifest.json`);
const lowRenderScales = numberList(args.get('--low-render-scales') || args.get('--low-render-scale'), '0.10,0.15,0.18,0.25').map(clampRenderScale);
const highRenderScale = clampRenderScale(args.get('--high-render-scale') || 1);
const settleMs = Number(args.get('--settle-ms') || 5200);
const framesPerSequence = positiveInteger(args.get('--frames-per-sequence'), 1);
const frameStrideMs = nonNegativeNumber(args.get('--frame-stride-ms'), 320);
const temporalSequenceMode = framesPerSequence > 1 || args.has('--frames-per-sequence') || args.has('--frame-stride-ms');
const variants = loadVariants(args, settleMs);
const createdAt = new Date().toISOString();
const corpus = {
  schema: CORPUS_SCHEMA,
  status: args.has('--dry-run') ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  generator: 'volume-render-pair-corpus.mjs',
  cwd,
  gitCommit: gitValue(['rev-parse', 'HEAD']),
  gitBranch: gitValue(['branch', '--show-current']),
  gitStatusShort: gitValue(['status', '--short'], ''),
  outRoot,
  manifestPath,
  baseUrl: String(args.get('--base-url') || DEFAULT_BASE_URL),
  variantPreset: args.get('--variant-file') ? null : String(args.get('--variant-preset') || HARD_LOW_SCALE_PRESET),
  variantFile: args.get('--variant-file') ? resolve(String(args.get('--variant-file'))) : null,
  dryRun: args.has('--dry-run'),
  keepGoing: args.has('--keep-going'),
  pairAuthority: PAIR_AUTHORITY,
  imageAuthority: IMAGE_AUTHORITY,
  sequenceAuthority: temporalSequenceMode ? SEQUENCE_AUTHORITY : null,
  temporalSequenceMode,
  supervisedResidualTrainingSuitable: !args.has('--dry-run'),
  lowRenderScales,
  highRenderScale,
  debugPort: Number(args.get('--debug-port') || 9800),
  settleMs,
  framesPerSequence,
  frameStrideMs,
  windowSize: String(args.get('--window-size') || '1280,960'),
  evidenceMode: String(args.get('--evidence-mode') || 'performance'),
  requestedVariantCount: variants.length,
  pairCount: 0,
  temporalAdjacentPairCount: 0,
  temporalAdjacentPairs: [],
  temporalSequences: [],
  variants: [],
  pairs: [],
  failures: [],
};

writeJson(manifestPath, corpus);
for (let index = 0; index < variants.length; index += 1) {
  runVariant({ variant: variants[index], index, args, corpus, cwd });
  corpus.pairCount = corpus.pairs.length;
  const temporalSummary = summarizeTemporalSequences(corpus);
  corpus.temporalAdjacentPairCount = temporalSummary.temporalAdjacentPairCount;
  corpus.temporalAdjacentPairs = temporalSummary.temporalAdjacentPairs;
  corpus.temporalSequences = temporalSummary.temporalSequences;
  corpus.updatedAt = new Date().toISOString();
  corpus.status = corpus.failures.length ? (corpus.keepGoing ? 'partial' : 'failed') : (corpus.dryRun ? 'dry-run' : 'running');
  writeJson(manifestPath, corpus);
  if (corpus.failures.length && !corpus.keepGoing) break;
}
corpus.pairCount = corpus.pairs.length;
corpus.updatedAt = new Date().toISOString();
if (!corpus.failures.length) {
  corpus.status = corpus.dryRun ? 'dry-run' : 'captured';
} else if (corpus.keepGoing && corpus.pairs.length) {
  corpus.status = 'partial';
} else {
  corpus.status = 'failed';
}
writeJson(manifestPath, corpus);
console.log(JSON.stringify(corpus, null, 2));
if (corpus.failures.length && !corpus.keepGoing) process.exit(1);
