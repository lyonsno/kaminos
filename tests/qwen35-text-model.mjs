// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Qwen35TextModel } from '../models/qwen3_5/text-model.js';
import { qwen35ModelLayout } from '../models/qwen3_5/model-layout.js';
import { createWebGpuInferenceControl } from '../webgpu-inference-kit/src/inference-control.js';
import { generateTokens } from '../webgpu-inference-kit/src/autoregressive-generation.js';
import { expandPupText } from '../models/qwen3_5/pup-text.js';

// Host-lifecycle fixture only. Fake GPU commands establish no numerical claim.
function fixture() {
  const config = JSON.parse(fs.readFileSync(new URL('./fixtures/qwen35/config.json', import.meta.url)));
  Object.assign(config.text_config, { hidden_size: 64, intermediate_size: 128, vocab_size: 64, num_hidden_layers: 2,
    layer_types: ['linear_attention', 'full_attention'], num_attention_heads: 4, num_key_value_heads: 2, head_dim: 16,
    linear_num_key_heads: 2, linear_num_value_heads: 4, linear_key_head_dim: 8, linear_value_head_dim: 16 });
  const manifest = { schema: 'kaminos.qwen35-text-weights.v1', config, tensors: {} }, blobs = new Map();
  function tensor(name, shape, dtype = 'BF16') {
    const bytes = shape.reduce((a, b) => a * b, 1) * (dtype === 'BF16' ? 2 : 4), raw = new Uint8Array(bytes), file = `tensor-${blobs.size}.bin`;
    manifest.tensors[name] = { shape, dtype, bytes, file, offset: 0, sha256: createHash('sha256').update(raw).digest('hex') }; blobs.set(file, raw);
  }
  function linear(name, rows, columns) { tensor(name + '.weight', [rows, columns / 8], 'U32'); tensor(name + '.scales', [rows, columns / 64]); tensor(name + '.biases', [rows, columns / 64]); }
  linear('model.embed_tokens', 64, 64); linear('lm_head', 64, 64); tensor('model.norm.weight', [64]);
  for (let i = 0; i < 2; i++) {
    const root = `model.layers.${i}`;
    tensor(root + '.input_layernorm.weight', [64]); tensor(root + '.post_attention_layernorm.weight', [64]);
    linear(root + '.mlp.gate_proj', 128, 64); linear(root + '.mlp.up_proj', 128, 64); linear(root + '.mlp.down_proj', 64, 128);
    if (!i) {
      for (const [name, rows] of [['in_proj_qkv', 96], ['in_proj_z', 64], ['in_proj_a', 4], ['in_proj_b', 4], ['out_proj', 64]]) linear(root + '.linear_attn.' + name, rows, 64);
      tensor(root + '.linear_attn.conv1d.weight', [96, 4, 1]); tensor(root + '.linear_attn.A_log', [4]); tensor(root + '.linear_attn.dt_bias', [4]); tensor(root + '.linear_attn.norm.weight', [16]);
    } else {
      for (const [name, rows] of [['q_proj', 128], ['k_proj', 32], ['v_proj', 32], ['o_proj', 64]]) linear(root + '.self_attn.' + name, rows, 64);
      tensor(root + '.self_attn.q_norm.weight', [16]); tensor(root + '.self_attn.k_norm.weight', [16]);
    }
  }
  const fetchImpl = async url => { const b = blobs.get(new URL(url).pathname.split('/').at(-1)); return new Response(b, { status: 206, headers: { 'content-range': `bytes 0-${b.length - 1}/${b.length + 1}` } }); };
  return { manifest, fetchImpl };
}
function deviceFixture() {
  globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 }; globalThis.GPUMapMode = { READ: 1 };
  const buffers = [], queue = { onSubmittedWorkDone: async () => {}, writeBuffer() {}, submit() {} };
  const device = { queue, limits: { maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024, maxComputeWorkgroupsPerDimension: 65535 },
    createBuffer({ size }) { const b = { size, destroyed: false, destroy() { this.destroyed = true; }, mapAsync: async () => {}, getMappedRange: () => new ArrayBuffer(size), unmap() {} }; buffers.push(b); return b; },
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout() {} }), createBindGroup() {}, pushErrorScope() {}, popErrorScope: async () => null,
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish() {}, beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }) }),
  };
  return { device, buffers };
}
test('model layout requires all projections and direct source norm shapes', () => {
  const { manifest } = fixture(), layout = qwen35ModelLayout(manifest);
  assert.equal(layout.projections.size, 17); assert.equal(layout.vectors.size, 11);
  const missing = structuredClone(manifest); delete missing.tensors['lm_head.biases']; assert.throws(() => qwen35ModelLayout(missing), /lm_head.biases/);
  const wrong = structuredClone(manifest); wrong.tensors['model.layers.1.self_attn.k_norm.weight'].shape = [32]; assert.throws(() => qwen35ModelLayout(wrong), /k_norm/);
  const quant = structuredClone(manifest); quant.config.quantization.bits = 8; assert.throws(() => qwen35ModelLayout(quant), /quantization/);
});
test('request validation precedes allocation and model teardown preserves borrowed device/control', async () => {
  const { manifest, fetchImpl } = fixture(), { device, buffers } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  const before = buffers.length; await assert.rejects(model.createState({ capacity: 0 }), /capacity/); assert.equal(buffers.length, before);
  const state = await model.createState({ capacity: 4 });
  await assert.rejects(model.decode(0, state), /prefix/); await assert.rejects(model.prefill([64], state), /vocabulary/); assert.equal(state.length, 0);
  await model.disposeState(state); assert.equal(model.states.size, 0); await model.destroy();
  assert.ok(buffers.every(b => b.destroyed)); assert.equal(control.snapshot().status, 'running'); await control.close();
});
test('disposal destroys owned state even when its queue fence rejects', async () => {
  const { manifest, fetchImpl } = fixture(), { device, buffers } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  const state = await model.createState({ capacity: 4 }), owned = [...state.buffers];
  device.queue.onSubmittedWorkDone = async () => { throw new Error('lost queue'); };
  await assert.rejects(model.disposeState(state), /lost queue/); assert.ok(owned.every(b => b.destroyed)); assert.equal(model.states.size, 0);
  await assert.rejects(model.destroy(), /lost queue/); assert.ok(buffers.every(b => b.destroyed));
});
test('disposing a parked request releases it without resuming its borrowed control', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  const state = await model.createState({ capacity: 4 }); await control.pause();
  const work = model.prefill([1, 2], state).catch(error => error);
  await new Promise(setImmediate);
  let settled = false; const disposal = model.disposeState(state).then(() => { settled = true; });
  await new Promise(setImmediate); const disposedWhileParked = settled && state.closed;
  const status = control.snapshot().status;
  await control.resume(); await work; await disposal; await model.destroy(); await control.close();
  assert.equal(status, 'paused'); assert.ok(disposedWhileParked);
});
test('concurrent disposal callers both wait for the state retirement fence', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  const state = await model.createState({ capacity: 4 });
  let release; const fence = new Promise(resolve => { release = resolve; }); device.queue.onSubmittedWorkDone = () => fence;
  const first = model.disposeState(state); let secondFinished = false;
  const second = model.disposeState(state).then(() => { secondFinished = true; });
  await new Promise(setImmediate); const retiredEarly = secondFinished;
  release(); await first; await second; await model.destroy(); await control.close();
  assert.equal(retiredEarly, false); assert.equal(state.buffers.size, 0);
});
test('prefill splits only at device capacity and consumes every input token before predicting', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture(); device.limits.maxStorageBufferBindingSize = 32768;
  const control = createWebGpuInferenceControl({ queue: device.queue }), model = new Qwen35TextModel(device, manifest, { control });
  await model.load('http://localhost/model/', { fetchImpl }); const state = await model.createState({ capacity: 65 }), calls = [];
  model.forward = async (ids, s, context, predict) => { calls.push({ ids, predict }); s.length += ids.length; return predict ? new Float32Array(64) : null; };
  const input = Array.from({ length: 65 }, (_, i) => i % 64); await model.prefill(input, state);
  await model.destroy(); await control.close();
  assert.deepEqual(calls.map(c => c.ids.length), [32, 32, 1]); assert.deepEqual(calls.flatMap(c => c.ids), input);
  assert.deepEqual(calls.map(c => c.predict), [false, false, true]); assert.equal(state.length, 65);
});
test('generation and PUP consumers inherit the existing model control when request control is omitted', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  try {
    const generated = await generateTokens({ model, inputIds: [1, 2], capacity: 2, maxNewTokens: 1, sample: () => 0 });
    assert.deepEqual(generated.tokenIds, [0]);
    const tokenizer = { added: new Map([['<|im_end|>', 62], ['<|endoftext|>', 63]]), encode: () => [1, 2], createDecoder: () => ({ push: () => 'caption', end: () => '' }) };
    const expanded = await expandPupText({ model, tokenizer, prompt: 'fox', systemPrompt: 'expand', maxNewTokens: 1 }); assert.equal(expanded.text, 'caption');
    const other = createWebGpuInferenceControl({ queue: device.queue }), state = await model.createState({ capacity: 2, control: other });
    assert.equal(state.control, other); await model.disposeState(state); await other.close(); assert.equal(model.states.size, 0);
  } finally { await model.destroy(); await control.close(); }
});
test('paused model requests enqueue no token upload before a leaf duty is admitted', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture(), control = createWebGpuInferenceControl({ queue: device.queue });
  const model = new Qwen35TextModel(device, manifest, { control }); await model.load('http://localhost/model/', { fetchImpl });
  const state = await model.createState({ capacity: 4 }); await control.pause(); let writes = 0; device.queue.writeBuffer = () => { writes++; };
  const work = model.prefill([1, 2], state).catch(error => error); await new Promise(setImmediate); const beforeAdmission = writes;
  await model.disposeState(state); const failure = await work; assert.equal(failure.name, 'AbortError'); assert.equal(control.snapshot().status, 'paused');
  await model.destroy(); await control.resume(); await control.close(); assert.equal(beforeAdmission, 0); assert.equal(writes, 0);
});
