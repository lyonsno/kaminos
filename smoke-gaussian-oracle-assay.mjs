import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY = 'smoke-gaussian-oracle-ceiling-assay-v0';
export const SMOKE_GAUSSIAN_ORACLE_TEACHER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function shaOrStableIdentity(value, label) {
  const text = identity(value, label);
  if (!/^(sha256:|[a-f0-9]{64}$)/i.test(text)) {
    throw new Error(`${label} must preserve a sha256 identity`);
  }
  return text;
}

function assertNoOverlap(left, right, label) {
  const rightSet = new Set(right);
  const overlap = left.filter(value => rightSet.has(value));
  if (overlap.length) throw new Error(`${label} overlap is not allowed: ${overlap.join(', ')}`);
}

function validateTeacher(report) {
  const requested = identity(report.requestedTeacherRoute, 'requestedTeacherRoute');
  const effective = identity(report.effectiveTeacherRoute, 'effectiveTeacherRoute');
  if (requested !== SMOKE_GAUSSIAN_ORACLE_TEACHER_ROUTE || effective !== SMOKE_GAUSSIAN_ORACLE_TEACHER_ROUTE) {
    throw new Error(`teacher route must be requested/effective ${SMOKE_GAUSSIAN_ORACLE_TEACHER_ROUTE}`);
  }
  identity(report.requestedSequence, 'requestedSequence');
  const effectiveSequence = identity(report.effectiveSequence, 'effectiveSequence');
  if (effectiveSequence !== report.requestedSequence) throw new Error('effective sequence must match requested sequence for oracle evidence');
  const teacher = plainObject(report.teacher, 'teacher');
  identity(teacher.rendererIdentity, 'teacher.rendererIdentity');
  positive(teacher.sourceGeneration, 'teacher.sourceGeneration');
  if (teacher.fallbackIdentity) throw new Error('teacher fallback identity must be null for oracle evidence');
  identity(teacher.denseStateAuthority, 'teacher.denseStateAuthority');
}

function validateFrames(report) {
  const frames = array(report.frames, 'frames');
  const seen = new Set();
  for (const [index, frame] of frames.entries()) {
    plainObject(frame, `frames[${index}]`);
    const frameId = identity(frame.frameId, `frames[${index}].frameId`);
    if (seen.has(frameId)) throw new Error(`duplicate frame id ${frameId}`);
    seen.add(frameId);
    if (frame.status !== 'passed') throw new Error(`frame ${frameId} did not pass teacher capture`);
    if (frame.complete !== true) throw new Error(`frame ${frameId} is partial or incomplete`);
    if (frame.stale === true) throw new Error(`frame ${frameId} is stale`);
    finite(frame.step, `frames[${index}].step`);
    shaOrStableIdentity(frame.sourceManifestIdentity, `frames[${index}].sourceManifestIdentity`);
    shaOrStableIdentity(frame.denseStateIdentity, `frames[${index}].denseStateIdentity`);
    shaOrStableIdentity(frame.opticalDepthIdentity, `frames[${index}].opticalDepthIdentity`);
    shaOrStableIdentity(frame.transmittanceIdentity, `frames[${index}].transmittanceIdentity`);
    shaOrStableIdentity(frame.hdrReferenceIdentity, `frames[${index}].hdrReferenceIdentity`);
    const worldSpace = plainObject(frame.worldSpace, `frames[${index}].worldSpace`);
    identity(worldSpace.coordinateFrame, `frames[${index}].worldSpace.coordinateFrame`);
    identity(worldSpace.transformAuthority, `frames[${index}].worldSpace.transformAuthority`);
    positive(worldSpace.extinctionCoefficient, `frames[${index}].worldSpace.extinctionCoefficient`);
    const bounds = plainObject(worldSpace.bounds, `frames[${index}].worldSpace.bounds`);
    const minimum = array(bounds.minimum, `frames[${index}].worldSpace.bounds.minimum`);
    const maximum = array(bounds.maximum, `frames[${index}].worldSpace.bounds.maximum`);
    if (minimum.length !== 3 || maximum.length !== 3) throw new Error(`frame ${frameId} world-space bounds must be 3D`);
    minimum.forEach((value, axis) => finite(value, `frames[${index}].worldSpace.bounds.minimum[${axis}]`));
    maximum.forEach((value, axis) => finite(value, `frames[${index}].worldSpace.bounds.maximum[${axis}]`));
  }
  if (frames.length < 2) throw new Error('temporal oracle assay requires at least two complete frames');
  return frames;
}

