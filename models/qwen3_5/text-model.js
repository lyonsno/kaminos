import { qwen35ModelLayout } from './model-layout.js';
import { fetchTensor, projectionSlices } from './model-source.js';
import * as kernels from './kernels.js';
import { affineParams, affineDispatch, deltaParams, attentionParams } from './kernel-params.js';
import { rmsNormShader, swigluShader, axpyShader } from '../flux2-klein/klein-kernels.js';
import { createWebGpuTiledFlashAttentionShader, flashAttentionParams } from '../../webgpu-inference-kit/src/flash-attention-kernel.js';

function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error(String(signal.reason ?? 'generation aborted')), { name: 'AbortError' }); }
function positive(n, name) { if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`${name} must be positive`); }
function bits(n) { return new Uint32Array(new Float32Array([n]).buffer)[0]; }

// Cancellation can withdraw a parked admission without resuming or closing the
// borrowed control. Once work starts, its fence completes before it returns.
function admit(control, signal, work) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let started = false;
    const abort = () => { if (!started) { signal.removeEventListener('abort', abort); try { checkAbort(signal); } catch (error) { reject(error); } } };
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => control.runDuty(async () => {
      started = true; signal?.removeEventListener('abort', abort); checkAbort(signal);
      const value = await work(); checkAbort(signal); return value;
    })).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
    if (signal?.aborted) abort();
  });
}

const embeddingShader = () => `
struct P { tokens:u32,dim:u32,start:u32,rows:u32 };
@group(0) @binding(0) var<storage,read> ids:array<u32>;
@group(0) @binding(1) var<storage,read> weight:array<u32>;
@group(0) @binding(2) var<storage,read> scales:array<f32>;
@group(0) @binding(3) var<storage,read> biases:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@group(0) @binding(5) var<uniform> p:P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let d=gid.x;let t=gid.y;if(d>=p.dim || t>=p.tokens){return;}
 let id=ids[t];if(id<p.start || id>=p.start+p.rows){return;}let row=id-p.start;
 let q=(weight[row*(p.dim/8u)+d/8u]>>((d%8u)*4u))&15u;
 let s=row*(p.dim/64u)+d/64u;output[t*p.dim+d]=f32(q)*scales[s]+biases[s];
}`;

/** Dense text-only adapter. The caller supplies device and inference control;
 * model owns loaded weights, each request owns opaque hybrid state. All serving
 * intermediates/KV are f32 here. Model weights remain packed affine4/group64.
 */
