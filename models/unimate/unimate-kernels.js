// WGSL kernels for the UniMate denoiser. All arithmetic is f32. Each kernel
// reads its sizes from a uniform block whose fields are u32 unless noted.

// erf from Numerical Recipes' erfc Chebyshev fit (fractional error < 1.2e-7),
// shared by the exact (erf) GELU that torch.nn.GELU() computes.
export const ERF_FNS = /* wgsl */`
fn erfc_nr(x: f32) -> f32 {
  let z = abs(x);
  let t = 1.0 / (1.0 + 0.5 * z);
  let r = t * exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return select(2.0 - r, r, x >= 0.0);
}
fn gelu_erf(x: f32) -> f32 { return 0.5 * x * (2.0 - erfc_nr(x * 0.70710678118654752)); }`;

// Y[M,N] = act(X[M,K] · W[N,K]^T + b). W is in PyTorch [out, in] layout.
// flags: bit0 = has bias, bits1..2 = activation (0 none, 1 silu, 2 gelu-erf).
export const LINEAR = /* wgsl */`
struct P { M: u32, N: u32, K: u32, flags: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read> W: array<f32>;
@group(0) @binding(2) var<storage, read> Bv: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> As: array<array<f32, 17>, 64>;
var<workgroup> Bs: array<array<f32, 17>, 64>;
${ERF_FNS}
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let m0 = wg.y * 64u;
  let n0 = wg.x * 64u;
  let tid = l.y * 16u + l.x;
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < p.K; k0 += 16u) {
    for (var i = 0u; i < 4u; i++) {
      let e = tid + i * 256u;
      let r = e / 16u;
      let c = e % 16u;
      let gk = k0 + c;
      let gm = m0 + r;
      var a = 0.0;
      if (gm < p.M && gk < p.K) { a = X[gm * p.K + gk]; }
      As[r][c] = a;
      let gn = n0 + r;
      var b = 0.0;
      if (gn < p.N && gk < p.K) { b = W[gn * p.K + gk]; }
      Bs[r][c] = b;
    }
    workgroupBarrier();
    for (var kk = 0u; kk < 16u; kk++) {
      var a: array<f32, 4>;
      var b: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) { a[i] = As[l.y * 4u + i][kk]; b[i] = Bs[l.x * 4u + i][kk]; }
      for (var i = 0u; i < 4u; i++) {
        for (var j = 0u; j < 4u; j++) { acc[i][j] = fma(a[i], b[j], acc[i][j]); }
      }
    }
    workgroupBarrier();
  }
  let act = (p.flags >> 1u) & 3u;
  for (var i = 0u; i < 4u; i++) {
    let m = m0 + l.y * 4u + i;
    if (m >= p.M) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let n = n0 + l.x * 4u + j;
      if (n >= p.N) { continue; }
      var v = acc[i][j];
      if ((p.flags & 1u) != 0u) { v = v + Bv[n]; }
      if (act == 1u) { v = v / (1.0 + exp(-v)); }
      if (act == 2u) { v = gelu_erf(v); }
      Y[m * p.N + n] = v;
    }
  }
}`;

// Row RMSNorm (LlamaRMSNorm, eps from params) times weight, optionally
// followed by adaLN modulation y * (1 + scale[b]) + shift[b], where b is the
// batch row of the token row and shift/scale come from a [B, modStride] buffer.
// One workgroup per row.
export const RMSNORM_MOD = /* wgsl */`
struct P { rows: u32, C: u32, rowsPerBatch: u32, flags: u32, modStride: u32, shiftOff: u32, scaleOff: u32, eps: f32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read> Wn: array<f32>;
@group(0) @binding(2) var<storage, read> Mod: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> partial: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let row = wg.x + wg.y * 65535u;
  if (row >= p.rows) { return; }
  let base = row * p.C;
  var s = 0.0;
  for (var c = l.x; c < p.C; c += 256u) { let v = X[base + c]; s = fma(v, v, s); }
  partial[l.x] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (l.x < w) { partial[l.x] += partial[l.x + w]; }
    workgroupBarrier();
  }
  let inv = inverseSqrt(partial[0] / f32(p.C) + p.eps);
  let b = row / p.rowsPerBatch;
  for (var c = l.x; c < p.C; c += 256u) {
    var v = Wn[c] * (X[base + c] * inv);
    if ((p.flags & 1u) != 0u) {
      let mb = b * p.modStride;
      v = v * (1.0 + Mod[mb + p.scaleOff + c]) + Mod[mb + p.shiftOff + c];
    }
    Y[base + c] = v;
  }
}`;

