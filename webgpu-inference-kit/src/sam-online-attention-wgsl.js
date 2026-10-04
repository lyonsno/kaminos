import { WEBGPU_SHADER_STAGE } from './runtime-primitives.js';

const STANDARD_DIMS = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
};`;

const DECODER_DIMS = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
  mask_mode: u32,
};`;

const TEXT_DIMS = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};`;

const PROMPT_FPN_DIMS = `
struct PromptFpnDims {
  batch: u32,
  spatial_tokens: u32,
  prompt_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_encoder: u32,
  total_prompt: u32,
};`;

const VIT_DIMS = `
struct BlockDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  window_size: u32,
  intermediate_size: u32,
  padded_height: u32,
  padded_width: u32,
  windows_per_row: u32,
  window_count: u32,
  window_tokens: u32,
  total_values: u32,
  padded_total_values: u32,
  _pad0: u32,
};`;

function createStaticQkReductionWgsl() {
  const lines = [];
  for (let component = 0; component < 64; component += 1) {
    lines.push(`var product_${component} = 0.0;`);
    lines.push(`if (${component}u < dims.head_dim) {`);
    lines.push(`  product_${component} = q_values[q_base + ${component}u] * k_values[k_base + ${component}u];`);
    lines.push('}');
  }
  // Preserve the original in-place 64-element tree, including padded zeros.
  for (let stride = 32; stride >= 1; stride /= 2) {
    for (let index = 0; index < stride; index += 1) {
      lines.push(`product_${index} = product_${index} + product_${index + stride};`);
    }
  }
  return lines.join('\n      ');
}

function createOnlineAttentionWgsl({
  dimsStruct,
  dimsType,
  extraBinding = '',
  outputBinding = 3,
  uniformBinding = 4,
  queryTokens,
  keyTokens,
  channels,
  domainCount = 'dims.batch',
  qBase,
  kBase,
  vIndex,
  scoreAdjustment = '',
  queryOffset = '',
}) {
  return `${dimsStruct}

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
${extraBinding}
@group(0) @binding(${outputBinding}) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(${uniformBinding}) var<uniform> dims: ${dimsType};

var<workgroup> scores: array<f32, 64>;
var<workgroup> old_scales: array<f32, 64>;
var<workgroup> token_scales: array<f32, 64>;
var<workgroup> state: array<f32, 2>;

@compute @workgroup_size(64)
fn main(
  @builtin(local_invocation_index) dimension: u32,
  @builtin(workgroup_id) workgroup: vec3<u32>,
) {
  let query = workgroup.x${queryOffset};
  let head = workgroup.y;
  let batch = workgroup.z;
  if (
    dims.head_dim > 64u ||
    query >= ${queryTokens} ||
    head >= dims.heads ||
    batch >= ${domainCount}
  ) { return; }

  let head_offset = head * dims.head_dim;
  let q_base = ${qBase};
  let scale = inverseSqrt(f32(dims.head_dim));
  var accumulator = 0.0;

  if (dimension == 0u) {
    state[0] = -3.402823e38;
    state[1] = 0.0;
  }
  workgroupBarrier();

  // Each lane scores one key. Keep the original reduction tree and token-order
  // recurrence, but synchronize once per tile instead of per key/dimension.
  for (var tile_start = 0u; tile_start < ${keyTokens}; tile_start = tile_start + 64u) {
    let tile_count = min(64u, ${keyTokens} - tile_start);
    let token = tile_start + dimension;
    if (dimension < tile_count) {
      let k_base = ${kBase};
      ${createStaticQkReductionWgsl()}
      var score = product_0 * scale;
      ${scoreAdjustment}
      scores[dimension] = score;
    }
    workgroupBarrier();

    if (dimension == 0u) {
      for (var offset = 0u; offset < tile_count; offset = offset + 1u) {
        let next_max = max(state[0], scores[offset]);
        old_scales[offset] = exp(state[0] - next_max);
        token_scales[offset] = exp(scores[offset] - next_max);
        state[0] = next_max;
        state[1] = state[1] * old_scales[offset] + token_scales[offset];
      }
    }
    workgroupBarrier();

    if (dimension < dims.head_dim) {
      for (var offset = 0u; offset < tile_count; offset = offset + 1u) {
        let token = tile_start + offset;
        accumulator = accumulator * old_scales[offset] + token_scales[offset] * v_values[${vIndex}];
      }
    }
    workgroupBarrier();
  }

  if (dimension < dims.head_dim) {
    output_values[${qBase} + dimension] = accumulator / state[1];
  }
}`;
}

const standard = {
  dimsStruct: STANDARD_DIMS,
  dimsType: 'AttentionDims',
  queryTokens: 'dims.query_tokens',
  keyTokens: 'dims.key_tokens',
  channels: 'dims.channels',
  qBase: '(batch * dims.query_tokens + query) * dims.channels + head_offset',
  kBase: '(batch * dims.key_tokens + token) * dims.channels + head_offset',
  vIndex: '(batch * dims.key_tokens + token) * dims.channels + head_offset + dimension',
};

export const SAM_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl(standard);

export const SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  ...standard,
  extraBinding: '\nstruct QueryRange { query_offset: u32, };\n@group(0) @binding(5) var<uniform> query_range: QueryRange;',
  queryOffset: ' + query_range.query_offset',
});

// 123 ms / 5184 queries projects to about 6.1 ms per 256-query phase.
// This partitions execution, never the full query/key tensor dimensions.
export function partitionSamAttentionPhase(phase, kernels, runtime, queriesPerPhase = 256) {
  const [queries, heads, batches] = phase.dispatch;
  onlineAttentionDispatch(queries, heads, batches, 64);
  positiveDispatchDimension(queriesPerPhase, 'queriesPerPhase');
  const chunks = [];
  const template = kernels[phase.kernel];
  for (let offset = 0; offset < queries; offset += queriesPerPhase) {
    const kernel = `${phase.kernel}Query${offset}`;
    const range = runtime.createUniformBuffer({
      label: `${kernel}.query-range`,
      schema: [{ name: 'query_offset', type: 'u32' }],
      values: { query_offset: offset },
    });
    kernels[kernel] = {
      ...template,
      bindings: [...template.bindings, { name: 'queryRange', resource: range, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }],
    };
    chunks.push({
      ...phase,
      name: offset === 0 ? phase.name : `${phase.name}-query-${offset}`,
      kernel,
      dispatch: [Math.min(queriesPerPhase, queries - offset), heads, batches],
    });
  }
  return chunks;
}

export const SAM_MASKED_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  ...standard,
  extraBinding: '@group(0) @binding(3) var<storage, read> key_mask: array<f32>;',
  outputBinding: 4,
  uniformBinding: 5,
  scoreAdjustment: `if (key_mask[batch * dims.key_tokens + token] <= 0.0) {
        score = score - 1000000000.0;
      }`,
});

export const SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  ...standard,
  dimsStruct: DECODER_DIMS,
  extraBinding: '@group(0) @binding(3) var<storage, read> key_mask: array<f32>;',
  outputBinding: 4,
  uniformBinding: 5,
  scoreAdjustment: `if (dims.mask_mode == 1u && key_mask[batch * dims.key_tokens + token] <= 0.0) {
        score = score - 1000000000.0;
      }`,
});

export const SAM_BIASED_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  ...standard,
  dimsStruct: DECODER_DIMS,
  extraBinding: '@group(0) @binding(3) var<storage, read> bias_values: array<f32>;',
  outputBinding: 4,
  uniformBinding: 5,
  scoreAdjustment: 'score = score + bias_values[((batch * dims.heads + head) * dims.query_tokens + query) * dims.key_tokens + token];',
});

export const SAM_CAUSAL_MASKED_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  dimsStruct: TEXT_DIMS,
  dimsType: 'TextDims',
  extraBinding: '@group(0) @binding(3) var<storage, read> prompt_mask: array<f32>;',
  outputBinding: 4,
  uniformBinding: 5,
  queryTokens: 'dims.prompt_tokens',
  keyTokens: 'dims.prompt_tokens',
  channels: 'dims.hidden_size',
  qBase: '(batch * dims.prompt_tokens + query) * dims.hidden_size + head_offset',
  kBase: '(batch * dims.prompt_tokens + token) * dims.hidden_size + head_offset',
  vIndex: '(batch * dims.prompt_tokens + token) * dims.hidden_size + head_offset + dimension',
  scoreAdjustment: `if (token > query || prompt_mask[batch * dims.prompt_tokens + token] <= 0.0) {
        score = -1000000000.0;
      }`,
});

export const SAM_PROMPT_FPN_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  dimsStruct: PROMPT_FPN_DIMS,
  dimsType: 'PromptFpnDims',
  extraBinding: '@group(0) @binding(3) var<storage, read> prompt_mask: array<f32>;',
  outputBinding: 4,
  uniformBinding: 5,
  queryTokens: 'dims.spatial_tokens',
  keyTokens: 'dims.prompt_tokens',
  channels: 'dims.channels',
  qBase: '(batch * dims.spatial_tokens + query) * dims.channels + head_offset',
  kBase: '(batch * dims.prompt_tokens + token) * dims.channels + head_offset',
  vIndex: '(batch * dims.prompt_tokens + token) * dims.channels + head_offset + dimension',
  scoreAdjustment: `if (prompt_mask[batch * dims.prompt_tokens + token] <= 0.0) {
        score = score - 1000000000.0;
      }`,
});

const vit = {
  dimsStruct: VIT_DIMS,
  dimsType: 'BlockDims',
  queryTokens: 'dims.window_tokens',
  keyTokens: 'dims.window_tokens',
  channels: 'dims.channels',
  domainCount: 'dims.batch * dims.window_count',
  qBase: '(batch * dims.window_tokens + query) * dims.channels + head_offset',
  kBase: '(batch * dims.window_tokens + token) * dims.channels + head_offset',
  vIndex: '(batch * dims.window_tokens + token) * dims.channels + head_offset + dimension',
};

export const SAM_VIT_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl(vit);
export const SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  ...vit,
  extraBinding: '\nstruct QueryRange { query_offset: u32, };\n@group(0) @binding(5) var<uniform> query_range: QueryRange;',
  queryOffset: ' + query_range.query_offset',
});

function positiveDispatchDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be an integer in [1, 65535]`);
  }
  return value;
}

export function onlineAttentionDispatch(queryTokens, heads, batches, headDim) {
  if (!Number.isInteger(headDim) || headDim <= 0 || headDim > 64) {
    throw new Error('headDim must be an integer in [1, 64]');
  }
  return [
    positiveDispatchDimension(queryTokens, 'queryTokens'),
    positiveDispatchDimension(heads, 'heads'),
    positiveDispatchDimension(batches, 'batches'),
  ];
}
