// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateTokens } from '../webgpu-inference-kit/src/autoregressive-generation.js';
import { sampleToken } from '../webgpu-inference-kit/src/token-sampling.js';
import { createWebGpuInferenceControl } from '../webgpu-inference-kit/src/inference-control.js';

function modelFixture(outputs = [2, 3, 9], fail = null) {
  const calls = [], states = [];
  const logits = token => Array.from({ length: 10 }, (_, i) => i === token ? 1 : 0);
  const model = {
    async createState({ capacity }) { const state = { capacity, ids: [] }; states.push(state); calls.push('create'); return state; },
    async prefill(ids, state) { calls.push(['prefill', [...ids]]); state.ids.push(...ids); if (fail === 'prefill') throw new Error('prefill failed'); return logits(outputs[0]); },
    async decode(id, state) { calls.push(['decode', id]); state.ids.push(id); if (fail === 'decode') throw new Error('decode failed'); return logits(outputs[state.ids.length - 2]); },
    async disposeState(state) { calls.push('dispose'); state.disposed = true; if (fail === 'dispose') throw new Error('dispose failed'); },
  };
  return { model, calls, states };
}
const greedy = logits => sampleToken(logits, { temperature: 0 });
const request = model => ({ model, inputIds: [7, 8], capacity: 32, maxNewTokens: 8, eosTokenIds: [9], sample: greedy });
test('prefill predicts the first token; decode feeds only newly selected tokens and EOS is not published', async () => {
  const { model, calls, states } = modelFixture(), streamed = [];
  const out = await generateTokens({ ...request(model), onToken: token => streamed.push(token) });
  assert.deepEqual(out, { tokenIds: [2, 3], finishReason: 'eos', stopTokenId: 9, promptTokenCount: 2, generatedTokenCount: 3 });
  assert.deepEqual(calls, ['create', ['prefill', [7, 8]], ['decode', 2], ['decode', 3], 'dispose']);
  assert.deepEqual(streamed, [2, 3]); assert.equal(states[0].disposed, true);
});
test('length and context exhaustion are explicit, without computing an unused next token', async () => {
  const a = modelFixture();
  assert.equal((await generateTokens({ ...request(a.model), maxNewTokens: 1 })).finishReason, 'length');
  assert.equal(a.calls.filter(x => x?.[0] === 'decode').length, 0);
  const b = modelFixture();
  const out = await generateTokens({ ...request(b.model), capacity: 2 });
  assert.deepEqual(out.tokenIds, [2]); assert.equal(out.finishReason, 'capacity');
  assert.equal(b.calls.filter(x => x?.[0] === 'decode').length, 0);
});
test('each request has fresh model-owned state and sampler receives only generated history', async () => {
  const { model, states } = modelFixture(), histories = [];
  const sample = (logits, { generatedTokenIds }) => { histories.push([...generatedTokenIds]); return greedy(logits); };
  await generateTokens({ ...request(model), sample }); await generateTokens(request(model));
  assert.deepEqual(histories, [[], [2], [2, 3]]); assert.notEqual(states[0], states[1]);
});
test('cancellation after sampling publishes no token and releases state', async () => {
  const { model, calls } = modelFixture(), abort = new AbortController(), streamed = [];
  await assert.rejects(generateTokens({ ...request(model), signal: abort.signal, sample: () => { abort.abort('stop'); return 2; }, onToken: id => streamed.push(id) }), { name: 'AbortError' });
  assert.deepEqual(streamed, []); assert.equal(calls.at(-1), 'dispose');
});
test('prefill, decode, callback and cleanup failures propagate after state disposal', async () => {
  for (const phase of ['prefill', 'decode', 'dispose']) {
    const { model, calls } = modelFixture(undefined, phase);
    await assert.rejects(generateTokens(request(model)), new RegExp(`${phase} failed`));
    assert.equal(calls.at(-1), 'dispose');
  }
  const { model, calls } = modelFixture();
  await assert.rejects(generateTokens({ ...request(model), onToken: () => { throw new Error('consumer failed'); } }), /consumer failed/);
  assert.equal(calls.at(-1), 'dispose');
  const both = modelFixture();
  both.model.disposeState = async () => { throw new Error('cleanup failed'); };
  await assert.rejects(generateTokens({ ...request(both.model), sample: () => { throw new Error('sampling failed'); } }), error => error instanceof AggregateError && error.errors.length === 2);
});
test('invalid capacities, token IDs and missing adapter methods fail before allocation', async () => {
  const { model, calls } = modelFixture();
  for (const change of [{ inputIds: [] }, { inputIds: [-1] }, { capacity: 1 }, { maxNewTokens: 0 }, { maxNewTokens: 1.5 }, { eosTokenIds: [-1] }]) {
    await assert.rejects(generateTokens({ ...request(model), ...change }));
  }
  assert.deepEqual(calls, []);
  await assert.rejects(generateTokens({ ...request({}), sample: greedy }), /model/);
  await assert.rejects(generateTokens({ ...request(model), sample: () => undefined }), /token/);
});
test('existing kit control can park generation and resume it without a separate scheduler', async () => {
  const fixture = modelFixture();
  const control = createWebGpuInferenceControl({ queue: { onSubmittedWorkDone: async () => {} } });
  await control.pause();
  const running = generateTokens({ ...request(fixture.model), control });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.calls, []);
  await control.resume(); await running; await control.close();
  assert.equal(fixture.calls.at(-1), 'dispose');
});
