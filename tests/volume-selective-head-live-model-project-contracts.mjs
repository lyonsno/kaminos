#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const projectorPath = join(root, 'volume-selective-head-live-model-project.py');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-selective-head-project-'));
const sourceDir = join(fixtureRoot, 'source');
const sourceManifestPath = join(sourceDir, 'manifest.json');
const sourceModelPath = join(sourceDir, 'model.f32');
const outputDir = join(fixtureRoot, 'front-only');
const featureCount = 185;
const hiddenWidth = 48;
const normalizationFloatCount = featureCount * 2;
const headFloatCount = featureCount * hiddenWidth + hiddenWidth + hiddenWidth + 3;
const fullFloatCount = normalizationFloatCount + headFloatCount * 5;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha256 = path => sha256(readFileSync(path));
const floatBytes = values => Buffer.from(values.buffer, values.byteOffset, values.byteLength);

function writeSourceModel() {
  spawnSync('mkdir', ['-p', sourceDir]);
  const values = new Float32Array(fullFloatCount);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.fround(Math.sin(index * 0.017) * 0.05);
  }
  for (let index = 0; index < featureCount; index += 1) {
    values[index] = Math.fround((index - 92) * 0.001);
    values[featureCount + index] = Math.fround(0.75 + (index % 13) * 0.025);
  }
  writeFileSync(sourceModelPath, floatBytes(values));

  const outputs = [];
  const channels = ['supportProbability', 'fuel', 'fireLick', 'visibleFireCarrier', 'frontTopology'];
  let offset = normalizationFloatCount;
  for (const channel of channels) {
    const offsets = {
      w1: offset,
      b1: offset + featureCount * hiddenWidth,
      w2: offset + featureCount * hiddenWidth + hiddenWidth,
      b2: offset + featureCount * hiddenWidth + hiddenWidth * 2,
      targetMean: offset + featureCount * hiddenWidth + hiddenWidth * 2 + 1,
      targetStd: offset + featureCount * hiddenWidth + hiddenWidth * 2 + 2,
    };
    outputs.push({
      channel,
      kind: channel === 'supportProbability' ? 'classifier' : 'residual-head',
      offsets,
      policy: channel === 'supportProbability'
        ? 'probability-threshold-v0'
        : channel === 'frontTopology'
          ? 'dense-ungated-residual-v0'
          : 'sparse-hard-support-gated-residual-v0',
    });
    offset += headFloatCount;
  }

  const manifest = {
    schema: 'kaminos.volume.selective-head-live-model.v0',
    identity: 'contract-parent-selective-head-model-v0',
    status: 'captured',
    failurePhase: null,
    source: {
      lowGrid: 96,
      highGrid: 160,
      pairAuthority: 'downsampled-same-high-history-input-to-exact-high-target',
      trainingInputAuthority: 'phase-aligned-high-filtered-to-low-grid-v0',
      trainingInputSyntheticDownsample: true,
      nativeDeploymentInputSeenDuringTraining: false,
      trainingBasinIdentity: 'contract-happy-bowl-v0',
      trainingSourceCaptureSha256: 'a'.repeat(64),
    },
    features: {
      identity: 'full-low-field-plus-spatial-rbf-features-v0',
      featureCount,
      lowFieldCount: 17,
      squaredLowFieldCount: 17,
      positionCount: 5,
      fourierCount: 18,
      rbfCount: 128,
    },
    architecture: { identity: 'dense-tanh-dense-v0', activation: 'tanh', hiddenWidth },
    composition: {
      supportThreshold: 0.98,
      supportThresholdAuthority: 'operator-selected-motion-witness-v0',
      fuel: 'sparse-hard-support-gated-residual-v0',
      fireLick: 'sparse-hard-support-gated-residual-v0',
      visibleFireCarrier: 'sparse-hard-support-gated-residual-v0',
      frontTopology: 'dense-ungated-residual-v0',
    },
    outputs,
    normalization: {
      featureMean: { channel: 'featureMean', offset: 0, floatCount: featureCount, kind: 'normalization' },
      featureStd: { channel: 'featureStd', offset: featureCount, floatCount: featureCount, kind: 'normalization' },
    },
    packed: {
      path: 'model.f32',
      dtype: 'float32-le',
      floatCount: values.length,
      byteLength: values.byteLength,
      sha256: fileSha256(sourceModelPath),
    },
  };
  writeFileSync(sourceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, values };
}

function runProjector(outDir, channels, source = sourceManifestPath) {
  return spawnSync('python3', [
    projectorPath,
    '--source-manifest', source,
    '--out-dir', outDir,
    '--model-identity', 'contract-front-only-160-to-96-v0',
    '--channels', channels,
  ], { encoding: 'utf8' });
}

function evaluateHead(values, output, features) {
  const { w1, b1, w2, b2, targetMean, targetStd } = output.offsets;
  const hidden = new Float64Array(hiddenWidth);
  for (let unit = 0; unit < hiddenWidth; unit += 1) {
    let activation = values[b1 + unit];
    for (let feature = 0; feature < featureCount; feature += 1) {
      const normalized = (features[feature] - values[feature]) / Math.max(values[featureCount + feature], 1e-6);
      activation += normalized * values[w1 + feature * hiddenWidth + unit];
    }
    hidden[unit] = Math.tanh(activation);
  }
  let result = values[b2];
  for (let unit = 0; unit < hiddenWidth; unit += 1) result += hidden[unit] * values[w2 + unit];
  return result * values[targetStd] + values[targetMean];
}

