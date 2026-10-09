// WGSL for the FLUX.2 Klein transformer, parity-first.
//
// Residual streams and every intermediate stay f32: the reference's text
// stream reaches about 58,000 from double block 4 onward, too close to f16's
// 65,504 limit to store. Weights are f16 [out, in] with f32 accumulation.
// Shapes and strides travel in uniforms; only layout and epilogue choices are
// baked into shader text.

export const LN_EPS = 1e-6;

// C[b][m][n] = alpha * sum_k A[b][m][k] * B[b / b_div][n][k], A f32, B f16 or f32.
// b_div (uniform z0, 0 meaning 1) lets grouped-query attention share K/V heads.
// bType i8/i4 reads group-64 quantized weights (pack-transformer.py) with scales at
// f16 element offset z1 of binding 5; b_off is then a u32 word offset.
// Epilogues: 'store' writes C; 'gated-residual' does R[m][n] += gate[n] * value
// in place (R is the C binding); 'add' does C += value.
export function gemmShader({ bType = 'f16', epilogue = 'store' } = {}) {
  const quant = bType === 'i8' || bType === 'i4';
  const bArray = quant ? 'array<u32>' : bType === 'f16' ? 'array<f16>' : 'array<f32>';
  let loadB = 'bv = f32(b[p.b_off + bbat * p.b_bs + n * p.b_rs + k]);';
  if (bType === 'i8') {
    loadB = `let word = b[p.b_off + n * (p.K / 4u) + k / 4u];
        let q = i32(word << (24u - 8u * (k % 4u))) >> 24u;
        bv = f32(q) * f32(bs[p.z1 + n * (p.K / 64u) + k / 64u]);`;
  } else if (bType === 'i4') {
    loadB = `let word = b[p.b_off + n * (p.K / 8u) + k / 8u];
        let q = (word >> (4u * (k % 8u))) & 15u;
        let sb = p.z1 + (n * (p.K / 64u) + k / 64u) * 2u;
        bv = f32(q) * f32(bs[sb]) + f32(bs[sb + 1u]);`;
  }
  const scaleBinding = quant ? '@group(0) @binding(5) var<storage, read> bs: array<f16>;' : '';
  const gateBinding = epilogue === 'gated-residual' ? '@group(0) @binding(4) var<storage, read> gate: array<f32>;' : '';
  let store;
  if (epilogue === 'store') store = 'c[ci] = v;';
  else if (epilogue === 'add') store = 'c[ci] = c[ci] + v;';
  else store = 'c[ci] = c[ci] + gate[p.gate_off + n] * v;';
  return `${bType === 'f32' ? '' : 'enable f16;'}
struct P {
  M: u32, N: u32, K: u32, alpha: f32,
  a_off: u32, a_rs: u32, a_bs: u32, b_off: u32,
  b_rs: u32, b_bs: u32, c_off: u32, c_rs: u32,
  c_bs: u32, gate_off: u32, z0: u32, z1: u32,
};
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: ${bArray};
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${gateBinding}
${scaleBinding}
var<workgroup> ta: array<f32, 1024>;
var<workgroup> tb: array<f32, 1024>;
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let tid = lid.y * 16u + lid.x;
  let m0 = wid.y * 64u; let n0 = wid.x * 64u; let bat = wid.z; let bbat = bat / max(p.z0, 1u);
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < p.K; k0 += 16u) {
    for (var q = 0u; q < 4u; q++) {
      let idx = tid + q * 256u; let kk = idx % 16u; let rr = idx / 16u;
      let k = k0 + kk;
      let m = m0 + rr; var av = 0.0;
      if (m < p.M && k < p.K) { av = a[p.a_off + bat * p.a_bs + m * p.a_rs + k]; }
      ta[kk * 64u + rr] = av;
      let n = n0 + rr; var bv = 0.0;
      if (n < p.N && k < p.K) { ${loadB} }
      tb[kk * 64u + rr] = bv;
    }
    workgroupBarrier();
    for (var kk = 0u; kk < 16u; kk++) {
      var av: array<f32, 4>; var bv: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) { av[i] = ta[kk * 64u + lid.y * 4u + i]; }
      for (var j = 0u; j < 4u; j++) { bv[j] = tb[kk * 64u + lid.x * 4u + j]; }
      for (var i = 0u; i < 4u; i++) { for (var j = 0u; j < 4u; j++) { acc[i][j] = fma(av[i], bv[j], acc[i][j]); } }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let m = m0 + lid.y * 4u + i; if (m >= p.M) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let n = n0 + lid.x * 4u + j; if (n >= p.N) { continue; }
      let v = p.alpha * acc[i][j];
      let ci = p.c_off + bat * p.c_bs + m * p.c_rs + n;
      ${store}
    }
  }
}`;
}

