import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGrid96Components } from '../volume-grid96-component-normalizer.mjs';
import { GRID96_DESCRIPTOR_ORDER } from '../volume-grid96-full-support-companion.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-grid96-component-normalizer-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact = (name, bytes, metadata) => {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), ...metadata };
};
const f32 = values => Buffer.from(new Float32Array(values).buffer);
const u32 = values => Buffer.from(new Uint32Array(values).buffer);

const sourceHashes = {
  fluidSha256: '1'.repeat(64),
  frontSha256: '2'.repeat(64),
  boundarySidecarSha256: '3'.repeat(64),
  majorantSha256: '4'.repeat(64),
};
const source = {
  schema: 'kaminos.volume.grid96-source.v0',
  status: 'complete',
  failurePhase: null,
  role: 'source',
  authority: 'native-grid96-full-field-export-v0',
  preflightIdentity: 'native-grid96-same-state-source-preflight-v0',
  grid: 96,
  majorantGrid: 24,
  completeFieldCoverage: true,
  fullGridCellCount: 96 ** 3,
  sameStateCaptureId: 'exact-full-flame-grid96-state120-v0',
  simStepCount: 120,
  requestedControlIdentity: 'sha256:requested-controls',
  effectiveControlIdentity: 'sha256:requested-controls',
  route: {
    requested: 'http://127.0.0.1:19096/?volume_resolution=96',
    effective: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
  },
  identity: `sha256:${'5'.repeat(64)}`,
  claimBoundary: {
    causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
    cheaperDemoClaim: false,
    resizedGrid160Evidence: false,
    learnerCampaign: false,
    depositionAdjudication: false,
  },
};
const equivalence = {
  schema: 'kaminos.volume.grid96-source-equivalence.v0',
  status: 'equivalent',
  failurePhase: null,
  equivalenceIdentity: 'exact-four-payload-byte-identity-at-state-v0',
  exactByteIdentity: true,
  grid: 96,
  stateId: 'coefficient-state-120',
  simStepCount: 120,
  authoritativeSourceIdentity: source.identity,
  sourceHashes,
  route: {
    candidateRequested: source.route.requested,
    candidateEffective: source.route.effective,
    candidateBackend: source.route.backend,
    fallbackUsed: false,
  },
  controls: {
    candidateRequested: 'sha256:producer-controls',
    candidateEffective: 'sha256:producer-controls',
    substitutionObserved: false,
  },
  reuseDecision: {
    tigerRuntimeSourceEquivalent: true,
    directCoefficientCaptureMayProceed: true,
    frozenFieldImportRequired: false,
  },
  claimBoundary: {
    causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
    cheaperDemoClaim: false,
    resizedGrid160Evidence: false,
    learnerCampaign: false,
    depositionAdjudication: false,
  },
};

const rowCount = 3;
const indices = artifact('indices.u32', u32([7, 31, (96 ** 3) - 1]), {
  dtype: 'uint32-le', shape: [rowCount], semanticRole: 'analytical-admission-native-cell-indices',
});
const admission = artifact('admission.f32', f32([1, 0, 0, 0.5, 0.25, 0.75]), {
  dtype: 'float32-le', shape: [rowCount, 2], semanticRole: 'analytical-ridge-or-nonridge-admission',
});
const features = artifact('features.f32', f32(Array.from({ length: rowCount * 24 }, (_, index) => index / 100)), {
  dtype: 'float32-le', shape: [rowCount, 24], semanticRole: 'post-admission-local-features',
});
const coefficients = artifact('coefficients.f32', f32(Array.from({ length: rowCount * 8 }, (_, index) => index / 50)), {
  dtype: 'float32-le', shape: [rowCount, 8], semanticRole: 'exact-local-layer-emission-extinction',
  nativeCellIndexSha256: indices.sha256,
  rowOrderIdentity: 'caller-ordered-native-cell-index-v0',
});
const descriptors = artifact('descriptors.f32', f32(Array.from({ length: rowCount * 100 }, (_, index) => index / 1000)), {
  dtype: 'float32-le', shape: [rowCount, 100], semanticRole: 'camera-independent-flow-kernel-descriptors',
  socketIdentity: 'flow-kernel-local-descriptor-socket-v0',
  strideFloats: 100,
  descriptorOrder: GRID96_DESCRIPTOR_ORDER,
  kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
  candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
  admissionIndexAuthority: {
    identity: 'external-native-cell-index-list-v0',
    indexSha256: indices.sha256,
    count: rowCount,
    duplicatePolicy: 'forbidden',
  },
  sourceHashes,
});

