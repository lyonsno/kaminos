import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID } from '../src/index.js';

const outDir = mkdtempSync(join(tmpdir(), 'sam-detr-decoder-mlx-packet-'));
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const sourceImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const proc = spawnSync('uv', [
  'run',
  '--project', mlxVlmRoot,
  'python',
  'tools/sam-detr-decoder-mlx-packet.py',
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
assert.equal(manifest.schema, 'kaminos.sam3-detr-decoder-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-detr-decoder-phase-program');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.deepEqual(manifest.claims.browserExecutedStages, ['detr-decoder', 'mask-embedder', 'instance-projection', 'decode-mask', 'threshold-mask']);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.heads, 8);
assert.equal(manifest.shape.layerCount, 6);
assert.equal(manifest.shape.mlpHidden, 2048);
assert.equal(manifest.shape.queryTokens, 200);
assert.equal(manifest.shape.spatialTokens, 256);
assert.ok(manifest.shape.promptTokens > 0);
assert.equal(manifest.tensors.find(entry => entry.role === 'encoder-hidden-states')?.shape.join(','), '1,256,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'encoder-pos')?.shape.join(','), '1,256,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-features')?.shape[2], 256);
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-mask')?.dtype, 'float32');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-decoder-hidden-states')?.shape.join(','), '6,1,200,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-last-hs')?.shape.join(','), '1,200,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-reference-boxes')?.shape.join(','), '1,200,4');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-presence-logits')?.shape.join(','), '6,1,1');
assert.equal(manifest.tensors.find(entry => entry.role === 'pixel-embed')?.shape.join(','), '1,64,64,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-mask-logits')?.shape.join(','), '1,200,64,64');
for (let layer = 0; layer < 6; layer += 1) {
  for (const role of ['self-q-weight', 'self-k-weight', 'self-v-weight', 'self-o-weight', 'text-q-weight', 'text-k-weight', 'text-v-weight', 'text-o-weight', 'vision-q-weight', 'vision-k-weight', 'vision-v-weight', 'vision-o-weight']) {
    assert.equal(manifest.weights.find(entry => entry.role === `detr-decoder-layer-${layer}-${role}`)?.shape.join(','), '256,256');
  }
  assert.equal(manifest.weights.find(entry => entry.role === `detr-decoder-layer-${layer}-self-layernorm-weight`)?.shape.join(','), '256');
  assert.equal(manifest.weights.find(entry => entry.role === `detr-decoder-layer-${layer}-fc1-weight`)?.shape.join(','), '2048,256');
  assert.equal(manifest.weights.find(entry => entry.role === `detr-decoder-layer-${layer}-fc2-weight`)?.shape.join(','), '256,2048');
}
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-query-embed-weight')?.shape.join(','), '200,256');
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-reference-points-weight')?.shape.join(','), '200,4');
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-presence-token-weight')?.shape.join(','), '1,256');
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-ref-point-head-layer-1-weight')?.shape.join(','), '256,512');
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-box-rpb-x-layer-2-weight')?.shape.join(','), '8,256');
assert.equal(manifest.weights.find(entry => entry.role === 'detr-decoder-box-head-layer-3-weight')?.shape.join(','), '4,256');
assert.ok(manifest.weights.find(entry => entry.role === 'mask-embedder-layer-0-weight'), 'packet must include downstream mask-tail weights for composed browser smoke');

for (const section of ['tensors', 'weights']) {
  for (const entry of manifest[section]) {
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(entry.sha256), `${entry.role} must have sha256`);
    assert.equal(existsSync(join(outDir, entry.file)), true, `${entry.file} must exist`);
  }
}

console.log('sam DETR decoder mlx packet contracts passed');