// y[r][n] = (1 + scale[n]) * LayerNorm(x[r])[n] + shift[n] (no affine), one workgroup per row.
// Rows are read at x_off + r * x_rs and written at y_off + r * y_rs.
export function layerNormModulateShader() {
  return `struct P { rows: u32, D: u32, x_off: u32, x_rs: u32, y_off: u32, y_rs: u32, shift_off: u32, scale_off: u32, eps: f32, z0: u32, z1: u32, z2: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> mod_: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x; let t = lid.x;
  let base = p.x_off + r * p.x_rs;
  var s = 0.0;
  for (var i = t; i < p.D; i += 256u) { s += x[base + i]; }
  red[t] = s; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  let mean = red[0] / f32(p.D); workgroupBarrier();
  var v = 0.0;
  for (var i = t; i < p.D; i += 256u) { let d = x[base + i] - mean; v += d * d; }
  red[t] = v; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  let inv = inverseSqrt(red[0] / f32(p.D) + p.eps);
  for (var i = t; i < p.D; i += 256u) {
    let nrm = (x[base + i] - mean) * inv;
    y[p.y_off + r * p.y_rs + i] = (1.0 + mod_[p.scale_off + i]) * nrm + mod_[p.shift_off + i];
  }
}`;
}

// From a fused projection row [q | k | v] (each H*128 wide) produce head-major
// Q and K (RMSNorm per head with weight, then interleaved-pair RoPE) and V^T.
// Output row index = row_base + r so text and image tokens can share one buffer.
export function qkvPrepShader() {
  return `enable f16;
struct P { rows: u32, H: u32, L: u32, src_off: u32, src_rs: u32, row_base: u32, rope_base: u32, eps: f32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read> nq: array<f16>;
@group(0) @binding(2) var<storage, read> nk: array<f16>;
@group(0) @binding(3) var<storage, read> rope: array<f32>;
@group(0) @binding(4) var<storage, read_write> q: array<f32>;
@group(0) @binding(5) var<storage, read_write> k: array<f32>;
@group(0) @binding(6) var<storage, read_write> vt: array<f32>;
@group(0) @binding(7) var<uniform> p: P;
var<workgroup> red: array<f32, 128>;
var<workgroup> buf: array<f32, 128>;
fn rms(t: u32, val: f32) -> f32 {
  red[t] = val * val; workgroupBarrier();
  for (var w = 64u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  let inv = inverseSqrt(red[0] / 128.0 + p.eps); workgroupBarrier();
  return val * inv;
}
fn rope_apply(t: u32, val: f32, pos: u32) -> f32 {
  buf[t] = val; workgroupBarrier();
  let partner = buf[t ^ 1u];
  let rot = select(partner, -partner, (t & 1u) == 0u);
  let c = rope[(pos * 128u + t) * 2u]; let s = rope[(pos * 128u + t) * 2u + 1u];
  workgroupBarrier();
  return val * c + rot * s;
}
@compute @workgroup_size(128)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x; let h = wid.y; let t = lid.x;
  let D = p.H * 128u;
  let row = p.src_off + r * p.src_rs;
  let out_row = p.row_base + r;
  let pos = p.rope_base + r;
  let qv = rms(t, src[row + h * 128u + t]) * f32(nq[t]);
  q[(h * p.L + out_row) * 128u + t] = rope_apply(t, qv, pos);
  let kv = rms(t, src[row + D + h * 128u + t]) * f32(nk[t]);
  k[(h * p.L + out_row) * 128u + t] = rope_apply(t, kv, pos);
  vt[(h * 128u + t) * p.L + out_row] = src[row + 2u * D + h * 128u + t];
}`;
}

