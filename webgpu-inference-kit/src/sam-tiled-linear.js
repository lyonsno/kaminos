// SAM dense projections through the kit tiled GEMM. Same math as the scalar
// sequential4 linears (bias, optional MLX-exact GELU) with a different
// accumulation order: k-ordered F32 fma from zero, bias added after the dot
// product. Outputs match sequential4 to rounding (relL2 ~1e-6 on SAM 3 ViT
// shapes); the route gate is masks identical and logit error vs authenticated
// MLX within the existing envelope (operator decision 2026-10-11).
//
// Layout: input [tokens, in] (row-major), weight [out, in] (SAM/MLX layout),
// bias [out], output [tokens, out]. Bindings: input, weight, bias, output,
// uniform params (TILED_GEMM_PARAMS_WORDS words).
import {
  createWebGpuTiledGemmShader, chooseTiledGemmTile, tiledGemmTileShape,
} from './tiled-gemm-kernel.js';
import { SAM_GELU_WGSL_HELPERS } from './sam-vector-linear-wgsl.js';
import { WEBGPU_SHADER_STAGE } from './runtime-primitives.js';

export const SAM_TILED_LINEAR_TILE_POLICY = Object.freeze({
  base: Object.freeze({ tm: 4, tn: 4, bk: 16 }), large: Object.freeze({ tm: 8, tn: 4, bk: 16 }), minWorkgroups: 1024,
});
const ACTIVATIONS = Object.freeze({
  none: null,
  gelu: Object.freeze({ expression: 'gelu_exact_approx(value)', helpers: SAM_GELU_WGSL_HELPERS }),
});

const shaderCache = new Map();
export function samTiledLinearShader({ activation = 'none', tile = SAM_TILED_LINEAR_TILE_POLICY.base } = {}) {
  if (!Object.hasOwn(ACTIVATIONS, activation)) throw new RangeError(`unsupported SAM tiled linear activation ${activation}`);
  const key = `${activation}:${tile.tm}x${tile.tn}x${tile.bk}`;
  if (!shaderCache.has(key)) {
    shaderCache.set(key, createWebGpuTiledGemmShader({
      aKContiguous: true, bNContiguous: false, biasN: true, precision: 'f32', tile,
      types: { a: 'f32', b: 'f32', c: 'f32', biasN: 'f32' }, activation: ACTIVATIONS[activation],
    }));
  }
  return shaderCache.get(key);
}

// Every shader this module can emit (for pipeline caching by code).
export function samTiledLinearShaders() {
  const { base, large } = SAM_TILED_LINEAR_TILE_POLICY;
  return Object.keys(ACTIVATIONS).flatMap(activation => [base, large].map(tile => samTiledLinearShader({ activation, tile })));
}

const PARAM_SCHEMA = Object.freeze([
  ['M', 'u32'], ['N', 'u32'], ['K', 'u32'], ['alpha', 'f32'],
  ['a_off', 'u32'], ['a_sm', 'u32'], ['a_sk', 'u32'], ['a_sb', 'u32'],
  ['b_off', 'u32'], ['b_sk', 'u32'], ['b_sn', 'u32'], ['b_sb', 'u32'],
  ['c_off', 'u32'], ['c_sm', 'u32'], ['c_sn', 'u32'], ['c_sb', 'u32'],
  ['pad_top', 'u32'], ['pad_left', 'u32'], ['n_base', 'u32'], ['z1', 'u32'],
].map(([name, type]) => Object.freeze({ name, type })));

// Parameters and dispatch for tokens [start, start + count).
export function samTiledLinearRange({ start, count, inputChannels, outputChannels, tile }) {
  const shape = tiledGemmTileShape(tile);
  return {
    values: {
      M: count, N: outputChannels, K: inputChannels, alpha: 1,
      a_off: start * inputChannels, a_sm: inputChannels, a_sk: 1, a_sb: 0,
      b_off: 0, b_sk: 1, b_sn: inputChannels, b_sb: 0,
      c_off: start * outputChannels, c_sm: outputChannels, c_sn: 1, c_sb: 0,
      pad_top: 0, pad_left: 0, n_base: 0, z1: 0,
    },
    dispatch: [Math.ceil(outputChannels / shape.bn), Math.ceil(count / shape.bm)],
  };
}

function positiveU32(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) throw new Error(`${name} must be a positive u32 integer`);
  return value;
}

// Replace one scalar SAM linear phase with token-row ranges of the tiled
// GEMM. The phase's kernel template supplies bindings [input, weight, bias,
// output, dims]; the dims uniform is replaced by per-range GEMM params.
// maxOutputsPerPhase bounds outputs per range like the scalar partition.
export function partitionSamTiledLinearPhase(phase, { tokens, inputChannels, outputChannels, maxOutputsPerPhase, activation = 'none' }, runtime, kernels) {
  for (const [name, value] of Object.entries({ tokens, inputChannels, outputChannels, maxOutputsPerPhase })) positiveU32(value, name);
  for (const count of [tokens * outputChannels, tokens * inputChannels, outputChannels * inputChannels]) {
    if (!Number.isSafeInteger(count) || count > 0xffff_ffff) throw new Error('linear tensor domain must fit u32');
  }
  const template = kernels[phase.kernel];
  if (!template || !Array.isArray(template.bindings) || template.bindings.length !== 5) {
    throw new Error('tiled linear partition requires a SAM linear kernel template with five bindings');
  }
  const rowsPerPhase = Math.max(1, Math.floor(maxOutputsPerPhase / outputChannels));
  const maxWorkgroupsPerDimension = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535;
  // One tile per projection, chosen from the full range size, so a short last
  // range reuses the same shader (and pipeline) as the others.
  const tile = chooseTiledGemmTile({ M: Math.min(rowsPerPhase, tokens), N: outputChannels }, SAM_TILED_LINEAR_TILE_POLICY);
  const phases = [];
  for (let start = 0; start < tokens; start += rowsPerPhase) {
    const count = Math.min(rowsPerPhase, tokens - start);
    const range = samTiledLinearRange({ start, count, inputChannels, outputChannels, tile });
    if (range.dispatch.some(value => value > maxWorkgroupsPerDimension)) throw new Error('tiled linear dispatch exceeds device workgroup limit');
    const kernel = `${phase.kernel}TiledRows${start}`;
    const params = runtime.createUniformBuffer({ label: `${kernel}.params`, schema: PARAM_SCHEMA, values: range.values });
    kernels[kernel] = {
      ...template,
      code: samTiledLinearShader({ activation, tile }),
      bindings: [...template.bindings.slice(0, 4), { name: 'params', resource: params, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }],
    };
    phases.push({ ...phase, name: start === 0 ? phase.name : `${phase.name}-rows-${start}`, kernel, dispatch: range.dispatch });
  }
  return phases;
}
