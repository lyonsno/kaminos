// Tiled (flash-style) attention: each workgroup takes a block of 64 queries of one head and domain and
// streams the keys through workgroup memory in tiles; every thread owns one query, keeps it and its
// output accumulator in unrolled vec4 registers, and folds each tile in with an online softmax (one
// rescale per tile). Layout: q [domain, queryTokens, heads*headDim], k/v [domain, keyTokens,
// kvHeads*headDim], out like q. Grouped KV heads map head h to kv head h / (heads / kvHeads).
// Query ranges (queryOffset, queryCount) let cooperative schedulers split a long attention into duties.
export const FLASH_ATTENTION_PARAMS_WORDS = 12;
export const FLASH_ATTENTION_BLOCK_QUERIES = 64;

const MAX_HEAD_DIM = 64;
const WORKGROUP_STORAGE_LIMIT = 16384;

function validateShape({ headDim, blockKeys }) {
  if (!Number.isInteger(headDim) || headDim < 4 || headDim % 4 !== 0) throw new Error('headDim must be a multiple of 4');
  if (headDim > MAX_HEAD_DIM) throw new Error(`headDim must be at most ${MAX_HEAD_DIM}`);
  if (!Number.isInteger(blockKeys) || blockKeys < 1) throw new Error('blockKeys must be a positive integer');
  const storage = 2 * blockKeys * headDim * 4;
  if (storage > WORKGROUP_STORAGE_LIMIT) {
    throw new Error(`key and value tiles need ${storage} bytes of workgroup storage, over the ${WORKGROUP_STORAGE_LIMIT}-byte default`);
  }
}

export function createWebGpuFlashAttentionShader({ headDim, blockKeys = 32 } = {}) {
  validateShape({ headDim, blockKeys });
  const d4 = headDim / 4;
  const tile = blockKeys * d4;
  const range = n => Array.from({ length: n }, (_, i) => i);
  const dot = j => range(d4).map(d => `dot(q${d}, key_tile[${j * d4 + d}u])`).join(' + ');
  return `struct Params {
  query_tokens: u32, key_tokens: u32, q_channels: u32, kv_channels: u32,
  heads: u32, kv_heads: u32, query_offset: u32, query_count: u32,
  scale: f32, _pad0: u32, _pad1: u32, _pad2: u32,
};
@group(0) @binding(0) var<storage, read> q_values: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> k_values: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> v_values: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> out_values: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: Params;

var<workgroup> key_tile: array<vec4<f32>, ${tile}>;
var<workgroup> value_tile: array<vec4<f32>, ${tile}>;

@compute @workgroup_size(${FLASH_ATTENTION_BLOCK_QUERIES})
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let head = group.y;
  let domain = group.z;
  let kv_head = head / (params.heads / params.kv_heads);
  let local_query = group.x * ${FLASH_ATTENTION_BLOCK_QUERIES}u + lane;
  let active = local_query < params.query_count;
  let query = params.query_offset + min(local_query, params.query_count - 1u);
  let q_base = ((domain * params.query_tokens + query) * params.q_channels + head * ${headDim}u) / 4u;
${range(d4).map(d => `  var q${d}: vec4<f32> = q_values[q_base + ${d}u] * params.scale;`).join('\n')}
${range(d4).map(d => `  var a${d}: vec4<f32> = vec4<f32>(0.0);`).join('\n')}
  var running_max = -3.402823e38;
  var running_sum = 0.0;
  for (var tile_start = 0u; tile_start < params.key_tokens; tile_start = tile_start + ${blockKeys}u) {
    for (var i = lane; i < ${tile}u; i = i + ${FLASH_ATTENTION_BLOCK_QUERIES}u) {
      let token = tile_start + i / ${d4}u;
      if (token < params.key_tokens) {
        let source = ((domain * params.key_tokens + token) * params.kv_channels + kv_head * ${headDim}u) / 4u + i % ${d4}u;
        key_tile[i] = k_values[source];
        value_tile[i] = v_values[source];
      } else {
        key_tile[i] = vec4<f32>(0.0);
        value_tile[i] = vec4<f32>(0.0);
      }
    }
    workgroupBarrier();
    let tile_keys = min(${blockKeys}u, params.key_tokens - tile_start);
${range(blockKeys).map(j => `    var s${j}: f32 = -3.402823e38;\n    if (${j}u < tile_keys) { s${j} = ${dot(j)}; }`).join('\n')}
    let tile_max = max(running_max, ${range(blockKeys).reduce((expr, j) => j === 0 ? `s${j}` : `max(${expr}, s${j})`, '')});
    let correction = exp(running_max - tile_max);
    running_sum = running_sum * correction;
${range(d4).map(d => `    a${d} = a${d} * correction;`).join('\n')}
${range(blockKeys).map(j => `    if (${j}u < tile_keys) {
      let w = exp(s${j} - tile_max);
      running_sum = running_sum + w;
${range(d4).map(d => `      a${d} = a${d} + w * value_tile[${j * d4 + d}u];`).join('\n')}
    }`).join('\n')}
    running_max = tile_max;
    workgroupBarrier();
  }
  if (active) {
    let inverse = 1.0 / running_sum;
${range(d4).map(d => `    out_values[q_base + ${d}u] = a${d} * inverse;`).join('\n')}
  }
}
`;
}

export function flashAttentionParams({ queryTokens, keyTokens, heads, kvHeads = heads, headDim, queryOffset = 0, queryCount = queryTokens - queryOffset }) {
  if (heads % kvHeads !== 0) throw new Error('heads must be a multiple of kvHeads');
  if (!Number.isInteger(queryOffset) || !Number.isInteger(queryCount) || queryOffset < 0 || queryCount < 1 || queryOffset + queryCount > queryTokens) {
    throw new Error('query range must lie within queryTokens');
  }
  const words = new Uint32Array(FLASH_ATTENTION_PARAMS_WORDS);
  words.set([queryTokens, keyTokens, heads * headDim, kvHeads * headDim, heads, kvHeads, queryOffset, queryCount]);
  new Float32Array(words.buffer)[8] = 1 / Math.sqrt(headDim);
  return words;
}

export function flashAttentionDispatch({ queryCount, heads, domains = 1 }) {
  return [Math.ceil(queryCount / FLASH_ATTENTION_BLOCK_QUERIES), heads, domains];
}
