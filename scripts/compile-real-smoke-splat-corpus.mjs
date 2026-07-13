#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  KAMINOS_FLUID_CHANNEL_ORDER,
  REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
  compileSmokeFieldHierarchy,
} from '../smoke-splat-field-hierarchy.mjs';
import {
  predictSparseFine,
  trainSparseFineSelector,
} from '../smoke-splat-residual-selector.mjs';

const ROUTE = 'authoritative-full-grid-real-smoke-hierarchy-corpus-v0';
const MOTION_ROUTE = 'webgpu-real-field-hierarchical-smoke-motion-v0';
const MOTION_TEMPORAL_AUTHORITY = 'velocity-carried-short-horizon-extrapolation-v0';
const EXPECTED_SOURCE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const EXPECTED_BACKEND_PREFIX = 'WebGPU:';
const PACKED_SPLAT_CHANNELS = [
  'positionX', 'positionY', 'positionZ',
  'principalAxisX', 'principalAxisY', 'principalAxisZ',
  'radiusX', 'radiusY', 'radiusZ',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'hierarchyRoleCode',
];

function parseArgs(argv) {
  const options = { frames: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--frame') {
      if (!value) throw new Error('--frame requires a manifest path');
      options.frames.push(resolve(value));
      index += 1;
    } else if (key === '--out-dir') {
      if (!value) throw new Error('--out-dir requires a path');
      options.outDir = resolve(value);
      index += 1;
    } else if (['--coarse-block-size', '--fine-block-size', '--articulation-threshold', '--fine-mass-fraction', '--coarse-anchor-mass-ratio', '--coarse-stratum-size', '--fine-occupancy-mass-ratio', '--capacity', '--steps', '--instance-count', '--phase-slot-count'].includes(key)) {
      if (!value) throw new Error(`${key} requires a value`);
      options[key.slice(2).replaceAll('-', '_')] = Number(value);
      index += 1;
    } else {
      throw new Error(`unknown argument ${key}`);
    }
  }
  if (!options.outDir) throw new Error('--out-dir is required');
  if (options.frames.length === 0) throw new Error('at least one --frame is required');
  for (const key of ['instance_count', 'phase_slot_count']) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] <= 0)) {
      throw new Error(`--${key.replaceAll('_', '-')} must be a positive integer`);
    }
  }
  return options;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function resolveArtifactPath(manifestPath, artifactPath) {
  return isAbsolute(artifactPath) ? artifactPath : resolve(dirname(manifestPath), artifactPath);
}

async function loadFrame(manifestPath, index) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== 'kaminos.volume.full-grid-field-export.v0'
    || manifest.identity !== 'full-grid-fluid-front-boundary-sidecars-v0'
    || manifest.status !== 'captured'
    || manifest.completeFieldCoverage !== true) {
    throw new Error(`frame ${index} is not a complete captured full-grid export`);
  }
  const fluid = manifest.sidecars?.fluid;
  if (!fluid || fluid.kind !== 'fluid' || fluid.dtype !== 'float32' || fluid.byteOrder !== 'little-endian') {
    throw new Error(`frame ${index} fluid descriptor is missing or incompatible`);
  }
  if (!sameArray(fluid.channelOrder, KAMINOS_FLUID_CHANNEL_ORDER)
    || !sameArray(manifest.fluidChannelOrder, KAMINOS_FLUID_CHANNEL_ORDER)) {
    throw new Error(`frame ${index} fluid channel order does not match the renderer contract`);
  }
  const grid = Number(manifest.grid);
  const expectedShape = [grid, grid, grid, KAMINOS_FLUID_CHANNEL_ORDER.length];
  if (!Number.isInteger(grid) || grid <= 0 || !sameArray(fluid.shape, expectedShape)) {
    throw new Error(`frame ${index} fluid shape does not match grid ${grid}`);
  }
  const fluidPath = resolveArtifactPath(manifestPath, fluid.path);
  const bytes = await readFile(fluidPath);
  if (bytes.length !== fluid.byteLength || bytes.length !== fluid.floatCount * 4) {
    throw new Error(`frame ${index} fluid byte length mismatch`);
  }
  const actualHash = hash(bytes);
  if (actualHash !== fluid.sha256) throw new Error(`frame ${index} fluid sha256 mismatch: ${actualHash} != ${fluid.sha256}`);
  const replay = manifest.deterministicReplay;
  const step = Number(replay?.simStepCount ?? replay?.completedSteps);
  if (replay?.identity !== 'deterministic-replay-same-route-controls-fixed-step-v0'
    || replay?.authority !== 'same-route-controls-fixed-step-replay'
    || !Number.isInteger(step)) {
    throw new Error(`frame ${index} lacks deterministic simulator-step authority`);
  }
  const field = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return {
    manifestPath,
    manifestIdentity: `sha256:${hash(manifestBytes)}`,
    fluidPath,
    fluidIdentity: `sha256:${actualHash}`,
    grid,
    field,
    step,
    controlsSignature: replay.controlsSignature,
    effectiveRoute: manifest.effectiveRoute,
    prototypeIdentity: manifest.prototypeIdentity,
    backend: manifest.backend,
    channelOrder: fluid.channelOrder,
  };
}

