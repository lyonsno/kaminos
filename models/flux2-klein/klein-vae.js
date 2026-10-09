// FLUX.2 VAE decoder on WebGPU (parity-first), channels-last f32 activations.
// Mirrors diffusers: Flux2KleinPipeline latent un-packing, batch-norm
// de-normalization and un-patchify, then AutoencoderKLFlux2 post_quant_conv
// and Decoder (conv_in, mid block with single-head attention, four up blocks,
// GroupNorm + SiLU, conv_out). Weights come from pack-vae.py.
import { gemmShader, softmaxShader } from './klein-kernels.js';

const GN_EPS = 1e-6;
const GROUPS = 32;

// Implicit-GEMM convolution: out[pix][cout] = bias[cout] + sum_k in(pix, k) * w[cout][k],
// k = tap * Cin + ci with taps 9 (3x3, pad 1) or 1 (1x1). `up` reads a 2x nearest-upsampled input.
function convShader(epilogue) {
  const store = epilogue === 'bias' ? 'c[ci] = v;' : 'c[ci] = c[ci] + v;';
  return `enable f16;
struct P { M: u32, N: u32, K: u32, Cin: u32, Hout: u32, Wout: u32, Hin: u32, Win: u32, taps: u32, w_off: u32, b_off: u32, up: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f16>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> ta: array<f32, 1024>;
var<workgroup> tb: array<f32, 1024>;
fn load_in(m: u32, k: u32) -> f32 {
  let oy = m / p.Wout; let ox = m % p.Wout;
  let tap = k / p.Cin; let ci = k % p.Cin;
  if (p.taps == 1u) { return x[m * p.Cin + ci]; }
  let iy = i32(oy) + i32(tap / 3u) - 1; let ix = i32(ox) + i32(tap % 3u) - 1;
  if (iy < 0 || ix < 0 || iy >= i32(p.Hout) || ix >= i32(p.Wout)) { return 0.0; }
  var sy = u32(iy); var sx = u32(ix);
  if (p.up == 1u) { sy = sy / 2u; sx = sx / 2u; }
  return x[(sy * p.Win + sx) * p.Cin + ci];
}
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let tid = lid.y * 16u + lid.x;
  let m0 = wid.y * 64u; let n0 = wid.x * 64u;
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < p.K; k0 += 16u) {
    for (var q = 0u; q < 4u; q++) {
      let idx = tid + q * 256u; let kk = idx % 16u; let rr = idx / 16u; let k = k0 + kk;
      let m = m0 + rr; var av = 0.0;
      if (m < p.M && k < p.K) { av = load_in(m, k); }
      ta[kk * 64u + rr] = av;
      let n = n0 + rr; var bv = 0.0;
      if (n < p.N && k < p.K) { bv = f32(w[p.w_off + n * p.K + k]); }
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
      let v = acc[i][j] + f32(w[p.b_off + n]);
      let ci = m * p.N + n;
      ${store}
    }
  }
}`;
}

// GroupNorm statistics over channels-last x [HW][C]: mode 0 sums values, mode 1 sums
// squared deviations from the finalized mean. One workgroup per (group, chunk).
const gnPartialShader = `struct P { HW: u32, C: u32, chunk: u32, chunks: u32, mode: u32, z0: u32, z1: u32, z2: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read_write> part: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let g = wid.x; let ch = wid.y; let t = lid.x;
  let cg = p.C / ${GROUPS}u; let p0 = ch * p.chunk; let p1 = min(p0 + p.chunk, p.HW);
  let mean = stats[g * 2u];
  var s = 0.0;
  for (var e = t; e < (p1 - p0) * cg; e += 256u) {
    let v = x[(p0 + e / cg) * p.C + g * cg + e % cg];
    if (p.mode == 0u) { s += v; } else { let d = v - mean; s += d * d; }
  }
  red[t] = s; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  if (t == 0u) { part[g * p.chunks + ch] = red[0]; }
}`;

