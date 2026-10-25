// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { QwenTokenizer } from '../models/flux2-klein/qwen-tokenizer.js';
import { createPupTextInput } from '../models/qwen3_5/pup-input.js';
import { readQwen35Config, planQwen35State } from '../models/qwen3_5/config.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/qwen35/input-reference.json', import.meta.url)));
const config = JSON.parse(fs.readFileSync(new URL('./fixtures/qwen35/config.json', import.meta.url)));
const tokenizer = () => new QwenTokenizer({ model: { type: 'BPE', vocab: fixture.decodeVocabulary, merges: [] }, added_tokens: fixture.addedTokens });

test('existing Qwen tokenizer gains decoding against recorded HF token pieces', () => {
  const tok = tokenizer();
  assert.equal(typeof tok.decode, 'function', 'shared Qwen tokenizer needs token-to-text decoding');
  for (const row of fixture.cases) {
    assert.equal(tok.decode(row.ids, { skipSpecialTokens: false }), row.decoded);
    assert.equal(tok.decode(row.ids), row.skipped);
  }
});
test('incremental decoding holds incomplete UTF-8 across token boundaries', () => {
  const tok = tokenizer(), decoder = tok.createDecoder();
  const chunks = fixture.emojiIds.map(id => decoder.push(id));
  assert.equal(chunks.join('') + decoder.end(), '🚂');
  assert.ok(chunks.slice(0, -1).every(chunk => !chunk.includes('�')));
  assert.throws(() => decoder.push(fixture.emojiIds[0]), /ended/);
  assert.throws(() => tok.decode([999999]), /unknown/);
});
test('PUP text framing matches the source template and passes all tokens through', () => {
  for (const row of fixture.framed) {
    const tok = { added: new Map(fixture.addedTokens.map(t => [t.content, t.id])), encode: text => { assert.equal(text, row.text); return row.ids; } };
    const out = createPupTextInput(tok, { prompt: row.prompt, systemPrompt: row.systemPrompt });
    assert.deepEqual([...out.inputIds], row.ids);
    assert.ok(out.inputIds.length > 512);
    assert.equal(out.generation.temperature, 0);
    assert.equal(out.generation.presencePenalty, 1.5);
    assert.deepEqual(out.generation.eosTokenIds, [248046, 248044]);
  }
});
test('Qwen configuration produces per-layer KV and recurrent-state plans without allocating weights', () => {
  const cfg = readQwen35Config(config);
  assert.equal(cfg.layers.length, 32);
  const plan = planQwen35State(cfg, { capacity: 4096 });
  assert.equal(plan.kvBytes, 128 * 1024 ** 2);
  assert.equal(plan.recurrentBytes, 48 * 1024 ** 2);
  assert.equal(plan.layers.filter(x => x.type === 'full_attention').length, 8);
  assert.equal(plan.layers.filter(x => x.type === 'linear_attention').length, 24);
  assert.deepEqual(plan.layers[0].recurrent.shape, [32, 128, 128]);
  assert.deepEqual(plan.layers[0].convolution.shape, [8192, 4]);
  assert.deepEqual(plan.layers[3].kv.shape, [2, 4096, 4, 256]);
  assert.equal(plan.totalBytes, plan.kvBytes + plan.recurrentBytes + plan.convolutionBytes);
});
test('unsupported or malformed model geometry fails instead of substituting a default', () => {
  for (const mutate of [c => c.text_config.layer_types.pop(), c => c.text_config.layer_types[0] = 'mamba', c => c.text_config.num_key_value_heads = 3, c => c.text_config.hidden_size = '4096', c => c.model_type = 'qwen3_5_moe']) {
    const c = structuredClone(config); mutate(c); assert.throws(() => readQwen35Config(c));
  }
  const cfg = readQwen35Config(config);
  for (const capacity of [0, 1.5, cfg.maxPositions + 1]) assert.throws(() => planQwen35State(cfg, { capacity }));
});