function validateCameraSplit(report) {
  const split = plainObject(report.cameraSplit, 'cameraSplit');
  identity(split.authority, 'cameraSplit.authority');
  const train = array(split.trainCameraIds, 'cameraSplit.trainCameraIds').map(value => identity(value, 'train camera id'));
  const heldOut = array(split.heldOutCameraIds, 'held-out camera ids').map(value => identity(value, 'held-out camera id'));
  assertNoOverlap(train, heldOut, 'train/held-out camera split');
  const overlap = nonNegative(split.overlap, 'cameraSplit.overlap');
  if (overlap !== 0) throw new Error('held-out camera split must report zero overlap');
  const metrics = plainObject(report.multiviewMetrics, 'multiviewMetrics');
  const trainMetrics = plainObject(metrics.train, 'multiviewMetrics.train');
  const heldOutMetrics = plainObject(metrics.heldOut, 'multiviewMetrics.heldOut');
  const trainMetricIds = array(trainMetrics.cameraIds, 'multiviewMetrics.train.cameraIds');
  const heldOutMetricIds = array(heldOutMetrics.cameraIds, 'multiviewMetrics.heldOut.cameraIds');
  if (heldOutMetricIds.length === 0) throw new Error('held-out metrics are required');
  for (const cameraId of train) {
    if (!trainMetricIds.includes(cameraId)) throw new Error(`missing train metric for camera ${cameraId}`);
  }
  for (const cameraId of heldOut) {
    if (!heldOutMetricIds.includes(cameraId)) throw new Error(`missing held-out metric for camera ${cameraId}`);
  }
  nonNegative(trainMetrics.opticalDepthRmse, 'multiviewMetrics.train.opticalDepthRmse');
  nonNegative(heldOutMetrics.opticalDepthRmse, 'multiviewMetrics.heldOut.opticalDepthRmse');
  nonNegative(trainMetrics.structureSsim, 'multiviewMetrics.train.structureSsim');
  nonNegative(heldOutMetrics.structureSsim, 'multiviewMetrics.heldOut.structureSsim');
  return { train, heldOut };
}

function validateBudgets(report) {
  const budgets = plainObject(report.budgets, 'budgets');
  identity(budgets.authority, 'budgets.authority');
  if (budgets.hiddenCapApplied) throw new Error('hidden cap applied to oracle budget sweep');
  const activeCounts = array(budgets.activeCounts, 'budgets.activeCounts').map((value, index) => positive(value, `budgets.activeCounts[${index}]`));
  const sweep = array(budgets.sweep, 'budgets.sweep');
  if (sweep.length !== activeCounts.length) throw new Error('budget sweep must cover every requested active count');
  for (const [index, entry] of sweep.entries()) {
    plainObject(entry, `budgets.sweep[${index}]`);
    const requested = positive(entry.requestedActiveCount, `budgets.sweep[${index}].requestedActiveCount`);
    const effective = positive(entry.effectiveActiveCount, `budgets.sweep[${index}].effectiveActiveCount`);
    if (requested !== activeCounts[index]) throw new Error(`budget sweep request order mismatch at ${index}`);
    if (effective !== requested) throw new Error(`effective active count changed from requested at ${index}`);
    if (entry.outputWasTruncated) throw new Error(`budget sweep output was truncated at requested count ${requested}`);
  }
  return activeCounts;
}

function validateDiagnostics(report) {
  const diagnostics = plainObject(report.worldSpaceDiagnostics, 'worldSpaceDiagnostics');
  positive(diagnostics.extinctionRetentionRatio, 'worldSpaceDiagnostics.extinctionRetentionRatio');
  nonNegative(diagnostics.supportLeakageFraction, 'worldSpaceDiagnostics.supportLeakageFraction');
  positive(diagnostics.covarianceInflationP95, 'worldSpaceDiagnostics.covarianceInflationP95');
  nonNegative(diagnostics.deepOverlapOrderViolationFraction, 'worldSpaceDiagnostics.deepOverlapOrderViolationFraction');
  const temporal = plainObject(report.temporalContinuation, 'temporalContinuation');
  identity(temporal.authority, 'temporalContinuation.authority');
  array(temporal.frameIds, 'temporalContinuation.frameIds');
  nonNegative(temporal.correspondenceRetainedFraction, 'temporalContinuation.correspondenceRetainedFraction');
  nonNegative(temporal.births, 'temporalContinuation.births');
  nonNegative(temporal.deaths, 'temporalContinuation.deaths');
  nonNegative(temporal.splits, 'temporalContinuation.splits');
  nonNegative(temporal.merges, 'temporalContinuation.merges');
  nonNegative(temporal.opticalDriftHeldOutRmse, 'temporalContinuation.opticalDriftHeldOutRmse');
  const costs = plainObject(plainObject(report.costs, 'costs').chargedGpu, 'costs.chargedGpu');
  for (const key of ['productBuildMs', 'optimizerMs', 'rasterSortMs', 'compositeMs', 'raymarchTeacherMs']) {
    nonNegative(costs[key], `costs.chargedGpu.${key}`);
  }
}