const gnFinalizeShader = `struct P { HW: u32, C: u32, chunks: u32, mode: u32, eps: f32, z0: u32, z1: u32, z2: u32 };
@group(0) @binding(0) var<storage, read> part: array<f32>;
@group(0) @binding(1) var<storage, read_write> stats: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let g = wid.x; let t = lid.x;
  var s = 0.0;
  for (var i = t; i < p.chunks; i += 256u) { s += part[g * p.chunks + i]; }
  red[t] = s; workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) { if (t < w) { red[t] += red[t + w]; } workgroupBarrier(); }
  if (t == 0u) {
    let n = f32(p.HW * (p.C / ${GROUPS}u));
    if (p.mode == 0u) { stats[g * 2u] = red[0] / n; } else { stats[g * 2u + 1u] = inverseSqrt(red[0] / n + p.eps); }
  }
}`;

const gnApplyShader = `enable f16;
struct P { n: u32, C: u32, gamma_off: u32, beta_off: u32, silu: u32, z0: u32, z1: u32, z2: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f16>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * 65535u * 256u; if (i >= p.n) { return; }
  let c = i % p.C; let g = c / (p.C / ${GROUPS}u);
  var v = (x[i] - stats[g * 2u]) * stats[g * 2u + 1u] * f32(w[p.gamma_off + c]) + f32(w[p.beta_off + c]);
  if (p.silu == 1u) { v = v / (1.0 + exp(-v)); }
  y[i] = v;
}`;

// Packed transformer latents [h*w][128] -> de-normalized, un-patchified channels-last [2h*2w][32].
const latentPrepShader = `struct P { h: u32, w: u32, eps: f32, z0: u32 };
@group(0) @binding(0) var<storage, read> lat: array<f32>;
@group(0) @binding(1) var<storage, read> bn: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let W2 = p.w * 2u; if (i >= p.h * 2u * W2 * 32u) { return; }
  let c32 = i % 32u; let pix = i / 32u; let yy = pix / W2; let xx = pix % W2;
  let c = c32 * 4u + (yy % 2u) * 2u + (xx % 2u);
  let tok = (yy / 2u) * p.w + (xx / 2u);
  y[i] = lat[tok * 128u + c] * sqrt(bn[128u + c] + p.eps) + bn[c];
}`;

const transposeShader = `struct P { rows: u32, cols: u32, z0: u32, z1: u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x; let r = gid.y; if (r >= p.rows || c >= p.cols) { return; }
  y[c * p.rows + r] = x[r * p.cols + c];
}`;

export class KleinVaeDecoder {
  constructor(device, manifest) {
    this.device = device; this.manifest = manifest; this.pipelines = {}; this.uniformPool = [];
    this.tensors = Object.fromEntries(manifest.bundle.tensors.map(t => [t.name, t]));
  }

