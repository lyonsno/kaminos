// WGSL GEMM variants for the FLUX.2 Klein throughput probe.
//
// Every kernel computes Y[M,N] = X[M,K] * W[N,K]^T (PyTorch Linear layout,
// K contiguous for both operands) with f16 activations, f16 output and f32
// accumulation unless the variant says otherwise. Weight storage differs:
//   f16   W as f16
//   i8    W as signed int8, four per u32, one f16 scale per 64-element K group
//   i4    W as unsigned int4, eight per u32, f16 scale and bias per 64-element
//         K group (MLX-style affine: w = q * scale + bias)
//   sgmat W as f16, subgroup-matrix (simdgroup) 8x8x8 multiply with f16
//         accumulation; requires chromium-experimental-subgroup-matrix.

export const GROUP = 64;

function tiledGemm({ name, bm, bn, bk, weight }) {
  const tm = bm / 16, tn = bn / 16;
  const loadsA = (bm * bk) / 4 / 256;         // vec4<f16> loads per thread
  const header = `enable f16;
struct P { M:u32, N:u32, K:u32, groups:u32 };
@group(0) @binding(0) var<storage, read> X: array<vec4<f16>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f16>;
@group(0) @binding(3) var<uniform> p: P;
`;
  let weightDecl, loadB;
  if (weight === 'f16') {
    weightDecl = '@group(0) @binding(1) var<storage, read> W: array<vec4<f16>>;\n';
    const loadsB = (bn * bk) / 4 / 256;
    loadB = `for (var q = 0u; q < ${loadsB}u; q++) {
      let idx = tid + q * 256u; let row = idx / ${bk / 4}u; let c4 = idx % ${bk / 4}u;
      let n = n0 + row; var v = vec4<f16>(0.0);
      if (n < p.N) { v = W[n * (p.K / 4u) + k0 / 4u + c4]; }
      for (var c = 0u; c < 4u; c++) { Bs[(c4 * 4u + c) * ${bn}u + row] = v[c]; }
    }`;
  } else if (weight === 'i8') {
    weightDecl = `@group(0) @binding(1) var<storage, read> W: array<u32>;
@group(0) @binding(4) var<storage, read> S: array<f16>;
`;
    const loadsB = (bn * bk) / 4 / 256;
    loadB = `for (var q = 0u; q < ${loadsB}u; q++) {
      let idx = tid + q * 256u; let row = idx / ${bk / 4}u; let c4 = idx % ${bk / 4}u;
      let n = n0 + row; var v = vec4<f16>(0.0);
      if (n < p.N) {
        let k = k0 + c4 * 4u;
        let s = S[n * p.groups + k / ${GROUP}u];
        v = vec4<f16>(unpack4xI8(W[n * (p.K / 4u) + k / 4u])) * s;
      }
      for (var c = 0u; c < 4u; c++) { Bs[(c4 * 4u + c) * ${bn}u + row] = v[c]; }
    }`;
  } else if (weight === 'i4') {
    weightDecl = `@group(0) @binding(1) var<storage, read> W: array<u32>;
@group(0) @binding(4) var<storage, read> S: array<vec2<f16>>;
`;
    const loadsB = (bn * bk) / 8 / 256;
    if (!Number.isInteger(loadsB) || loadsB < 1) throw new Error(`${name}: i4 tile too small`);
    loadB = `for (var q = 0u; q < ${loadsB}u; q++) {
      let idx = tid + q * 256u; let row = idx / ${bk / 8}u; let c8 = idx % ${bk / 8}u;
      let n = n0 + row;
      var lo = vec4<f16>(0.0); var hi = vec4<f16>(0.0);
      if (n < p.N) {
        let k = k0 + c8 * 8u;
        let sb = S[n * p.groups + k / ${GROUP}u];
        let w = W[n * (p.K / 8u) + k / 8u];
        let ql = vec4<u32>(w, w >> 4u, w >> 8u, w >> 12u) & vec4<u32>(15u);
        let qh = vec4<u32>(w >> 16u, w >> 20u, w >> 24u, w >> 28u) & vec4<u32>(15u);
        lo = vec4<f16>(ql) * sb.x + sb.y; hi = vec4<f16>(qh) * sb.x + sb.y;
      }
      for (var c = 0u; c < 4u; c++) {
        Bs[(c8 * 8u + c) * ${bn}u + row] = lo[c];
        Bs[(c8 * 8u + 4u + c) * ${bn}u + row] = hi[c];
      }
    }`;
  } else throw new Error(`unknown weight ${weight}`);

  const code = `${header}${weightDecl}
var<workgroup> As: array<f16, ${bk * bm}>;
var<workgroup> Bs: array<f16, ${bk * bn}>;
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let tid = lid.y * 16u + lid.x;
  let m0 = wid.y * ${bm}u; let n0 = wid.x * ${bn}u;
  var acc: array<array<f32, ${tn}>, ${tm}>;
  for (var k0 = 0u; k0 < p.K; k0 += ${bk}u) {
    for (var q = 0u; q < ${loadsA}u; q++) {
      let idx = tid + q * 256u; let row = idx / ${bk / 4}u; let c4 = idx % ${bk / 4}u;
      let m = m0 + row; var v = vec4<f16>(0.0);
      if (m < p.M) { v = X[m * (p.K / 4u) + k0 / 4u + c4]; }
      for (var c = 0u; c < 4u; c++) { As[(c4 * 4u + c) * ${bm}u + row] = v[c]; }
    }
    ${loadB}
    workgroupBarrier();
    for (var kk = 0u; kk < ${bk}u; kk++) {
      var a: array<f32, ${tm}>; var b: array<f32, ${tn}>;
      for (var i = 0u; i < ${tm}u; i++) { a[i] = f32(As[kk * ${bm}u + lid.y * ${tm}u + i]); }
      for (var j = 0u; j < ${tn}u; j++) { b[j] = f32(Bs[kk * ${bn}u + lid.x * ${tn}u + j]); }
      for (var i = 0u; i < ${tm}u; i++) { for (var j = 0u; j < ${tn}u; j++) { acc[i][j] = fma(a[i], b[j], acc[i][j]); } }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < ${tm}u; i++) {
    let m = m0 + lid.y * ${tm}u + i; if (m >= p.M) { continue; }
    for (var j = 0u; j < ${tn}u; j++) {
      let n = n0 + lid.x * ${tn}u + j; if (n >= p.N) { continue; }
      Y[m * p.N + n] = f16(acc[i][j]);
    }
  }
}`;
  return { name, code, weight, tileM: bm, tileN: bn, workgroupSize: 256, accumulate: 'f32' };
}

