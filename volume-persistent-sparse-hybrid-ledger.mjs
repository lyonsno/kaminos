#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_MANIFEST_SHA256 as CONSUMER_MANIFEST_SHA256,
  authenticatePersistentSparseCohort,
  descriptorPath,
} from './volume-persistent-sparse-hybrid-frontier.mjs';
import {
  EXTINCTION_COMMON_LEDGER_SCHEMA,
  validateExtinctionCommonLedgerReport,
} from './volume-boundary-splat-extinction-common-ledger-report.mjs';

export const EXPECTED_COHORT_MANIFEST_SHA256 = '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20';
export const IMPLEMENTATION_BUNDLE_SHA256 = '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f';
export const LEDGER_RENDERER_IDENTITY = 'shared-linear-hdr-sparse-splat-positive-residual-v0';
export const LEDGER_MODEL_IDENTITY = 'analytical-exact-local-layer-coefficients-v0';
export const LEDGER_RECURRENCE_IDENTITY = 'ordered-emission-extinction-shared-transmittance-v0';
export const LEDGER_DEPTH_AUTHORITY = 'camera-depth-far-to-near-v0';
export const OPTICAL_OWNERSHIP_IDENTITY = 'complementary-local-optical-coefficient-ownership-v0';
export const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
export const HYBRID_ARTIFACT_SCHEMA = 'kaminos.bailiff.persistent-sparse-positive-complement-artifact.v0';
export const ARM_IDS = Object.freeze([
  'full-correct',
  'sparse-drop',
  'sparse-conservative',
  'sparse-positive-complement',
]);
export const STATE_IDS = Object.freeze([
  'coefficient-state-114',
  'coefficient-state-116',
  'coefficient-state-118',
  'coefficient-state-120',
]);
export const REQUIRED_STAGE_NAMES = Object.freeze([
  'selection',
  'compaction',
  'deposition',
  'splatRaster',
  'residualMarch',
  'reconstruction',
  'composition',
]);

const FULL_CANDIDATE_COUNT_BY_STATE = Object.freeze({
  'coefficient-state-114': 1_924_725,
  'coefficient-state-116': 1_926_470,
  'coefficient-state-118': 1_927_051,
  'coefficient-state-120': 1_925_788,
});
const SPARSE_CANDIDATE_COUNT = 481_447;
const RESIDUAL_GRID_SCALE = 0.10;
const RESIDUAL_RAY_STEPS = 64;
const WIDTH = 900;
const HEIGHT = 960;
const SHA256 = /^[0-9a-f]{64}$/;