function validateVisualWitnesses(report) {
  const witnesses = array(report.visualWitnesses, 'visualWitnesses');
  for (const [index, witness] of witnesses.entries()) {
    plainObject(witness, `visualWitnesses[${index}]`);
    identity(witness.kind, `visualWitnesses[${index}].kind`);
    identity(witness.path, `visualWitnesses[${index}].path`);
    shaOrStableIdentity(witness.sha256, `visualWitnesses[${index}].sha256`);
    if (witness.inspected !== true) throw new Error(`visual witness ${witness.kind} must be inspected`);
    const route = plainObject(witness.route, `visualWitnesses[${index}].route`);
    identity(route.requested, `visualWitnesses[${index}].route.requested`);
    identity(route.effective, `visualWitnesses[${index}].route.effective`);
    const stats = plainObject(witness.pixelStats, `visualWitnesses[${index}].pixelStats`);
    positive(stats.width, `visualWitnesses[${index}].pixelStats.width`);
    positive(stats.height, `visualWitnesses[${index}].pixelStats.height`);
    const nonzeroAlphaPixels = nonNegative(stats.nonzeroAlphaPixels, `visualWitnesses[${index}].pixelStats.nonzeroAlphaPixels`);
    const lumaP99 = nonNegative(stats.lumaP99, `visualWitnesses[${index}].pixelStats.lumaP99`);
    if (nonzeroAlphaPixels === 0 || lumaP99 === 0) throw new Error(`blank visual output for witness ${witness.kind}`);
  }
}

export function validateSmokeGaussianOracleAssayReport(report) {
  plainObject(report, 'report');
  if (report.identity !== SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY) throw new Error('oracle assay identity mismatch');
  if (report.status !== 'passed') throw new Error('only passed oracle assay reports can be validated as receipts');
  validateTeacher(report);
  const frames = validateFrames(report);
  const { train, heldOut } = validateCameraSplit(report);
  const activeCounts = validateBudgets(report);
  validateDiagnostics(report);
  validateVisualWitnesses(report);
  const verdict = plainObject(report.verdict, 'verdict');
  identity(verdict.wall, 'verdict.wall');
  if (verdict.supported !== true) throw new Error('verdict must be explicitly supported');
  identity(verdict.rationale, 'verdict.rationale');
  return {
    identity: SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY,
    status: 'passed',
    frameCount: frames.length,
    trainCameraCount: train.length,
    heldOutCameraCount: heldOut.length,
    maximumRequestedActiveCount: Math.max(...activeCounts),
    verdictWall: verdict.wall,
  };
}

export async function writeSmokeGaussianOracleFailureReport({
  reportPath,
  failurePhase,
  requestedTeacherRoute,
  effectiveTeacherRoute = null,
  requestedSequence,
  effectiveSequence = null,
  lastTrustworthyEvidence = null,
  cause,
} = {}) {
  const destination = identity(reportPath, 'reportPath');
  const report = {
    identity: SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY,
    status: 'failed',
    failurePhase: identity(failurePhase, 'failurePhase'),
    requestedTeacherRoute: identity(requestedTeacherRoute, 'requestedTeacherRoute'),
    effectiveTeacherRoute,
    requestedSequence: identity(requestedSequence, 'requestedSequence'),
    effectiveSequence,
    lastTrustworthyEvidence: lastTrustworthyEvidence ? { ...lastTrustworthyEvidence } : null,
    cause: identity(cause, 'cause'),
    writtenAt: new Date().toISOString(),
  };
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
