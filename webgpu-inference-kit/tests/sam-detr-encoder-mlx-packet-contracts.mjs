import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID } from '../src/index.js';

const outDir = mkdtempSync(join(tmpdir(), 'sam-detr-encoder-mlx-packet-'));
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const sourceImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const proc = spawnSync('uv', [
  'run',
  '--project', mlxVlmRoot,
  'python',
  'tools/sam-detr-encoder-mlx-packet.py',
  '--out-dir', outDir,
  '--image', sourceImage,
  '--prompt', 'truck',
  '--model', 'mlx-community/sam3-image',
  '--resolution', '224',
], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  timeout: 120000,
});

assert.equal(proc.status, 0, proc.stderr || proc.stdout);
const manifest = JSON.parse(readFileSync(join(outDir, 'tensor-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.sam3-detr-encoder-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-detr-encoder-phase-program');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.deepEqual(manifest.claims.browserExecutedStages, ['detr-encoder', 'prompt-cross-attention-fpn', 'pixel-decoder', 'mask-embedder', 'instance-projection', 'decode-mask', 'threshold-mask']);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.heads, 8);
assert.equal(manifest.shape.layerCount, 6);
assert.equal(manifest.shape.mlpHidden, 2048);
assert.equal(manifest.shape.spatialTokens, 256);
assert.ok(manifest.shape.promptTokens > 0);
assert.deepEqual(manifest.shape.levels.map(level => [level.height, level.width]), [[64, 64], [32, 32], [16, 16]]);
assert.equal(manifest.tensors.find(entry => entry.role === 'encoder-src')?.shape.join(','), '1,256,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'encoder-pos')?.shape.join(','), '1,256,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-features')?.shape[2], 256);
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-mask')?.dtype, 'float32');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-encoder-hidden-states')?.shape.join(','), '1,256,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'backbone-fpn-feature-0')?.shape.join(','), '1,64,64,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'backbone-fpn-feature-1')?.shape.join(','), '1,32,32,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-prompt-fpn-feature')?.shape.join(','), '1,16,16,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-pixel-embed')?.shape.join(','), '1,64,64,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'last-hs')?.shape.join(','), '1,200,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-mask-logits')?.shape.join(','), '1,200,64,64');
for (let layer = 0; layer < 6; layer += 1) {
  for (const role of ['self-q-weight', 'self-k-weight', 'self-v-weight', 'self-o-weight', 'cross-q-weight', 'cross-k-weight', 'cross-v-weight', 'cross-o-weight']) {
    assert.equal(manifest.weights.find(entry => entry.role === `detr-encoder-layer-${layer}-${role}`)?.shape.join(','), '256,256');
  }
  assert.equal(manifest.weights.find(entry => entry.role === `detr-encoder-layer-${layer}-layernorm1-weight`)?.shape.join(','), '256');
  assert.equal(manifest.weights.find(entry => entry.role === `detr-encoder-layer-${layer}-fc1-weight`)?.shape.join(','), '2048,256');
  assert.equal(manifest.weights.find(entry => entry.role === `detr-encoder-layer-${layer}-fc2-weight`)?.shape.join(','), '256,2048');
}
assert.ok(manifest.weights.find(entry => entry.role === 'prompt-cross-attn-q-weight'), 'packet must include downstream prompt-FPN weights for composed browser smoke');
assert.ok(manifest.weights.find(entry => entry.role === 'pixel-decoder-stage-0-conv-weight'), 'packet must include downstream pixel-decoder weights for composed browser smoke');
assert.ok(manifest.weights.find(entry => entry.role === 'mask-embedder-layer-0-weight'), 'packet must include downstream mask-tail weights for composed browser smoke');

for (const section of ['tensors', 'weights']) {
  for (const entry of manifest[section]) {
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(entry.sha256), `${entry.role} must have sha256`);
    assert.equal(existsSync(join(outDir, entry.file)), true, `${entry.file} must exist`);
  }
}

console.log('sam DETR encoder mlx packet contracts passed');
