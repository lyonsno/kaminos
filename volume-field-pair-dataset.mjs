#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const DATASET_SCHEMA = 'kaminos.volume.field-pair-dataset.v0';
const FIELD_PROJECTION_TENSOR_SCHEMA = 'kaminos.volume.field-projection-tensor.v0';
const SAME_STATE_FREEZE_PREFLIGHT_SCHEMA = 'kaminos.volume.same-state-freeze-preflight.v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const PAIR_AUTHORITY = 'route-paired-sequential-field-readbacks-not-frame-locked';
const FIELD_AUTHORITY = 'webgpu-copy-src-readback-simReadback-summary-and-majorant';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';
const SUPPORTED_GRIDS = [96, 128, 160];
const SUPPORTED_MAJORANT_GRIDS = [24, 32, 48];

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

function numberList(value, fallback) {
  const source = String(value || fallback).split(',');
  const numbers = source
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return numbers.length ? numbers : String(fallback).split(',').map(Number);
}

function nearestSupported(value, supported, fallback) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return fallback;
  return supported.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ), fallback);
}

function gridSlug(value) {
  return `g${nearestSupported(value, SUPPORTED_GRIDS, 96)}`;
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

function routeWithGrid(baseUrl, grid, majorantGrid) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_resolution', String(nearestSupported(grid, SUPPORTED_GRIDS, 96)));
  url.searchParams.set('volume_majorant_grid', String(nearestSupported(majorantGrid, SUPPORTED_MAJORANT_GRIDS, 48)));
  url.searchParams.set('volume_sim_profile', '1');
  return url.toString();
}