// In place on a [rows, 3*H*D] qkv buffer: RMSNorm each head of q and k over D
// (weights qn, kn), then rotate with a cos/sin table row. mode 0 (spatial):
// table row = b * J + j; mode 1 (temporal): table row = f. Rows are ordered
// (b, f, j). One workgroup of D threads per (row, head).
export const QK_PREP = /* wgsl */`
struct P { rows: u32, H: u32, D: u32, mode: u32, F1: u32, J: u32, eps: f32, pad: u32 };
@group(0) @binding(0) var<storage, read_write> QKV: array<f32>;
@group(0) @binding(1) var<storage, read> QN: array<f32>;
@group(0) @binding(2) var<storage, read> KN: array<f32>;
@group(0) @binding(3) var<storage, read> COS: array<f32>;
@group(0) @binding(4) var<storage, read> SIN: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
var<workgroup> v: array<f32, 128>;
var<workgroup> red: array<f32, 128>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let row = wg.y;
  let h = wg.x;
  if (row >= p.rows) { return; }
  let D = p.D;
  let hf = D / 2u;
  let j = row % p.J;
  let f = (row / p.J) % p.F1;
  let b = row / (p.J * p.F1);
  var trow = f;
  if (p.mode == 0u) { trow = b * p.J + j; }
  for (var which = 0u; which < 2u; which++) {
    let base = row * 3u * p.H * D + which * p.H * D + h * D;
    for (var d = l.x; d < D; d += 64u) { v[d] = QKV[base + d]; }
    workgroupBarrier();
    var s = 0.0;
    for (var d = l.x; d < D; d += 64u) { s = fma(v[d], v[d], s); }
    red[l.x] = s;
    workgroupBarrier();
    for (var w = 32u; w > 0u; w >>= 1u) {
      if (l.x < w) { red[l.x] += red[l.x + w]; }
      workgroupBarrier();
    }
    let inv = inverseSqrt(red[0] / f32(D) + p.eps);
    workgroupBarrier();
    for (var d = l.x; d < D; d += 64u) {
      var g = KN[d];
      if (which == 0u) { g = QN[d]; }
      v[d] = g * (v[d] * inv);
    }
    workgroupBarrier();
    for (var d = l.x; d < D; d += 64u) {
      var rot = 0.0;
      if (d < hf) { rot = -v[d + hf]; } else { rot = v[d - hf]; }
      QKV[base + d] = v[d] * COS[trow * D + d] + rot * SIN[trow * D + d];
    }
    workgroupBarrier();
  }
}`;

// Spatial self-attention per (b, f) over J joints with a per-(b, head) graph
// bias [B, H, J, J]. qkv rows ordered (b, f, j); output [rows, H*D].
export const ATTN_SPATIAL = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, H: u32, D: u32, scale: f32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> QKV: array<f32>;
@group(0) @binding(1) var<storage, read> BIAS: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x + gid.y * 65535u * 64u;
  let total = p.B * p.F1 * p.H * p.J;
  if (idx >= total) { return; }
  let i = idx % p.J;
  let h = (idx / p.J) % p.H;
  let bf = idx / (p.J * p.H);
  let b = bf / p.F1;
  let C3 = 3u * p.H * p.D;
  let qb = (bf * p.J + i) * C3 + h * p.D;
  var m = -3.0e38;
  for (var j = 0u; j < p.J; j++) {
    let kb = (bf * p.J + j) * C3 + p.H * p.D + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(QKV[qb + d], QKV[kb + d], s); }
    s = s * p.scale + BIAS[((b * p.H + h) * p.J + i) * p.J + j];
    m = max(m, s);
  }
  var acc: array<f32, 128>;
  var den = 0.0;
  for (var j = 0u; j < p.J; j++) {
    let kb = (bf * p.J + j) * C3 + p.H * p.D + h * p.D;
    let vb = (bf * p.J + j) * C3 + 2u * p.H * p.D + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(QKV[qb + d], QKV[kb + d], s); }
    s = s * p.scale + BIAS[((b * p.H + h) * p.J + i) * p.J + j];
    let e = exp(s - m);
    den += e;
    for (var d = 0u; d < p.D; d++) { acc[d] = fma(e, QKV[vb + d], acc[d]); }
  }
  let ob = (bf * p.J + i) * p.H * p.D + h * p.D;
  for (var d = 0u; d < p.D; d++) { O[ob + d] = acc[d] / den; }
}`;

// Temporal self-attention per (b, j) over frames, keys masked beyond each
// batch row's valid length (motion_length + 1 prefix frame).
export const ATTN_TEMPORAL = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, H: u32, D: u32, scale: f32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> QKV: array<f32>;
@group(0) @binding(1) var<storage, read> LEN: array<u32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x + gid.y * 65535u * 64u;
  let total = p.B * p.J * p.H * p.F1;
  if (idx >= total) { return; }
  let i = idx % p.F1;
  let h = (idx / p.F1) % p.H;
  let j = (idx / (p.F1 * p.H)) % p.J;
  let b = idx / (p.F1 * p.H * p.J);
  let L = min(LEN[b], p.F1);
  let C3 = 3u * p.H * p.D;
  let qb = ((b * p.F1 + i) * p.J + j) * C3 + h * p.D;
  var m = -3.0e38;
  for (var f = 0u; f < L; f++) {
    let kb = ((b * p.F1 + f) * p.J + j) * C3 + p.H * p.D + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(QKV[qb + d], QKV[kb + d], s); }
    m = max(m, s * p.scale);
  }
  var acc: array<f32, 128>;
  var den = 0.0;
  for (var f = 0u; f < L; f++) {
    let kb = ((b * p.F1 + f) * p.J + j) * C3 + p.H * p.D + h * p.D;
    let vb = ((b * p.F1 + f) * p.J + j) * C3 + 2u * p.H * p.D + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(QKV[qb + d], QKV[kb + d], s); }
    let e = exp(s * p.scale - m);
    den += e;
    for (var d = 0u; d < p.D; d++) { acc[d] = fma(e, QKV[vb + d], acc[d]); }
  }
  let ob = ((b * p.F1 + i) * p.J + j) * p.H * p.D + h * p.D;
  for (var d = 0u; d < p.D; d++) { O[ob + d] = acc[d] / den; }
}`;

