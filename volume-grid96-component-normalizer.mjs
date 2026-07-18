#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRID96_DESCRIPTOR_ORDER } from './volume-grid96-full-support-companion.mjs';
import {
  assertLayerCoefficientPopulation,
  summarizeLayerCoefficientPopulation,
} from './volume-layer-coefficient-population.mjs';

const GRID = 96;
const CELL_COUNT = GRID ** 3;
const ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const STATE_ID = 'coefficient-state-120';
const REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const SOURCE_SCHEMA = 'kaminos.volume.grid96-source.v0';
const EQUIVALENCE_SCHEMA = 'kaminos.volume.grid96-source-equivalence.v0';
const PRODUCER_SCHEMA = 'kaminos.volume.grid96-coefficient-source-capture.v0';
const SOURCE_AUTHORITY = 'native-grid96-full-field-export-v0';
const PRODUCER_AUTHORITY = 'exact-grid96-source-support-coefficient-descriptor-capture-v0';
const COMPONENT_SCHEMA = 'kaminos.volume.grid96-native-component.v0';
const SOURCE_PREFLIGHT_IDENTITY = 'native-grid96-same-state-source-preflight-v0';
const EQUIVALENCE_IDENTITY = 'exact-four-payload-byte-identity-at-state-v0';
const CAUSAL_QUESTION = 'source-lattice-subcell-vs-deposit-space-quadrature-v0';
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const RECEIPT_IDENTITY = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_SOURCE_HASH_KEYS = Object.freeze([
  'fluidSha256',
  'frontSha256',
  'boundarySidecarSha256',
  'majorantSha256',
]);
const EXPECTED_COEFFICIENT_CHANNELS = Object.freeze([
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
]);
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function buildGrid96Components({ source, equivalence, producer, sourceManifestSha256 }) {
  validateSource(source, sourceManifestSha256);
  validateEquivalence(equivalence, source);
  const state = validateProducer(producer, equivalence, source);
  const rows = validateRows(state.rows);
  const common = {
    schema: COMPONENT_SCHEMA,
    status: 'complete',
    failurePhase: null,
    grid: GRID,
    sameStateCaptureId: source.sameStateCaptureId,
    simStepCount: source.simStepCount,
    requestedControlIdentity: source.requestedControlIdentity,
    effectiveControlIdentity: source.effectiveControlIdentity,
    sourceManifestSha256,
    route: { ...source.route },
    producerReceipt: {
      authority: producer.authority,
      sourceEquivalenceIdentity: producer.sourceEquivalenceIdentity,
      authoritativeSourceIdentity: producer.authoritativeSourceIdentity,
      requestedControlIdentity: producer.requestedControlIdentity,
      effectiveControlIdentity: producer.effectiveControlIdentity,
      route: { ...producer.route },
      stateId: state.id,
      coefficientRenderAuthority: { ...rows.coefficientRenderAuthority },
    },
  };

  const support = {
    ...common,
    role: 'support',
    identity: 'full-flame-ridge-nonridge-live-union-v0',
    admissionIdentity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0',
    admissionAuthority: 'external-native-cell-index-list-v0',
    nativeCellIndexSha256: rows.nativeCellIndices.sha256,
    rowCount: rows.count,
    sampleCap: null,
    droppedRowCount: 0,
    overflowCount: 0,
    duplicatePolicy: 'forbidden',
    nativeCellIndices: rows.nativeCellIndices,
    admission: rows.admission,
    features: rows.features,
  };
  const descriptors = {
    ...common,
    role: 'descriptors',
    identity: 'flow-kernel-local-descriptor-socket-v0',
    kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
    candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
    nativeCellIndexSha256: rows.nativeCellIndices.sha256,
    rowCount: rows.count,
    strideFloats: GRID96_DESCRIPTOR_ORDER.length,
    descriptorOrder: [...GRID96_DESCRIPTOR_ORDER],
    artifact: rows.kernelDescriptors,
  };
  const coefficients = {
    ...common,
    role: 'coefficients',
    identity: 'exact-local-layer-emission-extinction-v0',
    coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    partitionIdentity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
    channels: [...EXPECTED_COEFFICIENT_CHANNELS],
    nonnegative: true,
    nativeCellIndexSha256: rows.nativeCellIndices.sha256,
    rowCount: rows.count,
    artifact: rows.coefficients,
  };
  const claimBoundary = {
    causalQuestion: CAUSAL_QUESTION,
    sourceEquivalenceIdentity: equivalence.identity ?? null,
    cheaperDemoClaim: false,
    resizedGrid160Evidence: false,
    learnerCampaign: false,
    depositionAdjudication: false,
  };
  return { support, descriptors, coefficients, claimBoundary };
}

