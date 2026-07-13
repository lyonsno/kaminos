import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSam31MultiplexMaskDecoderPhaseProgramCpuOracle } from '../src/index.js';

const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const tool = resolve('tools/sam31-multiplex-mask-decoder-meta-packet.py');
const outDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-multiplex-decoder-'));

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
  assert.equal(result.status, 0, `official multiplex decoder packet failed:\n${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(readFileSync(join(outDir, 'tensor-manifest.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(outDir, 'reference-receipt.json'), 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(manifest.reference.source.commit, '5dd401d1c5c1d5c3eedff06d41b77af824517619');
  assert.equal(manifest.reference.source.workingTreeClean, true);
  assert.equal(manifest.reference.model.sha256, 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6');
  assert.deepEqual(manifest.shape, {
    batch: 1, multiplexCount: 16, maskOutputsPerObject: 3, attributeTokens: 32,
    maskTokens: 48, queryTokens: 80, imageHeight: 2, imageWidth: 2, imageTokens: 4,
    channels: 256, heads: 8, attentionChannels: 128, mlpHidden: 2048,
    maskHeight: 8, maskWidth: 8, layerCount: 2,
  });
  assert.equal(manifest.checkpointAudit.mappedTensorCount, 133);
  assert.equal(manifest.checkpointAudit.allMappedOfficialKeysPresent, true);
  assert.ok(manifest.outputSummary.appearingObjectCount > 0, 'official fixture must exercise the projected object-pointer branch');
  assert.ok(manifest.outputSummary.absentObjectCount > 0, 'official fixture must exercise the no-object pointer branch');
  const tensors = Object.fromEntries(manifest.tensors.map(entry => [entry.role, load(entry)]));
  const weights = {};
  for (const entry of manifest.weights) {
    const key = entry.group === 'decoder' ? entry.localKey : `${entry.group}.${entry.localKey}`;
    weights[key] = load(entry);
  }
  const oracle = createSam31MultiplexMaskDecoderPhaseProgramCpuOracle({
    shape: manifest.shape,
    tensors: {
      imageEmbedding: tensors['image-embedding'],
      imagePosition: tensors['image-position'],
      highResolutionS0: tensors['high-resolution-s0'],
      highResolutionS1: tensors['high-resolution-s1'],
      extraPerObjectEmbedding: tensors['extra-per-object-embedding'],
    },
    weights,
  });
  assert.ok(maxAbs(oracle.layerQueries[0], tensors['layer-0-queries']) < 0.0001);
  assert.ok(maxAbs(oracle.layerKeys[0], tensors['layer-0-keys']) < 0.0001);
  assert.ok(maxAbs(oracle.layerQueries[1], tensors['layer-1-queries']) < 0.0001);
  assert.ok(maxAbs(oracle.layerKeys[1], tensors['layer-1-keys']) < 0.0001);
  assert.ok(maxAbs(oracle.samTokens, tensors['expected-sam-tokens']) < 0.0001);
  assert.ok(maxAbs(oracle.masks, tensors['expected-masks']) < 0.00015);
  assert.ok(maxAbs(oracle.iou, tensors['expected-iou']) < 0.0001);
  assert.ok(maxAbs(oracle.objectScores, tensors['expected-object-scores']) < 0.0001);
  assert.ok(maxAbs(oracle.bestMaskIndices, tensors['expected-best-mask-indices']) === 0);
  assert.ok(maxAbs(oracle.selectedMasks, tensors['expected-selected-masks']) < 0.00015);
  assert.ok(maxAbs(oracle.objectPointers, tensors['expected-object-pointers']) < 0.00015);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('sam3.1 official multiplex mask decoder packet contracts passed');
