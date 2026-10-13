// Tiled (flash-style) attention: each workgroup takes a block of 64 queries of one head and domain and
// streams the keys through workgroup memory in tiles; every thread owns one query, keeps it and its
// output accumulator in unrolled vec4 registers, and folds each tile in with an online softmax (one
// rescale per tile); head dims 1..64. Layout: q [domain, queryTokens, heads*headDim], k/v [domain, keyTokens,
// kvHeads*headDim], out like q. Grouped KV heads map head h to kv head h / (heads / kvHeads).
// Query ranges (queryOffset, queryCount) let cooperative schedulers split a long attention into duties.
export const FLASH_ATTENTION_PARAMS_WORDS = 12;
export const FLASH_ATTENTION_BLOCK_QUERIES = 64;

const MAX_HEAD_DIM = 64;
const MAX_SPLIT_HEAD_DIM = 256;
const PART_DIMS = 64;
const WORKGROUP_STORAGE_LIMIT = 16384;

function validateShape({ headDim, blockKeys }) {
  if (!Number.isInteger(headDim) || headDim < 1 || headDim > MAX_HEAD_DIM) throw new Error(`headDim must be an integer from 1 to ${MAX_SPLIT_HEAD_DIM}`);
  if (!Number.isInteger(blockKeys) || blockKeys < 1) throw new Error('blockKeys must be a positive integer');
  const storage = 2 * blockKeys * headDim * 4;
  if (storage > WORKGROUP_STORAGE_LIMIT) {
    throw new Error(`key and value tiles need ${storage} bytes of workgroup storage, over the ${WORKGROUP_STORAGE_LIMIT}-byte default`);
  }
}

// Head dims that are multiples of 4 run on vec4 registers, tiles and loads (channel offsets stay
// vec4-aligned); other head dims run the same recurrence on scalars.
export function createWebGpuFlashAttentionShader({ headDim, blockKeys, layout = 'packed' } = {}) {
  if (layout !== 'packed' && layout !== 'strided') throw new Error(`unsupported flash attention layout ${layout}`);
  if (!Number.isInteger(headDim) || headDim < 1 || headDim > MAX_SPLIT_HEAD_DIM) throw new Error(`headDim must be an integer from 1 to ${MAX_SPLIT_HEAD_DIM}`);
  if (headDim <= MAX_HEAD_DIM && layout === 'packed') return createPackedShader({ headDim, blockKeys: blockKeys ?? 32 });
  return createGeneralShader({ headDim, blockKeys, layout });
}