function validateSource(source, sourceManifestSha256) {
  assert.equal(source?.schema, SOURCE_SCHEMA, 'authoritative source schema drifted');
  assert.equal(source.status, 'complete', 'authoritative source is incomplete');
  assert.equal(source.failurePhase, null, 'authoritative source carries a failure phase');
  assert.equal(source.authority, SOURCE_AUTHORITY, 'authoritative source authority drifted');
  assert.equal(source.preflightIdentity, SOURCE_PREFLIGHT_IDENTITY, 'authoritative source preflight identity drifted');
  assert.equal(source.grid, GRID, 'authoritative source is not native Grid96');
  assert.equal(source.majorantGrid, 24, 'authoritative source majorant grid drifted');
  assert.equal(source.completeFieldCoverage, true, 'authoritative source field coverage is partial');
  assert.equal(source.fullGridCellCount, CELL_COUNT, 'authoritative source cell coverage is incomplete');
  assert.equal(source.simStepCount, 120, 'authoritative source is not exact state 120');
  assert.equal(source.route?.effective, ROUTE, 'authoritative source did not use the native route');
  assert.match(source.route?.backend || '', /^WebGPU:/, 'authoritative source backend is not WebGPU');
  assert.equal(source.route?.fallbackReason ?? null, null, 'authoritative source used a fallback');
  assert.equal(source.requestedControlIdentity, source.effectiveControlIdentity, 'authoritative source controls were substituted');
  assert.match(source.identity || '', RECEIPT_IDENTITY, 'authoritative source receipt identity is missing or invalid');
  validateClaimBoundary(source.claimBoundary, 'authoritative source');
  assert.match(sourceManifestSha256 || '', HEX_SHA256, 'source manifest SHA-256 is invalid');
}

function validateEquivalence(equivalence, source) {
  assert.equal(equivalence?.schema, EQUIVALENCE_SCHEMA, 'source equivalence schema drifted');
  assert.equal(equivalence.status, 'equivalent', 'source equivalence did not pass');
  assert.equal(equivalence.failurePhase, null, 'source equivalence carries a failure phase');
  assert.equal(equivalence.equivalenceIdentity, EQUIVALENCE_IDENTITY, 'source equivalence identity drifted');
  assert.equal(equivalence.exactByteIdentity, true, 'source equivalence lacks exact byte identity');
  assert.equal(equivalence.grid, GRID, 'source equivalence is not Grid96');
  assert.equal(equivalence.stateId, STATE_ID, 'source equivalence is not exact coefficient-state-120');
  assert.equal(equivalence.simStepCount, 120, 'source equivalence simulator step drifted');
  assert.match(equivalence.identity || '', RECEIPT_IDENTITY, 'source equivalence receipt identity is missing or invalid');
  assert.equal(equivalence.authoritativeSourceIdentity, source.identity, 'source equivalence references another authority');
  const direct = equivalence.reuseDecision?.directCoefficientCaptureMayProceed === true
    || equivalence.reuseDecision?.exactCoefficientProducerSourceEquivalent === true;
  assert.equal(direct, true, 'source equivalence does not admit direct coefficient capture');
  assert.equal(equivalence.reuseDecision?.frozenFieldImportRequired, false, 'source equivalence still requires frozen-field import');
  assert.equal(equivalence.route?.candidateEffective, ROUTE, 'source-equivalent candidate used the wrong route');
  assert.match(equivalence.route?.candidateBackend || '', /^WebGPU:/, 'source-equivalent candidate backend is not WebGPU');
  assert.equal(equivalence.route?.fallbackUsed, false, 'source equivalence used a fallback');
  assert.equal(equivalence.controls?.candidateRequested, equivalence.controls?.candidateEffective, 'source-equivalent candidate controls were substituted');
  assert.equal(equivalence.controls?.substitutionObserved, false, 'source equivalence observed control substitution');
  for (const key of REQUIRED_SOURCE_HASH_KEYS) {
    assert.match(equivalence.sourceHashes?.[key] || '', HEX_SHA256, `four-payload source hash receipt is missing or invalid: ${key}`);
  }
  validateClaimBoundary(equivalence.claimBoundary, 'source equivalence');
}

