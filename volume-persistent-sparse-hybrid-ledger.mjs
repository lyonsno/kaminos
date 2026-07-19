#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_MANIFEST_SHA256 as CONSUMER_MANIFEST_SHA256,
  authenticatePersistentSparseCohort,
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

const FULL_CANDIDATE_COUNT = 1_925_788;
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

export function auditFullCandidateCountContract(manifest, expectedFullCandidateCount = FULL_CANDIDATE_COUNT) {
  const counts = Object.fromEntries((manifest?.states || []).map(state => [state.stateId, state.sourceRows?.count]));
  const entries = Object.entries(counts);
  assert.deepEqual(entries.map(([stateId]) => stateId), STATE_IDS, 'full-population state sequence drifted');
  assert.ok(entries.every(([, count]) => Number.isInteger(count) && count > 0), 'full-population count is invalid');
  const mismatches = entries.filter(([, count]) => count !== expectedFullCandidateCount);
  assert.equal(
    mismatches.length,
    0,
    `Census scalar fullCandidateCount=${expectedFullCandidateCount} cannot represent state-varying authenticated full populations: ${entries.map(([stateId, count]) => `${stateId.replace('coefficient-state-', '')}=${count}`).join(', ')}`,
  );
  return counts;
}

export function buildExpectedLedgerContract(manifest) {
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
    fullCandidateCount: FULL_CANDIDATE_COUNT,
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

function requireTotals(label, totals) {
  assert.ok(totals && typeof totals === 'object', `${label} totals missing`);
  for (const channel of ['emission', 'extinction']) {
    assert.ok(Number.isFinite(totals[channel]) && totals[channel] >= 0, `${label} ${channel} total is invalid`);
  }
}

function channelLedger(armId, source, sparse) {
  assert.ok(sparse <= source + Math.max(1, source) * 1e-6, `${armId} sparse coefficient mass is outside source ownership`);
  const complement = Math.max(0, source - sparse);
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
  assert.ok(coefficients instanceof Float32Array, 'coefficient payload must be Float32Array');
  assert.equal(coefficients.length % 8, 0, 'coefficient payload row width drifted');
  let emission = 0;
  let extinction = 0;
  for (let offset = 0; offset < coefficients.length; offset += 8) {
    for (const channel of [0, 1, 2, 4, 5, 6]) {
      const value = coefficients[offset + channel];
      assert.ok(Number.isFinite(value) && value >= 0, 'emission coefficient is negative or non-finite');
      emission += value;
    }
    for (const channel of [3, 7]) {
      const value = coefficients[offset + channel];
      assert.ok(Number.isFinite(value) && value >= 0, 'extinction coefficient is negative or non-finite');
      extinction += value;
    }
  }
  return { emission, extinction };
}

function requestedConfig(expected) {
  return {
    stateIds: [...expected.stateIds],
    armIds: [...expected.armIds],
    fullCandidateCount: expected.fullCandidateCount,
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

export function validateCapturedLedgerReport(report, expected) {
  for (const state of report?.states || []) {
    for (const arm of state?.arms || []) requireCapturedEvidence({
      route: report.route,
      request: report.request,
      effective: report.effective,
      recurrenceIdentity: arm.recurrenceIdentity,
      presentation: arm.presentation,
      timing: arm.timing,
      capture: arm.capture,
    });
  }
  return validateExtinctionCommonLedgerReport(report, expected);
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
  mkdirSync(dirname(reportPath), { recursive: true });
  let expected;
  let manifest;
  try {
    await authenticatePersistentSparseCohort({
      manifestPath,
      expectedManifestSha256: EXPECTED_COHORT_MANIFEST_SHA256,
    });
    const manifestBytes = readFileSync(manifestPath);
    assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), EXPECTED_COHORT_MANIFEST_SHA256);
    manifest = JSON.parse(manifestBytes);
    expected = buildExpectedLedgerContract(manifest);
    auditFullCandidateCountContract(manifest, expected.fullCandidateCount);
    const failure = buildFailedLedgerReport({
      expected,
      durableReportPath: reportPath,
      failurePhase: 'gpu-route-load',
      reason: 'live WebGPU ledger runtime receipt was not supplied',
      lastTrustworthyEvidence: 'immutable cohort arrays and requested experiment identity authenticated',
      effectiveRouteStatus: 'unresolved-before-effective-route',
      sourceBindingStatus: 'authenticated',
      effectiveConfigStatus: 'verified',
    });
    const validation = validateExtinctionCommonLedgerReport(failure, expected);
    assert.equal(validation.ok, true, validation.errors.join(', '));
    writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ reportPath, expected, validation }, null, 2)}\n`);
  } catch (error) {
    if (!expected) throw error;
    const sourcePopulationCountsByState = Object.fromEntries(
      (manifest?.states || []).map(state => [state.stateId, state.sourceRows?.count]),
    );
    const failure = buildFailedLedgerReport({
      expected,
      durableReportPath: reportPath,
      failurePhase: 'common-ledger-source-binding',
      reason: error?.message || String(error),
      lastTrustworthyEvidence: `immutable cohort and all arrays authenticated; source full-population counts ${JSON.stringify(sourcePopulationCountsByState)}`,
      effectiveRouteStatus: 'unresolved-before-effective-route',
      sourceBindingStatus: 'authenticated',
      effectiveConfigStatus: 'verified',
    });
    failure.sourcePopulationCountsByState = sourcePopulationCountsByState;
    const validation = validateExtinctionCommonLedgerReport(failure, expected);
    assert.equal(validation.ok, true, validation.errors.join(', '));
    writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    process.stderr.write(`${JSON.stringify({ reportPath, failure, validation }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
