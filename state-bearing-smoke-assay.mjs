export const STATE_BEARING_SMOKE_ASSAY_SCHEMA = 'kaminos.state-bearing-smoke-assay.v0';

const CURRENT_STATE_AUTHORITY = 'held-current-state-only-v0';
const PHASE_HISTORY_AUTHORITY = 'phase-offset-history-v0';
const REQUIRED_FIELD_KINDS = ['fluid', 'front'];
const CANONICAL_CELL_IDS = ['A', 'B', 'C', 'D'];
const OPEN_BLOCKER_CLASSES = new Set(['dataset', 'owner', 'compute', 'abi']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function hash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw new Error(`${label} must be a lowercase sha256`);
  return value;
}

function integer(value, label, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (positive ? 1 : 0)) {
    throw new TypeError(`${label} must be a ${positive ? 'positive' : 'nonnegative'} integer number`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function vector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${label} must contain ${length} values`);
  return value.map((component, index) => finite(component, `${label}[${index}]`));
}

function sameNumbers(left, right, tolerance = 1e-6) {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function validateCamera(candidate, label) {
  const camera = object(candidate, label);
  return {
    position: vector(camera.position, 3, `${label} position`),
    target: vector(camera.target, 3, `${label} target`),
    matrixWorldInverse: vector(camera.matrixWorldInverse, 16, `${label} matrixWorldInverse`),
  };
}

function validateArtifact(candidate, label) {
  const artifact = object(candidate, label);
  return {
    kind: identity(artifact.kind, `${label} kind`),
    path: identity(artifact.path, `${label} path`),
    sha256: hash(artifact.sha256, `${label} sha256`),
    byteLength: integer(artifact.byteLength, `${label} byteLength`, { positive: true }),
  };
}

function validateTiming(candidate, label) {
  const timing = object(candidate, label);
  const sampleCount = integer(timing.sampleCount, `${label} sampleCount`, { positive: true });
  const mean = finite(timing.mean, `${label} mean`);
  const p95 = finite(timing.p95, `${label} p95`);
  if (mean < 0 || p95 < 0) throw new RangeError(`${label} timings must be nonnegative`);
  return { sampleCount, mean, p95 };
}

function validateTemporal(candidate, cellId, sourceStep) {
  const temporal = object(candidate, `cell ${cellId} temporal evidence`);
  const authority = identity(temporal.authority, `cell ${cellId} temporal authority`);
  const historyDepth = integer(temporal.historyDepth, `cell ${cellId} history depth`, { positive: true });
  if (!Array.isArray(temporal.sourceSteps) || temporal.sourceSteps.length === 0) {
    throw new Error(`cell ${cellId} source steps must be non-empty`);
  }
  const steps = temporal.sourceSteps.map((step, index) => integer(step, `cell ${cellId} source step ${index}`));
  if (authority === CURRENT_STATE_AUTHORITY) {
    if (historyDepth !== 1 || steps.length !== 1 || steps[0] !== sourceStep) {
      throw new Error(`cell ${cellId} source step must equal held source step ${sourceStep}`);
    }
  } else if (authority === PHASE_HISTORY_AUTHORITY) {
    const consecutive = steps.length >= 2
      && steps.at(-1) === sourceStep
      && steps.every((step, index) => index === 0 || step === steps[index - 1] + 1);
    if (!consecutive || historyDepth < steps.length) {
      throw new Error(`cell ${cellId} phase-offset evidence requires exact consecutive history ending at ${sourceStep}`);
    }
  } else {
    throw new Error(`cell ${cellId} temporal authority is unsupported: ${authority}`);
  }
  return { authority, historyDepth, sourceSteps: steps };
}

function validateProduct(candidate, cellId) {
  const product = object(candidate, `cell ${cellId} product`);
  const requested = identity(product.requestedRepresentation, `cell ${cellId} requested representation`);
  const effective = identity(product.effectiveRepresentation, `cell ${cellId} effective representation`);
  if (requested !== effective) throw new Error(`cell ${cellId} requested and effective representations disagree`);
  if (product.fallbackReason !== null) throw new Error(`cell ${cellId} product declares fallback: ${product.fallbackReason}`);
  identity(product.producerAuthority, `cell ${cellId} producer authority`);
  identity(product.compilerIdentity, `cell ${cellId} compiler identity`);
  identity(product.drawAuthority, `cell ${cellId} draw authority`);
  const requestedActiveCount = integer(product.requestedActiveCount, `cell ${cellId} requested active count`);
  const activeCount = integer(product.activeCount, `cell ${cellId} active count`);
  const capacity = integer(product.capacity, `cell ${cellId} capacity`, { positive: true });
  if (requestedActiveCount !== activeCount) {
    throw new Error(`cell ${cellId} requested active count ${requestedActiveCount} does not match active count ${activeCount}`);
  }
  if (activeCount > capacity) throw new Error(`cell ${cellId} active count exceeds capacity`);
  if (product.outputWasTruncated !== false) throw new Error(`cell ${cellId} output is truncated`);
  if (integer(product.overflowCount, `cell ${cellId} overflow count`) !== 0) throw new Error(`cell ${cellId} overflow is nonzero`);
  return product;
}

function validateOutput(candidate, cellId) {
  const output = object(candidate, `cell ${cellId} output`);
  if (output.status !== 'captured') throw new Error(`cell ${cellId} output is partial or missing`);
  identity(output.path, `cell ${cellId} output path`);
  hash(output.sha256, `cell ${cellId} output sha256`);
  integer(output.byteLength, `cell ${cellId} output byteLength`, { positive: true });
  const pixels = object(output.pixelStats, `cell ${cellId} pixelStats`);
  const pixelCount = integer(pixels.pixelCount, `cell ${cellId} pixel count`, { positive: true });
  const nonUniformPixelCount = integer(pixels.nonUniformPixelCount, `cell ${cellId} non-uniform pixel count`);
  const nonBlackPixelCount = integer(pixels.nonBlackPixelCount, `cell ${cellId} non-black pixel count`);
  if (nonUniformPixelCount > pixelCount || nonBlackPixelCount > pixelCount) {
    throw new Error(`cell ${cellId} pixel counts exceed the capture extent`);
  }
  if (nonUniformPixelCount === 0 || nonBlackPixelCount === 0) {
    throw new Error(`cell ${cellId} has blank or uniform output`);
  }
  return output;
}

function validateCell(candidate, source) {
  const cell = object(candidate, 'assay cell');
  const id = identity(cell.id, 'assay cell id');
  if (cell.status === 'open') {
    if (id !== 'C') throw new Error(`only route C may remain open in the first assay; cell ${id} must be captured`);
    if (cell.sourceIdentity !== source.identity) throw new Error('open cell C source identity does not match the common source');
    const blocker = object(cell.blocker, 'open cell C blocker');
    if (!OPEN_BLOCKER_CLASSES.has(blocker.class)) {
      throw new Error('open cell C blocker class must be dataset, owner, compute, or abi');
    }
    identity(blocker.detail, 'open cell C blocker detail');
    return cell;
  }
  if (cell.status !== 'captured') throw new Error(`cell ${id} is partial or missing`);
  if (cell.sourceIdentity !== source.identity) throw new Error(`cell ${id} source identity does not match the common source`);
  const cellCamera = validateCamera(cell.camera, `cell ${id} camera`);
  if (!sameNumbers(cellCamera.position, source.camera.position)
      || !sameNumbers(cellCamera.target, source.camera.target)
      || !sameNumbers(cellCamera.matrixWorldInverse, source.camera.matrixWorldInverse)) {
    throw new Error(`cell ${id} camera does not match the common source camera`);
  }
  const route = object(cell.route, `cell ${id} route`);
  const requestedRoute = identity(route.requested, `cell ${id} requested route`);
  const effectiveRoute = identity(route.effective, `cell ${id} effective route`);
  if (requestedRoute !== effectiveRoute) throw new Error(`cell ${id} requested and effective route disagree`);
  if (route.fallbackReason !== null) throw new Error(`cell ${id} declares fallback: ${route.fallbackReason}`);
  identity(route.backend, `cell ${id} backend`);
  validateTemporal(cell.temporal, id, source.simulation.simStep);
  validateProduct(cell.product, id);
  validateOutput(cell.output, id);
  const timing = object(cell.timing, `cell ${id} timing`);
  validateTiming(timing.routeLocalMs, `cell ${id} route-local timing`);
  validateTiming(timing.wholeFrameMs, `cell ${id} whole-frame timing`);
  return cell;
}

export function validateStateBearingSmokeAssay(candidate) {
  const assay = object(candidate, 'state-bearing smoke assay');
  if (assay.schema !== STATE_BEARING_SMOKE_ASSAY_SCHEMA) throw new Error('state-bearing smoke assay schema mismatch');
  if (!['captured', 'incomplete'].includes(assay.status)) throw new Error('state-bearing smoke assay status must be captured or incomplete');
  identity(assay.identity, 'state-bearing smoke assay identity');

  const source = object(assay.source, 'common source');
  identity(source.identity, 'common source identity');
  identity(source.authority, 'common source authority');
  const captureManifest = object(source.captureManifest, 'capture manifest');
  identity(captureManifest.path, 'capture manifest path');
  const captureSha256 = hash(captureManifest.sha256, 'capture manifest sha256');
  const importManifest = object(source.importManifest, 'import manifest');
  identity(importManifest.path, 'import manifest path');
  hash(importManifest.sha256, 'import manifest sha256');
  if (hash(importManifest.captureManifestSha256, 'import capture manifest sha256') !== captureSha256) {
    throw new Error('import capture manifest sha256 does not match the source capture manifest sha256');
  }
  const simulation = object(source.simulation, 'common source simulation');
  integer(simulation.grid, 'common source grid', { positive: true });
  integer(simulation.simStep, 'common source sim step');
  if (simulation.fieldCoverage !== 'complete') throw new Error('common source field coverage is not complete');
  if (!Array.isArray(source.artifacts)) throw new Error('common source artifacts must be an array');
  const artifacts = source.artifacts.map((artifact, index) => validateArtifact(artifact, `common source artifact ${index}`));
  const artifactKinds = new Set(artifacts.map(artifact => artifact.kind));
  if (!REQUIRED_FIELD_KINDS.every(kind => artifactKinds.has(kind))) {
    throw new Error('complete evolved field evidence requires checksum-bound fluid and front artifacts');
  }
  source.camera = validateCamera(source.camera, 'common source camera');

  if (!Array.isArray(assay.requiredCells) || assay.requiredCells.length === 0) {
    throw new Error('state-bearing smoke assay requiredCells must be non-empty');
  }
  const requiredCells = assay.requiredCells.map((id, index) => identity(id, `required cell ${index}`));
  if (new Set(requiredCells).size !== requiredCells.length) throw new Error('state-bearing smoke assay has duplicate required cells');
  if (!CANONICAL_CELL_IDS.every(id => requiredCells.includes(id))) {
    throw new Error('state-bearing smoke assay must require the canonical A/B/C/D cells');
  }
  if (!Array.isArray(assay.cells) || assay.cells.length === 0) throw new Error('state-bearing smoke assay cells must be non-empty');
  const cells = assay.cells.map(cell => validateCell(cell, source));
  const cellIds = cells.map(cell => cell.id);
  if (new Set(cellIds).size !== cellIds.length) throw new Error('state-bearing smoke assay has duplicate cell ids');
  for (const id of requiredCells) {
    if (!cellIds.includes(id)) throw new Error(`required cell ${id} is missing from the state-bearing assay`);
  }
  const openCells = cells.filter(cell => cell.status === 'open');
  if (openCells.length > 0 && assay.status !== 'incomplete') {
    throw new Error('a captured state-bearing smoke assay cannot contain an open route; status must remain incomplete');
  }
  if (openCells.length === 0 && assay.status !== 'captured') {
    throw new Error('an incomplete state-bearing smoke assay must contain an explicit open route');
  }
  return assay;
}

function trustworthyEvidence(candidate) {
  const cells = Array.isArray(candidate?.cells) ? candidate.cells.map(cell => ({
    id: cell?.id || null,
    sourceIdentity: cell?.sourceIdentity || null,
    route: {
      requested: cell?.route?.requested || null,
      effective: cell?.route?.effective || null,
      fallbackReason: cell?.route?.fallbackReason ?? null,
      backend: cell?.route?.backend || null,
    },
    representation: {
      requested: cell?.product?.requestedRepresentation || null,
      effective: cell?.product?.effectiveRepresentation || null,
      fallbackReason: cell?.product?.fallbackReason ?? null,
      producerAuthority: cell?.product?.producerAuthority || null,
      compilerIdentity: cell?.product?.compilerIdentity || null,
      drawAuthority: cell?.product?.drawAuthority || null,
    },
    counts: {
      requestedActiveCount: cell?.product?.requestedActiveCount ?? null,
      activeCount: cell?.product?.activeCount ?? null,
      capacity: cell?.product?.capacity ?? null,
      overflowCount: cell?.product?.overflowCount ?? null,
      outputWasTruncated: cell?.product?.outputWasTruncated ?? null,
    },
    temporal: {
      authority: cell?.temporal?.authority || null,
      sourceSteps: Array.isArray(cell?.temporal?.sourceSteps) ? [...cell.temporal.sourceSteps] : null,
      historyDepth: cell?.temporal?.historyDepth ?? null,
    },
    output: {
      status: cell?.output?.status || null,
      path: cell?.output?.path || null,
      sha256: cell?.output?.sha256 || null,
      byteLength: cell?.output?.byteLength ?? null,
      pixelStats: cell?.output?.pixelStats ? { ...cell.output.pixelStats } : null,
    },
    timing: {
      routeLocalPresent: Boolean(cell?.timing?.routeLocalMs),
      wholeFramePresent: Boolean(cell?.timing?.wholeFrameMs),
      routeLocalSampleCount: cell?.timing?.routeLocalMs?.sampleCount ?? null,
      wholeFrameSampleCount: cell?.timing?.wholeFrameMs?.sampleCount ?? null,
    },
  })) : [];
  return {
    sourceIdentity: candidate?.source?.identity || null,
    captureManifestSha256: candidate?.source?.captureManifest?.sha256 || null,
    receivedCellIds: cells.map(cell => cell.id).filter(Boolean),
    cells,
  };
}

export async function writeStateBearingSmokeAssayReport(candidate, outputPath) {
  identity(outputPath, 'state-bearing smoke assay output path');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    const validated = validateStateBearingSmokeAssay(candidate);
    await writeFile(outputPath, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  } catch (error) {
    const failed = {
      schema: STATE_BEARING_SMOKE_ASSAY_SCHEMA,
      status: 'failed',
      identity: candidate?.identity || null,
      failurePhase: 'validation',
      lastTrustworthyEvidence: trustworthyEvidence(candidate),
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
    await writeFile(outputPath, `${JSON.stringify(failed, null, 2)}\n`);
    throw error;
  }
}
