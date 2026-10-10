// FLUX.2 Klein text encoder (Qwen3, first 27 decoder layers) on WebGPU, parity-first.
// Produces the pipeline's prompt embeddings: hidden states after layers 9, 18
// and 27, concatenated per token into [L][3 * hidden]. Residual stream f32;
// weights f16 from pack-text-encoder.py. Token embeddings are gathered on the
// host from rows fetched by the caller (HTTP range requests in the browser).
import { KleinDutyScheduler } from './klein-duties.js';
import { gemmShader, gemmShaderV2, rmsNormShader, qwenQkvPrepShader, maskedSoftmaxShader, swigluShader, copyColumnsShader,
  headsToRowsShader } from './klein-kernels.js';

const HEAD = 128;

// Rotate-half RoPE table [pos][128][cos, sin] following transformers' default rope in f32.
export function qwenRopeTable(L, theta) {
  const half = HEAD / 2;
  const inv = Array.from({ length: half }, (_, i) => Math.fround(1 / Math.fround(Math.pow(theta, Math.fround((2 * i) / HEAD)))));
  const out = new Float32Array(L * HEAD * 2);
  for (let p = 0; p < L; p++) {
    for (let d = 0; d < HEAD; d++) {
      const f = Math.fround(inv[d % half] * p);
      out[(p * HEAD + d) * 2] = Math.cos(f); out[(p * HEAD + d) * 2 + 1] = Math.sin(f);
    }
  }
  return out;
}

export class KleinTextEncoder {
  constructor(device, manifest) {
    this.device = device; this.manifest = manifest; this.cfg = manifest.config;
    this.D = this.cfg.hidden_size; this.QH = this.cfg.num_attention_heads; this.KVH = this.cfg.num_key_value_heads;
    this.F = this.cfg.intermediate_size; this.layers = manifest.layers; this.taps = manifest.taps;
    this.weights = {}; this.pipelines = {};
    this.sched = new KleinDutyScheduler(device, { label: 'klein.te' });
  }