assert.equal(CONSUMER_MANIFEST_SHA256, EXPECTED_COHORT_MANIFEST_SHA256);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function sha256Canonical(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function requireManifestIdentity(manifest) {
  assert.equal(manifest?.schema, 'persistent-sparse-cohort-export-v0', 'cohort schema drifted');
  assert.equal(
    manifest?.authority,
    'accepted-report-replayed-native-membership-consumer-arrays-v0',
    'cohort authority drifted',
  );
  assert.equal(manifest?.source?.implementationBundle?.sha256, IMPLEMENTATION_BUNDLE_SHA256, 'producer implementation bundle drifted');
  assert.deepEqual(manifest?.states?.map(state => state.stateId), STATE_IDS, 'held state sequence drifted');
  assert.ok(manifest.states.every(state => state.rowCount === SPARSE_CANDIDATE_COUNT), 'sparse cohort row count drifted');
  assert.ok(manifest.states.every(state => Number.isInteger(state.sourceRows?.count) && state.sourceRows.count > 0), 'full source row count is invalid');
  assert.ok(manifest.states.every(state => state.camera?.width === WIDTH && state.camera?.height === HEIGHT), 'camera resolution drifted');
}

export function auditFullCandidateCountContract(manifest, expectedFullCandidateCountByState = FULL_CANDIDATE_COUNT_BY_STATE) {
  const counts = Object.fromEntries((manifest?.states || []).map(state => [state.stateId, state.sourceRows?.count]));
  const entries = Object.entries(counts);
  assert.deepEqual(entries.map(([stateId]) => stateId), STATE_IDS, 'full-population state sequence drifted');
  assert.ok(entries.every(([, count]) => Number.isInteger(count) && count > 0), 'full-population count is invalid');
  assert.ok(
    expectedFullCandidateCountByState
      && typeof expectedFullCandidateCountByState === 'object'
      && !Array.isArray(expectedFullCandidateCountByState),
    'Census full population authority must be state-keyed; scalar aliases are forbidden',
  );
  assert.deepEqual(counts, expectedFullCandidateCountByState, 'state-keyed full populations drifted');
  return counts;
}

function buildCensusRequestedContract(manifest) {
  requireManifestIdentity(manifest);
  const cameraHashes = manifest.states.map(state => sha256Canonical(state.camera));
  assert.equal(new Set(cameraHashes).size, 1, 'held-state camera changed');
  const fullMembershipSha256ByState = {};
  const sparseMembershipSha256ByState = {};
  for (const state of manifest.states) {
    const fullHash = state.sourceRows?.nativeCellIndices?.sha256;
    const sparseHash = state.arrays?.nativeCellIndices?.sha256;
    assert.match(fullHash || '', SHA256, `${state.stateId} full membership SHA-256 missing`);
    assert.match(sparseHash || '', SHA256, `${state.stateId} sparse membership SHA-256 missing`);
    fullMembershipSha256ByState[state.stateId] = fullHash;
    sparseMembershipSha256ByState[state.stateId] = sparseHash;
  }
  return {
    effectiveRoute: EFFECTIVE_ROUTE,
    backend: 'WebGPU:apple',
    rendererIdentity: LEDGER_RENDERER_IDENTITY,
    modelIdentity: LEDGER_MODEL_IDENTITY,
    recurrenceIdentity: LEDGER_RECURRENCE_IDENTITY,
    depthAuthority: LEDGER_DEPTH_AUTHORITY,
    cohortSchema: manifest.schema,
    cohortManifestSha256: EXPECTED_COHORT_MANIFEST_SHA256,
    cohortAuthority: manifest.authority,
    coefficientAuthority: 'exact-local-layer-emission-extinction',
    implementationBundleSha256: IMPLEMENTATION_BUNDLE_SHA256,
    ownershipAuthority: OPTICAL_OWNERSHIP_IDENTITY,
    fullCandidateCountByState: auditFullCandidateCountContract(manifest),
    sparseCandidateCount: SPARSE_CANDIDATE_COUNT,
    stateIds: [...STATE_IDS],
    armIds: [...ARM_IDS],
    residualGridScale: RESIDUAL_GRID_SCALE,
    residualRaySteps: RESIDUAL_RAY_STEPS,
    width: WIDTH,
    height: HEIGHT,
    cameraSha256: cameraHashes[0],
    fullMembershipSha256ByState,
    sparseMembershipSha256ByState,
  };
}

export function buildExpectedLedgerContract(manifest) {
  return buildCensusRequestedContract(manifest);
}

function requireTotals(label, totals) {
  assert.ok(totals && typeof totals === 'object', `${label} totals missing`);
  for (const channel of ['emission', 'extinction']) {
    assert.ok(Number.isFinite(totals[channel]) && totals[channel] >= 0, `${label} ${channel} total is invalid`);
  }
}

function channelLedger(armId, source, sparse) {
  assert.ok(sparse <= source, `${armId} sparse coefficient mass is outside source ownership`);
  const complement = source - sparse;
  if (armId === 'full-correct' || armId === 'sparse-conservative') {
    return { source, splat: source, residual: 0, dropped: 0 };
  }
  if (armId === 'sparse-drop') return { source, splat: sparse, residual: 0, dropped: complement };
  return { source, splat: sparse, residual: complement, dropped: 0 };
}

export function buildCoefficientLedger(armId, sourceTotals, sparseTotals) {
  assert.ok(ARM_IDS.includes(armId), `unknown ledger arm ${armId}`);
  requireTotals('source', sourceTotals);
  requireTotals('sparse', sparseTotals);
  return {
    emission: channelLedger(armId, sourceTotals.emission, sparseTotals.emission),
    extinction: channelLedger(armId, sourceTotals.extinction, sparseTotals.extinction),
  };
}

export function aggregateCoefficientTotals(coefficients) {
  const exact = aggregateCoefficientTotalsExact(coefficients);
  return {
    emission: exact.emission.value,
    extinction: exact.extinction.value,
  };
}

function exactBinary32ChannelTotal(exponentBins) {
  let units = 0n;
  for (let exponent = 0; exponent < exponentBins.length; exponent += 1) {
    const bin = exponentBins[exponent];
    assert.ok(Number.isSafeInteger(bin), 'binary32 coefficient accumulator exceeded exact integer range');
    if (bin === 0) continue;
    const shift = exponent === 0 ? 0n : BigInt(exponent - 1);
    units += BigInt(bin) << shift;
  }
  const value = Number(units) * (2 ** -149);
  assert.ok(Number.isFinite(value) && value >= 0, 'binary32 coefficient total is invalid');
  return {
    binary32UnitExponent: -149,
    binary32UnitSum: units.toString(),
    value,
  };
}

export function aggregateCoefficientTotalsExact(coefficients) {
  assert.ok(coefficients instanceof Float32Array, 'coefficient payload must be Float32Array');
  assert.equal(coefficients.length % 8, 0, 'coefficient payload row width drifted');
  const bins = {
    emission: new Array(255).fill(0),
    extinction: new Array(255).fill(0),
  };
  const words = new Uint32Array(coefficients.buffer, coefficients.byteOffset, coefficients.length);
  for (let offset = 0; offset < coefficients.length; offset += 8) {
    for (let channel = 0; channel < 8; channel += 1) {
      const value = coefficients[offset + channel];
      const channelName = channel === 3 || channel === 7 ? 'extinction' : 'emission';
      assert.ok(Number.isFinite(value) && value >= 0, `${channelName} coefficient is negative or non-finite`);
      const word = words[offset + channel];
      const exponent = (word >>> 23) & 0xff;
      assert.notEqual(exponent, 0xff, `${channelName} coefficient exponent is non-finite`);
      const mantissa = exponent === 0 ? (word & 0x7fffff) : ((word & 0x7fffff) | 0x800000);
      bins[channelName][exponent] += mantissa;
    }
  }
  return {
    emission: exactBinary32ChannelTotal(bins.emission),
    extinction: exactBinary32ChannelTotal(bins.extinction),
  };
}

export function buildComplementRowIndices(sourceRowCount, sparseSourceRowIndices) {
  assert.ok(Number.isInteger(sourceRowCount) && sourceRowCount > 0, 'source row count is invalid');
  assert.ok(sparseSourceRowIndices instanceof Uint32Array, 'sparse source rows must be Uint32Array');
  assert.ok(sparseSourceRowIndices.length < sourceRowCount, 'sparse source rows cannot cover or exceed the source');
  let previous = -1;
  for (const sourceRow of sparseSourceRowIndices) {
    assert.ok(sourceRow < sourceRowCount, 'sparse source row escaped the source population');
    assert.notEqual(sourceRow, previous, 'sparse source rows contain a duplicate');
    assert.ok(sourceRow > previous, 'sparse source rows changed source row order');
    previous = sourceRow;
  }
  const complement = new Uint32Array(sourceRowCount - sparseSourceRowIndices.length);
  let sparseOffset = 0;
  let complementOffset = 0;
  for (let sourceRow = 0; sourceRow < sourceRowCount; sourceRow += 1) {
    if (sparseOffset < sparseSourceRowIndices.length && sparseSourceRowIndices[sparseOffset] === sourceRow) {
      sparseOffset += 1;
    } else {
      complement[complementOffset++] = sourceRow;
    }
  }
  assert.equal(sparseOffset, sparseSourceRowIndices.length, 'sparse source row partition is incomplete');
  assert.equal(complementOffset, complement.length, 'complement source row partition is incomplete');
  return complement;
}

function requestedConfig(expected) {
  return {
    stateIds: [...expected.stateIds],
    armIds: [...expected.armIds],
    fullCandidateCountByState: { ...expected.fullCandidateCountByState },
    sparseCandidateCount: expected.sparseCandidateCount,
    residualGridScale: expected.residualGridScale,
    residualRaySteps: expected.residualRaySteps,
    width: expected.width,
    height: expected.height,
  };
}

function sourceBinding(expected) {
  return {
    cohortSchema: expected.cohortSchema,
    cohortManifestSha256: expected.cohortManifestSha256,
    cohortAuthority: expected.cohortAuthority,
    coefficientAuthority: expected.coefficientAuthority,
    implementationBundleSha256: expected.implementationBundleSha256,
    ownershipAuthority: expected.ownershipAuthority,
    selectionRerun: false,
    residualAwareRetargeting: false,
    supportRedefined: false,
    coefficientsRedefined: false,
    covarianceRedefined: false,
    radianceRetuned: false,
    cameraRedefined: false,
  };
}

export function buildFailedLedgerReport({
  expected,
  durableReportPath,
  failurePhase,
  reason,
  lastTrustworthyEvidence,
  effectiveRouteStatus,
  sourceBindingStatus,
  effectiveConfigStatus,
  effective,
}) {
  assert.ok(expected && typeof expected === 'object', 'expected ledger identity is required');
  const report = {
    schema: EXTINCTION_COMMON_LEDGER_SCHEMA,
    status: 'failed',
    failurePhase,
    reason,
    lastTrustworthyEvidence,
    durableReportPath,
    route: { requestedRoute: expected.effectiveRoute },
    source: sourceBinding(expected),
    request: requestedConfig(expected),
    failureContext: { effectiveRouteStatus, sourceBindingStatus, effectiveConfigStatus },
  };
  if (effectiveRouteStatus === 'verified') {
    Object.assign(report.route, {
      effectiveRoute: expected.effectiveRoute,
      backend: expected.backend,
      rendererIdentity: expected.rendererIdentity,
      modelIdentity: expected.modelIdentity,
      recurrenceIdentity: expected.recurrenceIdentity,
      depthAuthority: expected.depthAuthority,
      fallbackReason: null,
    });
  }
  if (effectiveConfigStatus === 'verified') report.effective = effective || requestedConfig(expected);
  return report;
}

export function buildSourceAuthenticationFailureReport({
  expected,
  durableReportPath,
  error,
  sourcePopulationCountsByState,
}) {
  const failure = buildFailedLedgerReport({
    expected,
    durableReportPath,
    failurePhase: error?.failurePhase || 'artifact-source-authentication',
    reason: error?.message || String(error),
    lastTrustworthyEvidence: `manifest identity and requested state-keyed config parsed; source authentication did not complete; declared populations ${JSON.stringify(sourcePopulationCountsByState)}`,
    effectiveRouteStatus: 'unresolved-before-effective-route',
    sourceBindingStatus: 'unresolved-before-source-binding',
    effectiveConfigStatus: 'verified',
  });
  failure.sourcePopulationCountsByState = { ...sourcePopulationCountsByState };
  return failure;
}

function requireExactPresentation(presentation) {
  assert.equal(presentation?.targetFormat, 'rgba16float', 'linear HDR target format drifted');
  assert.equal(presentation?.exposure, 0.96, 'raymarch exposure drifted');
  assert.equal(presentation?.gradePower, 0.84, 'raymarch grade power drifted');
  assert.equal(presentation?.independentlyToneMapped, false, 'independent presentation resolve is forbidden');
}

export function requireCapturedEvidence(evidence) {
  assert.equal(evidence?.route?.effectiveRoute, EFFECTIVE_ROUTE, 'effective renderer route drifted');
  assert.equal(evidence?.route?.backend, 'WebGPU:apple', 'capture did not execute on Apple WebGPU');
  assert.equal(evidence?.route?.fallbackReason, null, 'capture used a fallback route');
  assert.deepEqual(evidence?.effective, evidence?.request, 'requested/effective capture config drifted');
  assert.equal(evidence?.recurrenceIdentity, LEDGER_RECURRENCE_IDENTITY, 'shared recurrence drifted');
  requireExactPresentation(evidence?.presentation);
  assert.equal(evidence?.timing?.timestampStatus, 'available', 'GPU timing is unavailable');
  for (const stageName of [...REQUIRED_STAGE_NAMES, 'chargedTotal']) {
    const stage = evidence?.timing?.stages?.[stageName];
    assert.equal(stage?.status, 'sampled', `${stageName} timing is partial`);
    assert.ok(Number.isFinite(stage.ms) && stage.ms >= 0, `${stageName} timing is invalid`);
  }
  const capture = evidence?.capture;
  assert.equal(capture?.authority, 'gpu-linear-hdr-readback-live-held-state-v0', 'capture authority drifted');
  assert.equal(capture?.freshnessStatus, 'live-controlled-capture', 'capture is not fresh');
  assert.equal(capture?.rgbaFloatCount, WIDTH * HEIGHT * 4, 'linear HDR payload is partial');
  assert.equal(capture?.finitePixelCount, WIDTH * HEIGHT, 'linear HDR payload contains non-finite pixels');
  assert.ok(Number.isInteger(capture?.litPixels) && capture.litPixels > 0, 'linear HDR payload is blank');
  return true;
}

function requireExactCoefficientChannel(channel, channelName) {
  for (const key of ['source', 'splat', 'residual', 'dropped']) {
    assert.ok(Number.isFinite(channel?.[key]) && channel[key] >= 0, `${channelName} ${key} is invalid`);
  }
  for (const key of ['splat', 'residual', 'dropped']) {
    assert.ok(channel[key] <= channel.source, `${channelName} ${key} exceeds source ownership`);
  }
  assert.equal(
    channel.splat + channel.residual + channel.dropped,
    channel.source,
    `${channelName} ownership is not exact`,
  );
}

export function requireExactCoefficientOwnership(arm) {
  assert.ok(ARM_IDS.includes(arm?.armId), 'captured arm identity is invalid');
  requireExactCoefficientChannel(arm?.coefficientLedger?.emission, 'emission');
  requireExactCoefficientChannel(arm?.coefficientLedger?.extinction, 'extinction');
  return true;
}

export function validateCapturedLedgerReport(report, expected) {
  for (const state of report?.states || []) {
    for (const arm of state?.arms || []) {
      requireExactCoefficientOwnership(arm);
      requireCapturedEvidence({
        route: report.route,
        request: report.request,
        effective: report.effective,
        recurrenceIdentity: arm.recurrenceIdentity,
        presentation: arm.presentation,
        timing: arm.timing,
        capture: arm.capture,
      });
    }
  }
  return validateExtinctionCommonLedgerReport(report, expected);
}

function typedBuffer(bytes, Type) {
  assert.equal(bytes.byteLength % Type.BYTES_PER_ELEMENT, 0, 'artifact byte alignment drifted');
  if (bytes.byteOffset % Type.BYTES_PER_ELEMENT === 0) {
    return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
  }
  const aligned = Uint8Array.from(bytes);
  return new Type(aligned.buffer, aligned.byteOffset, aligned.byteLength / Type.BYTES_PER_ELEMENT);
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, path);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function authenticateArrayDescriptor(descriptor, manifestPath, label, localOnly) {
  try {
    assert.ok(descriptor && typeof descriptor === 'object', `${label} descriptor missing`);
    const path = descriptorPath(descriptor, manifestPath, localOnly);
    assert.equal(statSync(path).size, descriptor.bytes, `${label} byte count drifted`);
    assert.equal(await sha256File(path), descriptor.sha256, `${label} SHA-256 drifted`);
    return {
      ...descriptor,
      path,
      authentication: 'sha256-and-byte-count-verified',
    };
  } catch (error) {
    error.failurePhase ??= localOnly ? 'exported-array-authentication' : 'source-array-authentication';
    throw error;
  }
}

function artifactArrayDescriptor({ path, artifactPath, bytes, dtype, shape, semanticRole }) {
  return {
    path: relative(dirname(artifactPath), path),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    dtype,
    shape,
    semanticRole,
    authentication: 'derived-from-authenticated-disjoint-source-row-partition-v0',
  };
}

export async function authenticateDerivedComplementDescriptor({
  artifactPath,
  descriptor,
  expectedRows,
  expectedSemanticRole = descriptor?.semanticRole,
}) {
  try {
    assert.ok(descriptor && typeof descriptor === 'object', 'derived complement descriptor missing');
    assert.equal(typeof descriptor.path, 'string', 'derived complement path missing');
    assert.equal(isAbsolute(descriptor.path), false, 'derived complement path must be artifact-relative');
    assert.match(descriptor.sha256 || '', SHA256, 'derived complement SHA-256 missing');
    assert.ok(Number.isInteger(expectedRows) && expectedRows > 0, 'derived complement row count is invalid');
    assert.equal(descriptor.bytes, expectedRows * Uint32Array.BYTES_PER_ELEMENT, 'derived complement byte count drifted');
    assert.equal(descriptor.dtype, '<u4', 'derived complement dtype drifted');
    assert.deepEqual(descriptor.shape, [expectedRows], 'derived complement shape drifted');
    assert.equal(descriptor.semanticRole, expectedSemanticRole, 'derived complement semantic role drifted');
    assert.equal(
      descriptor.authentication,
      'derived-from-authenticated-disjoint-source-row-partition-v0',
      'derived complement authentication identity drifted',
    );
    const root = realpathSync(dirname(resolve(artifactPath)));
    const path = realpathSync(resolve(root, descriptor.path));
    const rel = relative(root, path);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'derived complement path escaped the artifact root');
    assert.equal(statSync(path).size, descriptor.bytes, 'derived complement on-disk byte count drifted');
    assert.equal(await sha256File(path), descriptor.sha256, 'derived complement on-disk SHA-256 drifted');
    return true;
  } catch (error) {
    error.failurePhase ??= 'derived-complement-authentication';
    throw error;
  }
}

