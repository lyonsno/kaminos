// FLUX.2 Klein transformer forward on WebGPU (parity-first).
// Mirrors diffusers Flux2Transformer2DModel: embedders, shared timestep
// modulation, double-stream blocks, single-stream blocks, AdaLN output norm and
// projection. Weights come from pack-transformer.py bundles (f16 [out, in]).
import { LN_EPS, gemmShader, layerNormModulateShader, qkvPrepShader, softmaxShader, swigluShader,
  headsToRowsShader, siluShader, axpyShader } from './klein-kernels.js';

const HEAD = 128;

export function timestepProjection(tModel, channels = 256, maxPeriod = 10000) {
  const half = channels / 2;
  const out = new Float32Array(channels);
  for (let i = 0; i < half; i++) {
    const freq = Math.fround(Math.exp(Math.fround(-Math.log(maxPeriod) * i / half)));
    const arg = Math.fround(tModel * freq);
    out[i] = Math.cos(arg);          // flip_sin_to_cos: [cos, sin]
    out[half + i] = Math.sin(arg);
  }
  return out;
}

// Interleaved [pos][128][cos, sin] for a list of 4-axis ids, axes 32 each, theta 2000.
export function ropeTable(ids, theta = 2000, axes = [32, 32, 32, 32]) {
  const n = ids.length / 4;
  const out = new Float32Array(n * HEAD * 2);
  for (let r = 0; r < n; r++) {
    let col = 0;
    for (let ax = 0; ax < axes.length; ax++) {
      const dim = axes[ax]; const pos = ids[r * 4 + ax];
      for (let i = 0; i < dim / 2; i++) {
        const freq = 1 / Math.pow(theta, (2 * i) / dim);
        const a = pos * freq;
        for (const c of [col, col + 1]) { out[(r * HEAD + c) * 2] = Math.cos(a); out[(r * HEAD + c) * 2 + 1] = Math.sin(a); }
        col += 2;
      }
    }
  }
  return out;
}

export class KleinTransformer {
  constructor(device, manifest) {
    this.device = device;
    this.manifest = manifest;
    this.cfg = manifest.config;
    this.D = this.cfg.num_attention_heads * this.cfg.attention_head_dim;
    this.H = this.cfg.num_attention_heads;
    this.F = Math.round(this.D * this.cfg.mlp_ratio);
    this.weights = {};
    this.pipelines = {};
    this.uniformPool = [];
  }

