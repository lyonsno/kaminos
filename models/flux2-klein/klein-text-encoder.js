// FLUX.2 Klein text encoder (Qwen3, first 27 decoder layers) on WebGPU, parity-first.
// Produces the pipeline's prompt embeddings: hidden states after layers 9, 18
// and 27, concatenated per token into [L][3 * hidden]. Residual stream f32;
// weights f16 from pack-text-encoder.py. Token embeddings are gathered on the
// host from rows fetched by the caller (HTTP range requests in the browser).
import { gemmShader, rmsNormShader, qwenQkvPrepShader, maskedSoftmaxShader, swigluShader, copyColumnsShader,
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
    this.weights = {}; this.pipelines = {}; this.uniformPool = [];
  }

  pipeline(key, code) {
    if (!this.pipelines[key]) this.pipelines[key] = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
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
    return { buf: b.buf, elemOff: t.offset / 2, shape: t.shape };
  }

  gemm(enc, { a, aOff = 0, aRs, aBs = 0, b, bOff = 0, bRs, bBs = 0, bDiv = 1, bType = 'f16', c, cOff = 0, cRs, cBs = 0, M, N, K, batch = 1, alpha = 1, epilogue = 'store' }) {
    const pipe = this.pipeline(`gemm-${bType}-${epilogue}`, gemmShader({ bType, epilogue }));
    this.dispatch(enc, pipe, [a, b, c, this.uniform([M, N, K, this.f32bits(alpha), aOff, aRs, aBs, bOff, bRs, bBs, cOff, cRs, cBs, 0, bDiv, 0])],
      Math.ceil(N / 64), Math.ceil(M / 64), batch);
  }

  linear(enc, x, rows, weight, out, epilogue = 'store') {
    const [N, K] = weight.shape;
    this.gemm(enc, { a: x, aRs: K, b: weight.buf, bOff: weight.elemOff, bRs: K, c: out, cRs: N, M: rows, N, K, epilogue });
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
    for (let i = 0; i < this.layers; i++) {
      const enc = dev.createCommandEncoder();
      const lw = name => this.w(i, name);
      this.dispatch(enc, rms, [a.hidden, lw('input_layernorm').buf, a.norm, this.uniform([L, D, lw('input_layernorm').elemOff, eps])], L);
      this.linear(enc, a.norm, L, lw('qkv'), a.proj);
      this.dispatch(enc, this.pipeline('qwen-qkv', qwenQkvPrepShader()), [a.proj, lw('q_norm').buf, a.rope, a.q, a.k, a.vt,
        this.uniform([L, QH, KVH, lw('q_norm').elemOff, lw('k_norm').elemOff, eps, 0, 0])], L, QH);
      this.gemm(enc, { a: a.q, aRs: HEAD, aBs: L * HEAD, b: a.k, bType: 'f32', bRs: HEAD, bBs: L * HEAD, bDiv: QH / KVH,
        c: a.scores, cRs: L, cBs: L * L, M: L, N: L, K: HEAD, batch: QH, alpha: 1 / Math.sqrt(HEAD) });
      const rows = QH * L;
      this.dispatch(enc, this.pipeline('masked-softmax', maskedSoftmaxShader()), [a.scores, a.mask, this.uniform([rows, L, 0, 0])], Math.min(rows, 65535), Math.ceil(rows / 65535));
      this.gemm(enc, { a: a.scores, aRs: L, aBs: L * L, b: a.vt, bType: 'f32', bRs: L, bBs: HEAD * L, bDiv: QH / KVH,
        c: a.o, cRs: HEAD, cBs: L * HEAD, M: L, N: HEAD, K: L, batch: QH });
      this.dispatch(enc, this.pipeline('h2r', headsToRowsShader()), [a.o, a.attn, this.uniform([L, QH, QH * HEAD, 0, 0, L, 0, 0])], L, QH);
      this.linear(enc, a.attn, L, lw('o_proj'), a.hidden, 'add');
      this.dispatch(enc, rms, [a.hidden, lw('post_attention_layernorm').buf, a.norm, this.uniform([L, D, lw('post_attention_layernorm').elemOff, eps])], L);
      this.linear(enc, a.norm, L, lw('gate_up'), a.proj);
      this.dispatch(enc, this.pipeline('swiglu', swigluShader()), [a.proj, a.ffAct, this.uniform([L, F, 2 * F, 0, F, 0, 0, 0])], Math.ceil(F / 256), L);
      this.linear(enc, a.ffAct, L, lw('down'), a.hidden, 'add');
      const tap = this.taps.indexOf(i + 1);
      if (tap >= 0) {
        this.dispatch(enc, this.pipeline('copy-cols', copyColumnsShader()), [a.hidden, out, this.uniform([L, D, this.taps.length * D, tap * D])], Math.ceil(D / 256), L);
      }
      dev.queue.submit([enc.finish()]);
      if (onLayer) await onLayer(i + 1, a.hidden);
    }
    await dev.queue.onSubmittedWorkDone();
    this.uniformPool.forEach(b => b.destroy()); this.uniformPool = [];
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
