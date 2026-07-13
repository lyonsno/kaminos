import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const root = new URL('..', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exporter = new URL('../tools/sam-mask-island-mlx-boundary-packet.py', import.meta.url);
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const fixtureImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const outDir = await mkdtemp(join(tmpdir(), 'sam-mask-mlx-boundary-'));

assert.ok(packageJson.files.includes('tools'), 'package must publish real-boundary packet exporter');
assert.ok(
  packageJson.scripts['test:live:sam-mlx-boundary']?.includes('sam-mask-island-mlx-boundary-packet-contracts.mjs'),
  'package must expose real MLX boundary contracts through an explicit live test script',
);
assert.doesNotMatch(
  packageJson.scripts.test,
  /sam-mask-island-mlx-boundary-packet-contracts\.mjs/,
  'default npm test must not require private MLX checkout, SAM fixture, or cached model weights',
);
assert.equal(existsSync(exporter), true, 'real MLX boundary packet exporter must exist');

const run = spawnSync('uv', [
  'run',
  '--project', mlxVlmRoot,
  'python',
  exporter.pathname,
  '--out-dir', outDir,
  '--image', fixtureImage,
  '--prompt', 'truck',
  '--model', 'mlx-community/sam3-bf16',
  '--resolution', '224',
], {
  cwd: mlxVlmRoot,
  encoding: 'utf8',
  timeout: 120000,
});

assert.equal(run.status, 0, run.stderr || run.stdout);

const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));

assert.equal(manifest.schema, 'kaminos.sam3-mask-island-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_MASK_DECODER_ISLAND_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-mask-projection-threshold');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.equal(manifest.claims.upstream, 'mlx-vlm-sam3-detector-reference');
assert.deepEqual(manifest.claims.browserExecutedStages, ['decode-mask', 'threshold-mask']);
assert.equal(manifest.reference.model.id, 'mlx-community/sam3-bf16');
assert.match(manifest.reference.model.snapshot, /^[0-9a-f]{40}$/);
assert.match(manifest.reference.weights.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(manifest.reference.framework.name, 'mlx-vlm');
assert.match(manifest.reference.framework.root, /mlx-vlm$/);
assert.equal(manifest.prompt.text, 'truck');
assert.match(manifest.prompt.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(manifest.sourceImage.file, 'source-image.png');
assert.match(manifest.sourceImage.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal((await stat(join(outDir, manifest.sourceImage.file))).isFile(), true);
assert.equal(manifest.visualization.selectedMaskIndex >= 0, true);
assert.equal(manifest.visualization.selectedMaskIndex < manifest.shape.maskTokens, true);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.maskTokens > 1, true);
assert.equal(manifest.shape.height, 64);
assert.equal(manifest.shape.width, 64);

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
assert.equal(hyperInput.length, manifest.shape.batch * manifest.shape.maskTokens * manifest.shape.channels);
assert.equal(upscaledEmbedding.length, manifest.shape.batch * manifest.shape.channels * manifest.shape.height * manifest.shape.width);
assert.equal(expectedLogits.length, manifest.shape.batch * manifest.shape.maskTokens * manifest.shape.height * manifest.shape.width);
assert.equal(expectedBinary.length, expectedLogits.length);

const oracle = createSam3MaskProjectionCpuOracle({
  hyperInput,
  upscaledEmbedding,
  shape: manifest.shape,
});
let maxDiff = 0;
for (let index = 0; index < expectedLogits.length; index += 1) {
  maxDiff = Math.max(maxDiff, Math.abs(Number(expectedLogits[index]) - Number(oracle.maskLogits[index])));
}
assert.equal(maxDiff <= manifest.tolerances.cpuOracleLogitsMaxAbsDiff, true, `CPU oracle logits diff ${maxDiff}`);
assert.deepEqual(Array.from(expectedBinary), Array.from(oracle.binaryMask));

assert.equal(receipt.ok, true);
assert.equal(receipt.mode, manifest.mode);
assert.equal(receipt.boundary, manifest.boundary);
assert.deepEqual(receipt.reference, manifest.reference);
assert.deepEqual(receipt.shape, manifest.shape);
assert.equal(receipt.outputs.tensorManifest, join(outDir, 'tensor-manifest.json'));
assert.equal(receipt.outputs.sourceImage, join(outDir, 'source-image.png'));

console.log('sam mask island mlx boundary packet contracts passed');
