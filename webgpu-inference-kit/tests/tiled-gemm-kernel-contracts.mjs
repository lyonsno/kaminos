// Tiled GEMM shader generator: extracted from SuperMat without changing a byte
// of emitted WGSL (264 layout/precision/tile/conv/storage cases hashed from
// models/supermat/supermat-kernels.js before extraction), plus option checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  createWebGpuTiledGemmShader, tiledGemmTileShape, TILED_GEMM_PARAMS_WORDS, chooseTiledGemmTile,
} from '../src/tiled-gemm-kernel.js';

const snapshot = JSON.parse(fs.readFileSync(new URL('./fixtures/tiled-gemm-shader-snapshot.json', import.meta.url), 'utf8'));
assert.equal(snapshot.cases.length, 264);
for (const { layout, sha256 } of snapshot.cases) {
  const text = createWebGpuTiledGemmShader(layout);
  assert.equal(createHash('sha256').update(text).digest('hex'), sha256, JSON.stringify(layout));
}

assert.equal(TILED_GEMM_PARAMS_WORDS, 20);
assert.deepEqual(tiledGemmTileShape({ tm: 8, tn: 4, bk: 16 }), { tm: 8, tn: 4, bk: 16, bm: 128, bn: 64 });
assert.throws(() => createWebGpuTiledGemmShader({ precision: 'f8' }), /unsupported precision/);
assert.throws(() => createWebGpuTiledGemmShader({ normB: { silu: true } }), /requires a conv GEMM/);

// Per-shape tile policy: the large tile only when it still yields enough workgroups.
const policy = { base: { tm: 4, tn: 4, bk: 16 }, large: { tm: 8, tn: 4, bk: 16 }, minWorkgroups: 1024 };
assert.deepEqual(chooseTiledGemmTile({ M: 256, N: 262144, batch: 1 }, policy), policy.large);  // decoder conv
assert.deepEqual(chooseTiledGemmTile({ M: 320, N: 4096, batch: 1 }, policy), policy.base);     // small UNet conv
assert.deepEqual(chooseTiledGemmTile({ M: 320, N: 4096, batch: 1 }, { ...policy, large: null }), policy.base);
console.log('tiled gemm kernel contracts: passed (264 shader identities)');