function validateProducer(producer, equivalence, source = null) {
  assert.equal(producer?.schema, PRODUCER_SCHEMA, 'coefficient source producer schema drifted');
  assert.equal(producer.status, 'complete', 'coefficient source producer is incomplete');
  assert.equal(producer.failurePhase, null, 'coefficient source producer carries a failure phase');
  assert.equal(producer.authority, PRODUCER_AUTHORITY, 'coefficient source producer authority drifted');
  assert.equal(producer.route?.effective, ROUTE, 'coefficient source producer did not use the native route');
  assert.match(producer.route?.backend || '', /^WebGPU:/, 'coefficient source producer backend is not WebGPU');
  assert.equal(producer.route?.fallbackReason ?? null, null, 'coefficient source producer used a fallback');
  assert.equal(producer.sourceEquivalenceIdentity, equivalence.identity, 'producer source equivalence identity drifted');
  assert.equal(producer.authoritativeSourceIdentity, source?.identity ?? equivalence.authoritativeSourceIdentity, 'producer authoritative source identity drifted');
  assert.equal(producer.requestedControlIdentity, equivalence.controls?.candidateRequested, 'producer requested controls differ from source equivalence');
  assert.equal(producer.effectiveControlIdentity, equivalence.controls?.candidateEffective, 'producer effective controls differ from source equivalence');
  assert.equal(producer.requestedControlIdentity, producer.effectiveControlIdentity, 'producer controls were substituted');
  assert.equal(producer.route?.requested, equivalence.route?.candidateRequested, 'producer requested route differs from source equivalence');
  assert.equal(producer.sampleCap, null, 'coefficient source producer installed a sample cap');
  assert.equal(producer.droppedRowCount, 0, 'coefficient source producer dropped rows');
  assert.equal(producer.overflowCount, 0, 'coefficient source producer overflowed');
  const state = producer.state;
  assert.equal(state?.id, STATE_ID, 'coefficient source producer state drifted');
  assert.equal(state.replay?.identity, REPLAY_IDENTITY, 'coefficient source replay identity drifted');
  assert.equal(state.replay?.requestedSteps, 120, 'coefficient source replay request drifted');
  assert.equal(state.replay?.completedSteps, 120, 'coefficient source replay did not complete state 120');
  assert.equal(state.replay?.grid, GRID, 'coefficient source replay is not native Grid96');
  assert.equal(state.replay?.effectiveRoute, ROUTE, 'coefficient source replay used the wrong route');
  assert.match(state.replay?.backend || '', /^WebGPU:/, 'coefficient source replay backend is not WebGPU');
  for (const key of REQUIRED_SOURCE_HASH_KEYS) {
    const expected = equivalence.sourceHashes[key];
    const field = key.replace(/Sha256$/, '').replace('boundarySidecar', 'boundary');
    assert.equal(state.sourceHashes?.[key], expected, `${field} checksum differs from equivalent native Grid96 source`);
  }
  return state;
}

function validateClaimBoundary(boundary, label) {
  assert.equal(boundary?.causalQuestion, CAUSAL_QUESTION, `${label} causal question drifted`);
  assert.equal(boundary.cheaperDemoClaim, false, `${label} carries a cheaper-demo claim`);
  assert.equal(boundary.resizedGrid160Evidence, false, `${label} carries resized Grid160 evidence`);
  assert.equal(boundary.learnerCampaign, false, `${label} absorbed a learner campaign`);
  assert.equal(boundary.depositionAdjudication, false, `${label} absorbed deposition adjudication`);
}