// Head dims <= 64, packed layout: one thread per query (the shaders SAM's routes were accepted on).
function createPackedShader({ headDim, blockKeys }) {
  validateShape({ headDim, blockKeys });
  const lanes = headDim % 4 === 0 ? 4 : 1;
  const type = lanes === 4 ? 'vec4<f32>' : 'f32';
  const zero = `${type}(0.0)`;
  const n = headDim / lanes;
  const tile = blockKeys * n;
  const range = count => Array.from({ length: count }, (_, i) => i);
  const product = (d, j) => lanes === 4 ? `dot(q${d}, key_tile[${j * n + d}u])` : `q${d} * key_tile[${j * n + d}u]`;
  const dot = j => range(n).map(d => product(d, j)).join(' + ');
  return `struct Params {
  query_tokens: u32, key_tokens: u32, q_channels: u32, kv_channels: u32,
  heads: u32, kv_heads: u32, query_offset: u32, query_count: u32,
  scale: f32, _pad0: u32, _pad1: u32, _pad2: u32,
};
@group(0) @binding(0) var<storage, read> q_values: array<${type}>;
@group(0) @binding(1) var<storage, read> k_values: array<${type}>;
@group(0) @binding(2) var<storage, read> v_values: array<${type}>;
@group(0) @binding(3) var<storage, read_write> out_values: array<${type}>;
@group(0) @binding(4) var<uniform> params: Params;

var<workgroup> key_tile: array<${type}, ${tile}>;
var<workgroup> value_tile: array<${type}, ${tile}>;

@compute @workgroup_size(${FLASH_ATTENTION_BLOCK_QUERIES})
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let head = group.y;
  let domain = group.z;
  let kv_head = head / (params.heads / params.kv_heads);
  let local_query = group.x * ${FLASH_ATTENTION_BLOCK_QUERIES}u + lane;
  let in_range = local_query < params.query_count;
  let query = params.query_offset + min(local_query, params.query_count - 1u);
  let q_base = ((domain * params.query_tokens + query) * params.q_channels + head * ${headDim}u) / ${lanes}u;
${range(n).map(d => `  var q${d}: ${type} = q_values[q_base + ${d}u] * params.scale;`).join('\n')}
${range(n).map(d => `  var a${d}: ${type} = ${zero};`).join('\n')}
  var running_max = -3.402823e38;
  var running_sum = 0.0;
  for (var tile_start = 0u; tile_start < params.key_tokens; tile_start = tile_start + ${blockKeys}u) {
    for (var i = lane; i < ${tile}u; i = i + ${FLASH_ATTENTION_BLOCK_QUERIES}u) {
      let token = tile_start + i / ${n}u;
      if (token < params.key_tokens) {
        let source = ((domain * params.key_tokens + token) * params.kv_channels + kv_head * ${headDim}u) / ${lanes}u + i % ${n}u;
        key_tile[i] = k_values[source];
        value_tile[i] = v_values[source];
      } else {
        key_tile[i] = ${zero};
        value_tile[i] = ${zero};
      }
    }
    workgroupBarrier();
    let tile_keys = min(${blockKeys}u, params.key_tokens - tile_start);
${range(blockKeys).map(j => `    var s${j}: f32 = -3.402823e38;\n    if (${j}u < tile_keys) { s${j} = ${dot(j)}; }`).join('\n')}
    let tile_max = max(running_max, ${range(blockKeys).reduce((expr, j) => j === 0 ? `s${j}` : `max(${expr}, s${j})`, '')});
    let correction = exp(running_max - tile_max);
    running_sum = running_sum * correction;
${range(n).map(d => `    a${d} = a${d} * correction;`).join('\n')}
${range(blockKeys).map(j => `    if (${j}u < tile_keys) {
      let w = exp(s${j} - tile_max);
      running_sum = running_sum + w;
${range(n).map(d => `      a${d} = a${d} + w * value_tile[${j * n + d}u];`).join('\n')}
    }`).join('\n')}
    running_max = tile_max;
    workgroupBarrier();
  }
  if (in_range) {
    let inverse = 1.0 / running_sum;
${range(n).map(d => `    out_values[q_base + ${d}u] = a${d} * inverse;`).join('\n')}
  }
}
`;
}

// Smallest number of threads per query that keeps each thread's slice of q and the accumulator at most 64
// dims and divides the head's vec4s evenly.
function partsFor(headDim) {
  if (headDim <= PART_DIMS) return 1;
  if (headDim % 4 !== 0) throw new Error('head dims above 64 must be multiples of 4');
  const vecs = headDim / 4;
  for (let parts = Math.ceil(headDim / PART_DIMS); parts <= vecs; parts += 1) {
    if (vecs % parts === 0 && vecs / parts <= PART_DIMS / 4) return parts;
  }
  throw new Error(`head dim ${headDim} cannot be split into 64-dim parts`);
}

// Key tile: the largest power of two up to 32 whose K/V tiles and partial-score exchange fit 16 KiB.
function keyTileFor(headDim, parts) {
  const perKey = 2 * headDim * 4 + (parts > 1 ? parts * FLASH_ATTENTION_BLOCK_QUERIES * 4 : 0);
  let tile = 32;
  while (tile > 1 && tile * perKey > WORKGROUP_STORAGE_LIMIT) tile /= 2;
  if (tile * perKey > WORKGROUP_STORAGE_LIMIT) throw new Error(`head dim ${headDim} does not fit workgroup storage`);
  return tile;
}

const STRIDED_TENSORS = Object.freeze(['q', 'k', 'v', 'o']);