// In-place row softmax over N columns for rows*batches rows.
export function softmaxShader() {
  return `struct P { rows: u32, N: u32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read_write> s: array<f32>;
@group(0) @binding(1) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x + wid.y * 65535u; if (r >= p.rows) { return; }
  let t = lid.x; let base = r * p.N;
  var m = -3.4e38;
  for (var i = t; i < p.N; i += 256u) { m = max(m, s[base + i]); }
  red[t] = m; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] = max(red[t], red[t + w]); } workgroupBarrier(); }
  let mx = red[0]; workgroupBarrier();
  var sum = 0.0;
  for (var i = t; i < p.N; i += 256u) { let e = exp(s[base + i] - mx); s[base + i] = e; sum += e; }
  red[t] = sum; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  let inv = 1.0 / red[0];
  for (var i = t; i < p.N; i += 256u) { s[base + i] = s[base + i] * inv; }
}`;
}

// out[r][dst_off + j] = silu(x[r][src_off + j]) * x[r][src_off + F + j], j < F.
export function swigluShader() {
  return `struct P { rows: u32, F: u32, x_rs: u32, src_off: u32, y_rs: u32, dst_off: u32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x; let r = gid.y; if (j >= p.F || r >= p.rows) { return; }
  let g = x[r * p.x_rs + p.src_off + j]; let u = x[r * p.x_rs + p.src_off + p.F + j];
  y[r * p.y_rs + p.dst_off + j] = g / (1.0 + exp(-g)) * u;
}`;
}

// Attention output: from head-major O [H][L][128] to token-major rows at a column offset.
export function headsToRowsShader() {
  return `struct P { L: u32, H: u32, y_rs: u32, y_off: u32, row_begin: u32, rows: u32, dst_row0: u32, z0: u32 };
@group(0) @binding(0) var<storage, read> o: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(128)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x; let h = wid.y; let t = lid.x; if (r >= p.rows) { return; }
  y[(p.dst_row0 + r) * p.y_rs + p.y_off + h * 128u + t] = o[(h * p.L + p.row_begin + r) * 128u + t];
}`;
}

// Elementwise y = silu(x) (for modulation inputs), and the Euler update.
export function siluShader() {
  return `@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= arrayLength(&y)) { return; }
  let v = x[i]; y[i] = v / (1.0 + exp(-v));
}`;
}

// y[i] += alpha * x[i] for i < n.
export function axpyShader() {
  return `struct P { n: u32, alpha: f32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read_write> y: array<f32>;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= p.n) { return; }
  y[i] = y[i] + p.alpha * x[i];
}`;
}

// y[r] = weight * x[r] / sqrt(mean(x[r]^2) + eps), one workgroup per row (Qwen3RMSNorm).
export function rmsNormShader() {
  return `enable f16;
struct P { rows: u32, D: u32, w_off: u32, eps: f32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f16>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x; let t = lid.x; let base = r * p.D;
  var s = 0.0;
  for (var i = t; i < p.D; i += 256u) { let v = x[base + i]; s += v * v; }
  red[t] = s; workgroupBarrier();
  for (var w2 = 128u; w2 > 0u; w2 >>= 1u) { if (t < w2) { red[t] += red[t + w2]; } workgroupBarrier(); }
  let inv = inverseSqrt(red[0] / f32(p.D) + p.eps);
  for (var i = t; i < p.D; i += 256u) { y[base + i] = f32(w[p.w_off + i]) * (x[base + i] * inv); }
}`;
}

