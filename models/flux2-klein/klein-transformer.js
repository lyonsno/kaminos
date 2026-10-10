// FLUX.2 Klein transformer forward on WebGPU (parity-first).
// Mirrors diffusers Flux2Transformer2DModel: embedders, shared timestep
// modulation, double-stream blocks, single-stream blocks, AdaLN output norm and
// projection. Weights come from pack-transformer.py bundles (f16 [out, in]).
import { KleinDutyScheduler } from './klein-duties.js';
import { LN_EPS, gemmShader, layerNormModulateShader, qkvPrepShader, softmaxShader, swigluShader,
  headsToRowsShader, siluShader, axpyShader, gemmShaderV2 } from './klein-kernels.js';

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
    this.sched = new KleinDutyScheduler(device, { label: 'klein.dit' });
  }

  pipeline(key, code) {
    if (!this.pipelines[key]) {
      const module = this.device.createShaderModule({ code });
      this.pipelines[key] = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      this.pipelines[key].label = key;
    }
    return this.pipelines[key];
  }

  // Optional GPU-time profile: every dispatch writes begin/end timestamps, labeled by
  // pipeline (plus `profileTag`, e.g. 'attention'). Needs the device's timestamp-query feature.
  startProfile(capacity = 4096) {
    this.profile = { qs: this.device.createQuerySet({ type: 'timestamp', count: capacity }), labels: [], capacity };
  }

  async endProfile() {
    const { qs, labels } = this.profile; const n = labels.length * 2;
    const qb = this.device.createBuffer({ size: n * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const rb = this.device.createBuffer({ size: n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.resolveQuerySet(qs, 0, n, qb, 0); enc.copyBufferToBuffer(qb, 0, rb, 0, n * 8);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const ts = new BigInt64Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); qb.destroy(); qs.destroy();
    const byLabel = {};
    labels.forEach((label, i) => {
      const ms = Number(ts[2 * i + 1] - ts[2 * i]) / 1e6;
      const e = (byLabel[label] ??= { dispatches: 0, ms: 0 }); e.dispatches++; e.ms += ms;
    });
    this.profile = null;
    return { dispatches: labels.length, byLabel };
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
    const format = t.format ?? 'f16';
    const elemOff = format === 'f16' ? t.offset / 2 : t.offset / 4;
    return { buf: b.buf, format, elemOff, byteOff: t.offset, bytes: t.bytes, shape: t.shape,
      scaleOff: t.scale_offset !== undefined ? t.scale_offset / 2 : 0, group: t.group ?? this.manifest.group ?? 64 };
  }

  buffer(bytes, usage = 0) {
    return this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | usage });
  }

  uniform(words) {
    const data = new Uint32Array(words.length);
    words.forEach((v, i) => { data[i] = v; });
    const b = this.device.createBuffer({ size: Math.ceil(data.byteLength / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, data);
    return this.sched.track(b);
  }

  f32bits(x) { return new Uint32Array(new Float32Array([x]).buffer)[0]; }

  dispatch(enc, pipeline, entries, x, y = 1, z = 1) {
    const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: entries.map((e, i) => ({ binding: e.binding ?? i, resource: e.resource ?? { buffer: e } })) });
    let desc = {};
    if (this.profile && this.profile.labels.length * 2 < this.profile.capacity) {
      const i = this.profile.labels.length;
      this.profile.labels.push(this.profileTag ? `${this.profileTag}:${pipeline.label}` : pipeline.label);
      desc = { timestampWrites: { querySet: this.profile.qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } };
    }
    const e = enc?.encoder ? enc.encoder() : enc;
    const pass = e.beginComputePass(desc);
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(x, y, z); pass.end();
  }

  // C = alpha * A[M,K] * B[N,K]^T with strides; epilogue 'store' | 'add' | 'gated-residual'.
  // Under a cooperative schedule a GEMM above the duty budget runs as tile-aligned column
  // ranges with a split point between them (GEMM v2 only; the v1 parity kernel never splits).
  async gemm(enc, { a, aOff = 0, aRs, aBs = 0, b, bOff = 0, bRs, bBs = 0, bType = 'f16', c, cOff = 0, cRs, cBs = 0,
    M, N, K, batch = 1, alpha = 1, epilogue = 'store', gate = null, gateOff = 0, scaleOff = 0, group = 64, bDiv = 1, label = 'gemm' }) {
    // gemmVersion 2 (default) is the probe-derived kernel; 1 keeps the original parity kernel for A/B.
    const v2 = (this.gemmVersion ?? 2) === 2 && K % 4 === 0;
    const pipe = v2
      ? this.pipeline(`gemm2-${bType}-g${group}-${epilogue}-${this.sharedType ?? 'f32'}`, gemmShaderV2({ bType, epilogue, sType: this.sharedType ?? 'f32', group }))
      : this.pipeline(`gemm-${bType}-g${group}-${epilogue}`, gemmShader({ bType, epilogue, group }));
    const issue = (nBase, nCount) => {
      const u = this.uniform([M, N, K, this.f32bits(alpha), aOff, aRs, aBs, bOff, bRs, bBs, cOff, cRs, cBs, gateOff, bDiv, scaleOff, nBase, 0, 0, 0]);
      const entries = [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: b } },
        { binding: 2, resource: { buffer: c } }, { binding: 3, resource: { buffer: u } }];
      if (epilogue === 'gated-residual') entries.push({ binding: 4, resource: { buffer: gate } });
      if (/^i\d$/.test(bType)) entries.push({ binding: 5, resource: { buffer: b } });
      this.dispatch(enc, pipe, entries, Math.ceil(nCount / 64), Math.ceil(M / 64), batch);
      this.sched.addFlops(2 * M * nCount * K * batch);
    };
    const flops = 2 * M * N * K * batch, budget = this.sched.budget();
    if (!v2 || flops <= budget) { issue(0, N); return; }
    const columns = Math.max(64, Math.floor(budget / (2 * M * K * batch) / 64) * 64);
    for (let nBase = 0; nBase < N; nBase += columns) {
      issue(nBase, Math.min(columns, N - nBase));
      await this.sched.boundary(`${label}[${nBase}]`);
    }
  }

  linear(enc, x, rows, weight, out, opts = {}) {
    const [N, K] = weight.shape;
    return this.gemm(enc, { a: x, aOff: opts.aOff ?? 0, aRs: opts.aRs ?? K, b: weight.buf, bOff: weight.elemOff, bRs: K,
      bType: weight.format, scaleOff: weight.scaleOff, group: weight.group,
      c: out, cOff: opts.cOff ?? 0, cRs: opts.cRs ?? N, M: rows, N, K, epilogue: opts.epilogue ?? 'store',
      gate: opts.gate, gateOff: opts.gateOff ?? 0, label: opts.label ?? 'linear' });
  }

  layerNormModulate(enc, x, xOff, rows, y, yOff, mod, shiftOff, scaleOff) {
    const pipe = this.pipeline('lnmod', layerNormModulateShader());
    const u = this.uniform([rows, this.D, xOff, this.D, yOff, this.D, shiftOff, scaleOff, this.f32bits(LN_EPS), 0, 0, 0]);
    this.dispatch(enc, pipe, [x, mod, y, u], rows);
  }

  // Materialized-score attention. Under a cooperative schedule it runs in head groups sized
  // to the duty budget (scores, softmax and the value product for each group), with a split
  // point after each group.
  async attention(enc, L) {
    const a = this.act, H = this.H;
    this.profileTag = 'attention';
    const sm = this.pipeline('softmax', softmaxShader());
    const perHead = 4 * L * L * HEAD;
    const group = Math.max(1, Math.min(H, Math.floor(this.sched.budget() / perHead)));
    for (let h0 = 0; h0 < H; h0 += group) {
      const hn = Math.min(group, H - h0);
      await this.gemm(enc, { a: a.q, aOff: h0 * L * HEAD, aRs: HEAD, aBs: L * HEAD, b: a.k, bOff: h0 * L * HEAD, bType: 'f32', bRs: HEAD, bBs: L * HEAD,
        c: a.scores, cOff: h0 * L * L, cRs: L, cBs: L * L, M: L, N: L, K: HEAD, batch: hn, alpha: 1 / Math.sqrt(HEAD), label: 'attn.scores' });
      const rows = hn * L;
      this.dispatch(enc, sm, [a.scores, this.uniform([rows, L, h0 * L, 0])], Math.min(rows, 65535), Math.ceil(rows / 65535));
      await this.gemm(enc, { a: a.scores, aOff: h0 * L * L, aRs: L, aBs: L * L, b: a.vt, bOff: h0 * HEAD * L, bType: 'f32', bRs: L, bBs: HEAD * L,
        c: a.o, cOff: h0 * L * HEAD, cRs: HEAD, cBs: L * HEAD, M: L, N: HEAD, K: L, batch: hn, label: 'attn.values' });
      if (hn < H) await this.sched.boundary(`attention[${h0}]`);
    }
    this.profileTag = null;
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
    this.release();
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

  release() { for (const b of Object.values(this.act ?? {})) b.destroy(); this.act = null; }

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
    const n = this.shape.imgTokens * 128;
    this.dispatch(this.sched, pipe, [this.act.latents, this.act.velocity, this.uniform([n, this.f32bits(dt), 0, 0])], Math.ceil(n / 256));
    await this.sched.flush('euler');
  }

  async forward({ tModel }, taps = null) {
    const dev = this.device, a = this.act, D = this.D, F = this.F;
    const { imgTokens: Li, txtTokens: Lt, L } = this.shape;
    dev.queue.writeBuffer(a.tproj, 0, timestepProjection(tModel));
    const silu = this.pipeline('silu', siluShader());
    const enc = this.sched;
    // Block boundaries: uncooperatively every block ends its own command buffer (multi-second
    // command buffers were observed to kill the device); cooperatively the scheduler submits
    // when the duty budget is reached. Taps flush and read the boundary.
    const flush = async (name, buf, rows, cols, byteOffset = 0) => {
      if (taps) { await this.sched.flush(name); await taps(name, buf, rows, cols, byteOffset); return; }
      await this.sched.boundary(name, { force: !this.sched.cooperative });
    };
    const split = name => this.sched.boundary(name);

    // Timestep embedding and shared modulation vectors.
    await this.linear(enc, a.tproj, 1, this.w('globals', 'time_linear_1'), a.tmp);
    this.dispatch(enc, silu, [a.tmp, a.siluTemb], Math.ceil(D / 256));
    await this.linear(enc, a.siluTemb, 1, this.w('globals', 'time_linear_2'), a.temb);
    await flush('model/temb', a.temb, 1, D);
    this.dispatch(enc, silu, [a.temb, a.siluTemb], Math.ceil(D / 256));
    await this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_double_img'), a.mods, { cOff: this.modOff.doubleImg });
    await this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_double_txt'), a.mods, { cOff: this.modOff.doubleTxt });
    await this.linear(enc, a.siluTemb, 1, this.w('globals', 'mod_single'), a.mods, { cOff: this.modOff.single });
    await this.linear(enc, a.siluTemb, 1, this.w('globals', 'norm_out'), a.mods, { cOff: this.modOff.out });
    await flush('model/mod_double_img', a.mods, 1, 6 * D, this.modOff.doubleImg * 4);
    await flush('model/mod_single', a.mods, 1, 3 * D, this.modOff.single * 4);

    // Embedders write the joint stream: text rows [0, Lt), image rows [Lt, L).
    await this.linear(enc, a.promptEmbeds, Lt, this.w('globals', 'context_embedder'), a.hs);
    await this.linear(enc, a.latents, Li, this.w('globals', 'x_embedder'), a.hs, { cOff: Lt * D });
    await flush('model/context_embedder', a.hs, Lt, D);
    await flush('model/x_embedder', a.hs, Li, D, Lt * D * 4);

    const mi = this.modOff.doubleImg, mt = this.modOff.doubleTxt;
    for (let i = 0; i < this.cfg.num_layers; i++) {
      const blk = `double${String(i).padStart(2, '0')}`;
      // Attention sub-block: modulated norms, per-stream fused QKV, joint attention over [txt; img].
      this.layerNormModulate(enc, a.hs, 0, Lt, a.norm, 0, a.mods, mt, mt + D);
      this.layerNormModulate(enc, a.hs, Lt * D, Li, a.norm, Lt * D, a.mods, mi, mi + D);
      await this.linear(enc, a.norm, Lt, this.w(blk, 'added_qkv'), a.proj, { cRs: 3 * D });
      await this.linear(enc, a.norm, Li, this.w(blk, 'qkv'), a.proj, { aOff: Lt * D, cOff: Lt * 3 * D, cRs: 3 * D });
      this.qkvPrepRows(enc, a.proj, 3 * D, 0, Lt, this.w(blk, 'norm_added_q'), this.w(blk, 'norm_added_k'), L);
      this.qkvPrepRows(enc, a.proj, 3 * D, Lt, Li, this.w(blk, 'norm_q'), this.w(blk, 'norm_k'), L);
      await split(`${blk}.qkv`);
      await this.attention(enc, L);
      this.headsToRows(enc, L, 0, L, a.attn, D, 0);
      await this.linear(enc, a.attn, Lt, this.w(blk, 'to_add_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: mt + 2 * D });
      await this.linear(enc, a.attn, Li, this.w(blk, 'to_out'), a.hs, { aOff: Lt * D, cOff: Lt * D, epilogue: 'gated-residual', gate: a.mods, gateOff: mi + 2 * D });
      await split(`${blk}.out`);
      // Feed-forward sub-blocks.
      this.layerNormModulate(enc, a.hs, 0, Lt, a.norm, 0, a.mods, mt + 3 * D, mt + 4 * D);
      this.layerNormModulate(enc, a.hs, Lt * D, Li, a.norm, Lt * D, a.mods, mi + 3 * D, mi + 4 * D);
      await this.linear(enc, a.norm, Lt, this.w(blk, 'ff_context_in'), a.proj, { cRs: 2 * F });
      await this.linear(enc, a.norm, Li, this.w(blk, 'ff_in'), a.proj, { aOff: Lt * D, cOff: Lt * 2 * F, cRs: 2 * F });
      this.swiglu(enc, a.proj, 2 * F, 0, L, F, a.ffAct, F, 0);
      await this.linear(enc, a.ffAct, Lt, this.w(blk, 'ff_context_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: mt + 5 * D });
      await this.linear(enc, a.ffAct, Li, this.w(blk, 'ff_out'), a.hs, { aOff: Lt * F, cOff: Lt * D, epilogue: 'gated-residual', gate: a.mods, gateOff: mi + 5 * D });
      await flush(`${blk}/txt`, a.hs, Lt, D);
      await flush(`${blk}/img`, a.hs, Li, D, Lt * D * 4);
    }

    const ms = this.modOff.single, W = 3 * D + 2 * F;
    for (let i = 0; i < this.cfg.num_single_layers; i++) {
      const blk = `single${String(i).padStart(2, '0')}`;
      this.layerNormModulate(enc, a.hs, 0, L, a.norm, 0, a.mods, ms, ms + D);
      await this.linear(enc, a.norm, L, this.w(blk, 'qkv_mlp'), a.proj);
      this.qkvPrepRows(enc, a.proj, W, 0, L, this.w(blk, 'norm_q'), this.w(blk, 'norm_k'), L);
      await split(`${blk}.qkv`);
      await this.attention(enc, L);
      this.headsToRows(enc, L, 0, L, a.cat, D + F, 0);
      this.swiglu(enc, a.proj, W, 3 * D, L, F, a.cat, D + F, D);
      await this.linear(enc, a.cat, L, this.w(blk, 'to_out'), a.hs, { epilogue: 'gated-residual', gate: a.mods, gateOff: ms + 2 * D });
      await flush(blk, a.hs, L, D);
    }

    // AdaLayerNormContinuous: emb = [scale | shift]; image rows only.
    const mo = this.modOff.out;
    this.layerNormModulate(enc, a.hs, Lt * D, Li, a.outNorm, 0, a.mods, mo + D, mo);
    await flush('model/norm_out', a.outNorm, Li, D);
    await this.linear(enc, a.outNorm, Li, this.w('globals', 'proj_out'), a.velocity);
    await this.sched.flush('epilogue');
    if (taps) await taps('velocity', a.velocity, Li, 128, 0);
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
