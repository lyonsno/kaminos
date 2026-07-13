import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID } from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exporter = new URL('../tools/sam-mask-tail-mlx-packet.py', import.meta.url);
const mlxVlmRoot = process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm';
const fixtureImage = process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const outDir = await mkdtemp(join(tmpdir(), 'sam-mask-tail-'));

assert.ok(packageJson.scripts['test:live:sam-mask-tail']?.includes('sam-mask-tail-mlx-packet-contracts.mjs'), 'package must expose live mask-tail contract explicitly');
assert.equal(existsSync(exporter), true, 'mask-tail MLX packet exporter must exist');

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
assert.equal(manifest.schema, 'kaminos.sam3-mask-tail-real-boundary-packet.v0');
assert.equal(manifest.routeId, SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID);
assert.equal(manifest.mode, 'mlx-reference-export');
assert.equal(manifest.boundary, 'sam3-detector-mask-tail-phase-program');
assert.equal(manifest.claims.fullSam3BrowserExecution, false);
assert.deepEqual(manifest.claims.browserExecutedStages, ['mask-embedder', 'instance-projection', 'decode-mask', 'threshold-mask']);
assert.equal(manifest.shape.batch, 1);
assert.equal(manifest.shape.channels, 256);
assert.equal(manifest.shape.maskTokens, 200);
assert.equal(manifest.shape.height, 64);
assert.equal(manifest.shape.width, 64);

assert.deepEqual(
  manifest.tensors.map(tensor => tensor.role),
  ['last-hs', 'pixel-embed', 'expected-mask-embeddings', 'expected-upscaled-embedding', 'expected-mask-logits', 'expected-binary-mask'],
);
assert.deepEqual(
  manifest.weights.map(weight => weight.role),
  [
    'mask-embedder-layer-0-weight',
    'mask-embedder-layer-0-bias',
    'mask-embedder-layer-1-weight',
    'mask-embedder-layer-1-bias',
    'mask-embedder-layer-2-weight',
    'mask-embedder-layer-2-bias',
    'instance-projection-weight',
    'instance-projection-bias',
  ],
);
for (const artifact of [...manifest.tensors, ...manifest.weights]) {
  assert.match(artifact.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await stat(join(outDir, artifact.file))).isFile(), true);
}

console.log('sam mask tail mlx packet contracts passed');