  pipeline(key, code) {
    if (!this.pipelines[key]) {
      const module = this.device.createShaderModule({ code });
      this.pipelines[key] = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    return this.pipelines[key];
  }

  async loadBundles(fetchBundle, onProgress) {
    for (const [name, bundle] of Object.entries(this.manifest.bundles)) {
      const bytes = await fetchBundle(bundle.file, bundle);
      const buf = this.device.createBuffer({ size: Math.ceil(bytes.byteLength / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buf, 0, bytes);
      const tensors = Object.fromEntries(bundle.tensors.map(t => [t.name, t]));
      this.weights[name] = { buf, tensors };
      onProgress?.(name, bytes.byteLength);
    }
  }

  w(bundle, name) {
    const b = this.weights[bundle]; const t = b.tensors[name];
    if (!t) throw new Error(`missing weight ${bundle}/${name}`);
    return { buf: b.buf, elemOff: t.offset / 2, byteOff: t.offset, bytes: t.bytes, shape: t.shape };
  }

  buffer(bytes, usage = 0) {
    return this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | usage });
  }

  uniform(words) {
    const data = new Uint32Array(words.length);
    words.forEach((v, i) => { data[i] = v; });
    const b = this.device.createBuffer({ size: Math.ceil(data.byteLength / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, data);
    this.uniformPool.push(b);
    return b;
  }

  f32bits(x) { return new Uint32Array(new Float32Array([x]).buffer)[0]; }

  dispatch(enc, pipeline, entries, x, y = 1, z = 1) {
    const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: entries.map((e, i) => ({ binding: e.binding ?? i, resource: e.resource ?? { buffer: e } })) });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(x, y, z); pass.end();
  }

  // C = alpha * A[M,K] * B[N,K]^T with strides; epilogue 'store' | 'add' | 'gated-residual'.
  gemm(enc, { a, aOff = 0, aRs, aBs = 0, b, bOff = 0, bRs, bBs = 0, bType = 'f16', c, cOff = 0, cRs, cBs = 0,
    M, N, K, batch = 1, alpha = 1, epilogue = 'store', gate = null, gateOff = 0 }) {
    const pipe = this.pipeline(`gemm-${bType}-${epilogue}`, gemmShader({ bType, epilogue }));
    const u = this.uniform([M, N, K, this.f32bits(alpha), aOff, aRs, aBs, bOff, bRs, bBs, cOff, cRs, cBs, gateOff, 0, 0]);
    const entries = [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: b } },
      { binding: 2, resource: { buffer: c } }, { binding: 3, resource: { buffer: u } }];
    if (epilogue === 'gated-residual') entries.push({ binding: 4, resource: { buffer: gate } });
    this.dispatch(enc, pipe, entries, Math.ceil(N / 64), Math.ceil(M / 64), batch);
  }

  linear(enc, x, rows, weight, out, opts = {}) {
    const [N, K] = weight.shape;
    this.gemm(enc, { a: x, aOff: opts.aOff ?? 0, aRs: opts.aRs ?? K, b: weight.buf, bOff: weight.elemOff, bRs: K,
      c: out, cOff: opts.cOff ?? 0, cRs: opts.cRs ?? N, M: rows, N, K, epilogue: opts.epilogue ?? 'store',
      gate: opts.gate, gateOff: opts.gateOff ?? 0 });
  }

  layerNormModulate(enc, x, xOff, rows, y, yOff, mod, shiftOff, scaleOff) {
    const pipe = this.pipeline('lnmod', layerNormModulateShader());
    const u = this.uniform([rows, this.D, xOff, this.D, yOff, this.D, shiftOff, scaleOff, this.f32bits(LN_EPS), 0, 0, 0]);
    this.dispatch(enc, pipe, [x, mod, y, u], rows);
  }

  attention(enc, L) {
    const a = this.act, H = this.H;
    this.gemm(enc, { a: a.q, aRs: HEAD, aBs: L * HEAD, b: a.k, bType: 'f32', bRs: HEAD, bBs: L * HEAD,
      c: a.scores, cRs: L, cBs: L * L, M: L, N: L, K: HEAD, batch: H, alpha: 1 / Math.sqrt(HEAD) });
    const rows = H * L;
    const sm = this.pipeline('softmax', softmaxShader());
    this.dispatch(enc, sm, [a.scores, this.uniform([rows, L, 0, 0])], Math.min(rows, 65535), Math.ceil(rows / 65535));
    this.gemm(enc, { a: a.scores, aRs: L, aBs: L * L, b: a.vt, bType: 'f32', bRs: L, bBs: HEAD * L,
      c: a.o, cRs: HEAD, cBs: L * HEAD, M: L, N: HEAD, K: L, batch: H });
  }

  headsToRows(enc, L, rowBegin, rows, y, yRs, yOff) {
    const pipe = this.pipeline('h2r', headsToRowsShader());
    this.dispatch(enc, pipe, [this.act.o, y, this.uniform([L, this.H, yRs, yOff, rowBegin, rows, 0, 0])], rows, this.H);
  }

  swiglu(enc, x, xRs, srcOff, rows, F, y, yRs, dstOff) {
    const pipe = this.pipeline('swiglu', swigluShader());
    this.dispatch(enc, pipe, [x, y, this.uniform([rows, F, xRs, srcOff, yRs, dstOff, 0, 0])], Math.ceil(F / 256), rows);
  }

  allocate(imgTokens, txtTokens) {
    const D = this.D, F = this.F, H = this.H, L = imgTokens + txtTokens;
    const f = n => this.buffer(n * 4);
    this.shape = { imgTokens, txtTokens, L };
    this.act = {
      latents: f(imgTokens * 128), promptEmbeds: f(txtTokens * this.cfg.joint_attention_dim),
      tproj: f(256), temb: f(D), tmp: f(D), siluTemb: f(D),
      mods: f(2 * 6 * D + 3 * D + 2 * D), // double img | double txt | single | norm_out
      hs: f(L * D), norm: f(L * D), proj: f(L * (3 * D + 2 * F)), rope: f(L * HEAD * 2),
      q: f(H * L * HEAD), k: f(H * L * HEAD), vt: f(H * L * HEAD), o: f(H * L * HEAD), scores: f(H * L * L),
      attn: f(L * D), cat: f(L * (D + F)), ffAct: f(L * F), outNorm: f(imgTokens * D), velocity: f(imgTokens * 128),
    };
    this.modOff = { doubleImg: 0, doubleTxt: 6 * D, single: 12 * D, out: 15 * D };
  }

  // One transformer evaluation. `taps(name, buffer, rows, cols, byteOffset)` lets a witness read
  // boundaries; it receives the encoder state after the boundary's work was encoded.
  // Upload per-image inputs once: initial latents, prompt embeddings, RoPE table.
  prepare({ latents, promptEmbeds, imgIds, txtIds }) {
    const dev = this.device, a = this.act;
    const { txtTokens: Lt, L } = this.shape;
    dev.queue.writeBuffer(a.latents, 0, latents);
    if (promptEmbeds) dev.queue.writeBuffer(a.promptEmbeds, 0, promptEmbeds);
    const allIds = new Float64Array(L * 4); allIds.set(txtIds, 0); allIds.set(imgIds, Lt * 4);
    dev.queue.writeBuffer(a.rope, 0, ropeTable(allIds));
  }

  // latents += dt * velocity (FlowMatchEulerDiscreteScheduler.step, f32).
  async eulerStep(dt) {
    const pipe = this.pipeline('axpy', axpyShader());
    const enc = this.device.createCommandEncoder();
    const n = this.shape.imgTokens * 128;
    this.dispatch(enc, pipe, [this.act.latents, this.act.velocity, this.uniform([n, this.f32bits(dt), 0, 0])], Math.ceil(n / 256));
    this.device.queue.submit([enc.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.uniformPool.forEach(b => b.destroy()); this.uniformPool = [];
  }

  async forward({ tModel }, taps = null) {
    const dev = this.device, a = this.act, D = this.D, F = this.F;
    const { imgTokens: Li, txtTokens: Lt, L } = this.shape;
    dev.queue.writeBuffer(a.tproj, 0, timestepProjection(tModel));
    const silu = this.pipeline('silu', siluShader());
    let enc = dev.createCommandEncoder();
    const flush = async (name, buf, rows, cols, byteOffset = 0) => {
      if (!taps) return;
      dev.queue.submit([enc.finish()]);
      await taps(name, buf, rows, cols, byteOffset);
      enc = dev.createCommandEncoder();
    };

    // Timestep embedding and shared modulation vectors.
    this.linear(enc, a.tproj, 1, this.w('globals', 'time_linear_1'), a.tmp);
    this.dispatch(enc, silu, [a.tmp, a.siluTemb], Math.ceil(D / 256));
    this.linear(enc, a.siluTemb, 1, this.w('globals', 'time_linear_2'), a.temb);
    await flush('model/temb', a.temb, 1, D);
    this.dispatch(enc, silu, [a.temb, a.siluTemb], Math.ceil(D / 256));
    this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_double_img'), a.mods, { cOff: this.modOff.doubleImg });
    this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_double_txt'), a.mods, { cOff: this.modOff.doubleTxt });
    this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_single'), a.mods, { cOff: this.modOff.single });
    this.linear(enc, a.siluTemb, 1, this.w('globals', 'norm_out'), a.mods, { cOff: this.modOff.out });
    await flush('model/mod_double_img', a.mods, 1, 6 * D, this.modOff.doubleImg * 4);
    await flush('model/mod_single', a.mods, 1, 3 * D, this.modOff.single * 4);

    // Embedders write the joint stream: text rows [0, Lt), image rows [Lt, L).
    this.linear(enc, a.promptEmbeds, Lt, this.w('globals', 'context_embedder'), a.hs);
    this.linear(enc, a.latents, Li, this.w('globals', 'x_embedder'), a.hs, { cOff: Lt * D });
    await flush('model/context_embedder', a.hs, Lt, D);
    await flush('model/x_embedder', a.hs, Li, D, Lt * D * 4);

    const mi = this.modOff.doubleImg, mt = this.modOff.doubleTxt;
    for (let i = 0; i < this.cfg.num_layers; i++) {
      const blk = `double${String(i).padStart(2, '0')}`;
      // Attention sub-block: modulated norms, per-stream fused QKV, joint attention over [txt; img].
      this.layerNormModulate(enc, a.hs, 0, Lt, a.norm, 0, a.mods, mt, mt + D);
      this.layerNormModulate(enc, a.hs, Lt * D, Li, a.norm, Lt * D, a.mods, mi, mi + D);
      this.linear(enc, a.norm, Lt, this.w(blk, 'added_qkv'), a.proj, { cRs: 3 * D });
      this.linear(enc, a.norm, Li, this.w(blk, 'qkv'), a.proj, { aOff: Lt * D, cOff: Lt * 3 * D, cRs: 3 * D });
      this.qkvPrepRows(enc, a.proj, 3 * D, 0, Lt, this.w(blk, 'norm_added_q'), this.w(blk, 'norm_added_k'), L);
      this.qkvPrepRows(enc, a.proj, 3 * D, Lt, Li, this.w(blk, 'norm_q'), this.w(blk, 'norm_k'), L);
      this.attention(enc, L);
      this.headsToRows(enc, L, 0, L, a.attn, D, 0);
      this.linear(enc, a.attn, Lt, this.w(blk, 'to_add_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: mt + 2 * D });
      this.linear(enc, a.attn, Li, this.w(blk, 'to_out'), a.hs, { aOff: Lt * D, cOff: Lt * D, epilogue: 'gated-residual', gate: a.mods, gateOff: mi + 2 * D });
      // Feed-forward sub-blocks.
      this.layerNormModulate(enc, a.hs, 0, Lt, a.norm, 0, a.mods, mt + 3 * D, mt + 4 * D);
      this.layerNormModulate(enc, a.hs, Lt * D, Li, a.norm, Lt * D, a.mods, mi + 3 * D, mi + 4 * D);
      this.linear(enc, a.norm, Lt, this.w(blk, 'ff_context_in'), a.proj, { cRs: 2 * F });
      this.linear(enc, a.norm, Li, this.w(blk, 'ff_in'), a.proj, { aOff: Lt * D, cOff: Lt * 2 * F, cRs: 2 * F });
      this.swiglu(enc, a.proj, 2 * F, 0, L, F, a.ffAct, F, 0);
      this.linear(enc, a.ffAct, Lt, this.w(blk, 'ff_context_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: mt + 5 * D });
      this.linear(enc, a.ffAct, Li, this.w(blk, 'ff_out'), a.hs, { aOff: Lt * F, cOff: Lt * D, epilogue: 'gated-residual', gate: a.mods, gateOff: mi + 5 * D });
      await flush(`${blk}/txt`, a.hs, Lt, D);
      await flush(`${blk}/img`, a.hs, Li, D, Lt * D * 4);
    }

    const ms = this.modOff.single, W = 3 * D + 2 * F;
    for (let i = 0; i < this.cfg.num_single_layers; i++) {
      const blk = `single${String(i).padStart(2, '0')}`;
      this.layerNormModulate(enc, a.hs, 0, L, a.norm, 0, a.mods, ms, ms + D);
      this.linear(enc, a.norm, L, this.w(blk, 'qkv_mlp'), a.proj);
      this.qkvPrepRows(enc, a.proj, W, 0, L, this.w(blk, 'norm_q'), this.w(blk, 'norm_k'), L);
      this.attention(enc, L);
      this.headsToRows(enc, L, 0, L, a.cat, D + F, 0);
      this.swiglu(enc, a.proj, W, 3 * D, L, F, a.cat, D + F, D);
      this.linear(enc, a.cat, L, this.w(blk, 'to_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: ms + 2 * D });
      await flush(blk, a.hs, L, D);
    }

    // AdaLayerNormContinuous: emb = [scale | shift]; image rows only.
    const mo = this.modOff.out;
    this.layerNormModulate(enc, a.hs, Lt * D, Li, a.outNorm, 0, a.mods, mo + D, mo);
    await flush('model/norm_out', a.outNorm, Li, D);
    this.linear(enc, a.outNorm, Li, this.w('globals', 'proj_out'), a.velocity);
    dev.queue.submit([enc.finish()]);
    if (taps) await taps('velocity', a.velocity, Li, 128, 0);
    await dev.queue.onSubmittedWorkDone();
    this.uniformPool.forEach(b => b.destroy()); this.uniformPool = [];
  }

  qkvPrepRows(enc, src, srcRs, rowBase, rows, normQ, normK, L) {
    const pipe = this.pipeline('qkvprep', qkvPrepShader());
    const u = this.uniform([rows, this.H, L, rowBase * srcRs, srcRs, rowBase, rowBase, this.f32bits(LN_EPS)]);
    const nq = { binding: 1, resource: { buffer: normQ.buf, offset: normQ.byteOff, size: normQ.bytes } };
    const nk = { binding: 2, resource: { buffer: normK.buf, offset: normK.byteOff, size: normK.bytes } };
    this.dispatch(enc, pipe, [{ binding: 0, resource: { buffer: src } }, nq, nk,
      { binding: 3, resource: { buffer: this.act.rope } }, { binding: 4, resource: { buffer: this.act.q } },
      { binding: 5, resource: { buffer: this.act.k } }, { binding: 6, resource: { buffer: this.act.vt } },
      { binding: 7, resource: { buffer: u } }], rows, this.H);
  }
}