// General flash attention: head dims up to 256 (each query split across `parts` threads when above 64) and
// packed or strided layouts. Strided addressing is offset + domain*domain_stride + token*token_stride +
// head*head_stride + dim per tensor, which covers fused QKV rows and head-major tensors.
function createGeneralShader({ headDim, blockKeys, layout }) {
  const parts = partsFor(headDim);
  const blockKeysUsed = blockKeys ?? keyTileFor(headDim, parts);
  const lanes = headDim % 4 === 0 ? 4 : 1;
  const type = lanes === 4 ? 'vec4<f32>' : 'f32';
  const zero = `${type}(0.0)`;
  const total = headDim / lanes;
  const n = total / parts;
  const threads = FLASH_ATTENTION_BLOCK_QUERIES * parts;
  const tile = blockKeysUsed * total;
  const storage = 2 * tile * lanes * 4 + (parts > 1 ? parts * FLASH_ATTENTION_BLOCK_QUERIES * blockKeysUsed * 4 : 0);
  if (storage > WORKGROUP_STORAGE_LIMIT) throw new Error(`flash attention tiles need ${storage} bytes of workgroup storage, over the ${WORKGROUP_STORAGE_LIMIT}-byte default`);
  const range = count => Array.from({ length: count }, (_, i) => i);
  const slice = parts > 1 ? ' + part * ' + n + 'u' : '';
  const row = (tensor, token, headExpr) => layout === 'strided'
    ? `(params.${tensor}_offset + domain * params.${tensor}_domain_stride + ${token} * params.${tensor}_token_stride + ${headExpr} * params.${tensor}_head_stride) / ${lanes}u`
    : tensor === 'q' || tensor === 'o'
      ? `((domain * params.query_tokens + ${token}) * params.q_channels + ${headExpr} * ${headDim}u) / ${lanes}u`
      : `((domain * params.key_tokens + ${token}) * params.kv_channels + ${headExpr} * ${headDim}u) / ${lanes}u`;
  const params = layout === 'strided'
    ? `struct Params {
  query_tokens: u32, key_tokens: u32, heads: u32, kv_heads: u32,
  query_offset: u32, query_count: u32, scale: f32, _pad0: u32,
${STRIDED_TENSORS.map(t => `  ${t}_offset: u32, ${t}_token_stride: u32, ${t}_head_stride: u32, ${t}_domain_stride: u32,`).join('\n')}
};`
    : `struct Params {
  query_tokens: u32, key_tokens: u32, q_channels: u32, kv_channels: u32,
  heads: u32, kv_heads: u32, query_offset: u32, query_count: u32,
  scale: f32, _pad0: u32, _pad1: u32, _pad2: u32,
};`;
  const keyIndex = (j, d) => `${j * total}u${slice} + ${d}u`;
  const product = (d, j) => lanes === 4 ? `dot(q${d}, key_tile[${keyIndex(j, d)}])` : `q${d} * key_tile[${keyIndex(j, d)}]`;
  const dot = j => range(n).map(d => product(d, j)).join(' + ');
  const scores = parts > 1
    ? `${range(blockKeysUsed).map(j => `    partial_scores[(part * ${FLASH_ATTENTION_BLOCK_QUERIES}u + query_lane) * ${blockKeysUsed}u + ${j}u] = ${dot(j)};`).join('\n')}
    workgroupBarrier();
${range(blockKeysUsed).map(j => `    var s${j}: f32 = -3.402823e38;\n    if (${j}u < tile_keys) { s${j} = ${range(parts).map(pp => `partial_scores[(${pp * FLASH_ATTENTION_BLOCK_QUERIES}u + query_lane) * ${blockKeysUsed}u + ${j}u]`).join(' + ')}; }`).join('\n')}`
    : range(blockKeysUsed).map(j => `    var s${j}: f32 = -3.402823e38;\n    if (${j}u < tile_keys) { s${j} = ${dot(j)}; }`).join('\n');
  return `${params}
@group(0) @binding(0) var<storage, read> q_values: array<${type}>;
@group(0) @binding(1) var<storage, read> k_values: array<${type}>;
@group(0) @binding(2) var<storage, read> v_values: array<${type}>;
@group(0) @binding(3) var<storage, read_write> out_values: array<${type}>;
@group(0) @binding(4) var<uniform> params: Params;

var<workgroup> key_tile: array<${type}, ${tile}>;
var<workgroup> value_tile: array<${type}, ${tile}>;
${parts > 1 ? `var<workgroup> partial_scores: array<f32, ${parts * FLASH_ATTENTION_BLOCK_QUERIES * blockKeysUsed}>;\n` : ''}
@compute @workgroup_size(${threads})
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let head = group.y;
  let domain = group.z;
  let kv_head = head / (params.heads / params.kv_heads);
  let query_lane = lane % ${FLASH_ATTENTION_BLOCK_QUERIES}u;
  let part = lane / ${FLASH_ATTENTION_BLOCK_QUERIES}u;
  let local_query = group.x * ${FLASH_ATTENTION_BLOCK_QUERIES}u + query_lane;
  let in_range = local_query < params.query_count;
  let query = params.query_offset + min(local_query, params.query_count - 1u);
  let q_base = ${row('q', 'query', 'head')}${slice};
  let o_base = ${row('o', 'query', 'head')}${slice};
${range(n).map(d => `  var q${d}: ${type} = q_values[q_base + ${d}u] * params.scale;`).join('\n')}
${range(n).map(d => `  var a${d}: ${type} = ${zero};`).join('\n')}
  var running_max = -3.402823e38;
  var running_sum = 0.0;
  for (var tile_start = 0u; tile_start < params.key_tokens; tile_start = tile_start + ${blockKeysUsed}u) {
    for (var i = lane; i < ${tile}u; i = i + ${threads}u) {
      let token = tile_start + i / ${total}u;
      let element = i % ${total}u;
      if (token < params.key_tokens) {
        key_tile[i] = k_values[${row('k', 'token', 'kv_head')} + element];
        value_tile[i] = v_values[${row('v', 'token', 'kv_head')} + element];
      } else {
        key_tile[i] = ${zero};
        value_tile[i] = ${zero};
      }
    }
    workgroupBarrier();
    let tile_keys = min(${blockKeysUsed}u, params.key_tokens - tile_start);
${scores}
    let tile_max = max(running_max, ${range(blockKeysUsed).reduce((expr, j) => j === 0 ? `s${j}` : `max(${expr}, s${j})`, '')});
    let correction = exp(running_max - tile_max);
    running_sum = running_sum * correction;
${range(n).map(d => `    a${d} = a${d} * correction;`).join('\n')}
${range(blockKeysUsed).map(j => `    if (${j}u < tile_keys) {
      let w = exp(s${j} - tile_max);
      running_sum = running_sum + w;
${range(n).map(d => `      a${d} = a${d} + w * value_tile[${keyIndex(j, d)}];`).join('\n')}
    }`).join('\n')}
    running_max = tile_max;
    workgroupBarrier();
  }
  if (in_range) {
    let inverse = 1.0 / running_sum;
${range(n).map(d => `    out_values[o_base + ${d}u] = a${d} * inverse;`).join('\n')}
  }
}
`;
}