// Qwen3 attention prep from a fused [q | k | v] row: per-head RMSNorm on q and k,
// rotate-half RoPE from a [pos][128][cos, sin] table, head-major Q/K and V^T.
// Workgroup (r, h) handles query head h; heads h < KVH also write K and V for kv head h.
export function qwenQkvPrepShader() {
  return `enable f16;
struct P { L: u32, QH: u32, KVH: u32, qn_off: u32, kn_off: u32, eps: f32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f16>;
@group(0) @binding(2) var<storage, read> rope: array<f32>;
@group(0) @binding(3) var<storage, read_write> q: array<f32>;
@group(0) @binding(4) var<storage, read_write> k: array<f32>;
@group(0) @binding(5) var<storage, read_write> vt: array<f32>;
@group(0) @binding(6) var<uniform> p: P;
var<workgroup> red: array<f32, 128>;
var<workgroup> buf: array<f32, 128>;
fn normed(t: u32, val: f32, w_off: u32) -> f32 {
  red[t] = val * val; workgroupBarrier();
  for (var s = 64u; s > 0u; s >>= 1u) { if (t < s) { red[t] += red[t + s]; } workgroupBarrier(); }
  let inv = inverseSqrt(red[0] / 128.0 + p.eps); workgroupBarrier();
  return f32(w[w_off + t]) * (val * inv);
}
fn rotate(t: u32, val: f32, pos: u32) -> f32 {
  buf[t] = val; workgroupBarrier();
  let partner = buf[(t + 64u) % 128u];
  let rot = select(partner, -partner, t < 64u);
  workgroupBarrier();
  return val * rope[(pos * 128u + t) * 2u] + rot * rope[(pos * 128u + t) * 2u + 1u];
}
@compute @workgroup_size(128)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x; let h = wid.y; let t = lid.x;
  let rs = (p.QH + 2u * p.KVH) * 128u; let row = r * rs;
  q[(h * p.L + r) * 128u + t] = rotate(t, normed(t, src[row + h * 128u + t], p.qn_off), r);
  if (h < p.KVH) {
    let kbase = row + p.QH * 128u;
    k[(h * p.L + r) * 128u + t] = rotate(t, normed(t, src[kbase + h * 128u + t], p.kn_off), r);
    vt[(h * 128u + t) * p.L + r] = src[kbase + p.KVH * 128u + h * 128u + t];
  }
}`;
}

// Row softmax with a causal mask and a key padding mask: row r of head-major scores is
// query i = r % L; key j counts iff j <= i and mask[j] != 0.
export function maskedSoftmaxShader() {
  return `struct P { rows: u32, L: u32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read_write> s: array<f32>;
@group(0) @binding(1) var<storage, read> mask: array<i32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let r = wid.x + wid.y * 65535u; if (r >= p.rows) { return; }
  let t = lid.x; let base = r * p.L; let qi = r % p.L;
  var m = -3.4e38;
  for (var j = t; j < p.L; j += 256u) { if (j <= qi && mask[j] != 0) { m = max(m, s[base + j]); } }
  red[t] = m; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] = max(red[t], red[t + w]); } workgroupBarrier(); }
  let mx = red[0]; workgroupBarrier();
  var sum = 0.0;
  for (var j = t; j < p.L; j += 256u) {
    var e = 0.0;
    if (j <= qi && mask[j] != 0) { e = exp(s[base + j] - mx); }
    s[base + j] = e; sum += e;
  }
  red[t] = sum; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  let inv = 1.0 / red[0];
  for (var j = t; j < p.L; j += 256u) { s[base + j] = s[base + j] * inv; }
}`;
}

// y[r][y_off + c] = x[r][c] for c < cols (strided column copy).
export function copyColumnsShader() {
  return `struct P { rows: u32, cols: u32, y_rs: u32, y_off: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x; let r = gid.y; if (c >= p.cols || r >= p.rows) { return; }
  y[r * p.y_rs + p.y_off + c] = x[r * p.cols + c];
}`;
}

