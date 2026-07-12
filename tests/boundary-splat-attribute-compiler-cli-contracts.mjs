import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cliUrl = new URL('../compile-boundary-splat-attribute-model.mjs', import.meta.url);
const source = await readFile(cliUrl, 'utf8').catch(() => '');
assert.match(source, /compileBoundarySplatAttributeModel/, 'compiler CLI must consume the validated compiler module');

const root = await mkdtemp(join(tmpdir(), 'kaminos-splat-attribute-compile-'));
try {
  const inputPath = join(root, 'model.json');
  const outputDir = join(root, 'compiled');
  const features = [
    'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
    'material.density', 'material.heat', 'material.fuel', 'material.detail',
    'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
    'micro.x', 'micro.y', 'micro.z', 'micro.w',
  ];
  const outputs = ['color.r', 'color.g', 'color.b', 'opacity', 'radius.x', 'radius.y'];
  await writeFile(inputPath, JSON.stringify({
    schema: 'kaminos-boundary-splat-attribute-mlp-v0',
    architecture: 'dense-relu-dense',
    features,
    outputs,
    hiddenSize: 1,
    outputRanges: [[0, 1], [0, 1], [0, 1], [0.001, 0.08], [0.2, 6], [0.2, 6]],
    layers: [
      { inputSize: 16, outputSize: 1, activation: 'relu', weights: Array(16).fill(0), bias: [0] },
      { inputSize: 1, outputSize: 6, activation: 'linear', weights: Array(6).fill(0), bias: Array(6).fill(0) },
    ],
  }));
  const result = spawnSync(process.execPath, [cliUrl.pathname, '--input', inputPath, '--out-dir', outputDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, `compiler CLI passes: ${result.stderr || result.stdout}`);
  const receipt = JSON.parse(await readFile(join(outputDir, 'compiled-model.json'), 'utf8'));
  assert.equal(receipt.schema, 'kaminos-boundary-splat-attribute-compiled-v0');
  assert.match(receipt.identity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.inputPath, inputPath);
  assert.equal(receipt.inputSize, 16);
  assert.equal(receipt.hiddenSize, 1);
  assert.equal(receipt.outputSize, 6);
  assert.equal(receipt.wgsl.path, join(outputDir, 'boundary-splat-attribute-model.wgsl'));
  assert.equal(receipt.weights.path, join(outputDir, 'boundary-splat-attribute-weights.f32'));
  assert.ok((await stat(receipt.wgsl.path)).size > 0);
  assert.equal((await stat(receipt.weights.path)).size, receipt.weights.floatCount * 4);
  assert.match(await readFile(receipt.wgsl.path, 'utf8'), /inferBoundarySplatAttributes/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat attribute compiler CLI contracts passed');
