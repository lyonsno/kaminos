// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { adjudicateModelReadbacks } from '../models/qwen3_5/model-witness-contract.js';
import { adjudicatePupExpansion } from '../models/qwen3_5/pup-witness-contract.js';

function fixture() {
  const config = JSON.parse(fs.readFileSync(new URL('./fixtures/qwen35/config.json', import.meta.url)));
  Object.assign(config.text_config, { hidden_size: 4, vocab_size: 8, num_hidden_layers: 2, layer_types: ['linear_attention', 'full_attention'] });
  const manifest = { config }, meta = { schema: 'kaminos.qwen35-model-reference.v1', weightsManifestSha256: 'a'.repeat(64),
    effective: { backend: 'mlx-metal', activationDtype: 'float32' }, inputIds: [1, 2], continuationIds: [0], expectedNextIds: { prefill: 0, decode: 0, 'full-prefix': 0 }, arrays: {} };
  const arrays = new Map(), result = { backend: 'webgpu', adapter: { vendor: 'apple', architecture: 'metal-3', isFallbackAdapter: false }, errors: [], weightsManifestSha256: meta.weightsManifestSha256,
    rows: [], generation: { tokenIds: [0, 0], finishReason: 'length' }, lengths: { prefill: 2, decode: 3, 'full-prefix': 3 }, cleanup: { states: 0, weights: 0, borrowedControl: 'running' } };
  for (const stage of ['prefill', 'decode', 'full-prefix']) for (const [kind, n] of [['layers', 8], ['norm', 4], ['logits', 8]]) {
    const name = `${stage}.${kind}`, values = new Float32Array(n).fill(1);
    meta.arrays[name] = { dtype: 'f32', shape: [n], bytes: n * 4 }; arrays.set(name, values);
    result.rows.push({ name, elements: n, data: Buffer.from(values.buffer).toString('base64') });
  }
  return { meta, manifest, arrays, result };
}
test('model witness admits complete actual-route envelopes and measures raw outputs on host', () => {
  const { result, meta, manifest, arrays } = fixture();
  assert.equal(adjudicateModelReadbacks(result, meta, manifest, arrays).rows, 9);
  assert.ok(result.rows.every(row => row.relL2 === 0 && row.maxAbs === 0));
});
test('blank, partial, fallback, stale-source, wrong-token and cleanup evidence cannot close model parity', () => {
  const { result, meta, manifest, arrays } = fixture();
  for (const change of [r => { r.backend = 'cpu'; }, r => { r.adapter.isFallbackAdapter = true; }, r => { r.weightsManifestSha256 = 'b'.repeat(64); },
    r => { r.rows = []; }, r => { r.rows.pop(); }, r => { r.rows.push(r.rows[0]); }, r => { r.rows[0].data = ''; },
    r => { r.rows[0].data = Buffer.from(new Float32Array(8).buffer).toString('base64'); r.rows[0].relL2 = 0; },
    r => { r.generation.tokenIds[1] = 3; }, r => { r.errors.push('device lost'); }, r => { r.lengths.decode = 2; }, r => { r.cleanup.weights = 1; }]) {
    const changed = structuredClone(result); change(changed); assert.throws(() => adjudicateModelReadbacks(changed, meta, manifest, arrays));
  }
});
test('application evidence requires actual framed input, source settings, EOS and complete streamed text', () => {
  const settings = { temperature: 0, topK: 20, topP: .95, minP: 0, presencePenalty: 1.5, maxNewTokens: 3584, eosTokenIds: [7, 8] };
  const expected = { prompt: 'fox', inputIds: [1, 2, 3], settings, tokenizerSha256: 'a', systemPromptsSha256: 'b' };
  const result = { ...structuredClone(expected), stream: ['red ', 'fox'], output: { text: 'red fox', finishReason: 'eos', stopTokenId: 7, promptTokenCount: 3, tokenIds: [4, 5], generatedTokenCount: 3 } };
  assert.equal(adjudicatePupExpansion(result, expected).generatedTokens, 3);
  for (const change of [r => { r.output.text = ''; }, r => { r.output.finishReason = 'length'; }, r => { r.inputIds.pop(); },
    r => { r.settings.maxNewTokens = 16; }, r => { r.tokenizerSha256 = 'wrong'; }, r => { r.stream = []; }, r => { r.output.stopTokenId = 9; }]) {
    const changed = structuredClone(result); change(changed); assert.throws(() => adjudicatePupExpansion(changed, expected));
  }
});
test('requested split-prefix parity requires every chunked layer/norm/logit observation', () => {
  const { result, meta, manifest, arrays } = fixture();
  for (const row of result.rows.slice(0, 3)) result.rows.push({ ...row, name: row.name.replace('prefill.', 'chunked-prefill.') });
  result.lengths['chunked-prefill'] = meta.inputIds.length;
  assert.equal(adjudicateModelReadbacks(result, meta, manifest, arrays, { chunkedPrefill: true }).rows, 12);
  result.rows.pop(); assert.throws(() => adjudicateModelReadbacks(result, meta, manifest, arrays, { chunkedPrefill: true }), /missing/);
});