export class Qwen35TextModel {
  constructor(device, manifest, { control, onLayer = null, onNorm = null } = {}) {
    if (typeof control?.runDuty !== 'function') throw new TypeError('borrowed inference control is required');
    this.layout = qwen35ModelLayout(manifest); this.config = this.layout.config;
    this.device = device; this.manifest = manifest; this.control = control; this.onLayer = onLayer; this.onNorm = onNorm;
    this.weights = new Map(); this.vectors = new Map(); this.pipelines = new Map();
    this.owned = new Set(); this.states = new Set(); this.loaded = false; this.closed = false; this.active = null;
    this.lifetime = new AbortController();
    this.bindingBytes = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
  }
  buffer(bytes, target = this.owned, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.device.limits.maxBufferSize || ((usage & GPUBufferUsage.STORAGE) && bytes > this.bindingBytes)) throw new RangeError('buffer exceeds device capacity');
    const buffer = this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage }); target.add(buffer); return buffer;
  }
  upload(data, target = this.owned) { const b = this.buffer(data.byteLength, target); this.device.queue.writeBuffer(b, 0, data); return b; }
  async pipeline(name, code) {
    if (!this.pipelines.has(name)) this.pipelines.set(name, (async () => {
      const module = this.device.createShaderModule({ code }), info = await module.getCompilationInfo();
      if (info.messages.some(x => x.type === 'error')) throw new Error(`${name}: ${info.messages.map(x => x.message).join('; ')}`);
      return this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    })());
    return this.pipelines.get(name);
  }
  async dispatch(name, code, buffers, params, shape, ctx) {
    const pipeline = await this.pipeline(name, code); checkAbort(ctx.signal);
    await admit(ctx.control, ctx.signal, async () => {
      const uniform = this.buffer(params.byteLength, new Set(), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      try {
        this.device.queue.writeBuffer(uniform, 0, params);
        this.device.pushErrorScope('validation');
        let validation;
        try {
          const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [...buffers, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) });
          const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
          pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(...shape); pass.end(); this.device.queue.submit([encoder.finish()]);
        } finally { validation = this.device.popErrorScope(); }
        const error = await validation; await this.device.queue.onSubmittedWorkDone();
        if (error) throw new Error(`${name}: ${error.message}`);
      } finally { uniform.destroy(); }
    });
  }
  async read(buffer, elements, offset = 0, ctx = { control: this.control }) {
    return admit(ctx.control, ctx.signal, async () => {
      const target = this.buffer(elements * 4, new Set(), GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      try {
        const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, offset, target, 0, elements * 4); this.device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(target.getMappedRange().slice(0)); target.unmap(); return data;
      } finally { target.destroy(); }
    });
  }
  async load(baseUrl, { signal = null, fetchImpl = fetch, onProgress = null } = {}) {
    if (this.closed || this.loaded || this.loading) throw new Error('model cannot load in its current state');
    this.loading = true;
    this.loadingDone = new Promise(resolve => { this.finishLoading = resolve; });
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    try {
      // Compile arithmetic before acquiring gigabytes of weights.
      await this.pipeline('rms', rmsNormShader({ weightType: 'f32' }));
      let count = 0;
      for (const [name, entry] of this.layout.projections) {
        checkAbort(signal);
        const weight = await fetchTensor(baseUrl, entry.weight, { signal, fetchImpl });
        const scales = await fetchTensor(baseUrl, entry.scales, { signal, fetchImpl });
        const biases = await fetchTensor(baseUrl, entry.biases, { signal, fetchImpl });
        const slices = [];
        for (const part of projectionSlices(entry.rows, entry.columns, entry.group, this.bindingBytes)) {
          const word = entry.columns / 8, group = entry.columns / 64;
          await admit(this.control, signal, async () => {
            slices.push({ ...part, weight: this.upload(weight.subarray(part.rowStart * word, (part.rowStart + part.rows) * word)),
              scales: this.upload(scales.subarray(part.rowStart * group, (part.rowStart + part.rows) * group)),
              biases: this.upload(biases.subarray(part.rowStart * group, (part.rowStart + part.rows) * group)) });
            await this.device.queue.onSubmittedWorkDone();
          });
        }
        this.weights.set(name, { ...entry, slices }); onProgress?.({ name, completed: ++count, total: this.layout.projections.size + this.layout.vectors.size });
      }
      const host = new Map();
      for (const [name, entry] of this.layout.vectors) {
        const data = await fetchTensor(baseUrl, entry, { signal, fetchImpl }); host.set(name, data);
        await admit(this.control, signal, async () => { this.vectors.set(name, this.upload(data)); await this.device.queue.onSubmittedWorkDone(); });
        onProgress?.({ name, completed: ++count, total: this.layout.projections.size + this.layout.vectors.size });
      }
      for (const [index, type] of this.config.layers.entries()) {
        const root = `model.layers.${index}.${type === 'linear_attention' ? 'linear_attn' : 'self_attn'}`;
        const names = type === 'linear_attention' ? ['A_log', 'dt_bias'] : ['q_norm.weight', 'k_norm.weight'];
        const first = host.get(root + '.' + names[0]), second = host.get(root + '.' + names[1]), joined = new Float32Array(first.length + second.length);
        joined.set(first); joined.set(second, first.length);
        await admit(this.control, signal, async () => { this.vectors.set(root + '.joined', this.upload(joined)); await this.device.queue.onSubmittedWorkDone(); });
      }
      await this.device.queue.onSubmittedWorkDone(); checkAbort(signal); this.loaded = true;
    } catch (error) { await this.device.queue.onSubmittedWorkDone().catch(() => {}); for (const b of this.owned) b.destroy(); this.owned.clear(); this.weights.clear(); this.vectors.clear(); throw error; }
    finally { this.loading = false; this.finishLoading(); }
  }
  async createState({ capacity, signal = null, control = this.control } = {}) {
    positive(capacity, 'capacity'); if (capacity > this.config.maxPositions) throw new RangeError('capacity exceeds model positions');
    checkAbort(signal);
    if (!this.loaded || this.closed || this.loading) throw new Error('model weights are not loaded');
    if (typeof control?.runDuty !== 'function') throw new TypeError('inference control required');
    const c = this.config, buffers = new Set(), state = { owner: this, capacity, length: 0, failed: false, closed: false, buffers, layers: [], signal, control, abort: new AbortController() };
    try {
      // Validate the full geometry before allocating any layer.
      if (capacity * c.kvHeads * c.headDim * 4 > this.bindingBytes) throw new RangeError('KV backing exceeds device binding capacity');
      for (const type of c.layers) {
        if (type === 'full_attention') state.layers.push({ keys: this.buffer(capacity * c.kvHeads * c.headDim * 4, buffers), values: this.buffer(capacity * c.kvHeads * c.headDim * 4, buffers) });
        else {
          const width = 2 * c.linearKeyHeads * c.linearKeyDim + c.linearValueHeads * c.linearValueDim;
          state.layers.push({ recurrent: this.buffer(c.linearValueHeads * c.linearKeyDim * c.linearValueDim * 4, buffers), history: this.buffer((c.convKernel - 1) * width * 4, buffers), nextHistory: this.buffer((c.convKernel - 1) * width * 4, buffers) });
        }
      }
      this.states.add(state); return state;
    } catch (error) { for (const b of buffers) b.destroy(); throw error; }
  }
  async linear(name, input, output, tokens, ctx, { outputStride = this.weights.get(name).rows, outputOffset = 0, inputOffset = 0 } = {}) {
    const entry = this.weights.get(name);
    for (const part of entry.slices) await this.dispatch('affine', kernels.affineShader(), [input, part.weight, part.scales, part.biases, output],
      affineParams({ tokens, rows: part.rows, columns: entry.columns, group: entry.group, outputStride, outputOffset: outputOffset + part.rowStart, inputOffset }),
      affineDispatch(part.rows, tokens, this.device.limits.maxComputeWorkgroupsPerDimension), ctx);
  }
  async prefill(ids, state, ctx = {}) { if (state.length !== 0) throw new Error('prefill requires fresh state'); return this.append(ids, state, ctx); }
  async decode(id, state, ctx = {}) { if (!state.length) throw new Error('decode requires a prefix'); return this.append([id], state, ctx); }
  async append(inputIds, state, options = {}) {
    if (this.closed || !this.loaded || state?.owner !== this || state.closed || state.failed) throw new Error('invalid generation state');
    if (this.active) throw new Error('concurrent model execution is not supported');
    const ids = Array.from(inputIds), c = this.config, tokens = ids.length;
    positive(tokens, 'input token count');
    if (ids.some(x => !Number.isInteger(x) || x < 0 || x >= c.vocabSize)) throw new RangeError('token outside model vocabulary');
    if (state.length + tokens > state.capacity) throw new RangeError('generation state capacity exhausted');
    const requestedSignal = options.signal ?? state.signal;
    const ctx = { signal: AbortSignal.any([state.abort.signal, this.lifetime.signal, ...(requestedSignal ? [requestedSignal] : [])]), control: options.control ?? state.control };
    const work = this.forward(ids, state, ctx); this.active = work; this.activeState = state;
    try { return await work; } catch (error) { state.failed = true; throw error; } finally { this.active = null; this.activeState = null; }
  }
  async forward(ids, state, ctx) {
    const c = this.config, tokens = ids.length, scratch = new Set(), f = n => this.buffer(n * 4, scratch);
    const norm = (input, weight, output, width = c.hiddenSize) => this.dispatch('rms', rmsNormShader({ weightType: 'f32' }), [input, this.vectors.get(weight), output], new Uint32Array([tokens, width, 0, bits(this.layout.epsilon)]), [tokens, 1, 1], ctx);
    const add = (hidden, update) => this.dispatch('axpy', axpyShader(), [hidden, update], new Uint32Array([tokens * c.hiddenSize, bits(1), 0, 0]), [Math.ceil(tokens * c.hiddenSize / 256), 1, 1], ctx);
    try {
      checkAbort(ctx.signal);
      const input = this.upload(new Uint32Array(ids), scratch), hidden = f(tokens * c.hiddenSize), normalized = f(tokens * c.hiddenSize), update = f(tokens * c.hiddenSize);
      const gateUp = f(tokens * 2 * c.intermediateSize), activation = f(tokens * c.intermediateSize);
      const deltaWidth = 2 * c.linearKeyHeads * c.linearKeyDim + c.linearValueHeads * c.linearValueDim, valueWidth = c.linearValueHeads * c.linearValueDim;
      const mixed = f(tokens * deltaWidth), z = f(tokens * valueWidth), gates = f(tokens * 2 * c.linearValueHeads), convolved = f(tokens * deltaWidth), prepared = f(tokens * (deltaWidth + 2 * c.linearValueHeads)), recurrent = f(tokens * valueWidth), gatedDelta = f(tokens * valueWidth);
      const qw = c.queryHeads * c.headDim, kw = c.kvHeads * c.headDim;
      const qp = f(tokens * 2 * qw), kp = f(tokens * kw), vp = f(tokens * kw), q = f(tokens * qw), attention = f(tokens * qw), gatedAttention = f(tokens * qw);
      for (const part of this.weights.get('model.embed_tokens').slices) await this.dispatch('embedding', embeddingShader(), [input, part.weight, part.scales, part.biases, hidden], new Uint32Array([tokens, c.hiddenSize, part.rowStart, part.rows]), [Math.ceil(c.hiddenSize / 256), tokens, 1], ctx);
      for (let index = 0; index < c.numLayers; index++) {
        const root = `model.layers.${index}`, layer = state.layers[index];
        await norm(hidden, root + '.input_layernorm.weight', normalized);
        if (c.layers[index] === 'linear_attention') {
          const p = deltaParams({ tokens, keyHeads: c.linearKeyHeads, valueHeads: c.linearValueHeads, keyDim: c.linearKeyDim, valueDim: c.linearValueDim, kernel: c.convKernel, epsilon: this.layout.epsilon });
          await this.linear(root + '.linear_attn.in_proj_qkv', normalized, mixed, tokens, ctx);
          await this.linear(root + '.linear_attn.in_proj_z', normalized, z, tokens, ctx);
          await this.linear(root + '.linear_attn.in_proj_a', normalized, gates, tokens, ctx, { outputStride: 2 * c.linearValueHeads });
          await this.linear(root + '.linear_attn.in_proj_b', normalized, gates, tokens, ctx, { outputStride: 2 * c.linearValueHeads, outputOffset: c.linearValueHeads });
          await this.dispatch('delta-conv', kernels.deltaConvShader(), [mixed, this.vectors.get(root + '.linear_attn.conv1d.weight'), layer.history, convolved, layer.nextHistory], p, [Math.ceil(Math.max(tokens, c.convKernel - 1) * deltaWidth / 256), 1, 1], ctx);
          [layer.history, layer.nextHistory] = [layer.nextHistory, layer.history];
          await this.dispatch('delta-prepare', kernels.deltaPrepareShader(), [convolved, gates, this.vectors.get(root + '.linear_attn.joined'), prepared], p, [c.linearKeyHeads, tokens, 1], ctx);
          await this.dispatch('delta-recurrent', kernels.deltaRecurrentShader(), [prepared, layer.recurrent, recurrent], p, [c.linearValueHeads, 1, 1], ctx);
          await this.dispatch('delta-norm', kernels.deltaNormShader(), [recurrent, z, this.vectors.get(root + '.linear_attn.norm.weight'), gatedDelta], p, [c.linearValueHeads, tokens, 1], ctx);
          await this.linear(root + '.linear_attn.out_proj', gatedDelta, update, tokens, ctx);
        } else {
          const p = attentionParams({ tokens, queryHeads: c.queryHeads, kvHeads: c.kvHeads, headDim: c.headDim, rotaryDim: c.rotaryDim, pastTokens: state.length, capacity: state.capacity, ropeTheta: c.ropeTheta, epsilon: this.layout.epsilon });
          await this.linear(root + '.self_attn.q_proj', normalized, qp, tokens, ctx); await this.linear(root + '.self_attn.k_proj', normalized, kp, tokens, ctx); await this.linear(root + '.self_attn.v_proj', normalized, vp, tokens, ctx);
          await this.dispatch('attention-prepare', kernels.attentionPrepareShader({ headDim: c.headDim }), [qp, kp, vp, this.vectors.get(root + '.self_attn.joined'), q, layer.keys, layer.values], p, [c.queryHeads, tokens, 1], ctx);
          await this.dispatch('attention', createWebGpuTiledFlashAttentionShader({ headDim: c.headDim, causal: true }), [q, layer.keys, layer.values, attention], flashAttentionParams({ queryTokens: tokens, keyTokens: state.length + tokens, heads: c.queryHeads, kvHeads: c.kvHeads, headDim: c.headDim, causalOffset: state.length }), [Math.ceil(tokens / 64), c.queryHeads, 1], ctx);
          await this.dispatch('attention-gate', kernels.attentionGateShader(), [attention, qp, gatedAttention], p, [Math.ceil(tokens * qw / 256), 1, 1], ctx);
          await this.linear(root + '.self_attn.o_proj', gatedAttention, update, tokens, ctx);
        }
        await add(hidden, update); await norm(hidden, root + '.post_attention_layernorm.weight', normalized);
        await this.linear(root + '.mlp.gate_proj', normalized, gateUp, tokens, ctx, { outputStride: 2 * c.intermediateSize });
        await this.linear(root + '.mlp.up_proj', normalized, gateUp, tokens, ctx, { outputStride: 2 * c.intermediateSize, outputOffset: c.intermediateSize });
        await this.dispatch('swiglu', swigluShader(), [gateUp, activation], new Uint32Array([tokens, c.intermediateSize, 2 * c.intermediateSize, 0, c.intermediateSize, 0, 0, 0]), [Math.ceil(c.intermediateSize / 256), tokens, 1], ctx);
        await this.linear(root + '.mlp.down_proj', activation, update, tokens, ctx); await add(hidden, update);
        if (this.onLayer) await this.onLayer({ index, buffer: hidden, tokens, context: ctx });
      }
      await norm(hidden, 'model.norm.weight', normalized);
      if (this.onNorm) await this.onNorm({ buffer: normalized, tokens, context: ctx });
      const logits = f(c.vocabSize); await this.linear('lm_head', normalized, logits, 1, ctx, { inputOffset: (tokens - 1) * c.hiddenSize });
      const result = await this.read(logits, c.vocabSize, 0, ctx); state.length += tokens; return result;
    } finally { await this.device.queue.onSubmittedWorkDone().catch(() => {}); for (const buffer of scratch) buffer.destroy(); }
  }
  async disposeState(state) {
    if (state?.owner !== this) throw new Error('foreign generation state');
    if (state.closed) return;
    state.closed = true; state.abort.abort('generation state disposed');
    if (this.activeState === state) await this.active.catch(() => {});
    try { await this.device.queue.onSubmittedWorkDone(); }
    finally { for (const b of state.buffers) b.destroy(); state.buffers.clear(); this.states.delete(state); }
  }
  async destroy() {
    this.closed = true; this.lifetime.abort('model destroyed');
    if (this.loading) await this.loadingDone;
    if (this.active) await this.active.catch(() => {});
    const errors = [];
    for (const state of [...this.states]) try { await this.disposeState(state); } catch (error) { errors.push(error); }
    try { await this.device.queue.onSubmittedWorkDone(); } catch (error) { errors.push(error); }
    finally { for (const b of this.owned) b.destroy(); this.owned.clear(); this.weights.clear(); this.vectors.clear(); this.loaded = false; }
    if (errors.length) throw new AggregateError(errors, 'model cleanup failed: ' + errors.map(e => e.message).join('; '));
  }
}