const producer = {
  schema: 'kaminos.volume.grid96-coefficient-source-capture.v0',
  status: 'complete',
  failurePhase: null,
  authority: 'exact-grid96-source-support-coefficient-descriptor-capture-v0',
  route: { ...source.route },
  sourceEquivalenceIdentity: `sha256:${'6'.repeat(64)}`,
  authoritativeSourceIdentity: source.identity,
  requestedControlIdentity: 'sha256:producer-controls',
  effectiveControlIdentity: 'sha256:producer-controls',
  sampleCap: null,
  droppedRowCount: 0,
  overflowCount: 0,
  state: {
    id: 'coefficient-state-120',
    replay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      requestedSteps: 120,
      completedSteps: 120,
      grid: 96,
      effectiveRoute: source.route.effective,
      backend: source.route.backend,
    },
    sourceHashes,
    rows: { count: rowCount, nativeCellIndices: indices, admission, features, coefficients, kernelDescriptors: descriptors },
  },
};
equivalence.identity = producer.sourceEquivalenceIdentity;

const built = buildGrid96Components({ source, equivalence, producer, sourceManifestSha256: 'a'.repeat(64) });
assert.equal(built.support.identity, 'full-flame-ridge-nonridge-live-union-v0');
assert.equal(built.support.rowCount, rowCount);
assert.equal(built.support.nativeCellIndexSha256, indices.sha256);
assert.equal(built.descriptors.artifact.sha256, descriptors.sha256);
assert.equal(built.coefficients.artifact.sha256, coefficients.sha256);
assert.equal(built.support.sameStateCaptureId, source.sameStateCaptureId);
assert.equal(built.support.sourceManifestSha256, 'a'.repeat(64));
assert.equal(built.claimBoundary.learnerCampaign, false);
assert.equal(built.claimBoundary.depositionAdjudication, false);

