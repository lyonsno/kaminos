// kaminos-test: node
// Production generation/control flow with finite model/device doubles, not a GPU parity test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';

globalThis.GPUBufferUsage ??= { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, STORAGE: 128 };
globalThis.GPUMapMode ??= { READ: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const frame = { width: 2, height: 2, rgba: new Uint8ClampedArray(16) };

function harness() {
  const reads = [], phases = [], boundaries = [];
  let decodeGate = null, skip = false;
  const device = {
    queue: { submit() {}, onSubmittedWorkDone: async () => {} },
    createBuffer: ({ size }) => ({ size, destroy() {}, mapAsync: async () => {}, unmap() {}, getMappedRange: () => new ArrayBuffer(size) }),
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  };
  const pipeline = new KleinPipeline(device);
  pipeline.sched = {
    stats: { history: [] }, setSchedule() {}, discard: async () => {}, flush: async () => {},
    encoder: () => device.createCommandEncoder(), boundary: async name => { boundaries.push(name); },
  };
  pipeline.transformer = {
    cfg: { joint_attention_dim: 1 }, act: { promptEmbeds: {}, latents: {}, velocity: {} },
    allocate() {}, prepare() {}, forward: async () => {}, eulerStep: async () => {}, release() {}, destroy() {},
  };
  pipeline.textEncoder = { assertActivationFits() {}, allocate() {}, encode: async () => {}, destroy() {} };
  pipeline.teManifest = { config: { hidden_size: 1 } };
  pipeline.fetchEmbeddingRows = async ids => new Map(ids.map(id => [id, new ArrayBuffer(2)]));
  pipeline.sizeLimits = () => ({ fits: true, maxTextTokens: 1, cap: 1024 });
  pipeline.framePrompt = () => ({ inputIds: [0], attentionMask: [1], length: 1 });
  pipeline.vae = {
    sched: pipeline.sched, prepPreview() {}, allocateInput() {}, prepLatents() {}, allocate() {},
    decode: async () => { await decodeGate?.promise; }, release() {}, destroy() {},
  };
  pipeline.preview = {
    encode() { if (skip) return null; const read = deferred(); reads.push(read); return () => read.promise; }, destroy() {},
  };
  return {
    pipeline, reads, phases, boundaries,
    holdDecode() { decodeGate = deferred(); return decodeGate; },
    skipPreviews() { skip = true; },
    run(onPreview, schedule = null) {
      return pipeline.generate({ prompt: 'test', width: 16, height: 16, steps: 2, textLength: 1,
        onPreview, schedule, onPhase: phase => phases.push(phase) });
    },
  };
}

test('unresolved LAST preview readback does not hold final decode, completion, reuse or destroy', async () => {
  const h = harness(), delivered = [];
  const first = h.run(image => delivered.push(image));
  const outcomes = [];
  first.then(result => outcomes.push(result));
  await tick();
  assert.deepEqual(h.phases, ['text', 'denoise', 'decode']);
  assert.equal(h.reads.length, 2);
  assert.equal(outcomes.length, 1, 'final image must not join either preview readback');
  assert.equal(outcomes[0].rgba.length, 16 * 16 * 4);
  assert.equal(outcomes[0].sampling.stepsCompleted, 2);
  const gate = h.holdDecode();
  const next = h.run(image => delivered.push(image));
  await tick();
  h.reads[1].resolve(frame);
  h.reads[0].resolve(frame);
  await tick();
  assert.deepEqual(delivered, [], 'retired preview must not publish into the next run');
  gate.resolve(); await next;
  await h.pipeline.destroy();
  h.reads[3].resolve(frame); await tick();
  assert.deepEqual(delivered, [], 'destroyed pipeline cannot publish a late frame');
});

test('an unresolved LAST observer does not hold completion; active frames arrive in step order', async () => {
  const h = harness(), gate = h.holdDecode(), observer = deferred(), steps = [];
  const run = h.run(image => { steps.push(image.step); return observer.promise; });
  await tick();
  h.reads[1].resolve(frame); await tick();
  h.reads[0].resolve(frame); await tick();
  assert.deepEqual(steps, [2], 'older readback cannot overwrite the latest step');
  gate.resolve(); const outcomes = [];
  run.then(result => outcomes.push(result)); await tick();
  assert.equal(outcomes.length, 1, 'completion must not join the observer promise');
  observer.resolve(); await h.pipeline.destroy();
});

test('aborted and failed generations retire preview delivery', async () => {
  for (const failure of ['abort', 'decode']) {
    const h = harness(), gate = h.holdDecode(), delivered = [], abort = new AbortController();
    const run = h.run(image => delivered.push(image), { signal: abort.signal });
    const outcome = run.then(result => ({ result }), error => ({ error }));
    await tick();
    if (failure === 'abort') abort.abort();
    else { gate.reject(new Error('decode failed')); assert.match((await outcome).error.message, /decode failed/); }
    h.reads[1].resolve(frame); await tick();
    assert.deepEqual(delivered, [], `${failure} must suppress late preview`);
    if (failure === 'abort') { gate.resolve(); await outcome; }
    await h.pipeline.destroy();
  }
});

for (const failure of ['readback', 'throw', 'reject']) test(`${failure}: preview failure is diagnostic, not an unhandled rejection or model failure`, async t => {
  const diagnostics = [];
  t.mock.method(console, 'warn', (...args) => diagnostics.push(args));
    const h = harness(), gate = h.holdDecode();
    const error = new Error(failure);
    const run = h.run(() => { if (failure === 'throw') throw error; return Promise.reject(error); });
    await tick();
    if (failure === 'readback') h.reads[1].reject(error);
    else h.reads[1].resolve(frame);
    await tick();
    assert.equal(diagnostics.at(-1)?.[1], error, `${failure} must remain diagnosable`);
    gate.resolve(); assert.equal((await run).sampling.stepsCompleted, 2);
    await h.pipeline.destroy();
});

test('busy preview slots do not prevent the real generation loop from producing the final image', async () => {
  const h = harness(); h.skipPreviews();
  const result = await h.run(() => assert.fail('no preview was acquired'));
  assert.equal(result.sampling.stepsCompleted, 2);
  assert.deepEqual(h.phases, ['text', 'denoise', 'decode']);
  assert.equal(h.reads.length, 0);
  await h.pipeline.destroy();
});
