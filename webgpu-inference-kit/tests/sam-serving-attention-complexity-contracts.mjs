import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { onlineAttentionDispatch } from '../src/sam-online-attention-wgsl.js';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-online-attention-wgsl.js', root);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const consumers = [
  ['ViT', 'sam-image-vit-block-stack-phase-program.js', /dispatchPlan\.attention\.dispatch/, /onlineAttentionDispatch\(layerShape\.windowTokens, shape\.numHeads, shape\.batch \* layerShape\.windowCount\)/],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', /prompt-text-causal-attention/, /onlineAttentionDispatch\(shape\.promptTokens, shape\.heads, shape\.batch\)/],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', /prompt-attention-softmax/, /onlineAttentionDispatch\(shape\.spatialTokens, shape\.heads, shape\.batch\)/],
  ['DETR encoder', 'sam-detr-encoder-phase-program.js', /detr-encoder-self-attention-softmax/, /onlineAttentionDispatch\(shape\.spatialTokens, shape\.heads, shape\.batch\)/],
  ['DETR decoder', 'sam-detr-decoder-phase-program.js', /detr-decoder-vision-attention-softmax/, /onlineAttentionDispatch\(shape\.queryTokens \+ 1, shape\.heads, shape\.batch\)/],
];

assert.equal(existsSync(sharedUrl), true, 'serving attention must share one online-softmax WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';
assert.match(shared, /var<workgroup> products: array<f32, 64>/, 'QK products must be reduced once across the head dimension');
assert.match(shared, /accumulator = accumulator \* state\[2\] \+ state\[3\] \* v_values/, 'online softmax must reuse one score for every value dimension');
assert.equal((shared.match(/for \(var token = 0u;/g) || []).length, 1, 'the score/value pass must traverse keys once, not once per output channel and softmax pass');
assert.match(shared, /head_dim > 64u/, 'the shared kernel must fail closed when a head exceeds its workgroup width');
assert.match(packageJson.scripts.test, /sam-serving-attention-complexity-contracts\.mjs/, 'the default suite must retain the serving attention regression contract');
assert.deepEqual(onlineAttentionDispatch(576, 16, 9), [576, 16, 9]);
assert.throws(() => onlineAttentionDispatch(65_536, 16, 1), /queryTokens.*\[1, 65535\]/);

function directSoftmax(scores, values) {
  const maxScore = Math.max(...scores);
  const weights = scores.map(score => Math.exp(score - maxScore));
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  return values[0].map((_, dimension) => (
    values.reduce((sum, vector, index) => sum + weights[index] * vector[dimension], 0) / denominator
  ));
}

function onlineSoftmax(scores, values) {
  let maxScore = -Infinity;
  let denominator = 0;
  const accumulator = values[0].map(() => 0);
  for (let token = 0; token < scores.length; token += 1) {
    const nextMax = Math.max(maxScore, scores[token]);
    const oldScale = Math.exp(maxScore - nextMax);
    const tokenScale = Math.exp(scores[token] - nextMax);
    denominator = denominator * oldScale + tokenScale;
    for (let dimension = 0; dimension < accumulator.length; dimension += 1) {
      accumulator[dimension] = accumulator[dimension] * oldScale + tokenScale * values[token][dimension];
    }
    maxScore = nextMax;
  }
  return accumulator.map(value => value / denominator);
}

const values = [
  [0.5, -1.25, 2.0, 0.125],
  [-0.75, 0.25, 1.0, 3.5],
  [1.5, 2.25, -0.5, -1.0],
  [4.0, -3.0, 0.75, 2.5],
];
for (const scores of [
  [1.25, -0.5, 3.75, 0.125],
  [-1_000_000_000, 0.25, -1_000_000_000, 2.0],
  [80.0, 79.5, -80.0, 12.0],
]) {
  const direct = directSoftmax(scores, values);
  const online = onlineSoftmax(scores, values);
  for (let dimension = 0; dimension < direct.length; dimension += 1) {
    assert.ok(Math.abs(direct[dimension] - online[dimension]) <= 1e-12, `online softmax dimension ${dimension} must match the two-pass oracle`);
  }
}

for (const [name, file, routeMarker, dispatchContract] of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, routeMarker, `${name} route marker must remain present`);
  assert.match(source, /sam-online-attention-wgsl\.js/, `${name} must consume the shared attention family`);
  assert.match(source, dispatchContract, `${name} must dispatch one workgroup per query/head/batch domain`);
  assert.doesNotMatch(source, /for \(var (key_)?token = 0u;[\s\S]{0,1400}for \(var (key_)?token = 0u;/, `${name} must not retain two-pass per-output score recomputation`);
}

console.log('sam serving attention complexity contracts passed');
