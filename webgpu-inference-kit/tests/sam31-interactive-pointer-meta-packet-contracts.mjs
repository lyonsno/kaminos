import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSam31InteractivePointerPhaseProgramCpuOracle } from '../src/index.js';

const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const tool = resolve('tools/sam31-interactive-pointer-meta-packet.py');
const outDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-interactive-pointer-'));

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
    inputMaskHeight: 8, inputMaskWidth: 8, decoderMaskHeight: 8, decoderMaskWidth: 8,
    maskOutputs: 4, layerCount: 2,
  });
  assert.equal(manifest.checkpointAudit.mappedTensorCount, 158);
  assert.equal(manifest.checkpointAudit.allMappedOfficialKeysPresent, true);
  assert.equal(manifest.execution.officialUseMaskAsOutputExecuted, true);
  assert.equal(manifest.execution.officialForwardSamHeadsExecuted, true);
  assert.ok(manifest.outputSummary.appearingObjectCount > 0);
  assert.ok(manifest.outputSummary.absentObjectCount > 0);

  const tensors = Object.fromEntries(manifest.tensors.map(entry => [entry.role, load(entry)]));
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
  assert.ok(maxAbs(oracle.finalObjectPointers, tensors['expected-final-object-pointers']) < 0.00015);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('sam3.1 official interactive pointer packet contracts passed');