  pipeline(key, code) {
    if (!this.pipelines[key]) this.pipelines[key] = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
    return this.pipelines[key];
  }
  buffer(bytes) { return this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); }
  uniform(words) {
    const b = this.device.createBuffer({ size: Math.ceil(words.length * 4 / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, new Uint32Array(words)); return this.sched.track(b);
  }
  f32bits(x) { return new Uint32Array(new Float32Array([x]).buffer)[0]; }
  dispatch(enc, pipe, buffers, x, y = 1, z = 1) {
    const bind = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const e = enc?.encoder ? enc.encoder() : enc;
    const pass = e.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(x, y, z); pass.end();
  }

  async loadBundles(fetchBundle, onProgress) {
    for (const [name, bundle] of Object.entries(this.manifest.bundles)) {
      const bytes = await fetchBundle(bundle.file, bundle);
      const buf = this.device.createBuffer({ size: Math.ceil(bytes.byteLength / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buf, 0, bytes);
      this.weights[name] = { buf, tensors: Object.fromEntries(bundle.tensors.map(t => [t.name, t])) };
      onProgress?.(name, bytes.byteLength);
    }
  }

  w(layer, name) {
    const b = this.weights[`layer${String(layer).padStart(2, '0')}`]; const t = b.tensors[name];
    const format = t.format ?? 'f16';
    return { buf: b.buf, format, elemOff: format === 'f16' ? t.offset / 2 : t.offset / 4, shape: t.shape,
      scaleOff: t.scale_offset !== undefined ? t.scale_offset / 2 : 0 };
  }

  // Same splitting contract as KleinTransformer.gemm: column ranges under a cooperative budget.
  async gemm(enc, { a, aOff = 0, aRs, aBs = 0, b, bOff = 0, bRs, bBs = 0, bDiv = 1, bType = 'f16', c, cOff = 0, cRs, cBs = 0, M, N, K, batch = 1, alpha = 1, epilogue = 'store', scaleOff = 0, label = 'gemm' }) {
    const v2 = (this.gemmVersion ?? 2) === 2 && K % 4 === 0;
    const st = this.sharedType ?? 'f32';
    const pipe = v2 ? this.pipeline(`gemm2-${bType}-${epilogue}-${st}`, gemmShaderV2({ bType, epilogue, sType: st }))
      : this.pipeline(`gemm-${bType}-${epilogue}`, gemmShader({ bType, epilogue }));
    const issue = (nBase, nCount) => {
      const u = this.uniform([M, N, K, this.f32bits(alpha), aOff, aRs, aBs, bOff, bRs, bBs, cOff, cRs, cBs, 0, bDiv, scaleOff, nBase, 0, 0, 0]);
      const entries = [a, b, c, u].map((buffer, i) => ({ binding: i, resource: { buffer } }));
      if (bType === 'i8' || bType === 'i4') entries.push({ binding: 5, resource: { buffer: b } });
      const bind = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
      const e = enc?.encoder ? enc.encoder() : enc;
      const pass = e.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(nCount / 64), Math.ceil(M / 64), batch); pass.end();
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

  linear(enc, x, rows, weight, out, epilogue = 'store') {
    const [N, K] = weight.shape;
    return this.gemm(enc, { a: x, aRs: K, b: weight.buf, bOff: weight.elemOff, bRs: K, bType: weight.format, scaleOff: weight.scaleOff,
      c: out, cRs: N, M: rows, N, K, epilogue, label: 'te.linear' });
  }

  allocate(L) {
    const D = this.D, F = this.F, QH = this.QH, KVH = this.KVH;
    const f = n => this.buffer(n * 4);
    this.L = L;
    this.act = {
      hidden: f(L * D), norm: f(L * D), proj: f(L * Math.max((QH + 2 * KVH) * HEAD, 2 * F)), ffAct: f(L * F),
      q: f(QH * L * HEAD), k: f(KVH * L * HEAD), vt: f(KVH * L * HEAD), o: f(QH * L * HEAD), scores: f(QH * L * L),
      attn: f(L * QH * HEAD), rope: f(L * HEAD * 2), mask: this.buffer(L * 4),
    };
    this.device.queue.writeBuffer(this.act.rope, 0, qwenRopeTable(L, this.cfg.rope_theta));
  }

  // embeddings: Float32Array [L][D] (host-gathered rows); mask: Int32Array [L].
  // Writes [L][taps * D] into `out` (a GPU buffer), e.g. the transformer's prompt-embedding input.
  async encode(embeddings, mask, out, onLayer = null) {
    const dev = this.device, a = this.act, D = this.D, F = this.F, L = this.L, QH = this.QH, KVH = this.KVH;
    const eps = this.f32bits(this.cfg.rms_norm_eps);
    dev.queue.writeBuffer(a.hidden, 0, embeddings);
    dev.queue.writeBuffer(a.mask, 0, mask);
    const rms = this.pipeline('rmsnorm', rmsNormShader());
    const enc = this.sched;
    const group = (() => {
      const budget = this.sched.budget(), rep = QH / KVH;
      if (!Number.isFinite(budget)) return QH;
      const g = Math.floor(budget / (4 * L * L * HEAD));
      return Math.max(rep, Math.min(QH, g - (g % rep)));
    })();
    for (let i = 0; i < this.layers; i++) {
      const lw = name => this.w(i, name);
      this.dispatch(enc, rms, [a.hidden, lw('input_layernorm').buf, a.norm, this.uniform([L, D, lw('input_layernorm').elemOff, eps])], L);
      await this.linear(enc, a.norm, L, lw('qkv'), a.proj);
      this.dispatch(enc, this.pipeline('qwen-qkv', qwenQkvPrepShader()), [a.proj, lw('q_norm').buf, a.rope, a.q, a.k, a.vt,
        this.uniform([L, QH, KVH, lw('q_norm').elemOff, lw('k_norm').elemOff, eps, 0, 0])], L, QH);
      await this.sched.boundary(`te.layer${i}.qkv`);
      // Attention in head groups aligned to the grouped KV heads (one group when uncooperative).
      for (let h0 = 0; h0 < QH; h0 += group) {
        const hn = Math.min(group, QH - h0);
        await this.gemm(enc, { a: a.q, aOff: h0 * L * HEAD, aRs: HEAD, aBs: L * HEAD, b: a.k, bOff: (h0 / (QH / KVH)) * L * HEAD, bType: 'f32', bRs: HEAD, bBs: L * HEAD,
          bDiv: QH / KVH, c: a.scores, cOff: h0 * L * L, cRs: L, cBs: L * L, M: L, N: L, K: HEAD, batch: hn, alpha: 1 / Math.sqrt(HEAD), label: 'te.scores' });
        const rows = hn * L;
        this.dispatch(enc, this.pipeline('masked-softmax', maskedSoftmaxShader()), [a.scores, a.mask, this.uniform([rows, L, h0 * L, 0])], Math.min(rows, 65535), Math.ceil(rows / 65535));
        await this.gemm(enc, { a: a.scores, aOff: h0 * L * L, aRs: L, aBs: L * L, b: a.vt, bOff: (h0 / (QH / KVH)) * HEAD * L, bType: 'f32', bRs: L, bBs: HEAD * L,
          bDiv: QH / KVH, c: a.o, cOff: h0 * L * HEAD, cRs: HEAD, cBs: L * HEAD, M: L, N: HEAD, K: L, batch: hn, label: 'te.values' });
        if (hn < QH) await this.sched.boundary(`te.layer${i}.attention[${h0}]`);
      }
      this.dispatch(enc, this.pipeline('h2r', headsToRowsShader()), [a.o, a.attn, this.uniform([L, QH, QH * HEAD, 0, 0, L, 0, 0])], L, QH);
      await this.linear(enc, a.attn, L, lw('o_proj'), a.hidden, 'add');
      this.dispatch(enc, rms, [a.hidden, lw('post_attention_layernorm').buf, a.norm, this.uniform([L, D, lw('post_attention_layernorm').elemOff, eps])], L);
      await this.linear(enc, a.norm, L, lw('gate_up'), a.proj);
      this.dispatch(enc, this.pipeline('swiglu', swigluShader()), [a.proj, a.ffAct, this.uniform([L, F, 2 * F, 0, F, 0, 0, 0])], Math.ceil(F / 256), L);
      await this.linear(enc, a.ffAct, L, lw('down'), a.hidden, 'add');
      const tap = this.taps.indexOf(i + 1);
      if (tap >= 0) {
        this.dispatch(enc, this.pipeline('copy-cols', copyColumnsShader()), [a.hidden, out, this.uniform([L, D, this.taps.length * D, tap * D])], Math.ceil(D / 256), L);
      }
      await this.sched.boundary(`te.layer${i}`, { force: !this.sched.cooperative });
      if (onLayer) { await this.sched.flush(`te.layer${i}.tap`); await onLayer(i + 1, a.hidden); }
    }
    await this.sched.flush('te.end');
  }
}

// Gather token-embedding rows (f16 little-endian, row_bytes each) into f32 [L][D].
// `fetchRows(ids)` returns a Map id -> ArrayBuffer for the distinct ids requested.
export async function gatherEmbeddings(inputIds, D, fetchRows) {
  const unique = [...new Set(inputIds)];
  const rows = await fetchRows(unique);
  const out = new Float32Array(inputIds.length * D);
  inputIds.forEach((id, r) => { out.set(new Float16Array(rows.get(id)), r * D); });
  return out;
}