function validateSequence(frames) {
  if (frames.length < 2) throw new Error('real smoke hierarchy corpus requires at least two adjacent deterministic frames');
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (index > 0 && frame.step !== frames[index - 1].step + 1) {
      throw new Error(`simulator frames must be adjacent: ${frames[index - 1].step} -> ${frame.step}`);
    }
    for (const field of ['grid', 'controlsSignature', 'effectiveRoute', 'prototypeIdentity', 'backend']) {
      if (frame[field] !== frames[0][field]) throw new Error(`frame ${index} ${field} drifts from frame 0`);
    }
  }
}

function packSplats(splats) {
  const packed = new Float32Array(splats.length * PACKED_SPLAT_CHANNELS.length);
  for (let index = 0; index < splats.length; index += 1) {
    const splat = splats[index];
    packed.set([
      ...splat.position,
      ...splat.principalAxis,
      ...splat.radii,
      splat.extinctionMass,
      splat.densityWitness,
      splat.temperatureWitness,
      ...splat.velocityWitness,
      splat.hierarchyRole === 'transport-coarse' ? 0 : 1,
    ], index * PACKED_SPLAT_CHANNELS.length);
  }
  return Buffer.from(packed.buffer);
}

async function writeProductArtifact(outDir, label, product) {
  const bytes = packSplats(product.splats);
  const path = join(outDir, `${label}.splats.f32`);
  await writeFile(path, bytes);
  return {
    path,
    sha256: hash(bytes),
    byteLength: bytes.length,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [product.splats.length, PACKED_SPLAT_CHANNELS.length],
    channelOrder: PACKED_SPLAT_CHANNELS,
  };
}

function compactProduct(product) {
  return {
    identity: product.identity,
    schema: product.schema,
    producerAuthority: product.producerAuthority,
    producerKind: product.producerKind,
    slotIdentity: product.slotIdentity,
    payloadIdentity: product.payloadIdentity,
    decoderConfigIdentity: product.decoderConfigIdentity,
    hierarchyCounts: product.hierarchyCounts,
    coarseConsolidation: product.coarseConsolidation,
    fineOccupancy: product.fineOccupancy,
    accounting: product.accounting,
    sourceStatistics: product.sourceStatistics,
    capacity: product.capacity,
    diagnostics: product.diagnostics,
  };
}

function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return new Set(left.filter(value => rightSet.has(value))).size;
}

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path, bytes);
  return bytes;
}

