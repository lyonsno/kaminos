import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGrid96OracleAdapter } from '../volume-grid96-oracle-adapter.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'grid96-oracle-adapter-contract-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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
const artifact = (name, shape, values = null) => {
  const path = join(scratch, `${name}.bin`);
  const count = shape.reduce((a, b) => a * b, 1);
  const typed = name.includes('indices')
    ? new Uint32Array(values || Array.from({ length: count }, (_, index) => index))
    : new Float32Array(values || Array.from({ length: count }, () => 1));
  const bytes = Buffer.from(typed.buffer);
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), dtype: name.includes('indices') ? 'uint32-le' : 'float32-le', shape };
};
const fixtures = () => ({
  source: { ...base, route: { ...route }, role: 'source', sidecars: { fluid: { sha256: '3'.repeat(64) }, front: { sha256: '4'.repeat(64) } } },
  support: {
    ...base, route: { ...route }, role: 'support', sampleCap: null, droppedRowCount: 0, overflowCount: 0,
    admissionIdentity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0',
    nativeCellIndices: artifact('indices', [3]), features: artifact('features', [3, 24]), admission: artifact('admission', [3, 2]),
  },
  descriptors: {
    ...base, route: { ...route }, role: 'descriptors', identity: 'flow-kernel-local-descriptor-socket-v0',
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
    ...base, route: { ...route }, role: 'coefficients', identity: 'exact-local-layer-emission-extinction-v0',
    coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    artifact: {
      ...artifact('coefficients', [3, 8]),
      coefficientPopulation: {
        rowCount: 3,
        ridgeAdmittedRows: 3,
        ridgePositiveRows: 3,
        ridgeAdmittedPositiveRows: 3,
        ridgeUnadmittedPositiveRows: 0,
        nonRidgeAdmittedRows: 3,
        nonRidgePositiveRows: 3,
        nonRidgeAdmittedPositiveRows: 3,
        nonRidgeUnadmittedPositiveRows: 0,
        unadmittedRows: 0,
        unionPositiveRows: 3,
        channelStats: Array.from({ length: 8 }, (_, channel) => ({
          channel,
          minimum: 1,
          maximum: 1,
          nonzeroCount: 3,
        })),
      },
    },
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

const forgedPositiveMetadata = fixtures();
forgedPositiveMetadata.coefficients.artifact = {
  ...forgedPositiveMetadata.coefficients.artifact,
  ...artifact('zero-coefficients', [3, 8], new Array(24).fill(0)),
};
assert.throws(
  () => buildGrid96OracleAdapter(forgedPositiveMetadata),
  /positive|optical mass|binary|coefficient/,
  'adapter must recompute coefficient population from the binary artifact',
);

const emptyAdmission = fixtures();
emptyAdmission.support.admission = artifact('empty-admission', [3, 2], new Array(6).fill(0));
emptyAdmission.coefficients.artifact.coefficientPopulation = {
  ...emptyAdmission.coefficients.artifact.coefficientPopulation,
  ridgeAdmittedRows: 0,
  ridgeAdmittedPositiveRows: 0,
  ridgeUnadmittedPositiveRows: 3,
  nonRidgeAdmittedRows: 0,
  nonRidgeAdmittedPositiveRows: 0,
  nonRidgeUnadmittedPositiveRows: 3,
  unadmittedRows: 3,
  channelStats: Array.from({ length: 8 }, (_, channel) => ({
    channel,
    minimum: null,
    maximum: null,
    nonzeroCount: 0,
  })),
};
assert.throws(
  () => buildGrid96OracleAdapter(emptyAdmission),
  /admission|membership|support/,
  'adapter must reject coefficient rows with no Ridge or Non-Ridge admission',
);

for (const [label, mutate, pattern] of [
  ['grid drift', value => { value.source.grid = 160; }, /grid96|grid/],
  ['state drift', value => { value.support.simStepCount = 96; }, /state|step/],
  ['support cap', value => { value.support.sampleCap = 10; }, /sampleCap|cap/],
  ['dropped rows', value => { value.support.droppedRowCount = 1; }, /dropped/],
  ['index drift', value => { value.coefficients.nativeCellIndexSha256 = '9'.repeat(64); }, /support|index/],
  ['row drift', value => { value.descriptors.rowCount = 2; }, /row/],
  ['fallback source route', value => { value.support.route.effective = 'fallback-raymarch-v0'; }, /route|fallback/],
  ['non-WebGPU source backend', value => { value.coefficients.route.backend = 'CPU'; }, /WebGPU|backend/],
  ['descriptor fallback', value => { value.descriptors.artifact.admissionIndexAuthority.runtimeReceipt.fallbackReason = 'fallback'; }, /fallback/],
  ['zero coefficient population', value => {
    value.coefficients.artifact.coefficientPopulation.ridgePositiveRows = 0;
    value.coefficients.artifact.coefficientPopulation.nonRidgePositiveRows = 0;
    value.coefficients.artifact.coefficientPopulation.unionPositiveRows = 0;
  }, /positive|optical mass|population/],
]) {
  const value = fixtures();
  mutate(value);
  assert.throws(() => buildGrid96OracleAdapter(value), pattern, label);
}

const reportPath = join(scratch, 'report.json');
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), '../volume-grid96-oracle-adapter.mjs');
const failed = spawnSync(process.execPath, [
  scriptPath,
  '--source-manifest', join(scratch, 'missing-source.json'),
  '--support-manifest', join(scratch, 'missing-support.json'),
  '--descriptor-manifest', join(scratch, 'missing-descriptors.json'),
  '--coefficient-manifest', join(scratch, 'missing-coefficients.json'),
  '--out', join(scratch, 'out.json'),
  '--report', reportPath,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0);
const failureReport = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'component-validation');
assert.equal(failureReport.lastTrustworthyEvidence.paths.source, join(scratch, 'missing-source.json'));
rmSync(scratch, { recursive: true, force: true });

console.log('volume-grid96-oracle-adapter contracts: ok');
