// SAM tiled linears: row-range partition covers every token once, carries the
// right GEMM params and bindings, and uses the shared tiled GEMM shader.
import assert from 'node:assert/strict';
import {
  partitionSamTiledLinearPhase, samTiledLinearShader, samTiledLinearShaders, SAM_TILED_LINEAR_TILE_POLICY,
} from '../src/sam-tiled-linear.js';
import { createWebGpuTiledGemmShader } from '../src/tiled-gemm-kernel.js';
import { SAM_GELU_WGSL_HELPERS } from '../src/sam-vector-linear-wgsl.js';

const uniforms = [];
const runtime = { device: { limits: { maxComputeWorkgroupsPerDimension: 65535 } },
  createUniformBuffer(spec) { uniforms.push(spec); return { label: spec.label }; } };
const bindings = ['input', 'weight', 'bias', 'output', 'dims'].map(name => ({ name }));

// MLP fc1 at SAM 3 native size: 5184 tokens, 1024 -> 4736, GELU.
const kernels = { mlpFc1: { code: 'scalar', bindings } };
const phases = partitionSamTiledLinearPhase({ name: 'vit-block-stack-gelu-mlp', kernel: 'mlpFc1', yieldAfter: true },
  { tokens: 5184, inputChannels: 1024, outputChannels: 4736, maxOutputsPerPhase: 1_048_576, activation: 'gelu' }, runtime, kernels);
const rowsPerPhase = Math.floor(1_048_576 / 4736);
assert.equal(phases.length, Math.ceil(5184 / rowsPerPhase));
let covered = 0;
phases.forEach((phase, index) => {
  const kernel = kernels[phase.kernel];
  const params = uniforms[index].values;
  assert.equal(params.a_off, covered * 1024);
  assert.equal(params.c_off, covered * 4736);
  assert.deepEqual([params.N, params.K, params.a_sm, params.a_sk, params.b_sk, params.b_sn, params.c_sm, params.c_sn, params.alpha], [4736, 1024, 1024, 1, 1, 1024, 4736, 1, 1]);
  assert.deepEqual(kernel.bindings.slice(0, 4).map(binding => binding.name), ['input', 'weight', 'bias', 'output']);
  assert.equal(kernel.bindings[4].name, 'params');
  assert.equal(kernel.bindings[4].type, 'uniform');
  assert.equal(phase.yieldAfter, true);
  assert.ok(samTiledLinearShaders().includes(kernel.code));
  assert.match(kernel.code, /gelu_exact_approx/);
  covered += params.M;
});
assert.equal(covered, 5184);
assert.equal(phases[0].name, 'vit-block-stack-gelu-mlp');

// Shader identity with the kit generator (SAM layout: weight [out, in], bias per output).
assert.equal(samTiledLinearShader({ activation: 'gelu', tile: SAM_TILED_LINEAR_TILE_POLICY.large }), createWebGpuTiledGemmShader({
  aKContiguous: true, bNContiguous: false, biasN: true, precision: 'f32', tile: SAM_TILED_LINEAR_TILE_POLICY.large,
  types: { a: 'f32', b: 'f32', c: 'f32', biasN: 'f32' }, activation: { expression: 'gelu_exact_approx(value)', helpers: SAM_GELU_WGSL_HELPERS } }));
assert.doesNotMatch(samTiledLinearShader({ activation: 'none' }), /gelu/);
assert.throws(() => samTiledLinearShader({ activation: 'relu6' }), /unsupported SAM tiled linear activation/);
assert.throws(() => partitionSamTiledLinearPhase({ kernel: 'x' }, { tokens: 1, inputChannels: 4, outputChannels: 4, maxOutputsPerPhase: 4 }, runtime, { x: { bindings: bindings.slice(0, 3) } }),
  /five bindings/);
console.log('sam tiled linear contracts: passed');