function exactProjectedValue(units) {
  const value = Number(units) * (2 ** -149);
  assert.ok(Number.isFinite(value) && value >= 0, 'projected exact coefficient total is invalid');
  return value;
}

function buildExactOwnership(sourceExact, sparseExact) {
  const exact = {};
  const sourceTotals = {};
  const sparseTotals = {};
  for (const channel of ['emission', 'extinction']) {
    const sourceUnits = BigInt(sourceExact[channel].binary32UnitSum);
    const sparseUnits = BigInt(sparseExact[channel].binary32UnitSum);
    assert.ok(sparseUnits <= sourceUnits, `${channel} sparse coefficient units exceed source ownership`);
    const complementUnits = sourceUnits - sparseUnits;
    assert.equal(sparseUnits + complementUnits, sourceUnits, `${channel} binary32 ownership does not close exactly`);
    const sparseValue = exactProjectedValue(sparseUnits);
    const complementValue = exactProjectedValue(complementUnits);
    exact[channel] = {
      binary32UnitExponent: -149,
      sourceUnitSum: sourceUnits.toString(),
      splatUnitSum: sparseUnits.toString(),
      complementUnitSum: complementUnits.toString(),
      closure: 'splatUnitSum + complementUnitSum == sourceUnitSum',
    };
    sparseTotals[channel] = sparseValue;
    sourceTotals[channel] = sparseValue + complementValue;
  }
  return { exact, sourceTotals, sparseTotals };
}