// Cross-attention for nn.MultiheadAttention-style modules. Groups g each have
// nQ queries and nK keys. Q rows are g*nQ+qi, or qi when qShared != 0; K and V
// rows are g*nK+k. Q, K, V are separate [rows, H*D] buffers; output [G*nQ, H*D].
export const ATTN_CROSS = /* wgsl */`
struct P { G: u32, nQ: u32, nK: u32, H: u32, D: u32, qShared: u32, scale: f32, pad: u32 };
@group(0) @binding(0) var<storage, read> Q: array<f32>;
@group(0) @binding(1) var<storage, read> K: array<f32>;
@group(0) @binding(2) var<storage, read> V: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let total = p.G * p.nQ * p.H;
  if (idx >= total) { return; }
  let h = idx % p.H;
  let qi = (idx / p.H) % p.nQ;
  let g = idx / (p.H * p.nQ);
  let C = p.H * p.D;
  var qrow = g * p.nQ + qi;
  if (p.qShared != 0u) { qrow = qi; }
  let qb = qrow * C + h * p.D;
  var m = -3.0e38;
  for (var k = 0u; k < p.nK; k++) {
    let kb = (g * p.nK + k) * C + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(Q[qb + d], K[kb + d], s); }
    m = max(m, s * p.scale);
  }
  var acc: array<f32, 128>;
  var den = 0.0;
  for (var k = 0u; k < p.nK; k++) {
    let kb = (g * p.nK + k) * C + h * p.D;
    var s = 0.0;
    for (var d = 0u; d < p.D; d++) { s = fma(Q[qb + d], K[kb + d], s); }
    let e = exp(s * p.scale - m);
    den += e;
    for (var d = 0u; d < p.D; d++) { acc[d] = fma(e, V[kb + d], acc[d]); }
  }
  let ob = (g * p.nQ + qi) * C + h * p.D;
  for (var d = 0u; d < p.D; d++) { O[ob + d] = acc[d] / den; }
}`;

// X[r, c] += gate[b, c] * Yv[r, c], gate read from a [B, modStride] buffer.
// With modStride == 0 the gate is 1 (plain residual add).
export const RESIDUAL = /* wgsl */`
struct P { n: u32, C: u32, rowsPerBatch: u32, modStride: u32, gateOff: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<storage, read_write> X: array<f32>;
@group(0) @binding(1) var<storage, read> Yv: array<f32>;
@group(0) @binding(2) var<storage, read> Mod: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.n) { return; }
  if (p.modStride == 0u) { X[i] = X[i] + Yv[i]; return; }
  let c = i % p.C;
  let b = (i / p.C) / p.rowsPerBatch;
  X[i] = X[i] + Mod[b * p.modStride + p.gateOff + c] * Yv[i];
}`;

