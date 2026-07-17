#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const exporter = join(root, 'volume-selective-head-live-model-export.py');
const composer = join(root, 'volume-native-low-selective-compose.py');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-native-front-only-'));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

const classifierPath = join(fixture, 'support-classifier.npz');
const headsPath = join(fixture, 'gated-channel-heads.npz');
const archive = spawnSync('python3', ['-c', String.raw`
import numpy as np
import sys

classifier_path, heads_path = sys.argv[1:3]
feature_count, hidden = 185, 48
base = {
    "w1": np.zeros((feature_count, hidden), dtype=np.float32),
    "b1": np.zeros((1, hidden), dtype=np.float32),
    "w2": np.zeros((hidden, 1), dtype=np.float32),
    "b2": np.zeros((1, 1), dtype=np.float32),
    "targetMean": np.zeros((1,), dtype=np.float32),
    "targetStd": np.ones((1,), dtype=np.float32),
}
np.savez(
    classifier_path,
    **base,
    featureMean=np.zeros((feature_count,), dtype=np.float32),
    featureStd=np.ones((feature_count,), dtype=np.float32),
    threshold=np.asarray([0.5], dtype=np.float32),
)
heads = {}
for name, values in base.items():
    heads[f"frontTopology.{name}"] = values.copy()
heads["frontTopology.targetMean"] = np.asarray([0.1], dtype=np.float32)
np.savez(heads_path, **heads)
`, classifierPath, headsPath], { encoding: 'utf8' });
assert.equal(archive.status, 0, archive.stderr || archive.stdout);

const probePath = join(fixture, 'probe.json');
writeFileSync(probePath, `${JSON.stringify({
  schema: 'kaminos.volume.exact-basin-support-probe.v0',
  identity: 'exact-basin-accepted-splat-support-head-v0',
  status: 'captured',
  failurePhase: null,
  inputs: {
    lowGrid: 2,
    highGrid: 4,
    pairAuthority: 'downsampled-same-high-history-input-to-exact-high-target',
    trainingInputAuthority: 'phase-aligned-high-filtered-to-low-grid-v0',
    trainingInputSyntheticDownsample: true,
    nativeDeploymentInputSeenDuringTraining: false,
  },
  features: { featureCount: 185 },
  classifier: { artifact: { path: classifierPath, sha256: sha256(classifierPath) } },
  channelHeadArtifact: { path: headsPath, sha256: sha256(headsPath) },
}, null, 2)}\n`);

const modelDir = join(fixture, 'model');
const exported = spawnSync('python3', [
  exporter,
  '--probe-manifest', probePath,
  '--out-dir', modelDir,
  '--expected-low-grid', '2',
  '--expected-high-grid', '4',
  '--channels', 'frontTopology',
], { encoding: 'utf8' });
assert.equal(exported.status, 0, exported.stderr || exported.stdout);

const fluidPath = join(fixture, 'native.fluid.f32');
const frontPath = join(fixture, 'native.front.f32');
const fluid = new Float32Array(2 * 2 * 2 * 16);
for (let cell = 0; cell < 8; cell += 1) {
  for (let channel = 0; channel < 16; channel += 1) fluid[cell * 16 + channel] = (channel + 1) / 100;
}
const front = new Float32Array(8).fill(0.2);
writeFileSync(fluidPath, Buffer.from(fluid.buffer));
writeFileSync(frontPath, Buffer.from(front.buffer));
const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];
const descriptor = (path, shape, channelOrder) => ({
  path,
  shape,
  channelOrder,
  dtype: 'float32-le',
  byteOrder: 'little-endian',
  elementCount: shape.reduce((product, value) => product * value, 1),
  byteLength: readFileSync(path).byteLength,
  sha256: sha256(path),
});
const nativePath = join(fixture, 'native.json');
writeFileSync(nativePath, `${JSON.stringify({
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  completeFieldCoverage: true,
  grid: 2,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:test',
  deterministicReplay: {
    grid: 2,
    simStepCount: 7,
    authority: 'same-route-controls-fixed-step-replay',
    controlsSignature: 'fixture-controls',
  },
  sidecars: {
    fluid: descriptor(fluidPath, [2, 2, 2, 16], channels),
    front: descriptor(frontPath, [2, 2, 2, 1], ['frontTopology']),
  },
}, null, 2)}\n`);

const outDir = join(fixture, 'out');
const composed = spawnSync('python3', [
  composer,
  '--native-manifest', nativePath,
  '--model-manifest', join(modelDir, 'manifest.json'),
  '--out-dir', outDir,
  '--channels', 'frontTopology',
  '--residual-scale', '0.5',
  '--materialization-mode', 'normalized-trilinear-low-to-output-grid-v0',
], { encoding: 'utf8' });
assert.equal(composed.status, 0, composed.stderr || composed.stdout);

const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.status, 'captured');
assert.equal(report.runtimeTruthAvailable, false);
assert.equal(report.relationship.syntheticDownsampleApplied, false);
assert.equal(report.relationship.samplingIdentity, 'normalized-trilinear-low-to-output-grid-v0');
assert.deepEqual(report.deployment.channels, ['frontTopology']);
assert.equal(report.deployment.residualScale, 0.5);
assert.equal(report.channelPolicies.frontTopology, 'dense-ungated-residual-v0');
assert.equal(report.channelPolicies.fuel, 'deterministic-materialization-only-v0');

const asFloat32 = path => {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};
const outputFluid = asFloat32(report.receiver.fluid.path);
const outputFront = asFloat32(report.receiver.front.path);
for (let cell = 0; cell < 4 ** 3; cell += 1) {
  for (let channel = 0; channel < 16; channel += 1) {
    assert.ok(Math.abs(outputFluid[cell * 16 + channel] - (channel + 1) / 100) < 1e-6);
  }
  assert.ok(Math.abs(outputFront[cell] - 0.25) < 1e-6);
}

const failedDir = join(fixture, 'failed');
const failed = spawnSync('python3', [
  composer,
  '--native-manifest', nativePath,
  '--model-manifest', join(modelDir, 'manifest.json'),
  '--out-dir', failedDir,
  '--channels', 'frontTopology,truthHigh',
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'unknown/truth-bearing channel request must fail');
const failedReport = JSON.parse(readFileSync(join(failedDir, 'manifest.json'), 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'input-validation');

console.log('native-low front-only composition contracts passed');
