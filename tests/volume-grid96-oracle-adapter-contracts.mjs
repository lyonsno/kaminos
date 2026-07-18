import assert from 'node:assert/strict';

import { buildGrid96OracleAdapter } from '../volume-grid96-oracle-adapter.mjs';

const route = {
  requested: 'http://127.0.0.1:19096/?volume_resolution=96',
  effective: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  fallbackReason: null,
};
const base = {
  status: 'complete', failurePhase: null, grid: 96,
  sameStateCaptureId: 'exact-full-flame-grid96-state120-v0', simStepCount: 120,
  requestedControlIdentity: 'sha256:controls', effectiveControlIdentity: 'sha256:controls', route,
  sourceManifestSha256: '1'.repeat(64), nativeCellIndexSha256: '2'.repeat(64), rowCount: 3,
};
const artifact = (name, shape) => ({
  path: `/tmp/${name}`, bytes: shape.reduce((a, b) => a * b, 1) * 4,
  sha256: name[0].repeat(64), dtype: name.includes('indices') ? 'uint32-le' : 'float32-le', shape,
});
const fixtures = () => ({
  source: { ...base, role: 'source', sidecars: { fluid: { sha256: '3'.repeat(64) }, front: { sha256: '4'.repeat(64) } } },
  support: {
    ...base, role: 'support', sampleCap: null, droppedRowCount: 0, overflowCount: 0,
    admissionIdentity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0',
    nativeCellIndices: artifact('indices', [3]), features: artifact('features', [3, 24]), admission: artifact('admission', [3, 2]),
  },
  descriptors: {
    ...base, role: 'descriptors', identity: 'flow-kernel-local-descriptor-socket-v0',
    kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
    artifact: {
      ...artifact('descriptors', [3, 100]), socketIdentity: 'flow-kernel-local-descriptor-socket-v0',
      kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
      candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
      admissionIndexAuthority: {
        identity: 'external-native-cell-index-list-v0', indexSha256: '2'.repeat(64), count: 3,
        duplicatePolicy: 'forbidden', orderIdentity: 'caller-ordered',
        runtimeReceipt: { status: 'applied', fallbackReason: null, grid: 96 },
      },
      sourceHashes: { fluidSha256: '3'.repeat(64), frontSha256: '4'.repeat(64) },
      sourceManifestSha256: '5'.repeat(64),
    },
  },
  coefficients: {
    ...base, role: 'coefficients', identity: 'exact-local-layer-emission-extinction-v0',
    coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    artifact: artifact('coefficients', [3, 8]),
  },
});

const valid = fixtures();
const manifest = buildGrid96OracleAdapter(valid);
assert.equal(manifest.schema, 'kaminos.volume.layer-coefficient-training-manifest.v0');
assert.equal(manifest.states.length, 1);
assert.equal(manifest.states[0].replay.grid, 96);
assert.equal(manifest.states[0].rows.count, 3);
assert.equal(manifest.cohort.sampleCap, null);
assert.equal(manifest.cohort.droppedRowCount, 0);
assert.equal(manifest.learnerCampaign, false);

for (const [label, mutate, pattern] of [
  ['grid drift', value => { value.source.grid = 160; }, /grid96|grid/],
  ['state drift', value => { value.support.simStepCount = 96; }, /state|step/],
  ['support cap', value => { value.support.sampleCap = 10; }, /sampleCap|cap/],
  ['dropped rows', value => { value.support.droppedRowCount = 1; }, /dropped/],
  ['index drift', value => { value.coefficients.nativeCellIndexSha256 = '9'.repeat(64); }, /support|index/],
  ['row drift', value => { value.descriptors.rowCount = 2; }, /row/],
  ['descriptor fallback', value => { value.descriptors.artifact.admissionIndexAuthority.runtimeReceipt.fallbackReason = 'fallback'; }, /fallback/],
]) {
  const value = fixtures();
  mutate(value);
  assert.throws(() => buildGrid96OracleAdapter(value), pattern, label);
}

console.log('volume-grid96-oracle-adapter contracts: ok');
