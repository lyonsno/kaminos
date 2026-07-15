import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KAMINOS_FLUID_CHANNEL_ORDER,
  compileSmokeFieldHierarchy,
} from './smoke-splat-field-hierarchy.mjs';
import { predictSparseFine } from './smoke-splat-residual-selector.mjs';
import { loadChecksumBoundSmokeTeacherFrame } from './smoke-gaussian-oracle-fitter.mjs';

const HELD_REPLAY_SCHEMA = 'kaminos.volume.operator-basin-replay.v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const PACKED_SPLAT_CHANNELS = [
  'positionX', 'positionY', 'positionZ',
  'principalAxisX', 'principalAxisY', 'principalAxisZ',
  'radiusX', 'radiusY', 'radiusZ',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'hierarchyRoleCode',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireIdentity(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function requireShaIdentity(value, label) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a sha256 identity`);
  return value;
}

function computedModelIdentity(model) {
  const payload = JSON.stringify({
    schema: model.schema,
    featureCount: model.featureCount,
    weights: model.weights,
    bias: model.bias,
    threshold: model.threshold,
    thresholdAuthority: model.thresholdAuthority,
    normalizer: model.normalizer,
  });
  return `sha256:${sha256(payload)}`;
}

function validateFrame(frame) {
  if (!frame || typeof frame !== 'object') throw new TypeError('checksum-bound teacher frame is required');
  if (frame.sourceSchema !== HELD_REPLAY_SCHEMA) throw new Error(`Route B requires ${HELD_REPLAY_SCHEMA}`);
  requireIdentity(frame.captureId, 'held captureId');
  requireShaIdentity(frame.manifestIdentity, 'held manifest identity');
  requireShaIdentity(frame.sourceCaptureIdentity, 'held source capture identity');
  requireShaIdentity(frame.cameraIdentity, 'held camera identity');
  requireShaIdentity(frame.fluidIdentity, 'held fluid identity');
  if (!Number.isInteger(frame.grid) || frame.grid <= 0) throw new TypeError('held grid must be a positive integer');
  if (!Number.isInteger(frame.simStepCount) || frame.simStepCount < 0) throw new TypeError('held sim step must be a nonnegative integer');
  if (!(frame.field instanceof Float32Array)
    || frame.field.length !== frame.grid ** 3 * KAMINOS_FLUID_CHANNEL_ORDER.length) {
    throw new Error('held fluid field length mismatch');
  }
  if (frame.manifest?.effectiveRoute !== EXPECTED_ROUTE) {
    throw new Error(`wrong effective route: ${frame.manifest?.effectiveRoute || '(missing)'}`);
  }
  if (frame.manifest?.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error('held prototype identity mismatch');
  if (typeof frame.manifest?.backend !== 'string' || !frame.manifest.backend.startsWith('WebGPU:')) throw new Error('held backend identity mismatch');
  return frame;
}

function validateModel(model) {
  if (!model || model.schema !== 'kaminos-smoke-splat-sparse-fine-selector-v0') {
    throw new TypeError('Route B requires a sparse fine selector model');
  }
  const effectiveIdentity = computedModelIdentity(model);
  if (model.identity !== effectiveIdentity) throw new Error(`model identity mismatch: ${model.identity || '(missing)'} != ${effectiveIdentity}`);
  return model;
}

export function buildHeldSmokeHierarchyProduct({ frame, model, config = {} } = {}) {
  const source = validateFrame(frame);
  const selector = validateModel(model);
  const product = compileSmokeFieldHierarchy({
    grid: source.grid,
    channelOrder: KAMINOS_FLUID_CHANNEL_ORDER,
    field: source.field,
    sourceIdentity: source.fluidIdentity,
    slotIdentity: {
      historySlot: 0,
      slotWriteTick: source.simStepCount,
      simulatorGeneration: 0,
      modelIdentity: selector.identity,
    },
    coarseBlockSize: config.coarseBlockSize ?? 8,
    fineBlockSize: config.fineBlockSize ?? 4,
    extinctionCoefficient: config.extinctionCoefficient ?? 1.35,
    fineMassFraction: config.fineMassFraction ?? 0.5,
    articulationThreshold: config.articulationThreshold ?? 0.5,
    coarseAnchorMassRatio: config.coarseAnchorMassRatio ?? 0.8,
    coarseStratumSize: config.coarseStratumSize ?? 4,
    fineOccupancyMassRatio: config.fineOccupancyMassRatio ?? 0.4,
    capacity: config.capacity ?? null,
    fineSelector: row => predictSparseFine(selector, row.features) >= selector.threshold,
  });
  if (product.capacity.overflowCount > 0) {
    throw new Error(`capacity overflow ${product.capacity.overflowCount}; refusing to truncate or misreport the Route B product`);
  }
  return {
    schema: 'kaminos.held-smoke-hierarchy-product.v0',
    status: 'compiled',
    routeCell: 'B',
    source: {
      sourceSchema: source.sourceSchema,
      captureId: source.captureId,
      simStepCount: source.simStepCount,
      manifestIdentity: source.manifestIdentity,
      sourceCaptureIdentity: source.sourceCaptureIdentity,
      cameraIdentity: source.cameraIdentity,
      fluidIdentity: source.fluidIdentity,
      effectiveRoute: source.manifest.effectiveRoute,
      prototypeIdentity: source.manifest.prototypeIdentity,
      backend: source.manifest.backend,
      grid: source.grid,
    },
    model: {
      identity: selector.identity,
      schema: selector.schema,
      threshold: selector.threshold,
      thresholdAuthority: selector.thresholdAuthority,
    },
    product,
  };
}

export function buildHeldAnalyticalSmokeHierarchyProduct({ frame, config = {} } = {}) {
  const source = validateFrame(frame);
  const allocationAuthority = 'analytical-articulation-score-v0';
  const product = compileSmokeFieldHierarchy({
    grid: source.grid,
    channelOrder: KAMINOS_FLUID_CHANNEL_ORDER,
    field: source.field,
    sourceIdentity: source.fluidIdentity,
    slotIdentity: {
      historySlot: 0,
      slotWriteTick: source.simStepCount,
      simulatorGeneration: 0,
      modelIdentity: allocationAuthority,
    },
    coarseBlockSize: config.coarseBlockSize ?? 8,
    fineBlockSize: config.fineBlockSize ?? 4,
    extinctionCoefficient: config.extinctionCoefficient ?? 1.35,
    fineMassFraction: config.fineMassFraction ?? 0.5,
    articulationThreshold: config.articulationThreshold ?? 0.5,
    coarseAnchorMassRatio: config.coarseAnchorMassRatio ?? 0.8,
    coarseStratumSize: config.coarseStratumSize ?? 4,
    fineOccupancyMassRatio: config.fineOccupancyMassRatio ?? 0.4,
    capacity: config.capacity ?? null,
  });
  if (product.capacity.overflowCount > 0) {
    throw new Error(`capacity overflow ${product.capacity.overflowCount}; refusing to truncate or misreport the Route A product`);
  }
  return {
    schema: 'kaminos.held-smoke-hierarchy-product.v0',
    status: 'compiled',
    routeCell: 'A',
    source: {
      sourceSchema: source.sourceSchema,
      captureId: source.captureId,
      simStepCount: source.simStepCount,
      manifestIdentity: source.manifestIdentity,
      sourceCaptureIdentity: source.sourceCaptureIdentity,
      cameraIdentity: source.cameraIdentity,
      fluidIdentity: source.fluidIdentity,
      effectiveRoute: source.manifest.effectiveRoute,
      prototypeIdentity: source.manifest.prototypeIdentity,
      backend: source.manifest.backend,
      grid: source.grid,
    },
    allocation: {
      authority: allocationAuthority,
      learned: false,
    },
    model: null,
    product,
  };
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
    requestedActiveCount: product.requiredSplatCount,
    activeCount: product.hierarchyCounts.total,
    outputWasTruncated: product.capacity.outputWasTruncated,
    overflowCount: product.capacity.overflowCount,
  };
}

export async function writeHeldSmokeHierarchyArtifacts(built, outDir) {
  if (built?.schema !== 'kaminos.held-smoke-hierarchy-product.v0' || built?.status !== 'compiled') {
    throw new TypeError('a compiled held smoke hierarchy product is required');
  }
  requireIdentity(outDir, 'Route B output directory');
  await mkdir(outDir, { recursive: true });
  const routeCell = built.routeCell === 'A' ? 'A' : 'B';
  const routeSlug = `route-${routeCell.toLowerCase()}`;
  const artifactPath = resolve(outDir, `${routeSlug}.splats.f32`);
  const bytes = packSplats(built.product.splats);
  await writeFile(artifactPath, bytes);
  const report = {
    schema: 'kaminos.held-smoke-hierarchy-report.v0',
    status: 'captured',
    routeCell,
    source: built.source,
    model: built.model,
    allocation: built.allocation || null,
    product: compactProduct(built.product),
    artifact: {
      path: `${routeSlug}.splats.f32`,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
      dtype: 'float32',
      byteOrder: 'little-endian',
      shape: [built.product.splats.length, PACKED_SPLAT_CHANNELS.length],
      channelOrder: PACKED_SPLAT_CHANNELS,
    },
  };
  const reportPath = resolve(outDir, `${routeSlug}-report.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}

