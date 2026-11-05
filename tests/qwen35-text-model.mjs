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
function fixture(configUrl = new URL('./fixtures/qwen35/config.json', import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(configUrl));
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
test('observed base-Qwen root embedding declaration is supported without admitting tied or conflicting layouts', () => {
  const { manifest } = fixture(new URL('./fixtures/qwen35/base-qwen-config.json', import.meta.url));
  assert.equal(manifest.config.tie_word_embeddings, false);
  assert.equal(Object.hasOwn(manifest.config.text_config, 'tie_word_embeddings'), false);
  assert.equal(qwen35ModelLayout(manifest).projections.size, 17);
  for (const mutate of [
    c => { c.tie_word_embeddings = true; },
    c => { delete c.tie_word_embeddings; },
    c => { c.text_config.tie_word_embeddings = true; },
    c => { c.tie_word_embeddings = true; c.text_config.tie_word_embeddings = false; },
    c => { c.text_config.tie_word_embeddings = null; },
  ]) {
    const bad = structuredClone(manifest); mutate(bad.config);
    assert.throws(() => qwen35ModelLayout(bad), /embedding|dense text-model/);
  }
  const matching = structuredClone(manifest); matching.config.text_config.tie_word_embeddings = false;
  assert.equal(qwen35ModelLayout(matching).projections.size, 17);
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

test('constructor admits only explicit single-token kernels without changing request state/control', async () => {
  const {manifest}=fixture(), {device}=deviceFixture(), control=createWebGpuInferenceControl({queue:device.queue});
  try {
    const model=new Qwen35TextModel(device,manifest,{control,singleTokenKernel:'quad'});
    assert.equal(model.singleTokenKernel,'quad'); assert.equal(model.states.size,0);
    assert.throws(()=>new Qwen35TextModel(device,manifest,{control,singleTokenKernel:'unknown'}),/kernel/);
    await model.destroy(); assert.equal(control.snapshot().status,'running');
  } finally {await control.close();}
});

function submissionCounter(device){
 const counts={submits:0,fences:0,dispatches:0}, submit=device.queue.submit, fence=device.queue.onSubmittedWorkDone, encoder=device.createCommandEncoder;
 device.queue.submit=(...args)=>{counts.submits++;return submit.apply(device.queue,args);};
 device.queue.onSubmittedWorkDone=(...args)=>{counts.fences++;return fence.apply(device.queue,args);};
 device.createCommandEncoder=(...args)=>{const e=encoder.apply(device,args),begin=e.beginComputePass;e.beginComputePass=(...params)=>{const p=begin.apply(e,params),dispatch=p.dispatchWorkgroups;p.dispatchWorkgroups=(...shape)=>{counts.dispatches++;return dispatch.apply(p,shape);};return p;};return e;};
 return counts;
}
test('optional cached layer batching preserves compute work while reducing actual submissions and fences',async(t)=>{
 const {manifest,fetchImpl}=fixture(),{device}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),counts=submissionCounter(device);
 const model=new Qwen35TextModel(device,manifest,{control});
 try{await model.load('http://localhost/model/',{fetchImpl});const state=await model.createState({capacity:6});await model.prefill([1,2],state);
 Object.assign(counts,{submits:0,fences:0,dispatches:0});await model.decode(3,state);const baseline={...counts};
 model.batchDecode=true;Object.assign(counts,{submits:0,fences:0,dispatches:0});await model.decode(4,state);const batched={...counts};
 assert.equal(batched.dispatches,baseline.dispatches,'every original compute pass must remain');
 assert.ok(batched.submits<baseline.submits,JSON.stringify({baseline,batched}));assert.ok(batched.fences<baseline.fences);
 assert.equal(model.layerBatchSubmissions,2);t.diagnostic(JSON.stringify({baseline,batched}));await model.disposeState(state);
 }finally{await model.destroy();await control.close();}
});
test('layer batching keeps uniforms alive through the admitted fence and lets a pause settle afterward',async()=>{
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control});
 assert.equal(typeof model.layerBatch,'function','admitted layer batching is required');
 model.pipeline=async()=>({getBindGroupLayout(){}});let release;const fence=new Promise(r=>release=r);device.queue.onSubmittedWorkDone=()=>fence;
 let settled=false;const work=model.layerBatch({control},async ctx=>{for(let i=0;i<2;i++)await model.dispatch('probe','',[],new Uint32Array([1,0,0,0]),[1,1,1],ctx);}).then(()=>{settled=true;});
 await new Promise(setImmediate);assert.equal(model.layerBatchSubmissions,1);assert.ok(buffers.every(b=>!b.destroyed));
 const pause=control.pause();await new Promise(setImmediate);assert.equal(settled,false);assert.equal(control.snapshot().status,'pausing');
 release();await work;await pause;assert.ok(buffers.every(b=>b.destroyed));assert.equal(control.snapshot().status,'paused');
 await control.resume();await model.destroy();await control.close();
});
test('aborting an encoded layer discards its commands and fences pending uniform uploads before retirement',async()=>{
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control});
 assert.equal(typeof model.layerBatch,'function','admitted layer batching is required');
 const counts=submissionCounter(device),abort=new AbortController();model.pipeline=async()=>({getBindGroupLayout(){}});
 await assert.rejects(model.layerBatch({control,signal:abort.signal},async ctx=>{await model.dispatch('probe','',[],new Uint32Array([1,0,0,0]),[1,1,1],ctx);abort.abort('stop');}),e=>e.name==='AbortError');
 assert.equal(counts.submits,0);assert.ok(counts.fences>0);assert.ok(buffers.every(b=>b.destroyed));
 await model.destroy();await control.close();
});
test('batch validation and queue failures remain failures with all temporary buffers retired',async()=>{
 for(const kind of ['validation','fence']){
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control});
 assert.equal(typeof model.layerBatch,'function','admitted layer batching is required');
 model.pipeline=async()=>({getBindGroupLayout(){}});
 if(kind==='validation')device.popErrorScope=async()=>({message:'bad batch binding'});else device.queue.onSubmittedWorkDone=async()=>{throw new Error('batch fence failed');};
 await assert.rejects(model.layerBatch({control},ctx=>model.dispatch('probe','',[],new Uint32Array([1,0,0,0]),[1,1,1],ctx)),/batch|binding/);
 assert.ok(buffers.every(b=>b.destroyed));device.queue.onSubmittedWorkDone=async()=>{};await model.destroy();await control.close();
 }
});
test('batching defaults off and rejects unsupported values or changes during active model work',()=>{
 const {manifest}=fixture(),{device}=deviceFixture(),control={runDuty:async work=>work()};
 const model=new Qwen35TextModel(device,manifest,{control});assert.equal(model.batchDecode,false);
 assert.throws(()=>{model.batchDecode='yes';},/batch/);model.active=Promise.resolve();assert.throws(()=>{model.batchDecode=true;},/active/);
});