// GEMM v2: same contract and uniforms as gemmShader, restructured after the GEMM probe:
// vec4 loads along K for both operands, a K tile of 32, and a selectable shared-memory
// type (f32 keeps activations exact; f16 halves shared traffic). Requires K, row strides
// and offsets to be multiples of 4.
export function gemmShaderV2({ bType = 'f16', epilogue = 'store', sType = 'f32' } = {}) {
  const quant = bType === 'i8' || bType === 'i4';
  const bArray = quant ? 'array<u32>' : bType === 'f16' ? 'array<vec4<f16>>' : 'array<vec4<f32>>';
  const gateBinding = epilogue === 'gated-residual' ? '@group(0) @binding(4) var<storage, read> gate: array<f32>;' : '';
  const scaleBinding = quant ? '@group(0) @binding(5) var<storage, read> bs: array<f16>;' : '';
  let store;
  if (epilogue === 'store') store = 'c[ci] = v;';
  else if (epilogue === 'add') store = 'c[ci] = c[ci] + v;';
  else store = 'c[ci] = c[ci] + gate[p.gate_off + n] * v;';
  let loadB;
  if (!quant) {
    loadB = `for (var q = 0u; q < 2u; q++) {
      let idx = tid + q * 256u; let row = idx / 8u; let c4 = idx % 8u; let n = n0 + row; let k = k0 + c4 * 4u;
      var v = vec4<f32>(0.0);
      if (n < p.N && k < p.K) { v = vec4<f32>(b[(p.b_off + bbat * p.b_bs + n * p.b_rs + k) / 4u]); }
      for (var c = 0u; c < 4u; c++) { tb[(c4 * 4u + c) * 64u + row] = ${sType}(v[c]); }
    }`;
  } else if (bType === 'i8') {
    loadB = `for (var q = 0u; q < 2u; q++) {
      let idx = tid + q * 256u; let row = idx / 8u; let c4 = idx % 8u; let n = n0 + row; let k = k0 + c4 * 4u;
      var v = vec4<f32>(0.0);
      if (n < p.N && k < p.K) {
        v = vec4<f32>(unpack4xI8(b[p.b_off + n * (p.K / 4u) + k / 4u])) * f32(bs[p.z1 + n * (p.K / 64u) + k / 64u]);
      }
      for (var c = 0u; c < 4u; c++) { tb[(c4 * 4u + c) * 64u + row] = ${sType}(v[c]); }
    }`;
  } else {
    loadB = `{
      let row = tid / 4u; let c8 = tid % 4u; let n = n0 + row; let k = k0 + c8 * 8u;
      var lo = vec4<f32>(0.0); var hi = vec4<f32>(0.0);
      if (n < p.N && k < p.K) {
        let w = b[p.b_off + n * (p.K / 8u) + k / 8u];
        let sb = p.z1 + (n * (p.K / 64u) + k / 64u) * 2u;
        let sc = f32(bs[sb]); let bi = f32(bs[sb + 1u]);
        lo = vec4<f32>(vec4<u32>(w, w >> 4u, w >> 8u, w >> 12u) & vec4<u32>(15u)) * sc + bi;
        hi = vec4<f32>(vec4<u32>(w >> 16u, w >> 20u, w >> 24u, w >> 28u) & vec4<u32>(15u)) * sc + bi;
      }
      for (var c = 0u; c < 4u; c++) {
        tb[(c8 * 8u + c) * 64u + row] = ${sType}(lo[c]);
        tb[(c8 * 8u + 4u + c) * 64u + row] = ${sType}(hi[c]);
      }
    }`;
  }
  return `enable f16;
struct P {
  M: u32, N: u32, K: u32, alpha: f32,
  a_off: u32, a_rs: u32, a_bs: u32, b_off: u32,
  b_rs: u32, b_bs: u32, c_off: u32, c_rs: u32,
  c_bs: u32, gate_off: u32, z0: u32, z1: u32,
};
@group(0) @binding(0) var<storage, read> a: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> b: ${bArray};
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${gateBinding}
${scaleBinding}
var<workgroup> ta: array<${sType}, 2048>;
var<workgroup> tb: array<${sType}, 2048>;
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let tid = lid.y * 16u + lid.x;
  let m0 = wid.y * 64u; let n0 = wid.x * 64u; let bat = wid.z; let bbat = bat / max(p.z0, 1u);
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < p.K; k0 += 32u) {
    for (var q = 0u; q < 2u; q++) {
      let idx = tid + q * 256u; let row = idx / 8u; let c4 = idx % 8u; let m = m0 + row; let k = k0 + c4 * 4u;
      var v = vec4<f32>(0.0);
      if (m < p.M && k < p.K) { v = a[(p.a_off + bat * p.a_bs + m * p.a_rs + k) / 4u]; }
      for (var cc = 0u; cc < 4u; cc++) { ta[(c4 * 4u + cc) * 64u + row] = ${sType}(v[cc]); }
    }
    ${loadB}
    workgroupBarrier();
    for (var kk = 0u; kk < 32u; kk++) {
      var av: array<f32, 4>; var bv: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) { av[i] = f32(ta[kk * 64u + lid.y * 4u + i]); }
      for (var j = 0u; j < 4u; j++) { bv[j] = f32(tb[kk * 64u + lid.x * 4u + j]); }
      for (var i = 0u; i < 4u; i++) { for (var j = 0u; j < 4u; j++) { acc[i][j] = fma(av[i], bv[j], acc[i][j]); } }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let m = m0 + lid.y * 4u + i; if (m >= p.M) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let n = n0 + lid.x * 4u + j; if (n >= p.N) { continue; }
      let v = p.alpha * acc[i][j];
      let ci = p.c_off + bat * p.c_bs + m * p.c_rs + n;
      ${store}
    }
  }
}`;
}
