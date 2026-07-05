import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  createSam3MaskProjectionCpuOracle,
} from '../src/index.js';

async function typedArrayFromFile(path, Type) {
  const buffer = await readFile(path);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Type(arrayBuffer);
}

const outDir = await mkdtemp(join(tmpdir(), 'sam-mask-island-oracle-'));

const run = spawnSync(process.execPath, [
  'tools/sam-mask-island-oracle-packet.mjs',
  '--out-dir', outDir,
  '--batch', '1',
  '--mask-tokens', '1',
  '--channels', '2',
  '--height', '2',
  '--width', '2',
  '--source-image-artifact-id', 'image:evil-orb',
  '--source-image-sha256', 'sha256:source-image',
  '--prompt', 'orb',
  '--model', 'mlx-community/sam3-image',
], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
});

assert.equal(run.status, 0, run.stderr || run.stdout);

const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'oracle-receipt.json'), 'utf8'));

assert.equal(manifest.schema, 'kaminos.sam3-mask-island-oracle-packet.v0');
assert.equal(manifest.routeId, SAM3_MASK_DECODER_ISLAND_ROUTE_ID);
assert.equal(manifest.mode, 'synthetic');
assert.equal(manifest.model.id, 'mlx-community/sam3-image');
assert.equal(manifest.boundary, 'sam3-mask-projection-threshold');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.equal(manifest.claims.upstream, 'synthetic-oracle');
assert.deepEqual(manifest.shape, {
  batch: 1,
  maskTokens: 1,
  channels: 2,
  height: 2,
  width: 2,
});
assert.deepEqual(
  manifest.tensors.map(tensor => tensor.role),
  ['hyper-input', 'upscaled-embedding', 'expected-mask-logits', 'expected-binary-mask'],
);

for (const tensor of manifest.tensors) {
  assert.match(tensor.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await stat(join(outDir, tensor.file))).isFile(), true);
}

const hyperInput = await typedArrayFromFile(join(outDir, 'hyper-input.f32.bin'), Float32Array);
const upscaledEmbedding = await typedArrayFromFile(join(outDir, 'upscaled-embedding.f32.bin'), Float32Array);
const expectedLogits = await typedArrayFromFile(join(outDir, 'expected-mask-logits.f32.bin'), Float32Array);
const expectedBinary = await typedArrayFromFile(join(outDir, 'expected-binary-mask.u32.bin'), Uint32Array);

const oracle = createSam3MaskProjectionCpuOracle({
  hyperInput,
  upscaledEmbedding,
  shape: manifest.shape,
});
assert.deepEqual(Array.from(expectedLogits), Array.from(oracle.maskLogits));
assert.deepEqual(Array.from(expectedBinary), Array.from(oracle.binaryMask));

assert.equal(receipt.ok, true);
assert.equal(receipt.routeId, SAM3_MASK_DECODER_ISLAND_ROUTE_ID);
assert.equal(receipt.sourceImage.artifactId, 'image:evil-orb');
assert.equal(receipt.sourceImage.sha256, 'sha256:source-image');
assert.equal(receipt.prompt.text, 'orb');
assert.match(receipt.prompt.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(receipt.outputs.tensorManifest, join(outDir, 'tensor-manifest.json'));
assert.equal(receipt.outputs.expectedMaskLogits, join(outDir, 'expected-mask-logits.f32.bin'));
assert.equal(receipt.outputs.expectedBinaryMask, join(outDir, 'expected-binary-mask.u32.bin'));

console.log('sam mask island oracle packet contracts passed');