// SwiGLU combine: out[r, c] = silu(U[r, c]) * U[r, Hd + c] for c < Hd.
export const SWIGLU = /* wgsl */`
struct P { rows: u32, Hd: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> U: array<f32>;
@group(0) @binding(1) var<storage, read_write> O: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.rows * p.Hd) { return; }
  let r = i / p.Hd;
  let c = i % p.Hd;
  let a = U[r * 2u * p.Hd + c];
  O[i] = (a / (1.0 + exp(-a))) * U[r * 2u * p.Hd + p.Hd + c];
}`;

// Elementwise: op 0 silu(A), 1 A + B, 2 A + B + C, 3 copy, 4 scale A by s
// (f32 bit pattern in sBits), 5 A * s + B * t (sBits, tBits).
export const ELEMENTWISE = /* wgsl */`
struct P { n: u32, op: u32, sBits: u32, tBits: u32 };
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> Bb: array<f32>;
@group(0) @binding(2) var<storage, read> Cc: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.n) { return; }
  let a = A[i];
  if (p.op == 0u) { O[i] = a / (1.0 + exp(-a)); return; }
  if (p.op == 1u) { O[i] = a + Bb[i]; return; }
  if (p.op == 2u) { O[i] = a + Bb[i] + Cc[i]; return; }
  if (p.op == 3u) { O[i] = a; return; }
  if (p.op == 4u) { O[i] = a * bitcast<f32>(p.sBits); return; }
  O[i] = a * bitcast<f32>(p.sBits) + Bb[i] * bitcast<f32>(p.tBits);
}`;

// Row gather: O[r, :] = T[IDX[r], :] for an embedding table [V, C].
export const GATHER_ROWS = /* wgsl */`
struct P { rows: u32, C: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> T: array<f32>;
@group(0) @binding(1) var<storage, read> IDX: array<u32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.rows * p.C) { return; }
  let r = i / p.C;
  O[i] = T[IDX[r] * p.C + (i % p.C)];
}`;

// Motion state [B, J, Fe, T] -> root rows [B*T, Fe] and joint rows
// [B*T*(J-1), Fe], ordered (b, t, j).
export const SPLIT_MOTION = /* wgsl */`
struct P { B: u32, J: u32, Fe: u32, T: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> R: array<f32>;
@group(0) @binding(2) var<storage, read_write> Jt: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.B * p.J * p.Fe * p.T) { return; }
  let t = i % p.T;
  let d = (i / p.T) % p.Fe;
  let j = (i / (p.T * p.Fe)) % p.J;
  let b = i / (p.T * p.Fe * p.J);
  let v = X[i];
  if (j == 0u) { R[(b * p.T + t) * p.Fe + d] = v; }
  else { Jt[((b * p.T + t) * (p.J - 1u) + (j - 1u)) * p.Fe + d] = v; }
}`;

// Token assembly [B, F1, J, C]: frame 0 = tpos embedding [B, J, C]; frame
// f >= 1 = root embedding (j == 0, rows (b, f-1)) or joint embedding (rows
// (b, f-1, j-1)).
export const ASSEMBLE_TOKENS = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, C: u32 };
@group(0) @binding(0) var<storage, read> TP: array<f32>;
@group(0) @binding(1) var<storage, read> RE: array<f32>;
@group(0) @binding(2) var<storage, read> JE: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.B * p.F1 * p.J * p.C) { return; }
  let c = i % p.C;
  let j = (i / p.C) % p.J;
  let f = (i / (p.C * p.J)) % p.F1;
  let b = i / (p.C * p.J * p.F1);
  let T = p.F1 - 1u;
  if (f == 0u) { O[i] = TP[(b * p.J + j) * p.C + c]; return; }
  if (j == 0u) { O[i] = RE[(b * T + f - 1u) * p.C + c]; return; }
  O[i] = JE[((b * T + f - 1u) * (p.J - 1u) + j - 1u) * p.C + c];
}`;

// X[b, f, j, c] += A[b, j, c] (per-joint token embeddings over every frame).
export const ADD_PER_JOINT = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, C: u32 };
@group(0) @binding(0) var<storage, read_write> X: array<f32>;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.B * p.F1 * p.J * p.C) { return; }
  let c = i % p.C;
  let j = (i / p.C) % p.J;
  let b = i / (p.C * p.J * p.F1);
  X[i] = X[i] + A[(b * p.J + j) * p.C + c];
}`;