function unavailableStageTimingReceipt(reason) {
  return {
    timestampStatus: 'unavailable',
    timeUnit: 'ms',
    reason,
    stages: Object.fromEntries(
      [...REQUIRED_STAGE_NAMES, 'chargedTotal'].map(name => [name, { status: 'unavailable', ms: null, reason }]),
    ),
  };
}

const ARM_PAYLOAD_POLICY = Object.freeze({
  'full-correct': {
    role: 'reference',
    coefficientDisposition: 'all-source-coefficients-in-splats-v0',
    payloadStatus: 'authenticated-source-descriptor-bound',
  },
  'sparse-drop': {
    role: 'comparison',
    coefficientDisposition: 'omitted-coefficients-dropped-ablation-v0',
    payloadStatus: 'authenticated-sparse-descriptor-bound',
  },
  'sparse-conservative': {
    role: 'comparison',
    coefficientDisposition: 'omitted-coefficients-redistributed-to-splats-v0',
    payloadStatus: 'coefficient-ledger-bound-runtime-redistribution-socket-required',
  },
  'sparse-positive-complement': {
    role: 'comparison',
    coefficientDisposition: 'complementary-coefficients-in-positive-residual-v0',
    payloadStatus: 'authenticated-sparse-and-positive-complement-bound',
  },
});