function validateRows(rows) {
  assert.ok(Number.isInteger(rows?.count) && rows.count > 0, 'analytical admission retained zero rows');
  const count = rows.count;
  const coefficientRenderAuthority = rows.coefficientRenderAuthority;
  assert.equal(coefficientRenderAuthority?.requestedComposition, 'raymarch-only-v0', 'coefficient render authority request drifted');
  assert.equal(coefficientRenderAuthority?.effectiveComposition, 'raymarch-only-v0', 'coefficient render authority was not effective');
  assert.equal(coefficientRenderAuthority?.compositionAuthority, 'diagnostic-raymarch-full-selected-field-authority-v0', 'coefficient render authority lacks full-fire authority');
  assert.equal(coefficientRenderAuthority?.compositionFallbackReason ?? null, null, 'coefficient render authority used fallback');
  const nativeCellIndices = validateArtifact(rows.nativeCellIndices, {
    label: 'native-cell indices', dtype: 'uint32-le', shape: [count], semanticRole: 'analytical-admission-native-cell-indices',
  });
  validateNativeCellIndices(nativeCellIndices.buffer, count);
  const admission = validateArtifact(rows.admission, {
    label: 'analytical admission', dtype: 'float32-le', shape: [count, 2], semanticRole: 'analytical-ridge-or-nonridge-admission',
  });
  validateFloatPayload(admission.buffer, 'analytical admission', { nonnegative: true, rowWidth: 2, requirePositivePerRow: true });
  const features = validateArtifact(rows.features, {
    label: 'local features', dtype: 'float32-le', shape: [count, 24], semanticRole: 'post-admission-local-features',
  });
  validateFloatPayload(features.buffer, 'local features');
  const coefficients = validateArtifact(rows.coefficients, {
    label: 'exact coefficients', dtype: 'float32-le', shape: [count, 8], semanticRole: 'exact-local-layer-emission-extinction',
  });
  assert.equal(rows.coefficients.nativeCellIndexSha256, nativeCellIndices.sha256, 'coefficient native-cell support hash drifted');
  assert.equal(rows.coefficients.rowOrderIdentity, 'caller-ordered-native-cell-index-v0', 'coefficient row order identity drifted');
  const coefficientValues = validateFloatPayload(coefficients.buffer, 'exact coefficients', { nonnegative: true });
  const admissionValues = floatValues(admission.buffer);
  const coefficientPopulation = assertLayerCoefficientPopulation(summarizeLayerCoefficientPopulation({
    coefficients: coefficientValues,
    admission: admissionValues,
  }));
  const kernelDescriptors = validateArtifact(rows.kernelDescriptors, {
    label: 'kernel descriptors', dtype: 'float32-le', shape: [count, GRID96_DESCRIPTOR_ORDER.length],
    semanticRole: 'camera-independent-flow-kernel-descriptors',
  });
  validateFloatPayload(kernelDescriptors.buffer, 'kernel descriptors');
  assert.equal(rows.kernelDescriptors.socketIdentity, 'flow-kernel-local-descriptor-socket-v0', 'descriptor socket identity drifted');
  assert.equal(rows.kernelDescriptors.kernelIdentity, 'flow-tangent-positive-symmetric-trilinear-v0', 'descriptor kernel identity drifted');
  assert.equal(rows.kernelDescriptors.candidateAdmissionAuthority, 'external-native-cell-index-list-v0', 'descriptor admission authority drifted');
  assert.equal(rows.kernelDescriptors.strideFloats, GRID96_DESCRIPTOR_ORDER.length, 'descriptor stride drifted');
  assert.deepEqual(rows.kernelDescriptors.descriptorOrder, GRID96_DESCRIPTOR_ORDER, 'descriptor order drifted');
  assert.equal(rows.kernelDescriptors.admissionIndexAuthority?.indexSha256, nativeCellIndices.sha256, 'descriptor native-cell support hash drifted');
  assert.equal(rows.kernelDescriptors.admissionIndexAuthority?.count, count, 'descriptor native-cell support count drifted');
  return {
    count,
    nativeCellIndices: stripBuffer(nativeCellIndices),
    admission: stripBuffer(admission),
    features: stripBuffer(features),
    coefficients: { ...stripBuffer(coefficients), coefficientPopulation },
    kernelDescriptors: stripBuffer(kernelDescriptors),
    coefficientRenderAuthority: { ...coefficientRenderAuthority },
  };
}

function validateArtifact(artifact, expected) {
  assert.ok(artifact && typeof artifact === 'object', `${expected.label} artifact is missing`);
  assert.ok(isAbsolute(artifact.path), `${expected.label} path must be absolute`);
  const buffer = readFileSync(artifact.path);
  assert.ok(buffer.length > 0, `${expected.label} artifact is blank`);
  assert.equal(artifact.bytes, buffer.length, `${expected.label} byte count drifted`);
  assert.equal(artifact.sha256, sha256(buffer), `${expected.label} checksum drifted`);
  assert.equal(artifact.dtype, expected.dtype, `${expected.label} dtype drifted`);
  assert.deepEqual(artifact.shape, expected.shape, `${expected.label} shape drifted`);
  assert.equal(artifact.semanticRole, expected.semanticRole, `${expected.label} semantic role drifted`);
  assert.equal(buffer.length, expected.shape.reduce((total, value) => total * value, 1) * 4, `${expected.label} physical byte length drifted`);
  return { ...artifact, buffer };
}

