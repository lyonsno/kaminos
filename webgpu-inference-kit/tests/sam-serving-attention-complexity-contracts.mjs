import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { onlineAttentionDispatch } from '../src/sam-online-attention-wgsl.js';
import * as attention from '../src/sam-online-attention-wgsl.js';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-online-attention-wgsl.js', root);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const consumers = [
  ['ViT', 'sam-image-vit-block-stack-phase-program.js', /dispatchPlan\.attention\.dispatch/, /onlineAttentionDispatch\(layerShape\.windowTokens, shape\.numHeads, shape\.batch \* layerShape\.windowCount, shape\.headDim\)/],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', /prompt-text-causal-attention/, /onlineAttentionDispatch\(shape\.promptTokens, shape\.heads, shape\.batch, shape\.headDim\)/],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', /prompt-attention-softmax/, /onlineAttentionDispatch\(shape\.spatialTokens, shape\.heads, shape\.batch, shape\.headDim\)/],
  ['DETR encoder', 'sam-detr-encoder-phase-program.js', /detr-encoder-self-attention-softmax/, /onlineAttentionDispatch\(shape\.spatialTokens, shape\.heads, shape\.batch, shape\.headDim\)/],
  ['DETR decoder', 'sam-detr-decoder-phase-program.js', /detr-decoder-vision-attention-softmax/, /onlineAttentionDispatch\(shape\.queryTokens \+ 1, shape\.heads, shape\.batch, shape\.headDim\)/],
];
const productionBindings = [
  ['ViT', 'sam-image-vit-block-stack-phase-program.js', 'SAM_VIT_ONLINE_ATTENTION_WGSL', /attention:\s*\{\s*code:\s*SAM_VIT_ONLINE_ATTENTION_WGSL/],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', 'SAM_CAUSAL_MASKED_ONLINE_ATTENTION_WGSL', /registerLayerKernel\(`\$\{prefix\}\.attention`,\s*SAM_CAUSAL_MASKED_ONLINE_ATTENTION_WGSL/],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', 'SAM_PROMPT_FPN_ONLINE_ATTENTION_WGSL', /attention:\s*\{\s*code:\s*SAM_PROMPT_FPN_ONLINE_ATTENTION_WGSL/],
];

assert.equal(existsSync(sharedUrl), true, 'serving attention must share one online-softmax WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';
function assertStaticQkTree(name, shader) {
  assert.doesNotMatch(shader, /var\s+products\s*:\s*array|products\[/, `${name} must not dynamically index a private products array`);
  const block = shader.match(/let k_base = [^;]+;([\s\S]*?)var score = ([^;]+);/);
  assert.ok(block, `${name} must expose its QK reduction before score adjustment`);
  const expected = [];
  for (let component = 0; component < 64; component += 1) {
    expected.push(`var product_${component} = 0.0;`);
    expected.push(`if (${component}u < dims.head_dim) {`);
    expected.push(`product_${component} = q_values[q_base + ${component}u] * k_values[k_base + ${component}u];`);
    expected.push('}');
  }
  // The baseline's in-place tree pairs opposite halves, not adjacent leaves.
  for (const stride of [32, 16, 8, 4, 2, 1]) {
    for (let index = 0; index < stride; index += 1) {
      expected.push(`product_${index} = product_${index} + product_${index + stride};`);
    }
  }
  assert.deepEqual(block[1].trim().split('\n').map(line => line.trim()), expected,
    `${name} must preserve all 64 guarded zero-padded products and exact tree operation order`);
  assert.equal(block[2], 'product_0 * scale', `${name} must scale only the tree root`);
}

const shaders = Object.entries(attention).filter(([name]) => name.endsWith('_WGSL'));
assert.equal(shaders.length, 7, 'every shared attention variant must exercise the static QK contract');
for (const [name, shader] of shaders) {
  assertStaticQkTree(name, shader);
  assert.throws(() => assertStaticQkTree(name, shader.replace(
    'product_0 = product_0 + product_32;', 'product_0 = product_0 + product_1;',
  )), /exact tree operation order/, 'the contract must reject an adjacent-pair replacement');
  assert.throws(() => assertStaticQkTree(name, shader.replace(
    'if (63u < dims.head_dim)', 'if (62u < dims.head_dim)',
  )), /guarded zero-padded products/, 'the contract must reject a wrong padding guard');
}
assert.match(shared, /var<workgroup> scores: array<f32, 64>/, 'a workgroup must calculate a tile of distinct key scores');
assert.match(shared, /tile_start = tile_start \+ 64u/, 'synchronization must advance in 64-key tiles');
assert.equal((shared.match(/workgroupBarrier\(\)/g) || []).length, 4, 'attention must use initialization plus three barriers per tile, not barriers per key or reduction step');
assert.match(shared, /accumulator = accumulator \* old_scales\[offset\] \+ token_scales\[offset\] \* v_values/, 'value accumulation must preserve the original token recurrence');
assert.match(shared, /let tile_count = min\(64u, .* - tile_start\)/, 'a partial final tile must not read nonexistent keys');
assert.match(shared, /head_dim > 64u/, 'the shared kernel must fail closed when a head exceeds its workgroup width');
assert.match(packageJson.scripts.test, /sam-serving-attention-complexity-contracts\.mjs/, 'the default suite must retain the serving attention regression contract');
assert.deepEqual(onlineAttentionDispatch(576, 16, 9, 64), [576, 16, 9]);
assert.throws(() => onlineAttentionDispatch(65_536, 16, 1, 64), /queryTokens.*\[1, 65535\]/);
assert.throws(() => onlineAttentionDispatch(576, 16, 9, 65), /headDim.*\[1, 64\]/);

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

function assertProductionBinding(name, source, registrationContract) {
  assert.match(source, registrationContract, `${name} production attention must register its shared online-softmax shader`);
}

for (const [name, file, shaderSymbol, registrationContract] of productionBindings) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assertProductionBinding(name, source, registrationContract);

  const wrongRegistration = source.replace(registrationContract, match => match.replace(shaderSymbol, 'LINEAR_WGSL'));
  assert.notEqual(wrongRegistration, source, `${name} registration-only counterexample must alter production wiring`);
  assert.throws(
    () => assertProductionBinding(name, wrongRegistration, registrationContract),
    /production attention must register/,
    `${name} contract must reject a wrong production shader while shared imports and dispatch remain intact`,
  );
}

console.log('sam serving attention complexity contracts passed');
