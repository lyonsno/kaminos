import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSam31InteractivePointerPhaseProgramCpuOracle } from '../src/index.js';

const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const tool = resolve('tools/sam31-interactive-pointer-meta-packet.py');
const outDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-interactive-pointer-'));
const dynamicOutDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-interactive-pointer-dynamic-'));
const ingressDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-interactive-pointer-ingress-'));

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function writeIngressTensor(role, shape) {
  const length = shape.reduce((product, value) => product * value, 1);
  const values = new Float32Array(length);
  for (let index = 0; index < values.length; index += 1) values[index] = Math.sin(index * 0.031) * 0.02;
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const file = `${role}.f32.bin`;
  writeFileSync(join(ingressDir, file), bytes);
  return { role, file, sha256: sha256(bytes), byteLength: bytes.byteLength, dtype: 'float32', shape };
}

function load(entry) {
  const bytes = readFileSync(join(outDir, entry.file));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function maxAbs(left, right) {
  assert.equal(left.length, right.length);
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  return maximum;
}

function createBinaryMaskFixture({ variant, height, width }) {
  const values = new Float32Array(16 * height * width);
  const regionHeight = Math.max(1, Math.floor(height / 2));
  const regionWidth = Math.max(1, Math.floor(width / 2));
  const rowPositions = Math.max(1, height - regionHeight + 1);
  const columnPositions = Math.max(1, width - regionWidth + 1);
  for (let objectIndex = 0; objectIndex < 7; objectIndex += 1) {
    const row = (objectIndex + variant) % rowPositions;
    const column = (objectIndex * 3 + variant * 2) % columnPositions;
    const objectOffset = objectIndex * height * width;
    for (let y = row; y < row + regionHeight; y += 1) {
      values.fill(1, objectOffset + y * width + column, objectOffset + y * width + column + regionWidth);
    }
  }
  return values;
}

try {
  const result = spawnSync(python, [tool, '--out-dir', outDir], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, `official interactive pointer packet failed:\n${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(readFileSync(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(readFileSync(join(outDir, 'reference-receipt.json'), 'utf8'));
assert.equal(receipt.ok, true);
assert.deepEqual(receipt.checkpointAudit, manifest.checkpointAudit, 'reference receipt must bind the complete pointer checkpoint audit');
  assert.equal(manifest.schema, 'kaminos.sam31-interactive-pointer-meta-packet.v0');
  assert.equal(manifest.boundary, 'binary-mask-to-interactive-prompt-decoder-to-final-object-pointer');
  assert.equal(manifest.reference.source.commit, '5dd401d1c5c1d5c3eedff06d41b77af824517619');
  assert.equal(manifest.reference.source.workingTreeClean, true);
  assert.equal(manifest.reference.model.sha256, 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6');
  assert.deepEqual(manifest.shape, {
    batch: 16, queryTokens: 8, sparsePromptTokens: 2, imageHeight: 2, imageWidth: 2,
    imageTokens: 4, channels: 256, heads: 8, attentionChannels: 128, mlpHidden: 2048,
    sourceImageHeight: 28, sourceImageWidth: 28,
    sourceMaskHeight: 32, sourceMaskWidth: 32,
    promptMaskHeight: 8, promptMaskWidth: 8,
    decoderMaskHeight: 8, decoderMaskWidth: 8,
    maskOutputs: 4, layerCount: 2,
  });
  assert.equal(manifest.checkpointAudit.mappedTensorCount, 158);
  assert.equal(manifest.checkpointAudit.allMappedOfficialKeysPresent, true);
  assert.equal(manifest.execution.officialUseMaskAsOutputExecuted, true);
  assert.equal(manifest.execution.officialForwardSamHeadsExecuted, true);
  assert.ok(manifest.outputSummary.appearingObjectCount > 0);
  assert.ok(manifest.outputSummary.absentObjectCount > 0);

  const tensors = Object.fromEntries(manifest.tensors.map(entry => [entry.role, load(entry)]));
  assert.deepEqual(manifest.tensors.find(entry => entry.role === 'binary-mask-inputs').shape, [16, 1, 32, 32]);
  assert.deepEqual(manifest.tensors.find(entry => entry.role === 'expected-mask-downsample').shape, [16, 1, 8, 8]);
  const weights = {};
  for (const entry of manifest.weights) weights[`${entry.group}.${entry.localKey}`] = load(entry);
  const oracle = createSam31InteractivePointerPhaseProgramCpuOracle({
    shape: manifest.shape,
    tensors: {
      binaryMasks: tensors['binary-mask-inputs'],
      imageEmbedding: tensors['image-embedding'],
      highResolutionS0: tensors['high-resolution-s0'],
      highResolutionS1: tensors['high-resolution-s1'],
    },
    weights,
  });
  assert.ok(maxAbs(oracle.maskDownsample, tensors['expected-mask-downsample']) < 0.00001);
  assert.ok(maxAbs(oracle.sparseEmbeddings, tensors['expected-sparse-embeddings']) < 0.00001);
  assert.ok(maxAbs(oracle.denseEmbeddings, tensors['expected-dense-embeddings']) < 0.0001);
  assert.ok(maxAbs(oracle.imagePosition, tensors['expected-image-position']) < 0.00001);
  assert.ok(maxAbs(oracle.layerQueries[0], tensors['expected-layer-0-queries']) < 0.0001);
  assert.ok(maxAbs(oracle.layerKeys[0], tensors['expected-layer-0-keys']) < 0.0001);
  assert.ok(maxAbs(oracle.layerQueries[1], tensors['expected-layer-1-queries']) < 0.0001);
  assert.ok(maxAbs(oracle.layerKeys[1], tensors['expected-layer-1-keys']) < 0.0001);
  assert.ok(maxAbs(oracle.samOutputTokens, tensors['expected-sam-output-tokens']) < 0.0001);
  assert.ok(maxAbs(oracle.decoderObjectScores, tensors['expected-decoder-object-scores']) < 0.0001);
  assert.ok(maxAbs(oracle.projectedPointers, tensors['expected-projected-pointers']) < 0.00015);
  assert.ok(maxAbs(oracle.forwardObjectPointers, tensors['expected-forward-object-pointers']) < 0.00015);
  const finalPointerMaxAbs = maxAbs(oracle.finalObjectPointers, tensors['expected-final-object-pointers']);
  assert.ok(finalPointerMaxAbs < 0.00015, `standalone final pointer max abs ${finalPointerMaxAbs}`);

  const ingressManifest = {
    schema: 'kaminos.sam31-two-image-ingress-meta-packet.v0',
    reference: {
      model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460' },
      source: { commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619', clean: true },
      checkpoint: { sha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6' },
    },
    shape: {
      batch: 1, imageHeight: 56, imageWidth: 56, patchSize: 14,
      patchHeight: 4, patchWidth: 4, patchTokens: 16,
      fpnHiddenSize: 256, decoderHighResolutionS0Channels: 32, decoderHighResolutionS1Channels: 64,
    },
    checkpointAudit: { allMappedOfficialKeysPresent: true, allOfficialModuleLoadsAccepted: true },
    tensors: [
      writeIngressTensor('frame-0-interactive-feature-2', [1, 4, 4, 256]),
      writeIngressTensor('frame-0-interactive-high-resolution-s0', [1, 32, 16, 16]),
      writeIngressTensor('frame-0-interactive-high-resolution-s1', [1, 64, 8, 8]),
    ],
  };
  const ingressManifestBytes = Buffer.from(JSON.stringify(ingressManifest, null, 2));
  const ingressManifestSha256 = sha256(ingressManifestBytes);
  writeFileSync(join(ingressDir, 'tensor-manifest.json'), ingressManifestBytes);
  writeFileSync(join(ingressDir, 'reference-receipt.json'), JSON.stringify({
    ok: true,
    schema: 'kaminos.sam31-two-image-ingress-meta-reference-receipt.v0',
    reference: ingressManifest.reference,
    shape: ingressManifest.shape,
    checkpointAudit: ingressManifest.checkpointAudit,
    primaryOutputWritten: true,
    outputs: { tensorManifestSha256: ingressManifestSha256 },
  }, null, 2));

  const dynamicResult = spawnSync(python, [
    tool,
    '--out-dir', dynamicOutDir,
    '--mask-variant', '1',
    '--ingress-dir', ingressDir,
    '--expected-ingress-manifest-sha256', ingressManifestSha256,
  ], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(dynamicResult.status, 0, `dynamic official interactive pointer packet failed:\n${dynamicResult.stdout}\n${dynamicResult.stderr}`);
  const dynamicManifest = JSON.parse(readFileSync(join(dynamicOutDir, 'tensor-manifest.json'), 'utf8'));
  assert.deepEqual(
    {
      imageHeight: dynamicManifest.shape.imageHeight,
      imageWidth: dynamicManifest.shape.imageWidth,
      imageTokens: dynamicManifest.shape.imageTokens,
      sourceImageHeight: dynamicManifest.shape.sourceImageHeight,
      sourceImageWidth: dynamicManifest.shape.sourceImageWidth,
      sourceMaskHeight: dynamicManifest.shape.sourceMaskHeight,
      sourceMaskWidth: dynamicManifest.shape.sourceMaskWidth,
      promptMaskHeight: dynamicManifest.shape.promptMaskHeight,
      promptMaskWidth: dynamicManifest.shape.promptMaskWidth,
      decoderMaskHeight: dynamicManifest.shape.decoderMaskHeight,
      decoderMaskWidth: dynamicManifest.shape.decoderMaskWidth,
    },
    {
      imageHeight: 4, imageWidth: 4, imageTokens: 16,
      sourceImageHeight: 56, sourceImageWidth: 56,
      sourceMaskHeight: 64, sourceMaskWidth: 64,
      promptMaskHeight: 16, promptMaskWidth: 16,
      decoderMaskHeight: 16, decoderMaskWidth: 16,
    },
  );
  assert.equal(dynamicManifest.fixture.sourceFeaturesSynthetic, false);
  assert.equal(dynamicManifest.fixture.maskVariant, 1, 'the authenticated pointer packet must bind the invocation mask variant');
  assert.equal(dynamicManifest.ingressAuthority.passed, true);
  assert.equal(dynamicManifest.ingressAuthority.manifestSha256, ingressManifestSha256);
  assert.deepEqual(
    Object.keys(dynamicManifest.ingressAuthority.bindings).sort(),
    ['frame0HighResolutionS0', 'frame0HighResolutionS1', 'frame0ImageEmbedding'],
  );
  const dynamicEntries = Object.fromEntries(dynamicManifest.tensors.map(entry => [entry.role, entry]));
  const dynamicTensors = Object.fromEntries(Object.entries(dynamicEntries).map(([role, entry]) => {
    const bytes = readFileSync(join(dynamicOutDir, entry.file));
    return [role, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))];
  }));
  const dynamicWeights = {};
  for (const entry of dynamicManifest.weights) {
    const bytes = readFileSync(join(dynamicOutDir, entry.file));
    dynamicWeights[`${entry.group}.${entry.localKey}`] = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  assert.deepEqual(
    dynamicTensors['binary-mask-inputs'],
    createBinaryMaskFixture({ variant: 1, height: 64, width: 64 }),
    'pointer source masks must be constructed directly at authenticated source geometry like the episode exporter',
  );
  const dynamicOracle = createSam31InteractivePointerPhaseProgramCpuOracle({
    shape: dynamicManifest.shape,
    tensors: {
      binaryMasks: dynamicTensors['binary-mask-inputs'],
      imageEmbedding: dynamicTensors['image-embedding'],
    },
    weights: dynamicWeights,
  });
  const dynamicFinalPointerMaxAbs = maxAbs(dynamicOracle.finalObjectPointers, dynamicTensors['expected-final-object-pointers']);
  assert.ok(dynamicFinalPointerMaxAbs < 0.00015, `dynamic final pointer max abs ${dynamicFinalPointerMaxAbs}`);

  const rejectedResult = spawnSync(python, [
    tool,
    '--out-dir', dynamicOutDir,
    '--ingress-dir', ingressDir,
    '--expected-ingress-manifest-sha256', `sha256:${'0'.repeat(64)}`,
  ], { encoding: 'utf8', timeout: 180_000 });
  assert.notEqual(rejectedResult.status, 0, 'wrong ingress authority must fail');
  assert.equal(existsSync(join(dynamicOutDir, 'tensor-manifest.json')), false, 'failed rerun must invalidate stale primary output');
  const failureReceipt = JSON.parse(readFileSync(join(dynamicOutDir, 'reference-receipt.json'), 'utf8'));
  assert.equal(failureReceipt.ok, false);
  assert.equal(failureReceipt.failurePhase, 'ingress-authority-validation');
  assert.equal(failureReceipt.requested.expectedIngressManifestSha256, `sha256:${'0'.repeat(64)}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(dynamicOutDir, { recursive: true, force: true });
  rmSync(ingressDir, { recursive: true, force: true });
}

console.log('sam3.1 official interactive pointer packet contracts passed');