test('a cancelled parked layer admits no writes and does not resume its borrowed control',async()=>{
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control});
 await control.pause();const abort=new AbortController();
 const work=model.layerBatch({control,signal:abort.signal},async ctx=>model.dispatch('probe','',[],new Uint32Array([1,0,0,0]),[1,1,1],ctx));
 await new Promise(setImmediate);abort.abort('withdraw parked layer');await assert.rejects(work,e=>e.name==='AbortError');
 assert.equal(buffers.length,0);assert.equal(model.layerBatchSubmissions,0);assert.equal(control.snapshot().status,'paused');
 await model.destroy();await control.resume();await control.close();
});

test('a final one-token prefill chunk retains fine duties and only a logical decode batches',async()=>{
 const {manifest,fetchImpl}=fixture(),{device}=deviceFixture();device.limits.maxStorageBufferBindingSize=32768;
 const control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control,batchDecode:true});
 try{await model.load('http://localhost/model/',{fetchImpl});const state=await model.createState({capacity:34});
 await model.prefill(Array.from({length:33},(_,i)=>i%64),state);assert.equal(state.length,33);assert.equal(model.layerBatchSubmissions,0);
 await model.decode(4,state);assert.equal(model.layerBatchSubmissions,2);await model.disposeState(state);
 }finally{await model.destroy();await control.close();}
});