let options;
let phase = 'argument-resolution';
let lastTrustworthyEvidence = null;
try {
  options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const reportPath = join(options.outDir, 'report.json');
  phase = 'source-artifact-validation';
  const frames = [];
  for (let index = 0; index < options.frames.length; index += 1) frames.push(await loadFrame(options.frames[index], index));
  lastTrustworthyEvidence = {
    validatedFrameCount: frames.length,
    fluidIdentities: frames.map(frame => frame.fluidIdentity),
  };
  phase = 'sequence-validation';
  validateSequence(frames);
  const config = {
    coarseBlockSize: options.coarse_block_size ?? 8,
    fineBlockSize: options.fine_block_size ?? 4,
    articulationThreshold: options.articulation_threshold ?? 0.5,
    fineMassFraction: options.fine_mass_fraction ?? 0.5,
    coarseAnchorMassRatio: options.coarse_anchor_mass_ratio ?? 0,
    coarseStratumSize: options.coarse_stratum_size ?? 0,
    fineOccupancyMassRatio: options.fine_occupancy_mass_ratio ?? 0,
    capacity: options.capacity ?? null,
  };
  phase = 'hierarchy-target-compilation';
  const targets = frames.map((frame, index) => compileSmokeFieldHierarchy({
    grid: frame.grid,
    channelOrder: frame.channelOrder,
    field: frame.field,
    sourceIdentity: frame.fluidIdentity,
    slotIdentity: {
      historySlot: index,
      slotWriteTick: frame.step,
      simulatorGeneration: 1,
      modelIdentity: 'smoke-sparse-residual-target:v0',
    },
    ...config,
  }));
  const trainTargets = targets.slice(0, -1);
  const evaluationTarget = targets.at(-1);
  const trainingRows = trainTargets.flatMap(target => target.modelRows);
  const evaluationRows = evaluationTarget.modelRows;
  phase = 'sparse-residual-learning';
  const training = trainSparseFineSelector({
    trainingRows,
    evaluationRows,
    steps: options.steps ?? 180,
    learningRate: 0.12,
    sparsityWeight: 0.04,
    seed: 13,
  });
  const evaluationFrame = frames.at(-1);
  const learnedEvaluation = compileSmokeFieldHierarchy({
    grid: evaluationFrame.grid,
    channelOrder: evaluationFrame.channelOrder,
    field: evaluationFrame.field,
    sourceIdentity: evaluationFrame.fluidIdentity,
    slotIdentity: {
      historySlot: frames.length - 1,
      slotWriteTick: evaluationFrame.step,
      simulatorGeneration: 1,
      modelIdentity: training.model.identity,
    },
    ...config,
    fineSelector: row => predictSparseFine(training.model, row.features) >= training.model.threshold,
  });
  phase = 'artifact-materialization';
  const frameReports = [];
  for (let index = 0; index < frames.length; index += 1) {
    const artifact = await writeProductArtifact(options.outDir, `sim-step-${frames[index].step}-target`, targets[index]);
    frameReports.push({
      frameId: `sim-step-${frames[index].step}`,
      step: frames[index].step,
      sourceManifest: frames[index].manifestPath,
      sourceManifestIdentity: frames[index].manifestIdentity,
      sourceFluid: frames[index].fluidPath,
      sourceFluidIdentity: frames[index].fluidIdentity,
      ...compactProduct(targets[index]),
      artifact,
    });
  }
  const learnedArtifact = await writeProductArtifact(options.outDir, `sim-step-${evaluationFrame.step}-learned`, learnedEvaluation);
  const modelPath = join(options.outDir, 'sparse-fine-selector.json');
  await writeFile(modelPath, `${JSON.stringify(training.model, null, 2)}\n`, 'utf8');
  const modelBytes = await readFile(modelPath);
  const firstTarget = targets[0];
  const lastTarget = targets.at(-1);
  const visibleInstanceCount = options.instance_count ?? 1;
  const uniquePhaseSlotCount = options.phase_slot_count ?? frames.length;
  const report = {
    schema: 'kaminos-real-smoke-splat-corpus-report-v0',
    status: 'passed',
    failurePhase: null,
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    producerAuthority: REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
    sourceRoute: {
      effectiveRoute: frames[0].effectiveRoute,
      prototypeIdentity: frames[0].prototypeIdentity,
      backend: frames[0].backend,
      controlsSignature: frames[0].controlsSignature,
    },
    requestedConfig: config,
    frameSplit: {
      authority: 'explicit-adjacent-step-holdout-v0',
      trainFrameIds: frames.slice(0, -1).map(frame => `sim-step-${frame.step}`),
      evaluationFrameIds: [`sim-step-${evaluationFrame.step}`],
      overlap: 0,
    },
    frames: frameReports,
    temporalComparison: {
      identity: 'stable-spatial-bin-adjacent-phase-comparison-v0',
      fromFrameId: `sim-step-${frames[0].step}`,
      toFrameId: `sim-step-${evaluationFrame.step}`,
      stepDelta: evaluationFrame.step - frames[0].step,
      sharedCoarseSpatialKeys: intersectionSize(firstTarget.temporalKeys.coarse, lastTarget.temporalKeys.coarse),
      sharedFineTargetSpatialKeys: intersectionSize(firstTarget.temporalKeys.fine, lastTarget.temporalKeys.fine),
    },
    modelDataset: {
      train: { frameIds: training.frameSplit.trainFrameIds, rowCount: trainingRows.length },
      evaluation: { frameIds: training.frameSplit.evaluationFrameIds, rowCount: evaluationRows.length },
    },
    learnedSelector: {
      authority: training.authority,
      model: {
        path: modelPath,
        identity: training.model.identity,
        sha256: hash(modelBytes),
        byteLength: modelBytes.length,
      },
      optimization: training.optimization,
      metrics: training.metrics,
      heldOutProduct: {
        ...compactProduct(learnedEvaluation),
        artifact: learnedArtifact,
      },
    },
    runtimeBudgetEstimate: {
      identity: 'phase-cached-hierarchical-smoke-instance-budget-estimate-v0',
      visibleInstanceCount,
      uniquePhaseSlotCount,
      decodedProductCount: uniquePhaseSlotCount,
      splatsPerLearnedPhaseProduct: learnedEvaluation.hierarchyCounts.total,
      estimatedStoredPhaseSplats: learnedEvaluation.hierarchyCounts.total * uniquePhaseSlotCount,
      estimatedRenderedSplatInstances: learnedEvaluation.hierarchyCounts.total * visibleInstanceCount,
      hiddenCapApplied: false,
      limitation: 'count projection only; this offline corpus does not measure GPU raster or sorting cost',
    },
    limitations: [
      'learned selector controls fine articulation allocation only; deterministic coarse reduction remains extinction authority',
      'offline full-field evidence does not prove GPU history-ring integration or rendered visual quality',
    ],
  };
  const reportBytes = await writeReport(reportPath, report);
  const firstMotionProduct = {
    ...frameReports[0],
    sourceProducerKind: frameReports[0].producerKind,
    producerKind: 'authoritative-articulation-target',
    phaseIndex: 0,
  };
  const learnedMotionProduct = {
    ...compactProduct(learnedEvaluation),
    artifact: learnedArtifact,
    sourceProducerKind: learnedEvaluation.producerKind,
    producerKind: 'learned-heldout-residual-selector',
    phaseIndex: 1,
    frameId: `sim-step-${evaluationFrame.step}`,
    step: evaluationFrame.step,
  };
  await writeReport(join(options.outDir, 'motion-source.json'), {
    schema: 'kaminos.smoke-splat-motion-source.v0',
    status: 'passed',
    requestedRoute: MOTION_ROUTE,
    effectiveRoute: MOTION_ROUTE,
    fallbackReason: null,
    temporalAuthority: MOTION_TEMPORAL_AUTHORITY,
    producerAuthority: REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
    sourceReport: {
      path: 'report.json',
      sha256: hash(reportBytes),
      schema: report.schema,
    },
    sourceRoute: report.sourceRoute,
    products: [firstMotionProduct, learnedMotionProduct],
    limitations: [
      'The authoritative target and held-out learned selector are adjacent phase products, not a recurrent neural smoke decode.',
      'Motion is short-horizon velocity extrapolation from exact compiled products.',
      'This manifest is standalone smoke representation evidence and does not prove final flame-smoke depth composition.',
    ],
  });
} catch (error) {
  const outDir = options?.outDir;
  const failureReport = {
    schema: 'kaminos-real-smoke-splat-corpus-report-v0',
    status: 'failed',
    failurePhase: phase,
    requestedRoute: ROUTE,
    effectiveRoute: null,
    message: error?.message ?? String(error),
    lastTrustworthyEvidence,
  };
  if (outDir) await writeReport(join(outDir, 'report.json'), failureReport);
  else process.stderr.write(`${failureReport.message}\n`);
  process.exitCode = 1;
}
