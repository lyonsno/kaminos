// UniMate v3 denoiser (UniMateGraphAdaLN) on WebGPU, FP32.
//
// The model is split the way its inputs vary:
// - prepare(cond): once per skeleton + caption batch. Rest-pose embeddings,
//   rest-pose pool, per-joint token additions, spectral RoPE tables, the ten
//   per-block graph biases and the projected caption.
// - forward(): once per drift evaluation. Timestep embedding, adaLN
//   modulation, input embedding, ten spatio-temporal blocks, final layer.
// Both run as fixed op lists over buffers allocated by configure(), so a
// solver only rewrites the timestep input between evaluations.
//
// Works on valid joints only (B rows, J joints, F1 = 61 token frames). Valid
// joint outputs do not depend on padded joints (checked against the PyTorch
// reference by probe-conditioning.py).

import { uploadWeightTensors } from './unimate-weights.js';
import * as K from './unimate-kernels.js';

// The WebGPU spec's buffer usage flags, so the module also loads where WebGPU is absent (bundling,
// servers, workers); the browser's own constants are used when present.
const SU = globalThis.GPUBufferUsage ?? { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
const STORAGE = SU.STORAGE | SU.COPY_SRC | SU.COPY_DST;

export class UniMateDenoiser {
  constructor(device, manifest, weights) {
    this.device = device;
    this.manifest = manifest;
    this.w = weights; // name -> { buffer, shape }
    this.pipelines = new Map();
    this.dummy = device.createBuffer({ size: 256, usage: STORAGE });
    this.D = 512;
    this.H = 8;
    this.HD = 64;
    // The kernels assume this checkpoint's shape: fail loudly on any other.
    const m = manifest.model ?? {};
    for (const [k, want] of [['latent_dim', 512], ['num_heads', 8], ['ff_size', 2048], ['attention', 'graph'], ['text_cond', 'adaln']]) {
      if (m[k] !== want) throw new Error(`unsupported or missing model ${k}=${m[k]} (port supports ${want})`);
    }
    // Clamp depth to the embedding table actually packed: rows 0..max_depth.
    const depthRows = manifest.tensors.find(t => t.name === 'depth_embedding.weight')?.shape?.[0];
    if (!depthRows) throw new Error('manifest has no depth_embedding.weight');
    this.maxDepth = depthRows - 1;
    this.layers = manifest.model?.num_layers ?? 10;
    this.ffHidden = Math.floor((2 / 3) * (manifest.model?.ff_size ?? 2048));
    this.Fe = manifest.dataset?.feature_len ?? 12;
  }

  // Upload a packed weight file (manifest from pack-weights.py).
  static async create(device, manifest, bytes, options = {}) {
    const weights = await uploadWeightTensors(device, manifest, bytes, options);
    try { return new this(device, manifest, weights); }
    catch (e) { weights.forEach(w => w.buffer.destroy()); throw e; }
  }

  weight(name) {
    const t = this.w.get(name);
    if (!t) throw new Error(`missing weight ${name}`);
    return t;
  }

  pipeline(name) {
    if (!this.pipelines.has(name)) {
      const module = this.device.createShaderModule({ code: K[name], label: name });
      this.pipelines.set(name, this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' }, label: name }));
    }
    return this.pipelines.get(name);
  }

  // Every allocated buffer must fit one storage binding, or its dispatches would
  // fail validation and leave zeros behind.
  assertWithinLimits() {
    const limit = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
    const all = [...Object.values(this.io), ...Object.values(this.st).flat(), ...this.tmp, ...Object.values(this.f).flat()];
    const largest = Math.max(...all.map(b => b.size));
    if (largest > limit) {
      throw new RangeError(`B=${this.B}, J=${this.J} needs a ${largest}-byte storage binding; device allows ${limit}. `
        + 'Request the adapter limits (requestUniMateDevice) or reduce the batch.');
    }
  }

  buf(floats, label) {
    return this.device.createBuffer({ size: Math.max(256, Math.ceil((floats * 4) / 256) * 256), usage: STORAGE, label });
  }

  // fields: array of [type, value] with type 'u' (u32) or 'f' (f32).
  uniform(fields) {
    const n = Math.ceil(fields.length / 4) * 4;
    const data = new ArrayBuffer(n * 4);
    const dv = new DataView(data);
    fields.forEach(([type, value], i) => {
      if (type === 'f') dv.setFloat32(i * 4, value, true); else dv.setUint32(i * 4, value >>> 0, true);
    });
    const buffer = this.device.createBuffer({ size: data.byteLength, usage: SU.UNIFORM | SU.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  // One dispatch with fixed bindings. bindings: GPUBuffer or {buffer, offset, size}.
  op(kernel, bindings, fields, workgroups, label) {
    const pipeline = this.pipeline(kernel);
    const entries = [...bindings, this.uniform(fields)].map((b, binding) => (
      b instanceof GPUBuffer ? { binding, resource: { buffer: b } } : { binding, resource: b }
    ));
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries, label: label ?? kernel });
    const wg = Array.isArray(workgroups) ? workgroups : [workgroups];
    return { kind: 'op', pipeline, bindGroup, workgroups: wg, label: label ?? kernel };
  }

  static grid(count, perGroup) {
    const groups = Math.ceil(count / perGroup);
    return groups <= 65535 ? [groups, 1] : [65535, Math.ceil(groups / 65535)];
  }

  // ---- op builders -------------------------------------------------------

  linear(prog, X, wName, bName, Y, M, N, Kd, act = 0, wRange = null, bRange = null) {
    const W = wRange ?? this.weight(wName).buffer;
    const Bv = bName ? (bRange ?? this.weight(bName).buffer) : this.dummy;
    prog.push(this.op('LINEAR', [X, W, Bv, Y], [['u', M], ['u', N], ['u', Kd], ['u', (bName ? 1 : 0) | (act << 1)]],
      [Math.ceil(N / 64), Math.ceil(M / 64)], `linear ${wName}`));
  }

  rmsnorm(prog, X, wName, Y, rows, C, mod = null) {
    const fields = [['u', rows], ['u', C], ['u', mod?.rowsPerBatch ?? 1], ['u', mod ? 1 : 0],
      ['u', mod?.stride ?? 0], ['u', mod?.shiftOff ?? 0], ['u', mod?.scaleOff ?? 0], ['f', 1e-6]];
    prog.push(this.op('RMSNORM_MOD', [X, this.weight(wName).buffer, mod?.buffer ?? this.dummy, Y], fields,
      rows <= 65535 ? [rows, 1] : [65535, Math.ceil(rows / 65535)], `rmsnorm ${wName}`));
  }

  elementwise(prog, op, A, B, C, O, n, s = 0, t = 0) {
    const bits = v => new Uint32Array(new Float32Array([v]).buffer)[0];
    prog.push(this.op('ELEMENTWISE', [A, B ?? this.dummy, C ?? this.dummy, O],
      [['u', n], ['u', op], ['u', bits(s)], ['u', bits(t)]], UniMateDenoiser.grid(n, 256), `elementwise ${op}`));
  }

  // Sub-range of a weight buffer: rows [r0, r1) of a [N, K] matrix or vector.
  range(name, r0, r1, rowFloats) {
    const t = this.weight(name);
    return { buffer: t.buffer, offset: r0 * rowFloats * 4, size: (r1 - r0) * rowFloats * 4 };
  }

  // ---- configure: allocate buffers and build both programs ---------------

  configure({ B, J, F1 = 61 }) {
    if (this.io) this.release();
    const D = this.D, Fe = this.Fe, T = F1 - 1, R = B * F1 * J;
    Object.assign(this, { B, J, F1, T, R });
    const b = (n, l) => this.buf(n, l);
    this.io = {
      // prepare inputs
      tposRoot: b(B * Fe), tposJoint: b(B * (J - 1) * Fe), tposParJoint: b(B * (J - 1) * Fe),
      depthIdx: b(B * J), namesEmb: b(B * J * 768), specPos: b(B * J * 8), specNeg: b(B * J * 8),
      gdist: b(B * J * J), grel: b(B * J * J), caption: b(B * 768), length: b(B),
      queryIdx: b(B * 4), cosT: b(F1 * this.HD), sinT: b(F1 * this.HD),
      // forward inputs and output
      x: b(B * J * Fe * T, 'x'), tFreq: b(B * 256, 'tFreq'), out: b(B * J * Fe * T, 'out'),
    };
    this.st = {
      // prepare results kept for forward
      tposEmb: b(B * J * D), cosS: b(B * J * this.HD), sinS: b(B * J * this.HD),
      tposPool: b(B * D), capProj: b(B * D), depthEmb: b(B * J * D), nameEmb: b(B * J * D),
      bias: Array.from({ length: this.layers }, () => b(B * this.H * J * J)),
    };
    const big = Math.max(B * J * J * 128, B * (J - 1) * 1024, B * J * 8 * 64, B * 4 * 2048);
    this.tmp = Array.from({ length: 6 }, () => b(big));
    this.f = {
      tE1: b(B * D), tE: b(B * D), y: b(B * D), siluY: b(B * D),
      mod: Array.from({ length: this.layers }, () => b(B * 9 * D)), finalMod: b(B * 2 * D),
      rootX: b(B * T * Fe), jointX: b(B * T * (J - 1) * Fe), rH: b(B * T * D), rE: b(B * T * D),
      jH: b(B * T * (J - 1) * D), jE: b(B * T * (J - 1) * D),
      X: b(R * D, 'X'), N: b(R * D), QKV: b(R * 3 * D), A: b(R * D), P: b(R * D),
      U: b(R * 2 * this.ffHidden), Hh: b(R * this.ffHidden),
      rootM: b(B * F1 * D), jointM: b(B * F1 * (J - 1) * D), qn: b(B * F1 * D), kn: b(B * F1 * (J - 1) * D),
      Q: b(B * F1 * D), Kk: b(B * F1 * (J - 1) * D), V: b(B * F1 * (J - 1) * D), agg: b(B * F1 * D), ao: b(B * F1 * D),
      rootH: b(B * F1 * D), jointH: b(B * F1 * (J - 1) * D), rootO: b(B * F1 * Fe), jointO: b(B * F1 * (J - 1) * Fe),
    };
    this.assertWithinLimits();
    this.prepProgram = this.buildPrepare();
    this.forwardProgram = this.buildForward();
    return this;
  }

  // Free the buffers of the current configuration (before configuring another skeleton size).
  release() {
    const free = v => (Array.isArray(v) ? v.forEach(free) : v?.destroy?.());
    for (const group of [this.io, this.st, this.f]) Object.values(group ?? {}).forEach(free);
    free(this.tmp);
    this.io = this.st = this.f = this.tmp = null;
  }

  buildPrepare() {
    const { B, J, D, Fe } = this, io = this.io, st = this.st, [t0, t1, t2, t3, t4, t5] = this.tmp, p = [];
    const mlp2 = (X, pre, Y, M, Kin, hidden) => {
      this.linear(p, X, `${pre}.0.weight`, `${pre}.0.bias`, hidden, M, D, Kin, 1);
      this.linear(p, hidden, `${pre}.2.weight`, `${pre}.2.bias`, Y, M, D, D);
    };
    // Rest-pose embeddings (InputLayer tpos path with parent fusion).
    mlp2(io.tposRoot, 'input_layer.root_tpos_embedder', t0, B, Fe, t5);
    mlp2(io.tposJoint, 'input_layer.joint_tpos_embedder', t1, B * (J - 1), Fe, t5);
    mlp2(io.tposParJoint, 'input_layer.parent_tpos_embedder', t2, B * (J - 1), Fe, t5);
    p.push(this.op('CONCAT_COLS', [t1, t2, t3], [['u', B * (J - 1)], ['u', D], ['u', D]], UniMateDenoiser.grid(B * (J - 1) * 2 * D, 256)));
    this.linear(p, t3, 'input_layer.tpos_fuse.0.weight', 'input_layer.tpos_fuse.0.bias', t5, B * (J - 1), D, 2 * D, 1);
    this.linear(p, t5, 'input_layer.tpos_fuse.2.weight', 'input_layer.tpos_fuse.2.bias', t1, B * (J - 1), D, D);
    p.push(this.op('MERGE_ROOT_JOINT', [t0, t1, st.tposEmb], [['u', B], ['u', J], ['u', D]], UniMateDenoiser.grid(B * J * D, 256)));
    p.push({ kind: 'tap', name: 'tpos_emb', buffer: st.tposEmb, floats: B * J * D });

    // Rest-pose pool (TposCrossAttentionPool, 4 queries, 4 heads of 128).
    const pp = 'tpos_pool.pool';
    this.rmsnorm(p, st.tposEmb, `${pp}.norm_kv.weight`, t0, B * J, D);                       // kv
    this.rmsnorm(p, this.weight(`${pp}.queries`).buffer, `${pp}.norm_q.weight`, t1, 4, D);  // qn
    const inW = `${pp}.cross_attn.in_proj_weight`, inB = `${pp}.cross_attn.in_proj_bias`;
    this.linear(p, t1, inW, inB, t2, 4, D, D, 0, this.range(inW, 0, D, D), this.range(inB, 0, D, 1));
    this.linear(p, t0, inW, inB, t3, B * J, D, D, 0, this.range(inW, D, 2 * D, D), this.range(inB, D, 2 * D, 1));
    this.linear(p, t0, inW, inB, t4, B * J, D, D, 0, this.range(inW, 2 * D, 3 * D, D), this.range(inB, 2 * D, 3 * D, 1));
    p.push(this.op('ATTN_CROSS', [t2, t3, t4, t5], [['u', B], ['u', 4], ['u', J], ['u', 4], ['u', 128], ['u', 1], ['f', 1 / Math.sqrt(128)]],
      [Math.ceil((B * 4 * 4) / 64)]));
    this.linear(p, t5, `${pp}.cross_attn.out_proj.weight`, `${pp}.cross_attn.out_proj.bias`, t0, B * 4, D, D);
    p.push(this.op('GATHER_ROWS', [this.weight(`${pp}.queries`).buffer, io.queryIdx, t1], [['u', B * 4], ['u', D]], UniMateDenoiser.grid(B * 4 * D, 256)));
    this.elementwise(p, 1, t1, t0, null, t2, B * 4 * D);                                      // q1 = q + attn
    this.rmsnorm(p, t2, `${pp}.norm_ff.weight`, t3, B * 4, D);
    this.linear(p, t3, `${pp}.ffn.w12.weight`, `${pp}.ffn.w12.bias`, t4, B * 4, 2048, D);
    p.push(this.op('SWIGLU', [t4, t5], [['u', B * 4], ['u', 1024]], UniMateDenoiser.grid(B * 4 * 1024, 256)));
    this.linear(p, t5, `${pp}.ffn.w3.weight`, `${pp}.ffn.w3.bias`, t3, B * 4, D, 1024);
    this.elementwise(p, 1, t2, t3, null, t4, B * 4 * D);                                      // q2 = q1 + ffn
    p.push(this.op('MEAN_ROWS', [t4, t0], [['u', B], ['u', 4], ['u', D]], [Math.ceil((B * D) / 256)]));
    this.rmsnorm(p, t0, `${pp}.norm_out.weight`, t1, B, D);
    this.linear(p, t1, `${pp}.out_proj.weight`, `${pp}.out_proj.bias`, st.tposPool, B, D, D);
    p.push({ kind: 'tap', name: 'tpos_pool', buffer: st.tposPool, floats: B * D });

    // Per-joint token additions: depth embedding + projected joint-name embedding.
    p.push(this.op('GATHER_ROWS', [this.weight('depth_embedding.weight').buffer, io.depthIdx, st.depthEmb], [['u', B * J], ['u', D]], UniMateDenoiser.grid(B * J * D, 256)));
    this.linear(p, io.namesEmb, 'joint_name_embedder.weight', 'joint_name_embedder.bias', st.nameEmb, B * J, D, 768);
    p.push({ kind: 'tap', name: 'depth_embedding', buffer: st.depthEmb, floats: B * J * D });
    p.push({ kind: 'tap', name: 'joint_name_embedder', buffer: st.nameEmb, floats: B * J * D });

    // Spectral joint RoPE: SignNet rho(phi(v) + phi(-v)) -> angles -> cos/sin.
    const se = 'rope_j.spectral_encoder', n = B * J * 8;
    this.linear(p, io.specPos, `${se}.phi.0.weight`, `${se}.phi.0.bias`, t0, n, 64, 1, 2);
    this.linear(p, t0, `${se}.phi.2.weight`, `${se}.phi.2.bias`, t1, n, 64, 64);
    this.linear(p, io.specNeg, `${se}.phi.0.weight`, `${se}.phi.0.bias`, t0, n, 64, 1, 2);
    this.linear(p, t0, `${se}.phi.2.weight`, `${se}.phi.2.bias`, t2, n, 64, 64);
    this.elementwise(p, 1, t1, t2, null, t3, n * 64);
    this.linear(p, t3, `${se}.rho.0.weight`, `${se}.rho.0.bias`, t0, B * J, 64, 512, 2);
    this.linear(p, t0, `${se}.rho.2.weight`, `${se}.rho.2.bias`, t1, B * J, 32, 64);
    p.push(this.op('ROPE_FROM_ANGLES', [t1, st.cosS, st.sinS], [['u', B * J], ['u', 32]], [Math.ceil((B * J * 64) / 256)]));

    // Graph biases, one per block.
    for (let l = 0; l < this.layers; l++) {
      const a = `transformer_blocks.${l}.s_attn`;
      const rows = B * J * J;
      p.push(this.op('GATHER_ROWS', [this.weight(`${a}.graph_dist_embedding.weight`).buffer, io.gdist, t0], [['u', rows], ['u', 128]], UniMateDenoiser.grid(rows * 128, 256)));
      this.linear(p, t0, `${a}.graph_dist_proj.weight`, `${a}.graph_dist_proj.bias`, t1, rows, this.H, 128);
      p.push(this.op('GATHER_ROWS', [this.weight(`${a}.graph_rel_embedding.weight`).buffer, io.grel, t0], [['u', rows], ['u', 128]], UniMateDenoiser.grid(rows * 128, 256)));
      this.linear(p, t0, `${a}.graph_rel_proj.weight`, `${a}.graph_rel_proj.bias`, t2, rows, this.H, 128);
      p.push(this.op('GRAPH_BIAS', [t1, t2, this.weight(`${a}.graph_dist_scale`).buffer, this.weight(`${a}.graph_rel_scale`).buffer, st.bias[l]],
        [['u', B], ['u', J], ['u', this.H]], [Math.ceil((B * this.H * J * J) / 256)]));
    }

    // Static adaLN driver part: projected caption + rest-pose pool.
    this.linear(p, io.caption, 'cond_embedder.weight', 'cond_embedder.bias', st.capProj, B, D, 768);
    p.push({ kind: 'tap', name: 'cond_embedder', buffer: st.capProj, floats: B * D });
    return p;
  }

  buildForward() {
    const { B, J, D, Fe, T, F1, R, H, HD } = this, io = this.io, st = this.st, f = this.f, p = [];
    // adaLN driver y = timestep embedding + static part; modulation for every block.
    this.linear(p, io.tFreq, 'time_embedder.mlp.0.weight', 'time_embedder.mlp.0.bias', f.tE1, B, D, 256, 1);
    this.linear(p, f.tE1, 'time_embedder.mlp.2.weight', 'time_embedder.mlp.2.bias', f.tE, B, D, D);
    p.push({ kind: 'tap', name: 'time_embedder', buffer: f.tE, floats: B * D });
    this.elementwise(p, 2, f.tE, st.capProj, st.tposPool, f.y, B * D);           // (t + caption) + rest-pose pool
    this.elementwise(p, 0, f.y, null, null, f.siluY, B * D);
    for (let l = 0; l < this.layers; l++) {
      this.linear(p, f.siluY, `transformer_blocks.${l}.adaLN_modulation.1.weight`, `transformer_blocks.${l}.adaLN_modulation.1.bias`, f.mod[l], B, 9 * D, D);
    }
    this.linear(p, f.siluY, 'final_layer.adaLN_modulation.1.weight', 'final_layer.adaLN_modulation.1.bias', f.finalMod, B, 2 * D, D);

    // Input embedding and token assembly (rest-pose frame first).
    p.push(this.op('SPLIT_MOTION', [io.x, f.rootX, f.jointX], [['u', B], ['u', J], ['u', Fe], ['u', T]], [Math.ceil((B * J * Fe * T) / 256)]));
    this.linear(p, f.rootX, 'input_layer.root_x_embedder.0.weight', 'input_layer.root_x_embedder.0.bias', f.rH, B * T, D, Fe, 1);
    this.linear(p, f.rH, 'input_layer.root_x_embedder.2.weight', 'input_layer.root_x_embedder.2.bias', f.rE, B * T, D, D);
    this.linear(p, f.jointX, 'input_layer.joint_x_embedder.0.weight', 'input_layer.joint_x_embedder.0.bias', f.jH, B * T * (J - 1), D, Fe, 1);
    this.linear(p, f.jH, 'input_layer.joint_x_embedder.2.weight', 'input_layer.joint_x_embedder.2.bias', f.jE, B * T * (J - 1), D, D);
    p.push(this.op('ASSEMBLE_TOKENS', [st.tposEmb, f.rE, f.jE, f.X], [['u', B], ['u', F1], ['u', J], ['u', D]], UniMateDenoiser.grid(R * D, 256)));
    p.push({ kind: 'tap', name: 'input_layer', buffer: f.X, floats: R * D });
    for (const add of [st.depthEmb, st.nameEmb]) {                                 // depth, then joint name, as upstream adds them
      p.push(this.op('ADD_PER_JOINT', [f.X, add], [['u', B], ['u', F1], ['u', J], ['u', D]], UniMateDenoiser.grid(R * D, 256)));
    }

    const rowsPerBatch = F1 * J, ms = 9 * D;
    const residual = (Y, mod, gateOff) => p.push(this.op('RESIDUAL', [f.X, Y, mod],
      [['u', R * D], ['u', D], ['u', rowsPerBatch], ['u', ms], ['u', gateOff]], UniMateDenoiser.grid(R * D, 256)));
    for (let l = 0; l < this.layers; l++) {
      const pre = `transformer_blocks.${l}`, mod = f.mod[l];
      // spatial attention with graph bias and spectral RoPE
      this.rmsnorm(p, f.X, `${pre}.norm_s.weight`, f.N, R, D, { buffer: mod, rowsPerBatch, stride: ms, shiftOff: 0, scaleOff: D });
      this.linear(p, f.N, `${pre}.s_attn.qkv.weight`, `${pre}.s_attn.qkv.bias`, f.QKV, R, 3 * D, D);
      p.push(this.op('QK_PREP', [f.QKV, this.weight(`${pre}.s_attn.q_norm.weight`).buffer, this.weight(`${pre}.s_attn.k_norm.weight`).buffer, st.cosS, st.sinS],
        [['u', R], ['u', H], ['u', HD], ['u', 0], ['u', F1], ['u', J], ['f', 1e-6]], [H, Math.min(R, 65535), Math.ceil(R / 65535)]));
      p.push(this.op('ATTN_SPATIAL', [f.QKV, st.bias[l], f.A], [['u', B], ['u', F1], ['u', J], ['u', H], ['u', HD], ['f', HD ** -0.5]], UniMateDenoiser.grid(R * H, 64)));
      this.linear(p, f.A, `${pre}.s_attn.proj.weight`, `${pre}.s_attn.proj.bias`, f.P, R, D, D);
      residual(f.P, mod, 2 * D);
      // temporal attention
      this.rmsnorm(p, f.X, `${pre}.norm_t.weight`, f.N, R, D, { buffer: mod, rowsPerBatch, stride: ms, shiftOff: 3 * D, scaleOff: 4 * D });
      this.linear(p, f.N, `${pre}.t_attn.qkv.weight`, `${pre}.t_attn.qkv.bias`, f.QKV, R, 3 * D, D);
      p.push(this.op('QK_PREP', [f.QKV, this.weight(`${pre}.t_attn.q_norm.weight`).buffer, this.weight(`${pre}.t_attn.k_norm.weight`).buffer, io.cosT, io.sinT],
        [['u', R], ['u', H], ['u', HD], ['u', 1], ['u', F1], ['u', J], ['f', 1e-6]], [H, Math.min(R, 65535), Math.ceil(R / 65535)]));
      p.push(this.op('ATTN_TEMPORAL', [f.QKV, io.length, f.A], [['u', B], ['u', F1], ['u', J], ['u', H], ['u', HD], ['f', HD ** -0.5]], UniMateDenoiser.grid(R * H, 64)));
      this.linear(p, f.A, `${pre}.t_attn.proj.weight`, `${pre}.t_attn.proj.bias`, f.P, R, D, D);
      residual(f.P, mod, 5 * D);
      // SwiGLU MLP
      this.rmsnorm(p, f.X, `${pre}.norm_mlp.weight`, f.N, R, D, { buffer: mod, rowsPerBatch, stride: ms, shiftOff: 6 * D, scaleOff: 7 * D });
      this.linear(p, f.N, `${pre}.mlp.w12.weight`, `${pre}.mlp.w12.bias`, f.U, R, 2 * this.ffHidden, D);
      p.push(this.op('SWIGLU', [f.U, f.Hh], [['u', R], ['u', this.ffHidden]], UniMateDenoiser.grid(R * this.ffHidden, 256)));
      this.linear(p, f.Hh, `${pre}.mlp.w3.weight`, `${pre}.mlp.w3.bias`, f.P, R, D, this.ffHidden);
      residual(f.P, mod, 8 * D);
      p.push({ kind: 'tap', name: `block${String(l).padStart(2, '0')}`, buffer: f.X, floats: R * D });
    }

    // Final layer: modulated norm, root cross-attention over joints, split heads.
    const G = B * F1, GJ = B * F1 * (J - 1);
    this.rmsnorm(p, f.X, 'final_layer.norm_final.weight', f.N, R, D, { buffer: f.finalMod, rowsPerBatch, stride: 2 * D, shiftOff: 0, scaleOff: D });
    p.push(this.op('SPLIT_TOKENS', [f.N, f.rootM, f.jointM], [['u', B], ['u', F1], ['u', J], ['u', D]], UniMateDenoiser.grid(R * D, 256)));
    this.rmsnorm(p, f.rootM, 'final_layer.root_cross_norm_q.weight', f.qn, G, D);
    this.rmsnorm(p, f.jointM, 'final_layer.root_cross_norm_kv.weight', f.kn, GJ, D);
    const inW = 'final_layer.root_cross_attn.in_proj_weight', inB = 'final_layer.root_cross_attn.in_proj_bias';
    this.linear(p, f.qn, inW, inB, f.Q, G, D, D, 0, this.range(inW, 0, D, D), this.range(inB, 0, D, 1));
    this.linear(p, f.kn, inW, inB, f.Kk, GJ, D, D, 0, this.range(inW, D, 2 * D, D), this.range(inB, D, 2 * D, 1));
    this.linear(p, f.jointM, inW, inB, f.V, GJ, D, D, 0, this.range(inW, 2 * D, 3 * D, D), this.range(inB, 2 * D, 3 * D, 1));
    p.push(this.op('ATTN_CROSS', [f.Q, f.Kk, f.V, f.agg], [['u', G], ['u', 1], ['u', J - 1], ['u', 4], ['u', 128], ['u', 0], ['f', 1 / Math.sqrt(128)]],
      [Math.ceil((G * 4) / 64)]));
    this.linear(p, f.agg, 'final_layer.root_cross_attn.out_proj.weight', 'final_layer.root_cross_attn.out_proj.bias', f.ao, G, D, D);
    this.elementwise(p, 1, f.rootM, f.ao, null, f.qn, G * D);
    this.linear(p, f.qn, 'final_layer.root_out.0.weight', 'final_layer.root_out.0.bias', f.rootH, G, D, D, 1);
    this.linear(p, f.rootH, 'final_layer.root_out.2.weight', 'final_layer.root_out.2.bias', f.rootO, G, Fe, D);
    this.linear(p, f.jointM, 'final_layer.joint_out.0.weight', 'final_layer.joint_out.0.bias', f.jointH, GJ, D, D, 1);
    this.linear(p, f.jointH, 'final_layer.joint_out.2.weight', 'final_layer.joint_out.2.bias', f.jointO, GJ, Fe, D);
    p.push(this.op('ASSEMBLE_OUTPUT', [f.rootO, f.jointO, io.out], [['u', B], ['u', F1], ['u', J], ['u', Fe]], [Math.ceil((B * J * Fe * T) / 256)]));
    return p;
  }

  // ---- host-side inputs ----------------------------------------------------

  // cond: per-row arrays over valid joints (see export-browser-fixture.py).
  writeConditioning(cond) {
    const { B, J, Fe, F1, HD } = this, q = this.device.queue, io = this.io;
    const f32 = a => (a instanceof Float32Array ? a : new Float32Array(a));
    const tposRoot = new Float32Array(B * Fe), tposJoint = new Float32Array(B * (J - 1) * Fe), tposPar = new Float32Array(B * (J - 1) * Fe);
    for (let b = 0; b < B; b++) {
      for (let j = 0; j < J; j++) {
        const src = (b * J + j) * Fe;
        if (j === 0) tposRoot.set(cond.tpos.subarray(src, src + Fe), b * Fe);
        else {
          tposJoint.set(cond.tpos.subarray(src, src + Fe), (b * (J - 1) + j - 1) * Fe);
          tposPar.set(cond.tposParents.subarray(src, src + Fe), (b * (J - 1) + j - 1) * Fe);
        }
      }
    }
    q.writeBuffer(io.tposRoot, 0, tposRoot);
    q.writeBuffer(io.tposJoint, 0, tposJoint);
    q.writeBuffer(io.tposParJoint, 0, tposPar);
    // Upstream clamps depth to max_depth: deeper joints share the last embedding row.
    q.writeBuffer(io.depthIdx, 0, new Uint32Array(Array.from(cond.depths, d => Math.min(Math.max(d, 0), this.maxDepth))));
    q.writeBuffer(io.namesEmb, 0, f32(cond.jointNamesEmb));
    const spec = f32(cond.spectral);
    q.writeBuffer(io.specPos, 0, spec);
    q.writeBuffer(io.specNeg, 0, spec.map(v => -v));
    q.writeBuffer(io.gdist, 0, new Uint32Array(cond.graphDist));
    q.writeBuffer(io.grel, 0, new Uint32Array(cond.jointRelations));
    q.writeBuffer(io.caption, 0, f32(cond.caption));
    q.writeBuffer(io.length, 0, new Uint32Array(Array.from(cond.motionLength, v => v + 1)));
    q.writeBuffer(io.queryIdx, 0, new Uint32Array(Array.from({ length: B * 4 }, (_, i) => i % 4)));
    // Temporal RoPE (RopeND, one axis, auto base for max length F1), in f32 steps.
    const base = (Math.floor(Math.floor((8 * F1) / Math.PI) / 100) + 1) * 100;
    const cos = new Float32Array(F1 * HD), sin = new Float32Array(F1 * HD);
    for (let i = 0; i < HD / 2; i++) {
      const inv = Math.fround(1 / Math.fround(Math.pow(base, Math.fround(Math.fround(2 * i) / HD))));
      for (let t = 0; t < F1; t++) {
        const a = Math.fround(t * inv);
        cos[t * HD + i] = cos[t * HD + i + HD / 2] = Math.cos(a);
        sin[t * HD + i] = sin[t * HD + i + HD / 2] = Math.sin(a);
      }
    }
    q.writeBuffer(io.cosT, 0, cos);
    q.writeBuffer(io.sinT, 0, sin);
    this.temporalRopeBase = base;
  }

  // Sinusoidal timestep features, cos then sin, as TimestepEmbedder computes in f32.
  writeTimesteps(ts) {
    const out = new Float32Array(this.B * 256);
    const s = Math.fround(-Math.log(10000));
    for (let b = 0; b < this.B; b++) {
      for (let i = 0; i < 128; i++) {
        const freq = Math.fround(Math.exp(Math.fround(Math.fround(s * i) / 128)));
        const a = Math.fround(ts[b] * freq);
        out[b * 256 + i] = Math.cos(a);
        out[b * 256 + 128 + i] = Math.sin(a);
      }
    }
    this.device.queue.writeBuffer(this.io.tFreq, 0, out);
  }

  writeMotion(x) { this.device.queue.writeBuffer(this.io.x, 0, x); }

  // ---- encoding ------------------------------------------------------------

  encode(encoder, program, taps = null) {
    let pass = null;
    for (const step of program) {
      if (step.kind === 'tap') {
        if (!taps || !taps.has(step.name)) continue;
        if (pass) { pass.end(); pass = null; }
        const dst = this.device.createBuffer({ size: step.floats * 4, usage: SU.COPY_DST | SU.MAP_READ, label: `tap ${step.name}` });
        encoder.copyBufferToBuffer(step.buffer, 0, dst, 0, step.floats * 4);
        taps.set(step.name, dst);
        continue;
      }
      if (!pass) pass = encoder.beginComputePass();
      pass.setPipeline(step.pipeline);
      pass.setBindGroup(0, step.bindGroup);
      pass.dispatchWorkgroups(...step.workgroups);
    }
    if (pass) pass.end();
  }

  encodePrepare(encoder, taps = null) { this.encode(encoder, this.prepProgram, taps); }
  encodeForward(encoder, taps = null) { this.encode(encoder, this.forwardProgram, taps); }

  get dispatchCounts() {
    const n = prog => prog.filter(s => s.kind === 'op').length;
    return { prepare: n(this.prepProgram), forward: n(this.forwardProgram) };
  }
}

// A device with the adapter's storage limits: large skeletons at two prompts need
// bindings above WebGPU's 128 MiB default.
export async function requestUniMateDevice(adapter) {
  const l = adapter.limits;
  return adapter.requestDevice({ requiredLimits: {
    maxBufferSize: l.maxBufferSize, maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: Math.min(l.maxStorageBuffersPerShaderStage, 10) } });
}

export async function readTap(buffer) {
  await buffer.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(buffer.getMappedRange().slice(0));
  buffer.unmap();
  buffer.destroy();
  return out;
}