function buildArmPayloads({
  state,
  expected,
  ownership,
  complementDescriptors,
  sourceDescriptors,
  sparseDescriptors,
}) {
  return ARM_IDS.map(armId => {
    const policy = ARM_PAYLOAD_POLICY[armId];
    const isFull = armId === 'full-correct';
    const usesComplement = armId === 'sparse-positive-complement';
    return {
      armId,
      stateId: state.stateId,
      role: policy.role,
      payloadStatus: policy.payloadStatus,
      requestedCandidateCount: isFull ? state.sourceRows.count : state.rowCount,
      membershipSha256: isFull
        ? state.sourceRows.nativeCellIndices.sha256
        : state.arrays.nativeCellIndices.sha256,
      coefficientAuthority: expected.coefficientAuthority,
      coefficientDisposition: policy.coefficientDisposition,
      coefficientLedger: buildCoefficientLedger(armId, ownership.sourceTotals, ownership.sparseTotals),
      exactBinary32Ownership: ownership.exact,
      splatPayload: isFull ? {
        membership: sourceDescriptors.nativeCellIndices,
        coefficients: sourceDescriptors.coefficients,
      } : {
        membership: sparseDescriptors.nativeCellIndices,
        sourceRowIndices: sparseDescriptors.sourceRowIndices,
        coefficients: sparseDescriptors.coefficients,
        kernelDescriptors: sparseDescriptors.kernelDescriptors,
        features: sparseDescriptors.features,
        admission: sparseDescriptors.admission,
        footprintScales: sparseDescriptors.footprintScales,
        depositMultiplicity: sparseDescriptors.depositMultiplicity,
        retainedQuadratureWeight: sparseDescriptors.retainedQuadratureWeight,
      },
      residualPayload: usesComplement ? {
        enabled: true,
        sourceRowIndices: complementDescriptors.sourceRowIndices,
        nativeCellIndices: complementDescriptors.nativeCellIndices,
        coefficientSource: sourceDescriptors.coefficients,
        kernelDescriptorSource: sourceDescriptors.kernelDescriptors,
        featureSource: sourceDescriptors.features,
        admissionSource: sourceDescriptors.admission,
        gatherAuthority: 'source-order-indexed-positive-complement-gather-v0',
      } : { enabled: false },
      recurrenceIdentity: LEDGER_RECURRENCE_IDENTITY,
      depthAuthority: LEDGER_DEPTH_AUTHORITY,
      timing: unavailableStageTimingReceipt('held-state Integration timestamp/runtime sockets not yet supplied'),
      route: {
        requestedRoute: EFFECTIVE_ROUTE,
        effectiveRoute: null,
        backend: null,
        status: 'unresolved-before-effective-route',
        fallbackReason: null,
      },
    };
  });
}