function validateNativeCellIndices(buffer, count) {
  const values = new Uint32Array(buffer.buffer, buffer.byteOffset, count);
  const seen = new Set();
  for (const value of values) {
    assert.ok(value < CELL_COUNT, `native cell index ${value} is outside Grid96`);
    assert.equal(seen.has(value), false, `duplicate native cell index ${value}`);
    seen.add(value);
  }
}

function validateFloatPayload(buffer, label, { nonnegative = false, rowWidth = null, requirePositivePerRow = false } = {}) {
  const values = floatValues(buffer);
  for (const value of values) {
    assert.ok(Number.isFinite(value), `${label} contains a non-finite float`);
    if (nonnegative) assert.ok(value >= 0, `${label} contains a negative float`);
  }
  if (requirePositivePerRow) {
    for (let offset = 0; offset < values.length; offset += rowWidth) {
      assert.ok(values.subarray(offset, offset + rowWidth).some(value => value > 0), `${label} row has no positive Ridge or Non-Ridge membership`);
    }
  }
  return values;
}

function floatValues(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function stripBuffer(value) {
  const { buffer, ...artifact } = value;
  return artifact;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected positional argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  return values;
}

function required(args, key) {
  const value = args.get(key);
  if (!value) throw new Error(`missing required argument: ${key}`);
  return resolve(value);
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

function componentPathsFor(outDir) {
  return {
    support: join(outDir, 'grid96-support-manifest.json'),
    descriptors: join(outDir, 'grid96-descriptor-manifest.json'),
    coefficients: join(outDir, 'grid96-coefficient-manifest.json'),
  };
}

function writeComponentState(paths, state) {
  const errors = [];
  for (const [role, path] of Object.entries(paths || {})) {
    try {
      atomicWriteJson(path, { ...state, role });
    } catch (error) {
      errors.push({ role, path, reason: error?.message || String(error) });
    }
  }
  return errors;
}

async function main() {
  let failurePhase = 'argument-validation';
  let reportPath = null;
  let componentPaths = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourcePath = required(args, '--source-manifest');
    const equivalencePath = required(args, '--equivalence-manifest');
    const producerPath = required(args, '--producer-manifest');
    const outDir = required(args, '--out-dir');
    reportPath = required(args, '--report');
    componentPaths = componentPathsFor(outDir);
    failurePhase = 'input-read';
    const invalidationErrors = writeComponentState(componentPaths, {
      schema: COMPONENT_SCHEMA,
      status: 'incomplete',
      failurePhase,
      reason: 'component normalization started; no prior fixed-name component output remains authoritative',
    });
    assert.equal(invalidationErrors.length, 0, `could not invalidate prior component outputs: ${JSON.stringify(invalidationErrors)}`);
    const sourceBytes = readFileSync(sourcePath);
    const source = JSON.parse(sourceBytes);
    const equivalence = JSON.parse(readFileSync(equivalencePath));
    const producer = JSON.parse(readFileSync(producerPath));
    failurePhase = 'component-validation';
    const built = buildGrid96Components({ source, equivalence, producer, sourceManifestSha256: sha256(sourceBytes) });
    failurePhase = 'component-write';
    for (const [role, path] of Object.entries(componentPaths)) atomicWriteJson(path, built[role]);
    const result = { ...built, paths: componentPaths };
    atomicWriteJson(reportPath, {
      schema: 'kaminos.volume.grid96-component-normalizer-report.v0',
      status: 'complete',
      failurePhase: null,
      paths: componentPaths,
      claimBoundary: built.claimBoundary,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failure = {
      schema: 'kaminos.volume.grid96-component-normalizer-report.v0',
      status: 'failed',
      failurePhase,
      reason: error?.message || String(error),
    };
    const componentFailureWriteErrors = writeComponentState(componentPaths, failure);
    if (componentFailureWriteErrors.length > 0) failure.componentFailureWriteErrors = componentFailureWriteErrors;
    if (reportPath) atomicWriteJson(reportPath, failure);
    console.error(failure.reason);
    process.exitCode = 1;
  }
}

if (isCli) await main();
