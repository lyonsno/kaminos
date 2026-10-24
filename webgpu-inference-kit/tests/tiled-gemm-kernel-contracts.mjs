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
// Activation epilogue: caller WGSL applied after bias/residual, before the store.
const gelu = createWebGpuTiledGemmShader({ biasN: true, activation: { expression: 'max(value, 0.0) * 2.0', helpers: 'fn unused_helper() -> f32 { return 1.0; }' } });
assert.match(gelu, /fn tiled_gemm_activate\(value:f32\)->f32\{return max\(value, 0\.0\) \* 2\.0;\}/);
assert.match(gelu, /fn unused_helper\(\)/);
assert.match(gelu, /v\+=bias_n\[n\];v=tiled_gemm_activate\(v\);c\[/);
assert.throws(() => createWebGpuTiledGemmShader({ activation: { expression: ' ' } }), /activation expression/);
// Residual after the activation (y = act(Wx + b) + x, as in MobRecon's
// mobile_unit and YOLOv8's Bottleneck): activation first, then the residual.
const before = createWebGpuTiledGemmShader({ biasM: true, residual: true, activation: { expression: 'max(value, 0.0)' } });
assert.match(before, /v\+=bias_m\[m\];v\+=res\[[^;]+;v=tiled_gemm_activate\(v\);c\[/);
const after = createWebGpuTiledGemmShader({ biasM: true, residual: true, residualAfterActivation: true,
  activation: { expression: 'max(value, 0.0)' } });
assert.match(after, /v\+=bias_m\[m\];v=tiled_gemm_activate\(v\);v\+=res\[p\.c_off\+bat\*p\.c_sb\+m\*p\.c_sm\+n\*p\.c_sn\];c\[/);
assert.match(createWebGpuTiledGemmShader({ residual: true, residualAfterActivation: true, precision: 'f16-tiles',
  activation: { expression: 'max(value, 0.0)' } }), /v=tiled_gemm_activate\(v\);v\+=res\[/);
assert.throws(() => createWebGpuTiledGemmShader({ residualAfterActivation: true, activation: { expression: 'value' } }),
  /residualAfterActivation requires a residual/);
assert.throws(() => createWebGpuTiledGemmShader({ residual: true, residualAfterActivation: true }),
  /residualAfterActivation requires an activation/);
// Residual read from another region of the output buffer (word 19 holds its
// element offset): YOLOv8's C2f appends each bottleneck output, residual from
// the preceding chunk, to the same concat buffer. No separate res binding.
const inOutput = createWebGpuTiledGemmShader({ biasM: true, residual: true, residualInOutput: true, residualAfterActivation: true,
  activation: { expression: 'value/(1.0+exp(-value))' } });
assert.doesNotMatch(inOutput, /var<storage,read> res:/);
assert.match(inOutput, /v=tiled_gemm_activate\(v\);v\+=c\[p\.z1\+bat\*p\.c_sb\+m\*p\.c_sm\+n\*p\.c_sn\];c\[p\.c_off/);
assert.match(createWebGpuTiledGemmShader({ residual: true, residualInOutput: true }), /v\+=c\[p\.z1\+[^;]+;c\[p\.c_off/);
assert.throws(() => createWebGpuTiledGemmShader({ residualInOutput: true }), /residualInOutput requires a residual/);
assert.throws(() => createWebGpuTiledGemmShader({ residual: true, residualInOutput: true, types: { c: 'f16packed' } }),
  /residualInOutput requires an f32 or f16 output/);
console.log('tiled gemm kernel contracts: passed (264 shader identities)');