// Register-tiled flash attention for wider heads (head dim a multiple of 16, up to 256). A workgroup of
// 16x16 threads takes 64 queries of one head; per 32-key tile each thread computes a 4x2 micro-tile of
// scores as a small GEMM over 16-dim chunks of Q and K staged in workgroup memory, the score tile is shared
// so every thread reads its rows' maxima, and each thread accumulates a 4 x headDim/16 slice of the output
// from the probability tile and 8-key V chunks. Row sums stay per-thread partials until the end.
const TILED_QUERIES = 64;
const TILED_KEYS = 32;
const TILED_DIM_CHUNK = 16;

export function createWebGpuTiledFlashAttentionShader({ headDim, layout = 'packed' } = {}) {
  if (!Number.isInteger(headDim) || headDim < 16 || headDim > MAX_SPLIT_HEAD_DIM || headDim % 16 !== 0) {
    throw new Error('tiled flash attention needs a head dim that is a multiple of 16 from 16 to 256');
  }
  if (layout !== 'packed' && layout !== 'strided') throw new Error(`unsupported flash attention layout ${layout}`);
  const rowsPerThread = TILED_QUERIES / 16;
  const keysPerThread = TILED_KEYS / 16;
  const dimsPerThread = headDim / 16;
  const qChunk = TILED_QUERIES * TILED_DIM_CHUNK, kChunk = TILED_KEYS * TILED_DIM_CHUNK;
  const stageFloats = qChunk + kChunk;
  const valueKeys = Math.min(8, Math.floor(stageFloats / headDim));
  const range = count => Array.from({ length: count }, (_, i) => i);
  const R = range(rowsPerThread), J = range(keysPerThread), E = range(dimsPerThread);
  const row = (tensor, token, headExpr) => layout === 'strided'
    ? `params.${tensor}_offset + domain * params.${tensor}_domain_stride + ${token} * params.${tensor}_token_stride + ${headExpr} * params.${tensor}_head_stride`
    : tensor === 'q' || tensor === 'o'
      ? `(domain * params.query_tokens + ${token}) * params.q_channels + ${headExpr} * ${headDim}u`
      : `(domain * params.key_tokens + ${token}) * params.kv_channels + ${headExpr} * ${headDim}u`;
  const params = layout === 'strided'
    ? `struct Params {
  query_tokens: u32, key_tokens: u32, heads: u32, kv_heads: u32,
  query_offset: u32, query_count: u32, scale: f32, _pad0: u32,
${STRIDED_TENSORS.map(t => `  ${t}_offset: u32, ${t}_token_stride: u32, ${t}_head_stride: u32, ${t}_domain_stride: u32,`).join('\n')}
};`
    : `struct Params {
  query_tokens: u32, key_tokens: u32, q_channels: u32, kv_channels: u32,
  heads: u32, kv_heads: u32, query_offset: u32, query_count: u32,
  scale: f32, _pad0: u32, _pad1: u32, _pad2: u32,
};`;
  const queryOf = local => `params.query_offset + min(group.x * ${TILED_QUERIES}u + ${local}, params.query_count - 1u)`;
  return `${params}
@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> out_values: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

var<workgroup> score_tile: array<f32, ${TILED_QUERIES * TILED_KEYS}>;
var<workgroup> stage: array<f32, ${stageFloats}>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let head = group.y;
  let domain = group.z;
  let kv_head = head / (params.heads / params.kv_heads);
  let ty = lane / 16u;
  let tx = lane % 16u;
${R.map(r => `  var m${r}: f32 = -3.402823e38;\n  var l${r}: f32 = 0.0;`).join('\n')}
${R.map(r => E.map(e => `  var o${r}_${e}: f32 = 0.0;`).join('\n')).join('\n')}
  for (var tile_start = 0u; tile_start < params.key_tokens; tile_start = tile_start + ${TILED_KEYS}u) {
${R.map(r => J.map(j => `    var s${r}_${j}: f32 = 0.0;`).join('\n')).join('\n')}
    for (var chunk = 0u; chunk < ${headDim}u; chunk = chunk + ${TILED_DIM_CHUNK}u) {
      for (var i = lane; i < ${qChunk}u; i = i + 256u) {
        let local_row = i / ${TILED_DIM_CHUNK}u;
        stage[i] = q_values[${row('q', queryOf('local_row'), 'head')} + chunk + i % ${TILED_DIM_CHUNK}u];
      }
      for (var i = lane; i < ${kChunk}u; i = i + 256u) {
        let token = tile_start + i / ${TILED_DIM_CHUNK}u;
        var value = 0.0;
        if (token < params.key_tokens) { value = k_values[${row('k', 'token', 'kv_head')} + chunk + i % ${TILED_DIM_CHUNK}u]; }
        stage[${qChunk}u + i] = value;
      }
      workgroupBarrier();
${range(TILED_DIM_CHUNK).map(kk => `      {
${R.map(r => `        let a${r} = stage[(ty * ${rowsPerThread}u + ${r}u) * ${TILED_DIM_CHUNK}u + ${kk}u];`).join('\n')}
${J.map(j => `        let b${j} = stage[${qChunk}u + (tx * ${keysPerThread}u + ${j}u) * ${TILED_DIM_CHUNK}u + ${kk}u];`).join('\n')}
${R.map(r => J.map(j => `        s${r}_${j} = s${r}_${j} + a${r} * b${j};`).join('\n')).join('\n')}
      }`).join('\n')}
      workgroupBarrier();
    }
    let tile_keys = min(${TILED_KEYS}u, params.key_tokens - tile_start);
${R.map(r => J.map(j => `    if (tx * ${keysPerThread}u + ${j}u < tile_keys) { s${r}_${j} = s${r}_${j} * params.scale; } else { s${r}_${j} = -3.402823e38; }
    score_tile[(ty * ${rowsPerThread}u + ${r}u) * ${TILED_KEYS}u + tx * ${keysPerThread}u + ${j}u] = s${r}_${j};`).join('\n')).join('\n')}
    workgroupBarrier();
${R.map(r => `    var tile_max${r} = m${r};
    for (var c = 0u; c < ${TILED_KEYS}u; c = c + 1u) { tile_max${r} = max(tile_max${r}, score_tile[(ty * ${rowsPerThread}u + ${r}u) * ${TILED_KEYS}u + c]); }`).join('\n')}
    workgroupBarrier();
${R.map(r => `    {
      let correction = exp(m${r} - tile_max${r});
      l${r} = l${r} * correction;
${E.map(e => `      o${r}_${e} = o${r}_${e} * correction;`).join('\n')}
${J.map(j => `      let p${j} = exp(s${r}_${j} - tile_max${r});
      l${r} = l${r} + p${j};
      score_tile[(ty * ${rowsPerThread}u + ${r}u) * ${TILED_KEYS}u + tx * ${keysPerThread}u + ${j}u] = p${j};`).join('\n')}
      m${r} = tile_max${r};
    }`).join('\n')}
    workgroupBarrier();
    for (var key_chunk = 0u; key_chunk < ${TILED_KEYS}u; key_chunk = key_chunk + ${valueKeys}u) {
      for (var i = lane; i < ${valueKeys * headDim}u; i = i + 256u) {
        let token = tile_start + key_chunk + i / ${headDim}u;
        var value = 0.0;
        if (token < params.key_tokens) { value = v_values[${row('v', 'token', 'kv_head')} + i % ${headDim}u]; }
        stage[i] = value;
      }
      workgroupBarrier();
${range(valueKeys).map(j => `      {
${R.map(r => `        let p${r} = score_tile[(ty * ${rowsPerThread}u + ${r}u) * ${TILED_KEYS}u + key_chunk + ${j}u];`).join('\n')}
${E.map(e => `        let v${e} = stage[${j * headDim}u + tx * ${dimsPerThread}u + ${e}u];`).join('\n')}
${R.map(r => E.map(e => `        o${r}_${e} = o${r}_${e} + p${r} * v${e};`).join('\n')).join('\n')}
      }`).join('\n')}
      workgroupBarrier();
    }
  }
${R.map(r => `  score_tile[(ty * ${rowsPerThread}u + ${r}u) * 16u + tx] = l${r};`).join('\n')}
  workgroupBarrier();
${R.map(r => `  {
    let local_query = group.x * ${TILED_QUERIES}u + ty * ${rowsPerThread}u + ${r}u;
    var total = 0.0;
    for (var c = 0u; c < 16u; c = c + 1u) { total = total + score_tile[(ty * ${rowsPerThread}u + ${r}u) * 16u + c]; }
    if (local_query < params.query_count) {
      let base = ${row('o', 'params.query_offset + local_query', 'head')} + tx * ${dimsPerThread}u;
      let inverse = 1.0 / total;
${E.map(e => `      out_values[base + ${e}u] = o${r}_${e} * inverse;`).join('\n')}
    }
  }`).join('\n')}
}
`;
}

