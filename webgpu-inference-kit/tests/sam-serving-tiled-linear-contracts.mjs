import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-tiled-linear-wgsl.js', root);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const consumers = [
  ['ViT first block', 'sam-image-vit-first-block-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_GELU_WGSL']],
  ['ViT', 'sam-image-vit-block-stack-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_GELU_WGSL']],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', ['SAM_TILED_LINEAR_WGSL']],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', ['SAM_TILED_LINEAR_WGSL']],
  ['DETR encoder', 'sam-detr-encoder-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_RELU_WGSL']],
  ['DETR decoder', 'sam-detr-decoder-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_RELU_WGSL']],
  ['scoring', 'sam-scoring-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_RELU_WGSL']],
  ['mask tail', 'sam-mask-tail-phase-program.js', ['SAM_TILED_LINEAR_WGSL', 'SAM_TILED_LINEAR_RELU_WGSL']],
];
const productionBindings = [
  ['ViT first-block plain', 'sam-image-vit-first-block-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /qProjection:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['ViT first-block GELU', 'sam-image-vit-first-block-phase-program.js', 'SAM_TILED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_TILED_LINEAR_GELU_WGSL/],
  ['ViT plain', 'sam-image-vit-block-stack-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /qProjection:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['ViT GELU', 'sam-image-vit-block-stack-phase-program.js', 'SAM_TILED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_TILED_LINEAR_GELU_WGSL/],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /projection:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /qLinear:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR encoder plain', 'sam-detr-encoder-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /addLinearKernel\('SelfQ',\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR encoder ReLU', 'sam-detr-encoder-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /addLinearKernel\('MlpFc1Relu',\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ['DETR decoder plain', 'sam-detr-decoder-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /addKernel\(k\('SelfQ'\),\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR decoder ReLU', 'sam-detr-decoder-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /addKernel\(k\('Mlp1'\),\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ['scoring plain', 'sam-scoring-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /textMlpFc2:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['scoring ReLU', 'sam-scoring-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /textMlpFc1Relu:\s*\{\s*code:\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ['mask tail plain', 'sam-mask-tail-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /maskEmbedderLayer2:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['mask tail ReLU', 'sam-mask-tail-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /maskEmbedderLayer0:\s*\{\s*code:\s*SAM_TILED_LINEAR_RELU_WGSL/],
];

assert.equal(existsSync(sharedUrl), true, 'serving linears must share one tiled WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';
assert.match(shared, /@compute @workgroup_size\(8, 8, 1\)/, 'the tiled kernel must use one 8x8 workgroup per output tile');
assert.match(shared, /var<workgroup> input_tile: array<f32, 256>/, 'each input tile must be loaded once per workgroup');
assert.match(shared, /var<workgroup> weight_tile: array<f32, 256>/, 'each weight tile must be loaded once per workgroup');
assert.match(shared, /k_base = k_base \+ 16u/, 'the reduction dimension must advance by the shared tile width');
assert.ok((shared.match(/workgroupBarrier\(\)/g) || []).length >= 2, 'tile loads and reuse must be separated by workgroup barriers');
assert.match(packageJson.scripts.test, /sam-serving-tiled-linear-contracts\.mjs/, 'the default suite must retain the serving tiled-linear regression contract');

for (const [name, file, shaderSymbols] of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-tiled-linear-wgsl\.js/, `${name} must consume the shared tiled-linear family`);
  assert.match(source, /tiledLinearDispatch\(/, `${name} must dispatch output tiles rather than scalar outputs`);
  assert.doesNotMatch(source, /const LINEAR(?:_RELU|_GELU)?_WGSL = `/, `${name} must not retain a private scalar linear shader`);
  for (const shaderSymbol of shaderSymbols) assert.match(source, new RegExp(shaderSymbol), `${name} must register ${shaderSymbol}`);
}

for (const [name, file, shaderSymbol, registrationContract] of productionBindings) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, registrationContract, `${name} production kernel must register its shared tiled shader`);
  const wrongRegistration = source.replace(registrationContract, match => match.replace(shaderSymbol, 'SCALAR_LINEAR_WGSL'));
  assert.notEqual(wrongRegistration, source, `${name} registration-only counterexample must alter production wiring`);
  assert.doesNotMatch(wrongRegistration, registrationContract, `${name} contract must reject a scalar production registration`);
}

const { tiledLinearDispatch } = await import('../src/sam-tiled-linear-wgsl.js');
assert.deepEqual(tiledLinearDispatch(33, 65), [5, 3, 1]);
assert.deepEqual(tiledLinearDispatch(1_048_576, 16), [1, 65_535, 2]);
assert.throws(() => tiledLinearDispatch(0, 16), /tokenCount.*positive integer/);
assert.throws(() => tiledLinearDispatch(1, 1_048_561), /output tile count/);

console.log('sam serving tiled linear contracts passed');