test('closed encoding contexts and nested layer batches cannot enqueue additional work',async()=>{
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control});
 model.pipeline=async()=>({getBindGroupLayout(){}});let retained;
 try{await model.layerBatch({control},async ctx=>{retained=ctx;await model.dispatch('probe','',[],new Uint32Array([1,0,0,0]),[1,1,1],ctx);});
 const before=buffers.length;await assert.rejects(model.dispatch('late','',[],new Uint32Array([1,0,0,0]),[1,1,1],retained),/closed/);assert.equal(buffers.length,before);
 await assert.rejects(model.layerBatch({control},ctx=>model.layerBatch(ctx,async()=>{})),/nested/);
 }finally{await model.destroy();await control.close();}
});

test('pipeline cache evaluates shader factories once across concurrent and later uses', async () => {
  const { manifest } = fixture(), { device } = deviceFixture();
  const model = new Qwen35TextModel(device, manifest, { control: { runDuty: work => work() } });
  const source = '@compute @workgroup_size(1) fn main() {}';
  let built = 0, modules = 0, compiled = 0;
  device.createShaderModule = ({ code }) => { assert.equal(code, source); modules++; return { getCompilationInfo: async () => ({ messages: [] }) }; };
  const pipeline = { getBindGroupLayout() {} };
  device.createComputePipelineAsync = async () => { compiled++; return pipeline; };
  const factory = () => { built++; return source; };
  const values = await Promise.all([model.pipeline('probe', factory), model.pipeline('probe', factory)]);
  assert.deepEqual(values, [pipeline, pipeline]);
  assert.equal(await model.pipeline('probe', () => { throw new Error('cache hit rebuilt source'); }), pipeline);
  assert.deepEqual({ built, modules, compiled }, { built: 1, modules: 1, compiled: 1 });
  assert.equal(await model.pipeline('literal', source), pipeline, 'existing literal callers remain supported');
  const failed = () => { built++; throw new Error('source construction failed'); };
  await assert.rejects(model.pipeline('failed', failed), /source construction failed/);
  await assert.rejects(model.pipeline('failed', failed), /source construction failed/);
  assert.equal(built, 2, 'failed pipeline promises retain the same failure without rebuilding');
  await model.destroy();
});

test('prefill and both decode routes defer sources and compile each named shader once', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture();
  const model = new Qwen35TextModel(device, manifest, { control: { runDuty: work => work() } });
  const original = model.pipeline.bind(model), builds = new Map(), supplied = new Set();
  model.pipeline = (name, factory) => {
    assert.equal(typeof factory, 'function', `${name} source must be deferred until a cache miss`);
    supplied.add(name);
    return original(name, () => { builds.set(name, (builds.get(name) ?? 0) + 1); const source = factory(); assert.equal(typeof source, 'string'); return source; });
  };
  try {
    await model.load('http://localhost/model/', { fetchImpl });
    const state = await model.createState({ capacity: 6 });
    await model.prefill([1, 2], state); await model.decode(3, state);
    model.singleTokenKernel = 'quad'; model.batchDecode = true;
    await model.decode(4, state); await model.decode(5, state);
    assert.ok(supplied.has('affine') && supplied.has('affine-quad') && supplied.has('affine-tiled') && supplied.has('attention'));
    assert.equal(builds.size, supplied.size); assert.ok([...builds.values()].every(n => n === 1));
    assert.equal(state.length, 5); await model.disposeState(state);
  } finally { await model.destroy(); }
});