assert.throws(
  () => buildGrid96Components({ source, equivalence: { ...equivalence, exactByteIdentity: false }, producer, sourceManifestSha256: 'a'.repeat(64) }),
  /exact byte identity/,
);
for (const forgedHashes of [
  undefined,
  {},
  { ...sourceHashes, majorantSha256: undefined },
  { ...sourceHashes, boundarySidecarSha256: 'not-a-sha256' },
]) {
  assert.throws(
    () => buildGrid96Components({
      source,
      equivalence: { ...equivalence, sourceHashes: forgedHashes },
      producer,
      sourceManifestSha256: 'a'.repeat(64),
    }),
    /four-payload source hash receipt/,
  );
}
assert.throws(
  () => buildGrid96Components({ source, equivalence, producer: { ...producer, sampleCap: 2 }, sourceManifestSha256: 'a'.repeat(64) }),
  /sample cap/,
);
assert.throws(
  () => buildGrid96Components({ source, equivalence, producer: { ...producer, droppedRowCount: 1 }, sourceManifestSha256: 'a'.repeat(64) }),
  /dropped rows/,
);
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence,
    producer: { ...producer, state: { ...producer.state, sourceHashes: { ...sourceHashes, fluidSha256: '9'.repeat(64) } } },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /fluid checksum/,
);
const duplicateIndices = artifact('duplicate-indices.u32', u32([7, 7, 31]), {
  dtype: 'uint32-le', shape: [rowCount], semanticRole: 'analytical-admission-native-cell-indices',
});
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence,
    producer: {
      ...producer,
      state: { ...producer.state, rows: { ...producer.state.rows, nativeCellIndices: duplicateIndices } },
    },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /duplicate native cell/,
);
const unboundCoefficients = { ...coefficients, nativeCellIndexSha256: '8'.repeat(64) };
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence,
    producer: { ...producer, state: { ...producer.state, rows: { ...producer.state.rows, coefficients: unboundCoefficients } } },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /coefficient native-cell support hash/,
);
assert.throws(
  () => buildGrid96Components({
    source: { ...source, claimBoundary: { ...source.claimBoundary, cheaperDemoClaim: true } },
    equivalence,
    producer,
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /cheaper-demo claim/,
);
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence: { ...equivalence, claimBoundary: { ...equivalence.claimBoundary, resizedGrid160Evidence: true } },
    producer,
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /resized Grid160 evidence/,
);
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence,
    producer: { ...producer, authoritativeSourceIdentity: 'sha256:another-source' },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /producer authoritative source identity/,
);
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence,
    producer: { ...producer, requestedControlIdentity: 'sha256:other-controls' },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /producer requested controls/,
);
assert.throws(
  () => buildGrid96Components({
    source: { ...source, identity: undefined },
    equivalence: { ...equivalence, authoritativeSourceIdentity: undefined },
    producer: { ...producer, authoritativeSourceIdentity: undefined },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /authoritative source receipt identity/,
);
assert.throws(
  () => buildGrid96Components({
    source,
    equivalence: { ...equivalence, identity: undefined },
    producer: { ...producer, sourceEquivalenceIdentity: undefined },
    sourceManifestSha256: 'a'.repeat(64),
  }),
  /source equivalence receipt identity/,
);

const writeJson = (name, value) => {
  const path = join(scratch, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const sourcePath = writeJson('source.json', source);
const equivalencePath = writeJson('equivalence.json', equivalence);
const producerPath = writeJson('producer.json', producer);
const outDir = join(scratch, 'components');
const reportPath = join(scratch, 'component-report.json');
const cli = spawnSync(process.execPath, [
  new URL('../volume-grid96-component-normalizer.mjs', import.meta.url).pathname,
  '--source-manifest', sourcePath,
  '--equivalence-manifest', equivalencePath,
  '--producer-manifest', producerPath,
  '--out-dir', outDir,
  '--report', reportPath,
], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).failurePhase, null);
assert.equal(JSON.parse(readFileSync(join(outDir, 'grid96-support-manifest.json'), 'utf8')).rowCount, rowCount);

const rejectedEquivalencePath = writeJson('equivalence-rejected.json', { ...equivalence, exactByteIdentity: false });
const rejectedReportPath = join(scratch, 'component-rejected-report.json');
const rejected = spawnSync(process.execPath, [
  new URL('../volume-grid96-component-normalizer.mjs', import.meta.url).pathname,
  '--source-manifest', sourcePath,
  '--equivalence-manifest', rejectedEquivalencePath,
  '--producer-manifest', producerPath,
  '--out-dir', outDir,
  '--report', rejectedReportPath,
], { encoding: 'utf8' });
assert.notEqual(rejected.status, 0);
const rejectedReport = JSON.parse(readFileSync(rejectedReportPath, 'utf8'));
assert.equal(rejectedReport.failurePhase, 'component-validation');
assert.match(rejectedReport.reason, /exact byte identity/);
for (const name of ['grid96-support-manifest.json', 'grid96-descriptor-manifest.json', 'grid96-coefficient-manifest.json']) {
  const failedComponent = JSON.parse(readFileSync(join(outDir, name), 'utf8'));
  assert.equal(failedComponent.status, 'failed');
  assert.equal(failedComponent.failurePhase, 'component-validation');
  assert.match(failedComponent.reason, /exact byte identity/);
}

console.log('grid96 component normalizer contracts passed');
