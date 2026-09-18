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
}) {
  return `${dimsStruct}

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
${extraBinding}
@group(0) @binding(${outputBinding}) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(${uniformBinding}) var<uniform> dims: ${dimsType};

var<workgroup> products: array<f32, 64>;
var<workgroup> state: array<f32, 4>;

@compute @workgroup_size(64)
fn main(
  @builtin(local_invocation_index) dimension: u32,
  @builtin(workgroup_id) workgroup: vec3<u32>,
) {
  let query = workgroup.x;
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
    state[2] = 0.0;
    state[3] = 0.0;
  }
  workgroupBarrier();

  for (var token = 0u; token < ${keyTokens}; token = token + 1u) {
    let k_base = ${kBase};
    var product = 0.0;
    if (dimension < dims.head_dim) {
      product = q_values[q_base + dimension] * k_values[k_base + dimension];
    }
    products[dimension] = product;
    workgroupBarrier();

    var reduction_stride = 32u;
    loop {
      if (dimension < reduction_stride) {
        products[dimension] = products[dimension] + products[dimension + reduction_stride];
      }
      workgroupBarrier();
      if (reduction_stride == 1u) { break; }
      reduction_stride = reduction_stride / 2u;
    }

    if (dimension == 0u) {
      var score = products[0] * scale;
      ${scoreAdjustment}
      let next_max = max(state[0], score);
      state[2] = exp(state[0] - next_max);
      state[3] = exp(score - next_max);
      state[0] = next_max;
      state[1] = state[1] * state[2] + state[3];
    }
    workgroupBarrier();

    if (dimension < dims.head_dim) {
      accumulator = accumulator * state[2] + state[3] * v_values[${vIndex}];
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

export const SAM_VIT_ONLINE_ATTENTION_WGSL = createOnlineAttentionWgsl({
  dimsStruct: VIT_DIMS,
  dimsType: 'BlockDims',
  queryTokens: 'dims.window_tokens',
  keyTokens: 'dims.window_tokens',
  channels: 'dims.channels',
  domainCount: 'dims.batch * dims.window_count',
  qBase: '(batch * dims.window_tokens + query) * dims.channels + head_offset',
  kBase: '(batch * dims.window_tokens + token) * dims.channels + head_offset',
  vIndex: '(batch * dims.window_tokens + token) * dims.channels + head_offset + dimension',
});

function positiveDispatchDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be an integer in [1, 65535]`);
  }
  return value;
}

export function onlineAttentionDispatch(queryTokens, heads, batches, headDim) {
  positiveDispatchDimension(headDim, 'headDim');
  if (headDim > 64) throw new Error('headDim must be an integer in [1, 64]');
  return [
    positiveDispatchDimension(queryTokens, 'queryTokens'),
    positiveDispatchDimension(heads, 'heads'),
    positiveDispatchDimension(batches, 'batches'),
  ];
}