test('single-query attention is explicit and only selected for one-token work', async () => {
  const { manifest, fetchImpl } = fixture(), { device } = deviceFixture();
  const model = new Qwen35TextModel(device, manifest, { control: { runDuty: work => work() }, decodeAttention: 'single-query' });
  const names = [], dispatch = model.dispatch.bind(model);
  model.dispatch = (name, ...args) => { names.push(name); return dispatch(name, ...args); };
  try {
    assert.equal(model.decodeAttention, 'single-query');
    await model.load('http://localhost/model/', { fetchImpl });
    const state = await model.createState({ capacity: 4 });
    await model.prefill([1, 2], state);
    assert.ok(names.includes('attention')); assert.ok(!names.includes('attention-single-query'));
    names.length = 0; await model.decode(3, state);
    assert.ok(names.includes('attention-single-query')); assert.ok(!names.includes('attention'));
    model.decodeAttention = 'tiled'; names.length = 0; await model.decode(4, state);
    assert.ok(names.includes('attention')); assert.ok(!names.includes('attention-single-query'));
    assert.throws(() => { model.decodeAttention = 'unknown'; }, /attention/);
    model.active = Promise.resolve(); assert.throws(() => { model.decodeAttention = 'single-query'; }, /active/); model.active = null;
  } finally { await model.destroy(); }
});

// Resource reuse is observed through the device, independently of pool internals.
test('cached decode reuses uniforms only after the previous layer fence and retires them with state', async () => {
 const {manifest,fetchImpl}=fixture(),{device,buffers}=deviceFixture();
 const control=createWebGpuInferenceControl({queue:device.queue}), model=new Qwen35TextModel(device,manifest,{control,batchDecode:true});
 const uniforms=new Set(), writes=new Map();let epoch=0,reuses=0;
 const create=device.createBuffer.bind(device);device.createBuffer=options=>{const b=create(options);if(options.usage & GPUBufferUsage.UNIFORM)uniforms.add(b);return b;};
 device.queue.onSubmittedWorkDone=async()=>{epoch++;};
 device.queue.writeBuffer=(b,offset,data)=>{if(uniforms.has(b)){assert.equal(b.destroyed,false);if(writes.has(b)){assert.ok(epoch>writes.get(b),'cannot overwrite a uniform before its consuming layer completes');reuses++;}writes.set(b,epoch);}};
 try {
  await model.load('http://localhost/model/',{fetchImpl});const state=await model.createState({capacity:6});await model.prefill([1,2],state);
  const before=buffers.length;reuses=0;await model.decode(3,state);
  assert.ok(reuses>0,'cached layers must reuse uniform allocations');
  const workspace=buffers.slice(before);assert.ok(workspace.some(b=>!b.destroyed),'decode workspace must survive token completion');
  const count=buffers.length;await model.decode(4,state);assert.equal(buffers.length,count,'warm decode must create no GPU buffers');
  await model.disposeState(state);assert.ok(workspace.every(b=>b.destroyed),'state disposal retires its workspace');
 }finally{await model.destroy();await control.close();}
});
test('cached decode retires reused uniforms on validation, fence, and cancellation failures', async () => {
 for(const failure of ['validation','fence','abort']){
  const {manifest,fetchImpl}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue});
  const model=new Qwen35TextModel(device,manifest,{control,batchDecode:true}),abort=new AbortController();
  try{
   await model.load('http://localhost/model/',{fetchImpl});const state=await model.createState({capacity:4});await model.prefill([1,2],state);
   const before=buffers.length;await model.decode(3,state);
   model.onLayer=async({index})=>{if(index===0){if(failure==='validation')device.popErrorScope=async()=>({message:'bad reused binding'});else if(failure==='fence')device.queue.onSubmittedWorkDone=async()=>{throw Error('lost queue');};else abort.abort('stop decode');}};
   await assert.rejects(model.decode(4,state,{signal:abort.signal}),/binding|queue|stop decode/);
   assert.equal(state.failed,true);assert.ok(buffers.slice(before).every(b=>b.destroyed));
  }finally{device.queue.onSubmittedWorkDone=async()=>{};await model.destroy();await control.close();}
 }
});