// Strided params (24 words): counts, query range and scale, then offset/token/head/domain strides for q, k,
// v and out, in elements. Defaults describe packed token-major tensors; a domain stride defaults to the
// whole tensor domain. Vec4 head dims (multiples of 4) need every offset and stride to be a multiple of 4.
export function flashAttentionStridedParams({
  queryTokens, keyTokens, heads, kvHeads = heads, headDim, queryOffset = 0, queryCount = queryTokens - queryOffset,
  q = {}, k = {}, v = {}, out = {},
}) {
  if (heads % kvHeads !== 0) throw new Error('heads must be a multiple of kvHeads');
  if (!Number.isInteger(queryOffset) || !Number.isInteger(queryCount) || queryOffset < 0 || queryCount < 1 || queryOffset + queryCount > queryTokens) {
    throw new Error('query range must lie within queryTokens');
  }
  const tensor = (spec, tokens, headCount) => {
    const tokenStride = spec.tokenStride ?? headCount * headDim;
    const headStride = spec.headStride ?? headDim;
    const domainStride = spec.domainStride ?? Math.max(tokens * tokenStride, headCount * headStride);
    return [spec.offset ?? 0, tokenStride, headStride, domainStride];
  };
  const fields = [tensor(q, queryTokens, heads), tensor(k, keyTokens, kvHeads), tensor(v, keyTokens, kvHeads), tensor(out, queryTokens, heads)].flat();
  if (headDim % 4 === 0 && fields.some(value => value % 4 !== 0)) throw new Error('vec4 head dims need offsets and strides that are multiples of 4');
  if (fields.some(value => !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)) throw new Error('offsets and strides must be u32 integers');
  const words = new Uint32Array(24);
  words.set([queryTokens, keyTokens, heads, kvHeads, queryOffset, queryCount, 0, 0]);
  new Float32Array(words.buffer)[6] = 1 / Math.sqrt(headDim);
  words.set(fields, 8);
  return words;
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