  async load(bytes) {
    this.wbuf = this.device.createBuffer({ size: Math.ceil(bytes.byteLength / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.wbuf, 0, bytes);
    const bnMean = this.tensors['bn.running_mean'], bnVar = this.tensors['bn.running_var'];
    this.bn = this.buffer(256 * 4);
    this.device.queue.writeBuffer(this.bn, 0, bytes, bnMean.offset, 512);
    this.device.queue.writeBuffer(this.bn, 512, bytes, bnVar.offset, 512);
  }

  pipeline(key, code) {
    if (!this.pipelines[key]) {
      this.pipelines[key] = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
    }
    return this.pipelines[key];
  }
  buffer(bytes) { return this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); }
  uniform(words) {
    const b = this.device.createBuffer({ size: Math.ceil(words.length * 4 / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, new Uint32Array(words)); this.uniformPool.push(b); return b;
  }
  f32bits(x) { return new Uint32Array(new Float32Array([x]).buffer)[0]; }
  dispatch(enc, pipe, buffers, x, y = 1, z = 1) {
    const bind = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(x, y, z); pass.end();
  }
  t(name) { const t = this.tensors[name]; if (!t) throw new Error(`missing VAE tensor ${name}`); return t; }

  conv(enc, x, out, name, { Hin, Win, Cin, up = false, epilogue = 'bias' }) {
    const wt = this.t(`${name}.weight`), bt = this.t(`${name}.bias`);
    const [Cout, K] = wt.shape; const taps = K / Cin;
    const Hout = up ? Hin * 2 : Hin, Wout = up ? Win * 2 : Win, M = Hout * Wout;
    const pipe = this.pipeline(`conv-${epilogue}`, convShader(epilogue));
    this.dispatch(enc, pipe, [x, this.wbuf, out, this.uniform([M, Cout, K, Cin, Hout, Wout, Hin, Win, taps, wt.offset / 2, bt.offset / 2, up ? 1 : 0])],
      Math.ceil(Cout / 64), Math.ceil(M / 64));
    return { H: Hout, W: Wout, C: Cout };
  }

  groupNorm(enc, x, y, name, { HW, C, silu }) {
    const chunk = 1024, chunks = Math.ceil(HW / chunk);
    const partial = this.pipeline('gn-partial', gnPartialShader), fin = this.pipeline('gn-finalize', gnFinalizeShader);
    for (const mode of [0, 1]) {
      this.dispatch(enc, partial, [x, this.gnStats, this.gnPart, this.uniform([HW, C, chunk, chunks, mode, 0, 0, 0])], GROUPS, chunks);
      this.dispatch(enc, fin, [this.gnPart, this.gnStats, this.uniform([HW, C, chunks, mode, this.f32bits(GN_EPS), 0, 0, 0])], GROUPS);
    }
    const n = HW * C, groups = Math.ceil(n / 256);
    this.dispatch(enc, this.pipeline('gn-apply', gnApplyShader), [x, this.gnStats, this.wbuf, y,
      this.uniform([n, C, this.t(`${name}.weight`).offset / 2, this.t(`${name}.bias`).offset / 2, silu ? 1 : 0, 0, 0, 0])],
      Math.min(groups, 65535), Math.ceil(groups / 65535));
  }

  copy(enc, src, dst, bytes) { enc.copyBufferToBuffer(src, 0, dst, 0, bytes); }

  resnet(enc, x, out, name, s, CoutNew) {
    const { H, W, C } = s; const HW = H * W; const Cout = CoutNew ?? C;
    this.groupNorm(enc, x, this.t1, `${name}.norm1`, { HW, C, silu: true });
    this.conv(enc, this.t1, this.t2, `${name}.conv1`, { Hin: H, Win: W, Cin: C });
    this.groupNorm(enc, this.t2, this.t1, `${name}.norm2`, { HW, C: Cout, silu: true });
    if (this.tensors[`${name}.conv_shortcut.weight`]) this.conv(enc, x, out, `${name}.conv_shortcut`, { Hin: H, Win: W, Cin: C });
    else this.copy(enc, x, out, HW * C * 4);
    this.conv(enc, this.t1, out, `${name}.conv2`, { Hin: H, Win: W, Cin: Cout, epilogue: 'bias-add' });
    return { H, W, C: Cout };
  }

  attention(enc, x, out, name, s) {
    const { H, W, C } = s; const L = H * W;
    this.groupNorm(enc, x, this.t1, `${name}.group_norm`, { HW: L, C, silu: false });
    this.conv(enc, this.t1, this.q, `${name}.to_q`, { Hin: H, Win: W, Cin: C });
    this.conv(enc, this.t1, this.k, `${name}.to_k`, { Hin: H, Win: W, Cin: C });
    this.conv(enc, this.t1, this.t2, `${name}.to_v`, { Hin: H, Win: W, Cin: C });
    this.dispatch(enc, this.pipeline('transpose', transposeShader), [this.t2, this.vt, this.uniform([L, C, 0, 0])], Math.ceil(C / 16), Math.ceil(L / 16));
    const g = this.pipeline('gemm-f32-store', gemmShader({ bType: 'f32', epilogue: 'store' }));
    this.dispatch(enc, g, [this.q, this.k, this.scores, this.uniform([L, L, C, this.f32bits(1 / Math.sqrt(C)), 0, C, 0, 0, C, 0, 0, L, 0, 0, 0, 0])], Math.ceil(L / 64), Math.ceil(L / 64));
    this.dispatch(enc, this.pipeline('softmax', softmaxShader()), [this.scores, this.uniform([L, L, 0, 0])], L);
    this.dispatch(enc, g, [this.scores, this.vt, this.t1, this.uniform([L, C, L, this.f32bits(1), 0, L, 0, 0, L, 0, 0, C, 0, 0, 0, 0])], Math.ceil(C / 64), Math.ceil(L / 64));
    this.copy(enc, x, out, L * C * 4);
    this.conv(enc, this.t1, out, `${name}.to_out.0`, { Hin: H, Win: W, Cin: C, epilogue: 'bias-add' });
    return s;
  }

  allocate(latH, latW) {
    // Largest activation: 256 channels at full resolution (up block 2 output).
    const H = latH * 16, W = latW * 16;
    const big = H * W * 256 * 4;
    this.a = this.buffer(big); this.b = this.buffer(big); this.t1 = this.buffer(big); this.t2 = this.buffer(big);
    const Lm = latH * 2 * latW * 2;
    this.q = this.buffer(Lm * 512 * 4); this.k = this.buffer(Lm * 512 * 4); this.vt = this.buffer(Lm * 512 * 4);
    this.scores = this.buffer(Lm * Lm * 4);
    this.gnPart = this.buffer(GROUPS * Math.ceil(H * W / 1024) * 4); this.gnStats = this.buffer(GROUPS * 2 * 4);
    this.latents = this.buffer(latH * latW * 128 * 4);
    this.latH = latH; this.latW = latW;
  }

  // Packed latents (GPU buffer [h*w][128]) -> decoder input [2h*2w][32] in this.prepped.
  prepLatents(enc, packed) {
    const n = this.latH * 2 * this.latW * 2 * 32;
    this.prepped ??= this.buffer(n * 4);
    this.dispatch(enc, this.pipeline('latent-prep', latentPrepShader), [packed, this.bn, this.prepped,
      this.uniform([this.latH, this.latW, this.f32bits(this.manifest.config.batch_norm_eps), 0])], Math.ceil(n / 256));
  }

  // Decode channels-last latents [2h*2w][32] (GPU buffer) to channels-last RGB [H*W][3] in this.b.
  decode(enc, z) {
    let s = { H: this.latH * 2, W: this.latW * 2, C: 32 };
    this.conv(enc, z, this.t2, 'post_quant_conv', { Hin: s.H, Win: s.W, Cin: 32 });
    s = this.conv(enc, this.t2, this.a, 'decoder.conv_in', { Hin: s.H, Win: s.W, Cin: 32 });
    let cur = this.a, other = this.b;
    const swap = () => { [cur, other] = [other, cur]; };
    s = this.resnet(enc, cur, other, 'decoder.mid_block.resnets.0', s); swap();
    s = this.attention(enc, cur, other, 'decoder.mid_block.attentions.0', s); swap();
    s = this.resnet(enc, cur, other, 'decoder.mid_block.resnets.1', s); swap();
    const outCh = [512, 512, 256, 128];
    for (let u = 0; u < 4; u++) {
      for (let r = 0; r < 3; r++) {
        s = this.resnet(enc, cur, other, `decoder.up_blocks.${u}.resnets.${r}`, s, r === 0 ? outCh[u] : undefined); swap();
      }
      if (u < 3) { s = this.conv(enc, cur, other, `decoder.up_blocks.${u}.upsamplers.0.conv`, { Hin: s.H, Win: s.W, Cin: s.C, up: true }); swap(); }
    }
    this.groupNorm(enc, cur, this.t1, 'decoder.conv_norm_out', { HW: s.H * s.W, C: s.C, silu: true });
    s = this.conv(enc, this.t1, other, 'decoder.conv_out', { Hin: s.H, Win: s.W, Cin: s.C });
    this.out = other;
    return s;
  }

  releaseUniforms() { this.uniformPool.forEach(b => b.destroy()); this.uniformPool = []; }
}
