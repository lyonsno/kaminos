import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID } from '../src/index.js';

const outDir = mkdtempSync(join(tmpdir(), 'sam-pixel-decoder-mlx-packet-'));
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const sourceImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const proc = spawnSync('uv', [
  'run',
  '--project', mlxVlmRoot,
  'python',
  'tools/sam-pixel-decoder-mlx-packet.py',
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
assert.equal(manifest.schema, 'kaminos.sam3-pixel-decoder-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-pixel-decoder-phase-program');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.deepEqual(manifest.claims.browserExecutedStages, ['pixel-decoder', 'mask-embedder', 'instance-projection', 'decode-mask', 'threshold-mask']);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.groups, 8);
assert.deepEqual(manifest.shape.levels.map(level => [level.height, level.width]), [[64, 64], [32, 32], [16, 16]]);
assert.ok(/^sha256:[0-9a-f]{64}$/.test(manifest.staticWeights.sha256));
assert.equal(manifest.tensors.find(entry => entry.role === 'fpn-feature-0')?.shape.join(','), '1,64,64,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'fpn-feature-1')?.shape.join(','), '1,32,32,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'fpn-feature-2')?.shape.join(','), '1,16,16,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'last-hs')?.shape.join(','), '1,200,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-pixel-embed')?.shape.join(','), '1,64,64,256');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-mask-logits')?.shape.join(','), '1,200,64,64');
assert.equal(manifest.tensors.find(entry => entry.role === 'expected-binary-mask')?.dtype, 'uint32');
for (let stage = 0; stage < 2; stage += 1) {
  assert.equal(manifest.weights.find(entry => entry.role === `pixel-decoder-stage-${stage}-conv-weight`)?.shape.join(','), '256,3,3,256');
  assert.equal(manifest.weights.find(entry => entry.role === `pixel-decoder-stage-${stage}-conv-bias`)?.shape.join(','), '256');
  assert.equal(manifest.weights.find(entry => entry.role === `pixel-decoder-stage-${stage}-norm-weight`)?.shape.join(','), '256');
  assert.equal(manifest.weights.find(entry => entry.role === `pixel-decoder-stage-${stage}-norm-bias`)?.shape.join(','), '256');
}
assert.ok(manifest.weights.find(entry => entry.role === 'mask-embedder-layer-0-weight'), 'packet must include downstream mask-tail weights for composed browser smoke');

for (const section of ['tensors', 'weights']) {
  for (const entry of manifest[section]) {
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(entry.sha256), `${entry.role} must have sha256`);
    assert.equal(existsSync(join(outDir, entry.file)), true, `${entry.file} must exist`);
  }
}

console.log('sam pixel decoder mlx packet contracts passed');