test('decode workspace survives intervening prefill without retaining its larger allocations and stays state-local', async () => {
 const {manifest,fetchImpl}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue});
 const model=new Qwen35TextModel(device,manifest,{control,batchDecode:true});
 try{
  await model.load('http://localhost/model/',{fetchImpl});const a=await model.createState({capacity:20}),b=await model.createState({capacity:8});
  await model.prefill([1,2],a);const start=buffers.length;await model.decode(3,a);const aw=buffers.slice(start);
  const prefillStart=buffers.length;await model.append([4,5,6,7],a);assert.ok(buffers.slice(prefillStart).every(x=>x.destroyed),'multi-token scratch is temporary');
  const warm=buffers.length;await model.decode(8,a);assert.equal(buffers.length,warm,'prefill must not displace decode workspace');
  await model.prefill([9,10],b);const bs=buffers.length;await model.decode(11,b);const bw=buffers.slice(bs);
  assert.ok(bw.some(x=>!x.destroyed));assert.ok(aw.some(x=>!x.destroyed));
  await model.disposeState(a);assert.ok(aw.every(x=>x.destroyed));assert.ok(bw.every(x=>!x.destroyed));
  const before=buffers.length;await model.decode(12,b);assert.equal(buffers.length,before);await model.disposeState(b);assert.ok(bw.every(x=>x.destroyed));
 }finally{await model.destroy();await control.close();}
});
test('workspace retirement waits for an in-flight logits readback and rejects overlapping decode', async () => {
 const {manifest,fetchImpl}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue});
 const model=new Qwen35TextModel(device,manifest,{control,batchDecode:true});
 try{
  await model.load('http://localhost/model/',{fetchImpl});const state=await model.createState({capacity:8});await model.prefill([1,2],state);
  let release,entered;const mapped=new Promise(r=>entered=r),pending=new Promise(r=>release=r);const before=buffers.length,create=device.createBuffer.bind(device);
  device.createBuffer=o=>{const b=create(o);if(o.usage & GPUBufferUsage.MAP_READ)b.mapAsync=()=>{entered();return pending;};return b;};
  const work=model.decode(3,state);await mapped;const owned=buffers.slice(before).filter(x=>!x.destroyed);
  await assert.rejects(model.decode(4,state),/concurrent/);let disposed=false;const disposal=model.disposeState(state).then(()=>{disposed=true;});
  await new Promise(setImmediate);assert.equal(disposed,false);assert.ok(owned.every(x=>!x.destroyed));
  release();await assert.rejects(work,/disposed/);await disposal;assert.ok(owned.every(x=>x.destroyed));
 }finally{await model.destroy();await control.close();}
});

test('native delta mode is explicit and invalidates every language state before switching',async()=>{
 const {manifest,fetchImpl}=fixture(),{device}=deviceFixture(),model=new Qwen35TextModel(device,manifest,{control:{runDuty:f=>f()}});
 try{
  await model.load('http://localhost/model/',{fetchImpl});
  assert.equal(typeof model.setDeltaMode,'function','native model must expose the actual weight-mode switch');
  await assert.rejects(model.setDeltaMode({enabled:true,rank:4}),/adapter/);
  // Loaded adapter fixture represents already validated, GPU-resident sidecar state.
  const baseVectors=model.vectors, enabledVectors=new Map(baseVectors);
  model.delta={maxRank:8,enabled:false,rank:8,baseVectors,enabledVectors,owned:new Set(),projections:new Map(),exact:new Map()};
  const a=await model.createState({capacity:4}),b=await model.createState({capacity:4});
  await model.setDeltaMode({enabled:true,rank:4});assert.equal(model.states.size,0);assert.ok(a.closed&&b.closed);assert.equal(model.vectors,enabledVectors);
  await assert.rejects(model.prefill([1],a),/state/);
  const c=await model.createState({capacity:4});await model.setDeltaMode({enabled:true,rank:4});assert.equal(c.closed,false,'unchanged mode retains state');
  await model.setDeltaMode({enabled:false});assert.equal(c.closed,true);assert.equal(model.vectors,baseVectors);
  await assert.rejects(model.setDeltaMode({enabled:true,rank:9}),/rank/);assert.equal(model.delta.enabled,false);
  model.active=Promise.resolve();await assert.rejects(model.setDeltaMode({enabled:true,rank:4}),/active/);model.active=null;
 }finally{model.active=null;await model.destroy();}
});