const { manifest: sourceManifest, values: sourceValues } = writeSourceModel();
const projected = runProjector(outputDir, 'frontTopology');
assert.equal(projected.status, 0, projected.stderr || projected.stdout);

const outputManifestPath = join(outputDir, 'manifest.json');
const outputModelPath = join(outputDir, 'model.f32');
const outputManifest = JSON.parse(readFileSync(outputManifestPath, 'utf8'));
const outputModelBytes = readFileSync(outputModelPath);
const outputValues = new Float32Array(outputModelBytes.buffer.slice(
  outputModelBytes.byteOffset,
  outputModelBytes.byteOffset + outputModelBytes.byteLength,
));

assert.equal(outputManifest.schema, 'kaminos.volume.selective-head-live-model.v0');
assert.equal(outputManifest.identity, 'contract-front-only-160-to-96-v0');
assert.equal(outputManifest.status, 'captured');
assert.equal(outputManifest.failurePhase, null);
assert.deepEqual(outputManifest.outputs.map(output => output.channel), ['frontTopology']);
assert.deepEqual(outputManifest.packagedResidualChannels, ['frontTopology']);
assert.equal(outputManifest.packed.floatCount, normalizationFloatCount + headFloatCount);
assert.equal(outputManifest.packed.floatCount, 9349);
assert.equal(outputManifest.packed.byteLength, 37396);
assert.equal(outputManifest.packed.sha256, fileSha256(outputModelPath));
assert.equal(outputManifest.derivation.identity, 'bit-exact-selected-head-projection-v0');
assert.equal(outputManifest.derivation.sourceManifestSha256, fileSha256(sourceManifestPath));
assert.equal(outputManifest.derivation.sourcePackedSha256, sourceManifest.packed.sha256);
assert.deepEqual(outputManifest.derivation.selectedChannels, ['frontTopology']);
assert.equal(outputManifest.derivation.normalizationBitExact, true);
assert.equal(outputManifest.derivation.headTensorsBitExact, true);
assert.equal(outputManifest.derivation.supportClassifierPackaged, false);
assert.equal(outputManifest.derivation.runtimeTruthAvailable, false);
assert.equal(outputManifest.source.nativeDeploymentInputSeenDuringTraining, false);
assert.equal(outputManifest.features.featureCount, 185);
assert.equal(outputManifest.composition.frontTopology, 'dense-ungated-residual-v0');
assert.equal('supportThreshold' in outputManifest.composition, false);
assert.deepEqual(outputManifest.outputs[0].offsets, {
  w1: 370,
  b1: 9250,
  w2: 9298,
  b2: 9346,
  targetMean: 9347,
  targetStd: 9348,
});

const parentFront = sourceManifest.outputs.find(output => output.channel === 'frontTopology');
const projectedFront = outputManifest.outputs[0];
assert.deepEqual(
  floatBytes(outputValues.slice(0, normalizationFloatCount)),
  floatBytes(sourceValues.slice(0, normalizationFloatCount)),
  'normalization bytes must be copied exactly',
);
assert.deepEqual(
  floatBytes(outputValues.slice(normalizationFloatCount)),
  floatBytes(sourceValues.slice(parentFront.offsets.w1, parentFront.offsets.targetStd + 1)),
  'selected head bytes must be copied exactly',
);

for (let sample = 0; sample < 3; sample += 1) {
  const features = Float32Array.from({ length: featureCount }, (_, index) => Math.cos(index * 0.031 + sample) * 0.7);
  assert.equal(
    evaluateHead(outputValues, projectedFront, features),
    evaluateHead(sourceValues, parentFront, features),
    `projected head must be numerically identical for sample ${sample}`,
  );
}

const unsupportedDir = join(fixtureRoot, 'unsupported');
const unsupported = runProjector(unsupportedDir, 'truthSupport');
assert.notEqual(unsupported.status, 0, 'truth-bearing or unknown outputs must be rejected');
const unsupportedManifest = JSON.parse(readFileSync(join(unsupportedDir, 'manifest.json'), 'utf8'));
assert.equal(unsupportedManifest.status, 'failed');
assert.equal(unsupportedManifest.failurePhase, 'selection-validation');
assert.match(unsupportedManifest.reason, /unknown output channel/i);
assert.equal(existsSync(join(unsupportedDir, 'model.f32')), false);

const tamperedDir = join(fixtureRoot, 'tampered');
const tamperedBytes = readFileSync(sourceModelPath);
tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
writeFileSync(sourceModelPath, tamperedBytes);
const tampered = runProjector(tamperedDir, 'frontTopology');
assert.notEqual(tampered.status, 0, 'tampered parent bytes must fail before projection');
const tamperedManifest = JSON.parse(readFileSync(join(tamperedDir, 'manifest.json'), 'utf8'));
assert.equal(tamperedManifest.status, 'failed');
assert.equal(tamperedManifest.failurePhase, 'source-model-validation');
assert.match(tamperedManifest.reason, /sha-?256 mismatch/i);
assert.equal(tamperedManifest.lastTrustworthyEvidence.sourceManifestSha256, fileSha256(sourceManifestPath));
assert.equal(existsSync(join(tamperedDir, 'model.f32')), false);

console.log('selective-head packed-model projection contracts passed');
