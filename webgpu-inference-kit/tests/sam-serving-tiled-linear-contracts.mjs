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
  ...['qProjection', 'kProjection', 'vProjection', 'outputProjection', 'mlpFc2'].map(kernel => [`ViT first-block ${kernel}`, 'sam-image-vit-first-block-phase-program.js', 'SAM_TILED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_TILED_LINEAR_WGSL`)]),
  ['ViT first-block mlpFc1', 'sam-image-vit-first-block-phase-program.js', 'SAM_TILED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_TILED_LINEAR_GELU_WGSL/],
  ...['qProjection', 'kProjection', 'vProjection', 'outputProjection', 'mlpFc2'].map(kernel => [`ViT stack ${kernel}`, 'sam-image-vit-block-stack-phase-program.js', 'SAM_TILED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_TILED_LINEAR_WGSL`)]),
  ['ViT stack mlpFc1', 'sam-image-vit-block-stack-phase-program.js', 'SAM_TILED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_TILED_LINEAR_GELU_WGSL/],
  ['prompt text final projection', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /projection:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['prompt text QKV', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /for \(const projection of \['q', 'k', 'v'\]\) \{\s*registerLayerKernel\(`\$\{prefix\}\.\$\{projection\}`, SAM_TILED_LINEAR_WGSL/],
  ['prompt text output', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.out`, SAM_TILED_LINEAR_WGSL/],
  ['prompt text MLP fc1', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.fc1`, SAM_TILED_LINEAR_WGSL/],
  ['prompt text MLP fc2', 'sam-prompt-text-ingress-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.fc2`, SAM_TILED_LINEAR_WGSL/],
  ['prompt FPN Q', 'sam-prompt-fpn-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /qLinear:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['prompt FPN K', 'sam-prompt-fpn-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /kLinear:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['prompt FPN V', 'sam-prompt-fpn-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /vLinear:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['prompt FPN output', 'sam-prompt-fpn-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /outputLinear:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR encoder plain', 'sam-detr-encoder-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /addLinearKernel\('SelfQ',\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR encoder ReLU', 'sam-detr-encoder-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /addLinearKernel\('MlpFc1Relu',\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ['DETR decoder plain', 'sam-detr-decoder-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /addKernel\(k\('SelfQ'\),\s*SAM_TILED_LINEAR_WGSL/],
  ['DETR decoder ReLU', 'sam-detr-decoder-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /addKernel\(k\('Mlp1'\),\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ['scoring text MLP fc1', 'sam-scoring-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', /textMlpFc1Relu:\s*\{\s*code:\s*SAM_TILED_LINEAR_RELU_WGSL/],
  ...['textMlpFc2', 'textProj', 'queryProj'].map(kernel => [`scoring ${kernel}`, 'sam-scoring-phase-program.js', 'SAM_TILED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_TILED_LINEAR_WGSL`)]),
  ...['maskEmbedderLayer0', 'maskEmbedderLayer1'].map(kernel => [`mask tail ${kernel}`, 'sam-mask-tail-phase-program.js', 'SAM_TILED_LINEAR_RELU_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_TILED_LINEAR_RELU_WGSL`)]),
  ['mask tail maskEmbedderLayer2', 'sam-mask-tail-phase-program.js', 'SAM_TILED_LINEAR_WGSL', /maskEmbedderLayer2:\s*\{\s*code:\s*SAM_TILED_LINEAR_WGSL/],
];

assert.equal(existsSync(sharedUrl), true, 'serving linears must share one tiled WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';
assert.match(shared, /@compute @workgroup_size\(8, 8, 1\)/, 'the tiled kernel must use one 8x8 workgroup per output tile');
assert.match(shared, /var<workgroup> input_tile: array<f32, 256>/, 'each input tile must be loaded once per workgroup');
assert.match(shared, /var<workgroup> weight_tile: array<f32, 256>/, 'each weight tile must be loaded once per workgroup');
assert.match(shared, /k_base = k_base \+ 16u/, 'the reduction dimension must advance by the shared tile width');
assert.ok((shared.match(/workgroupBarrier\(\)/g) || []).length >= 2, 'tile loads and reuse must be separated by workgroup barriers');
assert.match(packageJson.scripts.test, /sam-serving-tiled-linear-contracts\.mjs/, 'the default suite must retain the serving tiled-linear regression contract');

function validateSharedKernelSource(source) {
  assert.equal((source.match(/let output_channel = output_base \+ local_id\.x \+ output_half \* 8u;/g) || []).length, 2, 'both initialization and store must use the lane x-coordinate for output channels');
  assert.equal((source.match(/let token_local = local_id\.y \+ token_half \* 8u;/g) || []).length, 1, 'the reduction must use the lane y-coordinate for token rows');
  assert.equal((source.match(/let accumulator_index = token_half \* 2u \+ output_half;/g) || []).length, 3, 'initialization, reduction, and store must share the token-major accumulator mapping');
  assert.match(source, /let token = token_base \+ local_id\.y \+ token_half \* 8u;/, 'the final store must use the lane y-coordinate for token rows');
  assert.match(source, /output_values\[token \* output_channels \+ output_channel\] = activate\(sums\[accumulator_index\]\);/, 'the final store must write token-major output coordinates from the matching accumulator');
  assert.match(source, /sums\[accumulator_index\] = bias\[output_channel\];/, 'bias must use the owned output channel');
  assert.match(source, /input_tile\[token_local \* 16u \+ k_local\]/, 'input tiles must index token rows');
  assert.match(source, /weight_tile\[output_local \* 16u \+ k_local\]/, 'weight tiles must index output-channel rows');
  assert.match(source, /if \(token < token_count && input_channel < input_channels\)/, 'input tail loads must be guarded');
  assert.match(source, /if \(output_channel < output_channels && input_channel < input_channels\)/, 'weight tail loads must be guarded');
  assert.match(source, /if \(token < token_count && output_channel < output_channels\)/, 'output tail stores must be guarded');
  const reductionStart = source.indexOf('for (var k_base = 0u;');
  assert.equal((source.match(/workgroupBarrier\(\)/g) || []).length, 2, 'each reduction tile must have exactly one load barrier and one reuse barrier');
  const firstBarrier = source.indexOf('workgroupBarrier();', reductionStart);
  const accumulation = source.indexOf('for (var k_local = 0u;', firstBarrier);
  const secondBarrier = source.indexOf('workgroupBarrier();', accumulation);
  const activation = source.indexOf('activate(sums[', secondBarrier);
  assert.ok(reductionStart >= 0 && firstBarrier > reductionStart && accumulation > firstBarrier && secondBarrier > accumulation, 'tile load, reduction, and reuse barriers must remain ordered');
  assert.ok(activation > secondBarrier, 'activation must happen only after the complete tiled reduction');
  assert.equal(source.indexOf('activate(sums['), activation, 'activation must not move into the reduction loop');
}

function replaceLast(source, search, replacement) {
  const index = source.lastIndexOf(search);
  assert.notEqual(index, -1, `counterexample source must contain ${search}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

validateSharedKernelSource(shared);
const semanticCounterexamples = [
  ['output axis', shared.replace('output_base + local_id.x + output_half * 8u', 'output_base + local_id.y + output_half * 8u')],
  ['token axis', shared.replace('local_id.y + token_half * 8u', 'local_id.x + token_half * 8u')],
  ['transposed output store', shared.replace('output_values[token * output_channels + output_channel]', 'output_values[output_channel * token_count + token]')],
  ['final token axis', shared.replace('let token = token_base + local_id.y + token_half * 8u;', 'let token = token_base + local_id.x + token_half * 8u;')],
  ['store accumulator', replaceLast(shared, 'let accumulator_index = token_half * 2u + output_half;', 'let accumulator_index = output_half * 2u + token_half;')],
  ['input tail guard', shared.replace('if (token < token_count && input_channel < input_channels)', 'if (input_channel < input_channels)')],
  ['load barrier', shared.replace('workgroupBarrier();', '// missing load barrier')],
  ['activation timing', shared.replace('= activate(sums[accumulator_index]);', '= sums[accumulator_index];')],
];
for (const [name, counterexample] of semanticCounterexamples) {
  assert.notEqual(counterexample, shared, 'semantic counterexample must alter the shared kernel');
  assert.throws(() => validateSharedKernelSource(counterexample), `shared-kernel semantic contract must reject ${name} drift`);
}

const deviceAwareHelperConsumers = [
  'sam-image-vit-first-block-phase-program.js',
  'sam-prompt-text-ingress-phase-program.js',
  'sam-prompt-fpn-phase-program.js',
  'sam-detr-encoder-phase-program.js',
  'sam-detr-decoder-phase-program.js',
  'sam-scoring-phase-program.js',
  'sam-mask-tail-phase-program.js',
];
for (const file of deviceAwareHelperConsumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(
    source,
    /function linearWorkgroups\(tokens, outputChannels, device\) \{\s*return tiledLinearDispatchForDevice\(tokens, outputChannels, device\);\s*\}/,
    `${file} must delegate effective-device dispatch to the exercised shared helper`,
  );
}

for (const [name, file, shaderSymbols] of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-tiled-linear-wgsl\.js/, `${name} must consume the shared tiled-linear family`);
  assert.match(source, /tiledLinearDispatch(?:ForDevice)?\(/, `${name} must dispatch output tiles rather than scalar outputs`);
  assert.match(source, /maxComputeWorkgroupsPerDimension|tiledLinearDispatchForDevice\(tokens, outputChannels, device\)/, `${name} must bind tiled dispatch to the effective device limit`);
  assert.doesNotMatch(source, /\{ name:[^\n]+dispatch:\s*tiledLinearDispatch\(/, `${name} production phases must not bypass the device-aware tiled dispatch helper`);
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

const promptFpn = readFileSync(new URL('sam-prompt-fpn-phase-program.js', root), 'utf8');
const promptFpnDispatches = [
  ['Q', /name: 'prompt-qkv-q', kernel: 'qLinear', dispatch: linearWorkgroups\(shape\.batch \* shape\.spatialTokens, shape\.channels, input\.device\)/],
  ['K', /name: 'prompt-qkv-k', kernel: 'kLinear', dispatch: linearWorkgroups\(shape\.batch \* shape\.promptTokens, shape\.channels, input\.device\)/],
  ['V', /name: 'prompt-qkv-v', kernel: 'vLinear', dispatch: linearWorkgroups\(shape\.batch \* shape\.promptTokens, shape\.channels, input\.device\)/],
  ['output', /name: 'prompt-output-linear', kernel: 'outputLinear', dispatch: linearWorkgroups\(shape\.batch \* shape\.spatialTokens, shape\.channels, input\.device\)/],
];
for (const [name, contract] of promptFpnDispatches) {
  assert.match(promptFpn, contract, `prompt FPN ${name} must dispatch its complete tiled logical domain`);
  const underDispatched = promptFpn.replace(contract, match => match.replace(/shape\.batch \* shape\.(?:spatialTokens|promptTokens)/, 'shape.batch'));
  assert.notEqual(underDispatched, promptFpn, `prompt FPN ${name} under-dispatch counterexample must alter production wiring`);
  assert.doesNotMatch(underDispatched, contract, `prompt FPN ${name} contract must reject under-dispatch`);
}
assert.match(promptFpn, /name: 'prompt-output-residual', kernel: 'outputResidual', dispatch: \[workgroups\(totalEncoder\)\]/, 'prompt FPN residual addition must cover every projected scalar');
assert.doesNotMatch(promptFpn, /const PROMPT_OUTPUT_RESIDUAL_WGSL = `[^]*weight\[channel \* dims\.channels \+ c\]/, 'prompt FPN residual phase must not retain a private scalar dense projection');

const productionDispatches = [
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', [
    ['Q', /kernel: `\$\{prefix\}\.q`, dispatch: linearWorkgroups\(rows, shape\.hiddenSize, input\.device\)/],
    ['K', /kernel: `\$\{prefix\}\.k`, dispatch: linearWorkgroups\(rows, shape\.hiddenSize, input\.device\)/],
    ['V', /kernel: `\$\{prefix\}\.v`, dispatch: linearWorkgroups\(rows, shape\.hiddenSize, input\.device\)/],
    ['output', /kernel: `\$\{prefix\}\.out`, dispatch: linearWorkgroups\(rows, shape\.hiddenSize, input\.device\)/],
    ['MLP fc1', /kernel: `\$\{prefix\}\.fc1`, dispatch: linearWorkgroups\(rows, shape\.intermediateSize, input\.device\)/],
    ['MLP fc2', /kernel: `\$\{prefix\}\.fc2`, dispatch: linearWorkgroups\(rows, shape\.hiddenSize, input\.device\)/],
    ['final projection', /kernel: 'projection', dispatch: linearWorkgroups\(rows, shape\.channels, input\.device\)/],
  ]],
  ['scoring', 'sam-scoring-phase-program.js', [
    ['text MLP fc1', /kernel: 'textMlpFc1Relu', dispatch: linearWorkgroups\(promptTotal, shape\.mlpHidden, input\.device\)/],
    ['text MLP fc2', /kernel: 'textMlpFc2', dispatch: linearWorkgroups\(promptTotal, shape\.channels, input\.device\)/],
    ['text projection', /kernel: 'textProj', dispatch: linearWorkgroups\(shape\.batch, shape\.channels, input\.device\)/],
    ['query projection', /kernel: 'queryProj', dispatch: linearWorkgroups\(shape\.layerCount \* shape\.batch \* shape\.queryTokens, shape\.channels, input\.device\)/],
  ]],
  ['mask tail', 'sam-mask-tail-phase-program.js', [
    ...['maskEmbedderLayer0', 'maskEmbedderLayer1', 'maskEmbedderLayer2'].map(kernel => [kernel, new RegExp(`kernel: '${kernel}', dispatch: linearWorkgroups\\(shape\\.batch \\* shape\\.maskTokens, shape\\.channels, input\\.device\\)`)]),
  ]],
];
for (const [surface, file, dispatches] of productionDispatches) {
  const source = readFileSync(new URL(file, root), 'utf8');
  for (const [name, contract] of dispatches) {
    assert.match(source, contract, `${surface} ${name} must dispatch its complete tiled logical domain with the effective device limit`);
    const underDispatched = source.replace(contract, match => match.replace('input.device', 'undefined'));
    assert.notEqual(underDispatched, source, `${surface} ${name} device-limit counterexample must alter production wiring`);
    assert.doesNotMatch(underDispatched, contract, `${surface} ${name} contract must reject dispatch detached from the effective device limit`);
  }
}

const { tiledLinearDispatch, tiledLinearDispatchForDevice } = await import('../src/sam-tiled-linear-wgsl.js');
assert.deepEqual(tiledLinearDispatch(33, 65), [5, 3, 1]);
assert.deepEqual(tiledLinearDispatch(1_048_576, 16), [1, 65_535, 2]);
assert.deepEqual(
  tiledLinearDispatchForDevice(400, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [1, 7, 4],
  'device-aware dispatch must honor the effective non-default workgroup limit',
);
assert.throws(() => tiledLinearDispatch(0, 16), /tokenCount.*positive integer/);
assert.throws(() => tiledLinearDispatch(1, 1_048_561), /output tile count/);

console.log('sam serving tiled linear contracts passed');
