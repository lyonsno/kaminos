// Flan-T5-base encoder on WebGPU (FP32), producing UniMate's caption embedding:
// the mean over tokens of the encoder's last hidden state, as
// sample._encode_prompt computes it.
//
// T5 specifics: RMS-style layer norm (no mean, eps 1e-6), no attention scaling,
// one relative-position bias table (block 0) shared by every layer, gated GELU
// (tanh) feed-forward, final layer norm. The bucket for each relative distance
// comes from the packed table (HF's own _relative_position_bucket).

import * as K from './unimate-kernels.js';
import { tensorFloat32Bytes } from './unimate-weights.js';
import { createT5Tokenizer } from './unimate-t5-tokenizer.js';

const SU = GPUBufferUsage;
const STORAGE = SU.STORAGE | SU.COPY_SRC | SU.COPY_DST;

export class T5Encoder {
  static async create(device, manifest, bytes, tokenizerSpec) {
    const w = new Map();
    for (const t of manifest.tensors) {
      const data = tensorFloat32Bytes(bytes, t);
      const buffer = device.createBuffer({ size: Math.max(256, Math.ceil(data.byteLength / 256) * 256), usage: STORAGE, mappedAtCreation: true });
      new Uint8Array(buffer.getMappedRange()).set(data);
      buffer.unmap();
      w.set(t.name, { buffer, shape: t.shape });
    }
    // The bias table is also needed on the host to build per-length bias matrices.
    const relEntry = manifest.tensors.find(t => t.name === 'relative_attention_bias');
    const rel = new Float32Array(tensorFloat32Bytes(bytes, relEntry).slice().buffer);
    return new T5Encoder(device, manifest, w, rel, createT5Tokenizer(tokenizerSpec));
  }

  constructor(device, manifest, weights, relTable, tokenizer) {
    Object.assign(this, { device, manifest, w: weights, relTable, tokenizer });
    const c = manifest.config;
    if (c.feed_forward_proj !== 'gated-gelu') throw new Error(`unsupported T5 feed-forward ${c.feed_forward_proj}`);
    this.D = c.d_model; this.H = c.num_heads; this.HD = c.d_kv; this.FF = c.d_ff; this.layers = c.num_layers;
    this.eps = c.layer_norm_epsilon;
    this.pipelines = new Map();
    this.dummy = device.createBuffer({ size: 256, usage: STORAGE });
  }

  pipeline(name) {
    if (!this.pipelines.has(name)) {
      this.pipelines.set(name, this.device.createComputePipeline({ layout: 'auto',
        compute: { module: this.device.createShaderModule({ code: K[name] }), entryPoint: 'main' } }));
    }
    return this.pipelines.get(name);
  }

  buf(floats) { return this.device.createBuffer({ size: Math.max(256, Math.ceil(floats * 4 / 256) * 256), usage: STORAGE }); }

  dispatch(pass, kernel, bindings, fields, workgroups, keep) {
    const data = new ArrayBuffer(Math.ceil(fields.length / 4) * 16), dv = new DataView(data);
    fields.forEach(([t, v], i) => (t === 'f' ? dv.setFloat32(i * 4, v, true) : dv.setUint32(i * 4, v >>> 0, true)));
    const u = this.device.createBuffer({ size: data.byteLength, usage: SU.UNIFORM | SU.COPY_DST });
    this.device.queue.writeBuffer(u, 0, data);
    keep.push(u);
    const p = this.pipeline(kernel);
    pass.setPipeline(p);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: p.getBindGroupLayout(0),
      entries: [...bindings, u].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
    pass.dispatchWorkgroups(...workgroups);
  }

  static grid(n, per) { const g = Math.ceil(n / per); return g <= 65535 ? [g, 1] : [65535, Math.ceil(g / 65535)]; }

  // Encode text -> { ids, hidden: Float32Array [L, D], pooled: Float32Array [D] }.
  async encode(text) {
    const ids = this.tokenizer.encode(text);
    const L = ids.length, { D, H, HD, FF, device } = this;
    const keep = [];
    const idsBuf = this.buf(L); device.queue.writeBuffer(idsBuf, 0, new Uint32Array(ids));
    // Position bias [H, L, L] from the bucket table.
    const { min_distance: minD, buckets } = this.manifest.relative_buckets;
    const bias = new Float32Array(H * L * L);
    for (let h = 0; h < H; h++) for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      bias[(h * L + i) * L + j] = this.relTable[buckets[j - i - minD] * H + h];
    }
    const biasBuf = this.buf(H * L * L); device.queue.writeBuffer(biasBuf, 0, bias);
    const X = this.buf(L * D), N = this.buf(L * D), QKV = this.buf(L * 3 * D), A = this.buf(L * D), P = this.buf(L * D),
      U = this.buf(L * 2 * FF), G = this.buf(L * FF), out = this.buf(L * D);
    keep.push(idsBuf, biasBuf, X, N, QKV, A, P, U, G, out);
    const W = n => this.w.get(n).buffer;
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    const linear = (Xb, w, Y, M, Nn, Kd) => this.dispatch(pass, 'LINEAR', [Xb, W(w), this.dummy, Y],
      [['u', M], ['u', Nn], ['u', Kd], ['u', 0]], [Math.ceil(Nn / 64), Math.ceil(M / 64)], keep);
    const norm = (Xb, w, Y) => this.dispatch(pass, 'RMSNORM_MOD', [Xb, W(w), this.dummy, Y],
      [['u', L], ['u', D], ['u', 1], ['u', 0], ['u', 0], ['u', 0], ['u', 0], ['f', this.eps]], [L, 1], keep);
    const addInto = Y => this.dispatch(pass, 'RESIDUAL', [X, Y, this.dummy],
      [['u', L * D], ['u', D], ['u', 1], ['u', 0], ['u', 0]], T5Encoder.grid(L * D, 256), keep);
    this.dispatch(pass, 'GATHER_ROWS', [W('shared'), idsBuf, X], [['u', L], ['u', D]], T5Encoder.grid(L * D, 256), keep);
    for (let l = 0; l < this.layers; l++) {
      norm(X, `block${l}.ln_attn`, N);
      linear(N, `block${l}.qkv`, QKV, L, 3 * D, D);
      this.dispatch(pass, 'ATTN_SPATIAL', [QKV, biasBuf, A], [['u', 1], ['u', 1], ['u', L], ['u', H], ['u', HD], ['f', 1]],
        T5Encoder.grid(L * H, 64), keep);
      linear(A, `block${l}.o`, P, L, D, D);
      addInto(P);
      norm(X, `block${l}.ln_ff`, N);
      linear(N, `block${l}.wi`, U, L, 2 * FF, D);
      this.dispatch(pass, 'GEGLU_TANH', [U, G], [['u', L], ['u', FF]], T5Encoder.grid(L * FF, 256), keep);
      linear(G, `block${l}.wo`, P, L, D, FF);
      addInto(P);
    }
    norm(X, 'final_layer_norm', out);
    pass.end();
    const rb = device.createBuffer({ size: L * D * 4, usage: SU.COPY_DST | SU.MAP_READ });
    enc.copyBufferToBuffer(out, 0, rb, 0, L * D * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const hidden = new Float32Array(rb.getMappedRange().slice(0));
    rb.unmap();
    [...keep, rb].forEach(b => b.destroy());
    const pooled = new Float32Array(D);
    for (let d = 0; d < D; d++) { let s = 0; for (let i = 0; i < L; i++) s += hidden[i * D + d]; pooled[d] = s / L; }
    return { ids, hidden, pooled };
  }
}
