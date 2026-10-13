// SAM attention (image ViT, DETR encoder, memory) through the kit flash attention generators. Same math as the online kernel in
// sam-online-attention-wgsl.js (scaled dot product, softmax over the window's or the global grid's keys)
// with a different reduction order: per-tile online softmax over 32-key tiles instead of per-key. On SAM
// 1008 shapes the original packed builder matched the online kernel to ~1e-6 and an f64 oracle to ~2e-6.
// Compatible head dims use the register-tiled builder; those numerical results do not qualify it.
//
// Layout (ViT windows): q, k, v and output [windows, windowTokens, heads * headDim], one domain per
// window (or one global domain). Bindings: q, k, v, output, params.
import { createWebGpuFlashAttentionShader, createWebGpuTiledFlashAttentionShader, flashAttentionDispatch } from './flash-attention-kernel.js';
import { WEBGPU_SHADER_STAGE } from './runtime-primitives.js';

// The original packed builder took ~236 ms for 5184 SAM 1008 queries, motivating 256-query ranges.
// Keep that partition (576-query windows split into three); it does not measure register-tiled duty.
export const SAM_FLASH_ATTENTION_QUERIES_PER_PHASE = 256;

const PARAM_SCHEMA = Object.freeze([
  'query_tokens', 'key_tokens', 'q_channels', 'kv_channels', 'heads', 'kv_heads', 'query_offset', 'query_count',
].map(name => Object.freeze({ name, type: 'u32' })).concat([
  Object.freeze({ name: 'scale', type: 'f32' }),
  ...['_pad0', '_pad1', '_pad2'].map(name => Object.freeze({ name, type: 'u32' })),
]));

const shaders = new Map();
export function samFlashAttentionShader(headDim = 64) {
  if (!shaders.has(headDim)) {
    const createShader = headDim >= 16 && headDim <= 64 && headDim % 16 === 0
      ? createWebGpuTiledFlashAttentionShader : createWebGpuFlashAttentionShader;
    shaders.set(headDim, createShader({ headDim }));
  }
  return shaders.get(headDim);
}

// Replace one SAM attention phase (dispatch [queries, heads, domains], template bindings [q, k, v, output,
// dims]; any head dim 1..64 the online kernels accept) with query ranges of the
// flash kernel. keyTokens defaults to the query count (self-attention).
export function partitionSamFlashAttentionPhase(phase, { headDim, keyTokens, queriesPerPhase = SAM_FLASH_ATTENTION_QUERIES_PER_PHASE }, runtime, kernels) {
  if (!Number.isInteger(headDim) || headDim < 1 || headDim > 64) throw new Error('SAM flash attention supports headDim 1 to 64, like the online kernels');
  if (!Number.isInteger(queriesPerPhase) || queriesPerPhase < 64 || queriesPerPhase % 64 !== 0) {
    throw new Error('queriesPerPhase must be a positive multiple of 64');
  }
  const [queries, heads, domains] = phase.dispatch;
  const keys = keyTokens ?? queries;
  if (!Number.isInteger(keys) || keys < 1) throw new Error('keyTokens must be a positive integer');
  const template = kernels[phase.kernel];
  const chunks = [];
  for (let offset = 0; offset < queries; offset += queriesPerPhase) {
    const count = Math.min(queriesPerPhase, queries - offset);
    const kernel = `${phase.kernel}Flash${offset}`;
    const params = runtime.createUniformBuffer({
      label: `${kernel}.params`,
      schema: PARAM_SCHEMA,
      values: {
        query_tokens: queries, key_tokens: keys, q_channels: heads * headDim, kv_channels: heads * headDim,
        heads, kv_heads: heads, query_offset: offset, query_count: count, scale: 1 / Math.sqrt(headDim),
        _pad0: 0, _pad1: 0, _pad2: 0,
      },
    });
    kernels[kernel] = {
      ...template,
      code: samFlashAttentionShader(headDim),
      bindings: [...template.bindings.slice(0, 4), { name: 'params', resource: params, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }],
    };
    chunks.push({
      ...phase,
      name: offset === 0 ? phase.name : `${phase.name}-query-${offset}`,
      kernel,
      dispatch: flashAttentionDispatch({ queryCount: count, heads, domains }),
    });
  }
  return chunks;
}