test('adapter loading rejects ambiguous targets before any GPU upload',async()=>{
 const {manifest}=fixture(),{device,buffers}=deviceFixture(),model=new Qwen35TextModel(device,manifest,{control:{runDuty:f=>f()}});
 manifest.source={baseRole:'qwen',sourceRevision:'source',configSha256:'config'};
 const delta={schema:'kaminos.qwen35-delta.v1',complete:true,maxRank:3,qwenRevision:'source',baseConfigSha256:'config',projections:{},exact:{}};
 for(const [name,e]of model.layout.projections){delta.projections[name]={a:{shape:[3,e.columns]},b:{shape:[e.rows,3]}};}
 for(const [name,row]of model.layout.vectors)delta.exact[name]={shape:row.shape};
 delta.exact['lm_head.weight']={shape:[64,64]};model.loaded=true;
 const before=buffers.length;await assert.rejects(model.loadDelta(delta,'http://fixture/'),/ambiguous/);assert.equal(buffers.length,before);
 await model.destroy();
});

test('choosing adapter rank while disabled preserves base-model cache and reports the chosen rank',async()=>{
 const {manifest,fetchImpl}=fixture(),{device}=deviceFixture(),model=new Qwen35TextModel(device,manifest,{control:{runDuty:f=>f()}});
 try{await model.load('http://localhost/model/',{fetchImpl});model.delta={maxRank:8,rank:8,enabled:false,baseVectors:model.vectors,enabledVectors:new Map(model.vectors)};
 const state=await model.createState({capacity:4});const result=await model.setDeltaMode({enabled:false,rank:3});assert.equal(result.rank,3);assert.equal(model.delta.rank,3);assert.equal(result.reset,false);assert.equal(state.closed,false);
 }finally{await model.destroy();}
});

function deltaFixture(model){
 model.manifest.source={baseRole:'qwen',sourceRevision:'source',configSha256:'config'};
 const manifest={schema:'kaminos.qwen35-delta.v1',complete:true,maxRank:3,qwenRevision:'source',baseConfigSha256:'config',projections:{},exact:{}},blobs=new Map();
 function row(shape){const raw=new Uint8Array(shape.reduce((a,b)=>a*b,1)*4),file=`delta-${blobs.size}.bin`;blobs.set(file,raw);return{file,shape,dtype:'F32',offset:0,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};}
 for(const[name,e]of model.layout.projections)manifest.projections[name]={a:row([3,e.columns]),b:row([e.rows,3])};
 for(const[name,e]of model.layout.vectors)manifest.exact[name]=row(e.shape);
 return{manifest,fetchImpl:async url=>{const raw=blobs.get(new URL(url).pathname.split('/').at(-1));return new Response(raw,{status:206,headers:{'content-range':`bytes 0-${raw.length-1}/${raw.length+1}`}});}};
}
test('cancel and destroy withdraw a parked adapter upload without resuming the borrowed control',async()=>{
 for(const action of ['cancel','destroy']){
  const{manifest,fetchImpl}=fixture(),{device,buffers}=deviceFixture(),control=createWebGpuInferenceControl({queue:device.queue}),model=new Qwen35TextModel(device,manifest,{control}),abort=new AbortController();let work,close,result;
  try{
   await model.load('http://localhost/model/',{fetchImpl});const delta=deltaFixture(model);await control.pause();
   let entered;const parked=new Promise(r=>entered=r),runDuty=control.runDuty.bind(control);model.control={runDuty:(...args)=>{entered();return runDuty(...args);}};
   work=model.loadDelta(delta.manifest,'http://localhost/adapter/',{fetchImpl:delta.fetchImpl,signal:abort.signal}).then(()=>{result='loaded';},e=>{result=e;});await parked;
   if(action==='cancel')abort.abort('cancel adapter');else close=model.destroy();
   await new Promise(setImmediate);await new Promise(setImmediate);
   const settled=result?.name==='AbortError',loading=model.loading,status=control.snapshot().status;
   // Cleanup permits the original broken implementation to unwind after observation.
   await control.resume();await work;await close;
   assert.equal(settled,true,`${action} must settle while admission stays parked`);assert.equal(loading,false);assert.equal(status,'paused');
  }finally{await control.resume();await work;await close;await model.destroy();await control.close();}
  assert.ok(buffers.every(b=>b.destroyed));
 }
});