function requestedIdentity(options) {
  return {
    routeCell: options.routeCell || 'B',
    manifestPath: options.manifestPath || null,
    manifestSha256: options.expectedManifestSha256 || null,
    modelPath: options.modelPath || null,
    modelSha256: options.expectedModelSha256 || null,
  };
}

export async function compileHeldSmokeHierarchyProduct(options = {}) {
  const outDir = requireIdentity(options.outDir, 'Route B output directory');
  const routeCell = options.routeCell || 'B';
  if (routeCell !== 'A' && routeCell !== 'B') throw new Error(`unsupported held smoke route cell: ${routeCell}`);
  const routeSlug = `route-${routeCell.toLowerCase()}`;
  await mkdir(outDir, { recursive: true });
  let phase = 'teacher-load';
  let frame = null;
  let modelIdentity = null;
  let primaryArtifactWritten = false;
  const startedAt = performance.now();
  try {
    const manifestPath = resolve(requireIdentity(options.manifestPath, 'held manifest path'));
    frame = await loadChecksumBoundSmokeTeacherFrame(manifestPath, options.expectedManifestSha256);
    let built;
    if (routeCell === 'A') {
      phase = 'product-build';
      built = buildHeldAnalyticalSmokeHierarchyProduct({ frame, config: options.config });
    } else {
      phase = 'model-load';
      const modelPath = resolve(requireIdentity(options.modelPath, 'Route B model path'));
      if (typeof options.expectedModelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedModelSha256)) {
        throw new Error('Route B requires an exact requested model sha256');
      }
      const modelBytes = await readFile(modelPath);
      const modelSha = sha256(modelBytes);
      if (modelSha !== options.expectedModelSha256) {
        throw new Error(`requested model sha256 mismatch: ${modelSha} != ${options.expectedModelSha256}`);
      }
      const model = JSON.parse(modelBytes.toString('utf8'));
      modelIdentity = model.identity || null;
      phase = 'product-build';
      built = buildHeldSmokeHierarchyProduct({ frame, model, config: options.config });
    }
    phase = 'artifact-write';
    const report = await writeHeldSmokeHierarchyArtifacts(built, outDir);
    primaryArtifactWritten = true;
    report.timing = { compileAndWriteMs: performance.now() - startedAt };
    await writeFile(report.reportPath, `${JSON.stringify({ ...report, reportPath: undefined }, null, 2)}\n`);
    return report;
  } catch (error) {
    const failure = {
      schema: 'kaminos.held-smoke-hierarchy-report.v0',
      status: 'failed',
      failurePhase: phase,
      requested: requestedIdentity(options),
      lastTrustworthyEvidence: {
        sourceManifestIdentity: frame?.manifestIdentity || null,
        sourceFluidIdentity: frame?.fluidIdentity || null,
        modelIdentity,
        primaryArtifactWritten,
      },
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
    await writeFile(join(outDir, `${routeSlug}-report.json`), `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) args.set(argv[index], argv[index + 1]);
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const report = await compileHeldSmokeHierarchyProduct({
    routeCell: args.get('--route-cell') || 'B',
    manifestPath: args.get('--manifest'),
    expectedManifestSha256: args.get('--manifest-sha256'),
    modelPath: args.get('--model'),
    expectedModelSha256: args.get('--model-sha256'),
    outDir: args.get('--out-dir'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