export async function validateAuthenticatedHybridArtifact(artifact, expected, { artifactPath } = {}) {
  assert.equal(artifact?.schema, HYBRID_ARTIFACT_SCHEMA, 'hybrid artifact schema drifted');
  assert.equal(artifact?.status, 'authenticated-build-contract-only', 'hybrid artifact status drifted');
  assert.equal(artifact?.captureEligible, false, 'build artifact falsely claims capture eligibility');
  assert.equal(artifact?.decisionBearing, false, 'build artifact falsely claims decision authority');
  assert.equal(Object.hasOwn(artifact?.request || {}, 'fullCandidateCount'), false, 'scalar full count alias returned');
  assert.deepEqual(artifact?.request, requestedConfig(expected), 'hybrid requested config drifted');
  assert.deepEqual(artifact?.effectiveConfig, artifact.request, 'hybrid requested/effective config drifted');
  assert.equal(artifact?.route?.requestedRoute, EFFECTIVE_ROUTE, 'hybrid requested route drifted');
  assert.equal(artifact?.route?.status, 'unresolved-before-effective-route', 'uncaptured route status drifted');
  assert.equal(artifact?.route?.effectiveRoute, null, 'uncaptured artifact claims an effective route');
  assert.equal(artifact?.route?.backend, null, 'uncaptured artifact claims a backend');
  assert.equal(artifact?.route?.fallbackReason, null, 'hybrid artifact contains fallback evidence');
  assert.equal(artifact?.opticalComposition?.recurrenceIdentity, LEDGER_RECURRENCE_IDENTITY, 'recurrence drifted');
  assert.equal(artifact?.opticalComposition?.recurrenceCount, 1, 'artifact does not preserve one HDR recurrence');
  assert.equal(artifact?.opticalComposition?.targetFormat, 'rgba16float', 'HDR target format drifted');
  assert.equal(artifact?.opticalComposition?.independentlyToneMapped, false, 'independent tone mapping returned');
  assert.equal(artifact?.opticalComposition?.postToneMapAddition, false, 'post-tone-map addition returned');
  assert.equal(artifact?.stageTiming?.timestampStatus, 'unavailable', 'uncaptured artifact claims timing authority');
  assert.deepEqual(
    Object.keys(artifact?.stageTiming?.stages || {}),
    [...REQUIRED_STAGE_NAMES, 'chargedTotal'],
    'stage timing receipt is incomplete',
  );
  for (const stage of Object.values(artifact.stageTiming.stages)) {
    assert.equal(stage.status, 'unavailable', 'uncaptured artifact claims a sampled stage');
    assert.equal(stage.ms, null, 'uncaptured artifact contains a stage duration');
  }
  assert.deepEqual(artifact?.states?.map(state => state.stateId), STATE_IDS, 'artifact state sequence drifted');
  for (const state of artifact.states) {
    const expectedFullCount = expected.fullCandidateCountByState[state.stateId];
    assert.equal(state.population.source, expectedFullCount, `${state.stateId} source count drifted`);
    assert.equal(state.population.sparse, expected.sparseCandidateCount, `${state.stateId} sparse count drifted`);
    assert.equal(
      state.population.complement,
      expectedFullCount - expected.sparseCandidateCount,
      `${state.stateId} complement count drifted`,
    );
    assert.equal(state.population.exactClosure, true, `${state.stateId} population closure is false`);
    assert.deepEqual(state.arms.map(arm => arm.armId), ARM_IDS, `${state.stateId} arm sequence drifted`);
    for (const descriptor of Object.values(state.sourceDescriptors || {})) {
      assert.equal(isAbsolute(descriptor.path), true, `${state.stateId} source descriptor is not an effective path`);
      assert.equal(descriptor.authentication, 'sha256-and-byte-count-verified');
    }
    for (const arm of state.arms) {
      requireExactCoefficientOwnership(arm);
      assert.equal(arm.route.status, 'unresolved-before-effective-route');
      assert.equal(arm.timing.timestampStatus, 'unavailable');
      for (const channel of ['emission', 'extinction']) {
        const exact = arm.exactBinary32Ownership[channel];
        const sourceUnits = BigInt(exact.sourceUnitSum);
        const splatUnits = BigInt(exact.splatUnitSum);
        const complementUnits = BigInt(exact.complementUnitSum);
        assert.equal(splatUnits + complementUnits, sourceUnits, `${state.stateId} ${channel} exact closure drifted`);
      }
      if (arm.armId !== 'full-correct') {
        for (const descriptor of Object.values(arm.splatPayload || {})) {
          assert.equal(isAbsolute(descriptor.path), true, `${state.stateId} sparse descriptor is not an effective path`);
          assert.equal(descriptor.authentication, 'sha256-and-byte-count-verified');
        }
      }
    }
    const complementArm = state.arms.find(arm => arm.armId === 'sparse-positive-complement');
    assert.equal(complementArm?.residualPayload?.enabled, true, `${state.stateId} positive complement is disabled`);
    assert.deepEqual(
      complementArm?.residualPayload?.sourceRowIndices,
      state.complementDescriptors?.sourceRowIndices,
      `${state.stateId} residual source-row descriptor aliases unverified metadata`,
    );
    assert.deepEqual(
      complementArm?.residualPayload?.nativeCellIndices,
      state.complementDescriptors?.nativeCellIndices,
      `${state.stateId} residual membership descriptor aliases unverified metadata`,
    );
    assert.equal(
      complementArm?.residualPayload?.sourceRowIndices?.shape?.[0],
      state.population.complement,
      `${state.stateId} complement row descriptor count drifted`,
    );
    assert.equal(
      complementArm?.residualPayload?.nativeCellIndices?.shape?.[0],
      state.population.complement,
      `${state.stateId} complement membership descriptor count drifted`,
    );
    await authenticateDerivedComplementDescriptor({
      artifactPath,
      descriptor: state.complementDescriptors.sourceRowIndices,
      expectedRows: state.population.complement,
      expectedSemanticRole: 'source-order-positive-complement-row-indices',
    });
    await authenticateDerivedComplementDescriptor({
      artifactPath,
      descriptor: state.complementDescriptors.nativeCellIndices,
      expectedRows: state.population.complement,
      expectedSemanticRole: 'source-order-positive-complement-native-cell-membership',
    });
  }
  return true;
}