// One subgroup computes a 32x32 block as 4x4 tiles of 8x8; a 128-thread
// workgroup (4 subgroups) covers 64x64. Operands load straight from storage.
function subgroupMatrixGemm() {
  const code = `enable f16;
enable subgroups;
enable chromium_experimental_subgroup_matrix;
struct P { M:u32, N:u32, K:u32, groups:u32 };
@group(0) @binding(0) var<storage, read> X: array<f16>;
@group(0) @binding(1) var<storage, read> W: array<f16>;
@group(0) @binding(2) var<storage, read_write> Y: array<f16>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(subgroup_id) sg: u32) {
  let m0 = wid.y * 64u + (sg / 2u) * 32u;
  let n0 = wid.x * 64u + (sg % 2u) * 32u;
  var acc: array<subgroup_matrix_result<f16, 8, 8>, 16>;
  for (var k = 0u; k < p.K; k += 8u) {
    var a: array<subgroup_matrix_left<f16, 8, 8>, 4>;
    var b: array<subgroup_matrix_right<f16, 8, 8>, 4>;
    for (var i = 0u; i < 4u; i++) {
      a[i] = subgroupMatrixLoad<subgroup_matrix_left<f16, 8, 8>>(&X, (m0 + i * 8u) * p.K + k, false, p.K);
      b[i] = subgroupMatrixLoad<subgroup_matrix_right<f16, 8, 8>>(&W, (n0 + i * 8u) * p.K + k, true, p.K);
    }
    for (var i = 0u; i < 4u; i++) {
      for (var j = 0u; j < 4u; j++) {
        acc[i * 4u + j] = subgroupMatrixMultiplyAccumulate(a[i], b[j], acc[i * 4u + j]);
      }
    }
  }
  for (var i = 0u; i < 4u; i++) {
    for (var j = 0u; j < 4u; j++) {
      subgroupMatrixStore(&Y, (m0 + i * 8u) * p.N + n0 + j * 8u, acc[i * 4u + j], false, p.N);
    }
  }
}`;
  return { name: 'sgmat-f16-64x64', code, weight: 'f16-flat', tileM: 64, tileN: 64, workgroupSize: 128, alignedTiles: true,
    accumulate: 'f16', requiresFeature: 'chromium-experimental-subgroup-matrix' };
}

export function kernelVariants() {
  return [
    tiledGemm({ name: 'f16-64x64x32', bm: 64, bn: 64, bk: 32, weight: 'f16' }),
    tiledGemm({ name: 'f16-128x128x16', bm: 128, bn: 128, bk: 16, weight: 'f16' }),
    tiledGemm({ name: 'i8g64-64x64x32', bm: 64, bn: 64, bk: 32, weight: 'i8' }),
    tiledGemm({ name: 'i8g64-128x128x16', bm: 128, bn: 128, bk: 16, weight: 'i8' }),
    tiledGemm({ name: 'i4g64-64x64x32', bm: 64, bn: 64, bk: 32, weight: 'i4' }),
    tiledGemm({ name: 'i4g64-128x128x16', bm: 128, bn: 128, bk: 16, weight: 'i4' }),
    subgroupMatrixGemm(),
  ];
}
