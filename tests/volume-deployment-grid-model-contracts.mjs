#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const exporterPath = join(root, 'volume-selective-head-live-model-export.py');
const composePath = join(root, 'volume-native-low-selective-compose.py');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-deployment-grid-model-'));
const probePath = join(fixtureRoot, 'probe.json');
const classifierPath = join(fixtureRoot, 'support-classifier.npz');
const headsPath = join(fixtureRoot, 'gated-channel-heads.npz');
const outDir = join(fixtureRoot, 'model');

const archive = spawnSync('python3', ['-c', String.raw`
import numpy as np
import sys

classifier_path, heads_path = sys.argv[1:3]
feature_count = 185
hidden = 48
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
    threshold=np.asarray([0.91], dtype=np.float32),
)
heads = {}
for channel in ("fuel", "fireLick", "visibleFireCarrier", "frontTopology"):
    for name, values in base.items():
        heads[f"{channel}.{name}"] = values
np.savez(heads_path, **heads)
`, classifierPath, headsPath], { encoding: 'utf8' });
assert.equal(archive.status, 0, archive.stderr || archive.stdout);

const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(probePath, `${JSON.stringify({
  schema: 'kaminos.volume.exact-basin-support-probe.v0',
  identity: 'exact-basin-accepted-splat-support-head-v0',
  status: 'captured',
  failurePhase: null,
  authority: 'fit-on-one-phase-aligned-exact-basin-diagnostic-not-native-low-transfer',
  inputs: {
    lowGrid: 96,
    highGrid: 160,
    pairAuthority: 'downsampled-same-high-history-input-to-exact-high-target',
    trainingInputAuthority: 'phase-aligned-high-filtered-to-low-grid-v0',
    trainingInputSyntheticDownsample: true,
    nativeDeploymentInputSeenDuringTraining: false,
  },
  features: {
    identity: 'full-low-field-plus-spatial-rbf-features-v0',
    featureCount: 185,
  },
  classifier: {
    artifact: {
      path: classifierPath,
      sha256: sha256File(classifierPath),
    },
  },
  channelHeadArtifact: {
    path: headsPath,
    sha256: sha256File(headsPath),
  },
}, null, 2)}\n`);

const exported = spawnSync('python3', [
  exporterPath,
  '--probe-manifest', probePath,
  '--out-dir', outDir,
  '--expected-low-grid', '96',
  '--expected-high-grid', '160',
  '--model-identity', 'latest-happy-bowl-selective-carrier-heads-160-to-96-step96-v0',
  '--training-basin-identity', 'latest-happy-bowl-vsp-48617494-step96-v0',
  '--training-source-capture-sha256', '3f1c08a38c61e8affa39ed69cc85bf59e15bd4c3a5b773d4d91a64d7d7cfe035',
], { encoding: 'utf8' });
assert.equal(exported.status, 0, exported.stderr || exported.stdout);

const model = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(model.identity, 'latest-happy-bowl-selective-carrier-heads-160-to-96-step96-v0');
assert.equal(model.source.trainingBasinIdentity, 'latest-happy-bowl-vsp-48617494-step96-v0');
assert.equal(model.source.trainingSourceCaptureSha256, '3f1c08a38c61e8affa39ed69cc85bf59e15bd4c3a5b773d4d91a64d7d7cfe035');
assert.equal(model.source.lowGrid, 96);
assert.equal(model.source.highGrid, 160);
assert.equal(model.source.pairAuthority, 'downsampled-same-high-history-input-to-exact-high-target');
assert.equal(model.source.trainingInputAuthority, 'phase-aligned-high-filtered-to-low-grid-v0');
assert.equal(model.source.trainingInputSyntheticDownsample, true);
assert.equal(model.source.nativeDeploymentInputSeenDuringTraining, false);
assert.equal(model.features.lowFieldCount, 17);
assert.equal(model.features.squaredLowFieldCount, 17);
assert.deepEqual(model.outputs.map(output => output.channel), [
  'supportProbability',
  'fuel',
  'fireLick',
  'visibleFireCarrier',
  'frontTopology',
]);

const compose = readFileSync(composePath, 'utf8');
assert.doesNotMatch(
  compose,
  /trained_low_grid != 128 or high_grid != 160/,
  'native application must validate the model-declared grid relationship rather than one historical pair',
);
assert.doesNotMatch(
  compose,
  /MODEL_IDENTITY = "exact-basin-selective-carrier-heads-160-to-128-v0"/,
  'native application must not hardcode the historical model identity',
);
assert.match(
  compose,
  /trainingInputSyntheticDownsample/,
  'application receipt preserves that training used a synthetic phase-aligned downsample',
);
assert.match(
  compose,
  /nativeDeploymentInputSeenDuringTraining/,
  'application receipt preserves that genuine native deployment state was unseen during training',
);
assert.match(
  compose,
  /runtimeTruthAvailable["']?\s*:\s*False/,
  'application still denies runtime truth',
);

console.log('deployment-grid model contracts passed');
