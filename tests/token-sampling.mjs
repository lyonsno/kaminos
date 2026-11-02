// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleToken, createSeededRandom } from '../webgpu-inference-kit/src/token-sampling.js';

test('greedy uses generated-token penalties, excludes masked logits, breaks ties by token ID', () => {
  assert.equal(sampleToken([2, 3, -Infinity], { temperature: 0, penaltyTokenIds: [1], presencePenalty: 1.5 }), 0);
  assert.equal(sampleToken([2, 2, -Infinity], { temperature: 0 }), 0);
  assert.equal(sampleToken([-2, -3], { temperature: 0, penaltyTokenIds: [0], repetitionPenalty: 2 }), 1);
  assert.equal(sampleToken([2, 3], { temperature: 0, penaltyTokenIds: [1, 1], frequencyPenalty: 1 }), 0);
});
test('categorical selection covers the full vocabulary without a hidden candidate cap', () => {
  const logits = new Float32Array(248320);
  assert.equal(sampleToken(logits, { random: () => 0.9999999 }), logits.length - 1);
  assert.equal(sampleToken([1000, 1000], { random: () => .75 }), 1);
  assert.equal(sampleToken([0, 1], { temperature: .1, random: () => .99 }), 1);
});
test('explicit top-k, relative min-p and nucleus filtering retain the crossing token', () => {
  const logits = [.5, .3, .2].map(Math.log);
  assert.equal(sampleToken(logits, { topK: 1, random: () => .99 }), 0);
  assert.equal(sampleToken(logits, { topP: .6, random: () => .9 }), 1);
  assert.equal(sampleToken(logits, { minP: .7, random: () => .99 }), 0);
  assert.equal(sampleToken(logits, { topK: 2, topP: .9, random: () => .99 }), 1);
});
test('seeded draws repeat, vary between seeds and remain in [0,1)', () => {
  const a = createSeededRandom(123), b = createSeededRandom(123), c = createSeededRandom(124);
  const draws = Array.from({ length: 32 }, () => a());
  assert.deepEqual(draws, Array.from({ length: 32 }, () => b()));
  assert.notDeepEqual(draws, Array.from({ length: 32 }, () => c()));
  assert.ok(draws.every(n => n >= 0 && n < 1));
});
test('malformed distributions/settings fail explicitly and logits stay untouched', () => {
  const logits = new Float32Array([1, 2]);
  sampleToken(logits, { temperature: 0, presencePenalty: 4, penaltyTokenIds: [1] });
  assert.deepEqual([...logits], [1, 2]);
  for (const bad of [[], [-Infinity], [NaN], [Infinity]]) assert.throws(() => sampleToken(bad), /logits/);
  for (const options of [{ temperature: -1 }, { temperature: NaN }, { topK: -1 }, { topK: 1.5 }, { topP: 0 }, { topP: 2 }, { minP: 2 }, { repetitionPenalty: 0 }, { random: () => 1 }]) {
    assert.throws(() => sampleToken([1, 2], options));
  }
});
