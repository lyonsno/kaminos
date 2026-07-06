import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID } from '../src/index.js';

const outDir = mkdtempSync(join(tmpdir(), 'sam-scoring-mlx-packet-'));
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const sourceImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const proc = spawnSync('uv', [
  'run',
  '--project', mlxVlmRoot,
  'python',
  'tools/sam-scoring-mlx-packet.py',
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
assert.equal(manifest.schema, 'kaminos.sam3-scoring-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-dot-product-scoring-phase-program');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.deepEqual(manifest.claims.browserExecutedStages, ['dot-product-scoring']);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.layerCount, 6);
assert.equal(manifest.shape.queryTokens, 200);
assert.equal(manifest.shape.mlpHidden, 2048);
assert.ok(manifest.shape.promptTokens > 0);
assert.equal(manifest.tensors.find(entry => entry.role === 'hidden-states')?.shape.join(','), '6,1,200,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-features')?.shape[2], 256);
assert.equal(manifest.tensors.find(entry => entry.role === 'prompt-mask')?.dtype, 'float32');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-pred-logits')?.shape.join(','), '6,1,200,1');
assert.equal(manifest.weights.find(entry => entry.role === 'scoring-query-proj-weight')?.shape.join(','), '256,256');
assert.equal(manifest.weights.find(entry => entry.role === 'scoring-text-proj-weight')?.shape.join(','), '256,256');
assert.equal(manifest.weights.find(entry => entry.role === 'scoring-text-mlp-layer-1-weight')?.shape.join(','), '2048,256');
assert.equal(manifest.weights.find(entry => entry.role === 'scoring-text-mlp-layer-2-weight')?.shape.join(','), '256,2048');
assert.equal(manifest.weights.find(entry => entry.role === 'scoring-text-mlp-out-norm-weight')?.shape.join(','), '256');

for (const section of ['tensors', 'weights']) {
  for (const entry of manifest[section]) {
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(entry.sha256), `${entry.role} must have sha256`);
    assert.equal(existsSync(join(outDir, entry.file)), true, `${entry.file} must exist`);
  }
}

console.log('sam scoring mlx packet contracts passed');