export async function emitAuthenticatedHybridArtifact({ manifestPath, artifactPath }) {
  const resolvedManifestPath = resolve(manifestPath);
  const resolvedArtifactPath = resolve(artifactPath);
  await authenticatePersistentSparseCohort({
    manifestPath: resolvedManifestPath,
    expectedManifestSha256: EXPECTED_COHORT_MANIFEST_SHA256,
  });
  const manifestBytes = readFileSync(resolvedManifestPath);
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), EXPECTED_COHORT_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestBytes);
  const expected = buildExpectedLedgerContract(manifest);
  const states = [];
  for (const state of manifest.states) {
    const stateDirectory = resolve(dirname(resolvedArtifactPath), 'states', state.stateId);
    const sparseRowsPath = descriptorPath(state.arrays.sourceRowIndices, resolvedManifestPath, true);
    const sparseRowsBytes = readFileSync(sparseRowsPath);
    assert.equal(createHash('sha256').update(sparseRowsBytes).digest('hex'), state.arrays.sourceRowIndices.sha256);
    const sparseRows = typedBuffer(sparseRowsBytes, Uint32Array);
    const complementRows = buildComplementRowIndices(state.sourceRows.count, sparseRows);

    const sourceNativePath = descriptorPath(state.sourceRows.nativeCellIndices, resolvedManifestPath, false);
    const sourceNativeBytes = readFileSync(sourceNativePath);
    assert.equal(createHash('sha256').update(sourceNativeBytes).digest('hex'), state.sourceRows.nativeCellIndices.sha256);
    const sourceNative = typedBuffer(sourceNativeBytes, Uint32Array);
    const complementNative = new Uint32Array(complementRows.length);
    for (let index = 0; index < complementRows.length; index += 1) {
      complementNative[index] = sourceNative[complementRows[index]];
    }

    const complementRowsPath = resolve(stateDirectory, 'complementSourceRowIndices.u32');
    const complementNativePath = resolve(stateDirectory, 'complementNativeCellIndices.u32');
    const complementRowsBytes = Buffer.from(
      complementRows.buffer,
      complementRows.byteOffset,
      complementRows.byteLength,
    );
    const complementNativeBytes = Buffer.from(
      complementNative.buffer,
      complementNative.byteOffset,
      complementNative.byteLength,
    );
    atomicWrite(complementRowsPath, complementRowsBytes);
    atomicWrite(complementNativePath, complementNativeBytes);
    const complementDescriptors = {
      sourceRowIndices: artifactArrayDescriptor({
        path: complementRowsPath,
        artifactPath: resolvedArtifactPath,
        bytes: complementRowsBytes,
        dtype: '<u4',
        shape: [complementRows.length],
        semanticRole: 'source-order-positive-complement-row-indices',
      }),
      nativeCellIndices: artifactArrayDescriptor({
        path: complementNativePath,
        artifactPath: resolvedArtifactPath,
        bytes: complementNativeBytes,
        dtype: '<u4',
        shape: [complementNative.length],
        semanticRole: 'source-order-positive-complement-native-cell-membership',
      }),
    };

    const sourceDescriptors = {};
    for (const name of ['features', 'admission', 'nativeCellIndices', 'coefficients', 'kernelDescriptors']) {
      sourceDescriptors[name] = await authenticateArrayDescriptor(
        state.sourceRows[name],
        resolvedManifestPath,
        `${state.stateId}.sourceRows.${name}`,
        false,
      );
    }
    const sparseDescriptors = {};
    for (const [name, descriptor] of Object.entries(state.arrays)) {
      sparseDescriptors[name] = await authenticateArrayDescriptor(
        descriptor,
        resolvedManifestPath,
        `${state.stateId}.arrays.${name}`,
        true,
      );
    }
    const sourceCoefficientBytes = readFileSync(sourceDescriptors.coefficients.path);
    const sparseCoefficientPath = descriptorPath(state.arrays.coefficients, resolvedManifestPath, true);
    const sparseCoefficientBytes = readFileSync(sparseCoefficientPath);
    assert.equal(createHash('sha256').update(sparseCoefficientBytes).digest('hex'), state.arrays.coefficients.sha256);
    const sourceExact = aggregateCoefficientTotalsExact(typedBuffer(sourceCoefficientBytes, Float32Array));
    const sparseExact = aggregateCoefficientTotalsExact(typedBuffer(sparseCoefficientBytes, Float32Array));
    const ownership = buildExactOwnership(sourceExact, sparseExact);

    assert.equal(state.rowCount + complementRows.length, state.sourceRows.count, `${state.stateId} row partition does not close`);
    states.push({
      stateId: state.stateId,
      steps: state.steps,
      population: {
        source: state.sourceRows.count,
        sparse: state.rowCount,
        complement: complementRows.length,
        exactClosure: state.rowCount + complementRows.length === state.sourceRows.count,
      },
      sourceDescriptors,
      complementDescriptors,
      arms: buildArmPayloads({
        state,
        expected,
        ownership,
        complementDescriptors,
        sourceDescriptors,
        sparseDescriptors,
      }),
    });
  }

  const artifact = {
    schema: HYBRID_ARTIFACT_SCHEMA,
    status: 'authenticated-build-contract-only',
    failurePhase: null,
    authority: 'manifest-pinned-source-order-positive-complement-partition-v0',
    decisionBearing: false,
    captureEligible: false,
    source: sourceBinding(expected),
    request: requestedConfig(expected),
    effectiveConfig: requestedConfig(expected),
    route: {
      requestedRoute: EFFECTIVE_ROUTE,
      effectiveRoute: null,
      backend: null,
      status: 'unresolved-before-effective-route',
      fallbackReason: null,
    },
    opticalComposition: {
      ownershipAuthority: OPTICAL_OWNERSHIP_IDENTITY,
      recurrenceIdentity: LEDGER_RECURRENCE_IDENTITY,
      recurrenceCount: 1,
      depthAuthority: LEDGER_DEPTH_AUTHORITY,
      targetFormat: 'rgba16float',
      independentlyToneMapped: false,
      postToneMapAddition: false,
      presentation: { exposure: 0.96, gradePower: 0.84 },
    },
    stageTiming: unavailableStageTimingReceipt('held-state Integration timestamp/runtime sockets not yet supplied'),
    states,
    rails: {
      selectionRerun: false,
      residualAwareRetargeting: false,
      supportRedefined: false,
      coefficientsRedefined: false,
      covarianceRedefined: false,
      depositionRedefined: false,
      trainingUsed: false,
    },
    remainingGate: [
      'Integration four-arm runtime application socket',
      'held-state field payloads for coefficient-state-114/116/118',
      'live WebGPU timestamp and linear-HDR readbacks',
      'Census sixteen-cell validation and Bailiff dynamic/native inspection',
    ],
  };
  await validateAuthenticatedHybridArtifact(artifact, expected, { artifactPath: resolvedArtifactPath });
  atomicWrite(resolvedArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const artifactSha256 = await sha256File(resolvedArtifactPath);
  return { artifact, artifactPath: resolvedArtifactPath, artifactSha256, expected };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    assert.ok(key.startsWith('--'), `unexpected argument ${key}`);
    assert.ok(index + 1 < argv.length && !argv[index + 1].startsWith('--'), `missing value for ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.ok(options.manifest, '--manifest is required');
  assert.ok(options.report, '--report is required');
  const manifestPath = resolve(options.manifest);
  const reportPath = resolve(options.report);
  const artifactPath = resolve(options.artifact || resolve(dirname(reportPath), 'hybrid-artifact.json'));
  mkdirSync(dirname(reportPath), { recursive: true });
  rmSync(reportPath, { force: true });
  rmSync(artifactPath, { force: true });
  let expected;
  let manifest;
  try {
    const manifestBytes = readFileSync(manifestPath);
    assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), EXPECTED_COHORT_MANIFEST_SHA256);
    manifest = JSON.parse(manifestBytes);
    expected = buildExpectedLedgerContract(manifest);
    const emitted = await emitAuthenticatedHybridArtifact({ manifestPath, artifactPath });
    const failure = buildFailedLedgerReport({
      expected,
      durableReportPath: reportPath,
      failurePhase: 'held-state-runtime-sockets',
      reason: 'exact four-state arm payloads are emitted, but held-state Integration route/timestamp/HDR sockets and field payloads for states 114/116/118 are unavailable',
      lastTrustworthyEvidence: `authenticated sparse-positive-complement artifact ${emitted.artifactSha256}`,
      effectiveRouteStatus: 'unresolved-before-effective-route',
      sourceBindingStatus: 'authenticated',
      effectiveConfigStatus: 'verified',
    });
    failure.payloadArtifact = {
      schema: HYBRID_ARTIFACT_SCHEMA,
      status: emitted.artifact.status,
      path: emitted.artifactPath,
      sha256: emitted.artifactSha256,
    };
    failure.stageTiming = unavailableStageTimingReceipt(
      'held-state Integration timestamp/runtime sockets not yet supplied',
    );
    const validation = validateExtinctionCommonLedgerReport(failure, expected);
    assert.equal(validation.ok, true, validation.errors.join(', '));
    atomicWrite(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      artifactPath: emitted.artifactPath,
      artifactSha256: emitted.artifactSha256,
      reportPath,
      reportSha256: await sha256File(reportPath),
      expected,
      validation,
    }, null, 2)}\n`);
  } catch (error) {
    if (!expected) throw error;
    const sourcePopulationCountsByState = Object.fromEntries(
      (manifest?.states || []).map(state => [state.stateId, state.sourceRows?.count]),
    );
    const failure = buildSourceAuthenticationFailureReport({
      expected,
      durableReportPath: reportPath,
      error,
      sourcePopulationCountsByState,
    });
    const validation = validateExtinctionCommonLedgerReport(failure, expected);
    assert.equal(validation.ok, true, validation.errors.join(', '));
    atomicWrite(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    process.stderr.write(`${JSON.stringify({ reportPath, failure, validation }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
