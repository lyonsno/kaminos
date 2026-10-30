// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandPupText } from '../models/qwen3_5/pup-text.js';

function fixture() {
  const events = [], model = {
    async createState(options) { events.push(['create', options.capacity]); return {}; },
    async prefill(ids) { events.push(['prefill', [...ids]]); return new Float32Array([1, .5, -1, -2]); },
    async decode(id) { events.push(['decode', id]); return id === 0 ? new Float32Array([1, .5, -1, -2]) : new Float32Array([-2, -2, 2, -2]); },
    async disposeState() { events.push(['dispose']); },
  }, tokenizer = { added: new Map([['<|im_end|>', 2], ['<|endoftext|>', 3]]), encode: () => [0, 0], createDecoder: () => ({ push: id => ['red ', 'fox'][id], end: () => '' }) };
  return { model, tokenizer, events };
}
test('BFL prompt expansion composes framing, generated-token penalties, text streaming and EOS', async () => {
  const { model, tokenizer, events } = fixture(), text = [];
  const result = await expandPupText({ model, tokenizer, prompt: 'fox', systemPrompt: 'expand', maxNewTokens: 3, onText: delta => text.push(delta) });
  assert.equal(result.text, 'red fox'); assert.equal(result.finishReason, 'eos'); assert.deepEqual(result.tokenIds, [0, 1]);
  assert.deepEqual(text, ['red ', 'fox']); assert.deepEqual(events, [['create', 4], ['prefill', [0, 0]], ['decode', 0], ['decode', 1], ['dispose']]);
});
test('stream consumer failure releases request state and preserves the caller error', async () => {
  const { model, tokenizer, events } = fixture(), error = new Error('consumer failed');
  await assert.rejects(expandPupText({ model, tokenizer, prompt: 'fox', systemPrompt: 'expand', maxNewTokens: 3, onText() { throw error; } }), value => value === error);
  assert.deepEqual(events.at(-1), ['dispose']);
});