function fieldShapeFromReadback(simReadback, majorantReadback, simCostLedger) {
  const grid = Number(simReadback?.grid);
  const voxelCount = grid * grid * grid;
  const fluidBufferBytes = Number(simReadback?.fluidBufferBytes ?? simCostLedger?.fluidBufferBytes);
  const frontFieldBytes = Number(simReadback?.frontFieldBytes);
  const fluidComponents = Number.isFinite(fluidBufferBytes) && voxelCount > 0
    ? Math.round(fluidBufferBytes / (voxelCount * Float32Array.BYTES_PER_ELEMENT))
    : null;
  const frontComponents = Number.isFinite(frontFieldBytes) && voxelCount > 0
    ? Math.round(frontFieldBytes / (voxelCount * Float32Array.BYTES_PER_ELEMENT))
    : null;
  return {
    grid,
    voxelCount,
    fluidBufferBytes,
    fluidComponents,
    fluidComponentLayout: fluidComponents === 16 ? 'four-vec4-slots-per-cell' : 'unknown-from-readback-bytes',
    frontFieldIdentity: simReadback?.frontFieldIdentity || null,
    frontFieldBytes,
    frontComponents,
    majorantGrid: Number(majorantReadback?.grid),
    majorantBricks: Number(majorantReadback?.bricks),
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function makeBinTensor(name, bins, channels) {
  const rows = Array.isArray(bins) ? bins : [];
  return {
    name,
    dtype: 'float32-json-number-array',
    shape: [rows.length, channels.length],
    channels,
    data: rows.flatMap((row) => channels.map((channel) => finiteNumber(row?.[channel]))),
  };
}

function buildFieldProjectionTensor({ witness, plan, fieldShape, simReadback, majorantReadback, simCostLedger }) {
  const plumeHeightChannels = [
    'yMin',
    'yMax',
    'smokeWeight',
    'smokeRadialBreadth',
    'smokeVelocityY',
    'smokeLateralVelocityMean',
    'smokeWeightedCurlMean',
    'fireWeight',
    'fireInteriorWeight',
    'fireRingWeight',
    'emissionDetailWeight',
    'smokeDetailWeight',
    'combustionFrontWeight',
    'frontTopologyWeight',
  ];
  const sourceRelativeChannels = [
    'visualCenter',
    'smokeWeight',
    'fireWeight',
    'fireInteriorWeight',
    'fireRingWeight',
    'fireFlameWeight',
    'fireEmberWeight',
    'fireFlameDetailWeight',
    'fireLickWeight',
    'fireHeatWeight',
    'emissionDetailWeight',
    'smokeDetailWeight',
    'combustionFrontWeight',
    'frontTopologyWeight',
    'smokeVisualRiseVelocity',
    'fireVisualRiseVelocity',
  ];
  const fieldProjectionTensor = {
    schema: FIELD_PROJECTION_TENSOR_SCHEMA,
    identity: 'kaminos-field-summary-projection-v0',
    fieldAuthority: FIELD_AUTHORITY,
    sourceReport: plan.report,
    requestedRoute: plan.route,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    captureBackend: witness.captureBackend,
    role: plan.role,
    requestedGrid: plan.requestedGrid,
    simGrid: simReadback.grid,
    requestedMajorantGrid: plan.requestedMajorantGrid,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    fieldShape,
    tensors: {
      plumeHeightBins: makeBinTensor('plumeHeightBins', simReadback.plumeHeightBins, plumeHeightChannels),
      sourceRelativeVisualHeightBins: makeBinTensor('sourceRelativeVisualHeightBins', simReadback.sourceRelativeVisualHeightBins, sourceRelativeChannels),
      scalarSummary: {
        name: 'scalarSummary',
        dtype: 'float32-json-number-array',
        shape: [1, 18],
        channels: [
          'densityMean',
          'densityMax',
          'heatMean',
          'fuelMean',
          'reactionMean',
          'fireLayerMean',
          'radianceMean',
          'extinctionMean',
          'detailMean',
          'microdetailMean',
          'combustionFrontMean',
          'frontTopologyMean',
          'velocityMean',
          'curlMean',
          'divergenceMean',
          'liveVoxels',
          'majorantOccupiedBricks',
          'majorantImportanceMax',
        ],
        data: [
          finiteNumber(simReadback.densityMean),
          finiteNumber(simReadback.densityMax),
          finiteNumber(simReadback.heatMean),
          finiteNumber(simReadback.fuelMean),
          finiteNumber(simReadback.reactionMean),
          finiteNumber(simReadback.fireLayerMean),
          finiteNumber(simReadback.radianceMean),
          finiteNumber(simReadback.extinctionMean),
          finiteNumber(simReadback.detailMean),
          finiteNumber(simReadback.microdetailMean),
          finiteNumber(simReadback.combustionFrontMean),
          finiteNumber(simReadback.frontTopologyMean),
          finiteNumber(simReadback.velocityMean),
          finiteNumber(simReadback.curlMean),
          finiteNumber(simReadback.divergenceMean),
          finiteNumber(simReadback.liveVoxels),
          finiteNumber(majorantReadback.occupiedBricks),
          finiteNumber(majorantReadback.importanceMax),
        ],
      },
    },
    pressureCues: {
      pressureSourceStrategy: simCostLedger.pressureSourceStrategy,
      pressureStrategy: simCostLedger.pressureStrategy,
      pressureJacobiPasses: simCostLedger.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: simCostLedger.pressureJacobiInlineDivergencePasses,
      fullGridPassBreakdown: simCostLedger.fullGridPassBreakdown,
    },
    limitation: 'Compact projection tensor is derived from live readback summaries/bins; it is trainable feature material, not dense 3D field export.',
  };
  writeJson(plan.fieldProjectionTensor, { fieldProjectionTensor });
  return {
    schema: FIELD_PROJECTION_TENSOR_SCHEMA,
    identity: fieldProjectionTensor.identity,
    path: plan.fieldProjectionTensor,
    dtype: 'float32-json-number-array',
    tensors: Object.fromEntries(Object.entries(fieldProjectionTensor.tensors).map(([key, tensor]) => [
      key,
      {
        shape: tensor.shape,
        channels: tensor.channels,
      },
    ])),
  };
}

function buildSameStateFreezeAttempt() {
  return {
    schema: SAME_STATE_FREEZE_PREFLIGHT_SCHEMA,
    status: 'blocked-by-missing-simulator-hook',
    code: 'same-state-grid-snapshot-unsupported',
    failurePhase: 'pairing-preflight',
    requestedPairing: 'same-state low/high simulation-grid field readbacks',
    effectivePairing: PAIR_AUTHORITY,
    currentEvidence: [
      'volume_resolution changes rebuildFluidState() and resets GPU fluid buffers',
      'sampleFrame() can copy current fluid/front/majorant buffers but cannot export/import them into a different grid instance',
      'no deterministic cross-grid seed/replay or frozen snapshot restore hook is exposed to volume-witness.mjs',
    ],
    requiredHook: 'Expose a simulator snapshot/reseed path that can clone or deterministically replay fluid/front/majorant state across requested low/high grids before readback.',
  };
}

function summarizeFieldEvidence(witness, plan) {
  const simReadback = witness.simReadback || null;
  const majorantReadback = witness.majorantReadback || null;
  const simCostLedger = witness.simCostLedger || null;
  const effectiveGrid = Number(witness.simGrid ?? simReadback?.grid);
  if (witness.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID) {
    const error = new Error(`wrong-fallback-route: expected ${EXPECTED_VOLUME_ROUTE_ID}, got ${witness.effectiveRoute || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_VOLUME_ROUTE_ID, effective: witness.effectiveRoute, report: plan.report };
    throw error;
  }
  if (witness.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`absent-effective-identity: expected ${EXPECTED_PROTOTYPE_ID}, got ${witness.prototypeIdentity || 'none'}`);
    error.code = 'absent-effective-identity';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_PROTOTYPE_ID, effective: witness.prototypeIdentity, report: plan.report };
    throw error;
  }
  if (!Number.isFinite(effectiveGrid) || effectiveGrid !== plan.requestedGrid || simReadback?.grid !== plan.requestedGrid) {
    const error = new Error(`stale-default-config: requested sim grid ${plan.requestedGrid}, got witness ${effectiveGrid} and readback ${simReadback?.grid}`);
    error.code = 'stale-default-config';
    error.failurePhase = 'validation';
    error.details = { requestedGrid: plan.requestedGrid, effectiveGrid, readbackGrid: simReadback?.grid, report: plan.report };
    throw error;
  }
  if (!simReadback || !Number.isFinite(simReadback.densityMax)) {
    const error = new Error('missing-primary-report: witness did not preserve live simReadback field evidence');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = { simReadback, report: plan.report };
    throw error;
  }
  if (!majorantReadback || majorantReadback.grid !== plan.requestedMajorantGrid || majorantReadback.occupiedBricks < 2) {
    const error = new Error('blank-or-partial-output: witness did not preserve live majorantReadback occupancy evidence');
    error.code = 'blank-or-partial-output';
    error.failurePhase = 'validation';
    error.details = { requestedMajorantGrid: plan.requestedMajorantGrid, majorantReadback, report: plan.report };
    throw error;
  }
  if (!simCostLedger || simCostLedger.routeIdentity !== EXPECTED_VOLUME_ROUTE_ID || simCostLedger.grid !== plan.requestedGrid) {
    const error = new Error('missing-primary-report: sim cost ledger is absent or does not match the effective grid');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = { requestedGrid: plan.requestedGrid, simCostLedger, report: plan.report };
    throw error;
  }
  const fieldShape = fieldShapeFromReadback(simReadback, majorantReadback, simCostLedger);
  const fieldProjectionTensor = buildFieldProjectionTensor({
    witness,
    plan,
    fieldShape,
    simReadback,
    majorantReadback,
    simCostLedger,
  });
  return {
    path: plan.out,
    fullScreenshot: plan.fullScreenshot,
    report: plan.report,
    fieldAuthority: FIELD_AUTHORITY,
    requestedGrid: plan.requestedGrid,
    simGrid: effectiveGrid,
    requestedMajorantGrid: plan.requestedMajorantGrid,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    captureBackend: witness.captureBackend,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    volumeScene: witness.volumeScene,
    fieldShape,
    fieldProjectionTensor,
    simReadback: {
      grid: simReadback.grid,
      samples: simReadback.samples,
      fluidBufferBytes: simReadback.fluidBufferBytes ?? simCostLedger.fluidBufferBytes,
      frontFieldIdentity: simReadback.frontFieldIdentity,
      frontFieldBytes: simReadback.frontFieldBytes,
      densityMean: simReadback.densityMean,
      densityMax: simReadback.densityMax,
      heatMean: simReadback.heatMean,
      fuelMean: simReadback.fuelMean,
      reactionMean: simReadback.reactionMean,
      fireLayerMean: simReadback.fireLayerMean,
      radianceMean: simReadback.radianceMean,
      extinctionMean: simReadback.extinctionMean,
      detailMean: simReadback.detailMean,
      microdetailMean: simReadback.microdetailMean,
      combustionFrontMean: simReadback.combustionFrontMean,
      frontTopologyMean: simReadback.frontTopologyMean,
      velocityMean: simReadback.velocityMean,
      curlMean: simReadback.curlMean,
      divergenceMean: simReadback.divergenceMean,
      liveVoxels: simReadback.liveVoxels,
      smokeWeight: simReadback.smokeWeight,
      fireWeight: simReadback.fireWeight,
      plumeHeightBins: simReadback.plumeHeightBins,
      sourceRelativeVisualHeightBins: simReadback.sourceRelativeVisualHeightBins,
    },
    majorantReadback: {
      grid: majorantReadback.grid,
      bricks: majorantReadback.bricks,
      occupiedBricks: majorantReadback.occupiedBricks,
      densityMean: majorantReadback.densityMean,
      densityMax: majorantReadback.densityMax,
      radianceMean: majorantReadback.radianceMean,
      radianceMax: majorantReadback.radianceMax,
      extinctionMean: majorantReadback.extinctionMean,
      extinctionMax: majorantReadback.extinctionMax,
      importanceMean: majorantReadback.importanceMean,
      importanceMax: majorantReadback.importanceMax,
    },
    pressureCues: {
      pressureSourceStrategy: simCostLedger.pressureSourceStrategy,
      pressureStrategy: simCostLedger.pressureStrategy,
      pressureJacobiPasses: simCostLedger.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: simCostLedger.pressureJacobiInlineDivergencePasses,
      fullGridPassBreakdown: simCostLedger.fullGridPassBreakdown,
    },
    occupancyCues: {
      liveVoxels: simReadback.liveVoxels,
      majorantOccupiedBricks: majorantReadback.occupiedBricks,
      majorantImportanceMax: majorantReadback.importanceMax,
      smokeWeight: simReadback.smokeWeight,
      fireWeight: simReadback.fireWeight,
    },
    simCostLedger,
    controls: witness.controls || null,
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    performanceVisualWarnings: witness.performanceVisualWarnings || [],
  };
}

function makeCapturePlan({ pairId, role, grid, majorantGrid, route, pairDir, debugPort, settleMs, windowSize, evidenceMode }) {
  const slug = `${pairId}-${role}-${gridSlug(grid)}`;
  const out = resolve(pairDir, `${slug}.png`);
  const report = resolve(pairDir, `${slug}.json`);
  const fullScreenshot = resolve(pairDir, `${slug}.full.png`);
  const stdout = resolve(pairDir, `${slug}.stdout.log`);
  const stderr = resolve(pairDir, `${slug}.stderr.log`);
  const fieldProjectionTensor = resolve(pairDir, `${slug}.field-projection-tensor.json`);
  const command = [
    process.execPath,
    'volume-witness.mjs',
    '--url', route,
    '--out', out,
    '--report', report,
    '--full-screenshot', fullScreenshot,
    '--debug-port', String(debugPort),
    '--settle-ms', String(settleMs),
    '--window-size', windowSize,
    '--evidence-mode', evidenceMode,
  ];
  return {
    role,
    requestedGrid: nearestSupported(grid, SUPPORTED_GRIDS, 96),
    requestedMajorantGrid: nearestSupported(majorantGrid, SUPPORTED_MAJORANT_GRIDS, 48),
    route,
    out,
    report,
    fullScreenshot,
    fieldProjectionTensor,
    stdout,
    stderr,
    command,
  };
}

function runCapture(plan, cwd) {
  mkdirSync(dirname(plan.out), { recursive: true });
  const stdoutFd = openSync(plan.stdout, 'w');
  const stderrFd = openSync(plan.stderr, 'w');
  let child;
  try {
    child = spawnSync(plan.command[0], plan.command.slice(1), {
      cwd,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (child.status !== 0) {
    const error = new Error(`capture failed for ${plan.role} sim grid ${plan.requestedGrid}`);
    error.code = 'capture-failed';
    error.failurePhase = 'capture';
    error.details = {
      status: child.status,
      signal: child.signal,
      spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
      stdout: plan.stdout,
      stderr: plan.stderr,
      report: plan.report,
    };
    throw error;
  }
  const witness = readJson(plan.report);
  return summarizeFieldEvidence(witness, plan);
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-field-pair-dataset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/manifest.json`);
const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
const lowGrids = numberList(args.get('--low-grids') || args.get('--low-grid'), '96').map((grid) => nearestSupported(grid, SUPPORTED_GRIDS, 96));
const highGrid = nearestSupported(args.get('--high-grid') || 128, SUPPORTED_GRIDS, 128);
const majorantGrid = nearestSupported(args.get('--majorant-grid') || 48, SUPPORTED_MAJORANT_GRIDS, 48);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = Number(args.get('--debug-port') || 9700);
const evidenceMode = String(args.get('--evidence-mode') || 'performance');
const dryRun = args.has('--dry-run');
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');
const pairs = lowGrids.map((lowGrid, index) => {
  const pairId = `pair-${String(index + 1).padStart(3, '0')}-${gridSlug(lowGrid)}-to-${gridSlug(highGrid)}`;
  const pairDir = resolve(outDir, pairId);
  const lowRoute = routeWithGrid(baseUrl, lowGrid, majorantGrid);
  const highRoute = routeWithGrid(baseUrl, highGrid, majorantGrid);
  return {
    pairId,
    pairAuthority: PAIR_AUTHORITY,
    fieldAuthority: FIELD_AUTHORITY,
    lowGrid,
    highGrid,
    gridScaleRatio: highGrid / lowGrid,
    voxelCountRatio: (highGrid ** 3) / (lowGrid ** 3),
    majorantGrid,
    low: makeCapturePlan({
      pairId,
      role: 'low',
      grid: lowGrid,
      majorantGrid,
      route: lowRoute,
      pairDir,
      debugPort: debugPort + index * 2,
      settleMs,
      windowSize,
      evidenceMode,
    }),
    high: makeCapturePlan({
      pairId,
      role: 'high',
      grid: highGrid,
      majorantGrid,
      route: highRoute,
      pairDir,
      debugPort: debugPort + index * 2 + 1,
      settleMs,
      windowSize,
      evidenceMode,
    }),
  };
});

const manifest = {
  schema: DATASET_SCHEMA,
  status: dryRun ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  baseUrl,
  outDir,
  manifestPath,
  dryRun,
  pairAuthority: PAIR_AUTHORITY,
  fieldAuthority: FIELD_AUTHORITY,
  sameStateFreezeAttempt: buildSameStateFreezeAttempt(),
  limitation: 'Pairs are live sequential readbacks from the same route family; they preserve field authority but are not frame-locked supervised tensors.',
  lowGrids,
  lowGrid: lowGrids[0],
  highGrid,
  gridScaleRatio: highGrid / lowGrids[0],
  voxelCountRatio: (highGrid ** 3) / (lowGrids[0] ** 3),
  majorantGrid,
  settleMs,
  windowSize,
  evidenceMode,
  pairs,
  failures: [],
};

writeJson(manifestPath, { dataset: manifest });

if (!dryRun) {
  for (const pair of manifest.pairs) {
    try {
      pair.high.effective = runCapture(pair.high, cwd);
      pair.low.effective = runCapture(pair.low, cwd);
      pair.status = 'captured';
    } catch (error) {
      pair.status = 'failed';
      const failure = {
        pairId: pair.pairId,
        code: error.code || 'capture-failed',
        failurePhase: error.failurePhase || 'unknown',
        message: error.message,
        details: error.details || {},
      };
      pair.failure = failure;
      manifest.failures.push(failure);
      break;
    } finally {
      manifest.updatedAt = new Date().toISOString();
      manifest.status = manifest.failures.length ? 'failed' : 'running';
      writeJson(manifestPath, { dataset: manifest });
    }
  }
  if (!manifest.failures.length) {
    manifest.status = 'captured';
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

console.log(JSON.stringify({ dataset: manifest }, null, 2));
if (manifest.failures.length) process.exit(1);