// Token rows [B, F1, J, C] -> root rows [B*F1, C] and joint rows
// [B*F1*(J-1), C].
export const SPLIT_TOKENS = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, C: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> R: array<f32>;
@group(0) @binding(2) var<storage, read_write> Jt: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.B * p.F1 * p.J * p.C) { return; }
  let c = i % p.C;
  let j = (i / p.C) % p.J;
  let bf = i / (p.C * p.J);
  if (j == 0u) { R[bf * p.C + c] = X[i]; }
  else { Jt[(bf * (p.J - 1u) + j - 1u) * p.C + c] = X[i]; }
}`;

// Output assembly: root rows [B*F1, Fe] and joint rows [B*F1*(J-1), Fe] ->
// motion layout [B, J, Fe, F1-1], dropping the prefix frame.
export const ASSEMBLE_OUTPUT = /* wgsl */`
struct P { B: u32, F1: u32, J: u32, Fe: u32 };
@group(0) @binding(0) var<storage, read> R: array<f32>;
@group(0) @binding(1) var<storage, read> Jt: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let T = p.F1 - 1u;
  let i = gid.x;
  if (i >= p.B * p.J * p.Fe * T) { return; }
  let t = i % T;
  let d = (i / T) % p.Fe;
  let j = (i / (T * p.Fe)) % p.J;
  let b = i / (T * p.Fe * p.J);
  let bf = b * p.F1 + t + 1u;
  if (j == 0u) { O[i] = R[bf * p.Fe + d]; }
  else { O[i] = Jt[(bf * (p.J - 1u) + j - 1u) * p.Fe + d]; }
}`;

// Mean over groups of n consecutive rows: O[g, c] = mean_k A[g*n + k, c].
export const MEAN_ROWS = /* wgsl */`
struct P { G: u32, n: u32, C: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read_write> O: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.G * p.C) { return; }
  let g = i / p.C;
  let c = i % p.C;
  var s = 0.0;
  for (var k = 0u; k < p.n; k++) { s += A[(g * p.n + k) * p.C + c]; }
  O[i] = s / f32(p.n);
}`;

// Graph bias for one block: BIAS[b, h, i, j] = Dp[(b,i,j), h] * sd + Rp[(b,i,j), h] * sr,
// where Dp/Rp are [B*J*J, H] projections and sd/sr are 1-element scale buffers.
export const GRAPH_BIAS = /* wgsl */`
struct P { B: u32, J: u32, H: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> Dp: array<f32>;
@group(0) @binding(1) var<storage, read> Rp: array<f32>;
@group(0) @binding(2) var<storage, read> SD: array<f32>;
@group(0) @binding(3) var<storage, read> SR: array<f32>;
@group(0) @binding(4) var<storage, read_write> O: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.B * p.H * p.J * p.J) { return; }
  let j = i % p.J;
  let ii = (i / p.J) % p.J;
  let h = (i / (p.J * p.J)) % p.H;
  let b = i / (p.J * p.J * p.H);
  let r = (b * p.J + ii) * p.J + j;
  O[i] = Dp[r * p.H + h] * SD[0] + Rp[r * p.H + h] * SR[0];
}`;

// cos/sin table [rows, 2*A] from angles [rows, A]: table = cat(angles, angles).
export const ROPE_FROM_ANGLES = /* wgsl */`
struct P { rows: u32, A: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> ANG: array<f32>;
@group(0) @binding(1) var<storage, read_write> COS: array<f32>;
@group(0) @binding(2) var<storage, read_write> SIN: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.rows * 2u * p.A) { return; }
  let r = i / (2u * p.A);
  let c = i % (2u * p.A);
  let a = ANG[r * p.A + (c % p.A)];
  COS[i] = cos(a);
  SIN[i] = sin(a);
}`;

// Column concat: O[r, :] = [A[r, 0:C1], B[r, 0:C2]].
export const CONCAT_COLS = /* wgsl */`
struct P { rows: u32, C1: u32, C2: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> Bb: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let C = p.C1 + p.C2;
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.rows * C) { return; }
  let r = i / C;
  let c = i % C;
  if (c < p.C1) { O[i] = A[r * p.C1 + c]; } else { O[i] = Bb[r * p.C2 + c - p.C1]; }
}`;

// [G, J, C] from root rows [G, C] (j == 0) and joint rows [G*(J-1), C].
export const MERGE_ROOT_JOINT = /* wgsl */`
struct P { G: u32, J: u32, C: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> R: array<f32>;
@group(0) @binding(1) var<storage, read> Jt: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= p.G * p.J * p.C) { return; }
  let c = i % p.C;
  let j = (i / p.C) % p.J;
  let g = i / (p.C * p.J);
  if (j == 0u) { O[i] = R[g * p.C + c]; } else { O[i] = Jt[(g * (p.J - 1u) + j - 1u) * p.C + c]; }
}`;
