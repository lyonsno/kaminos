import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-packed-linear-wgsl.js', root);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const consumers = [
  ['ViT first block', 'sam-image-vit-first-block-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_GELU_WGSL']],
  ['ViT', 'sam-image-vit-block-stack-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_GELU_WGSL']],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', ['SAM_PACKED_LINEAR_WGSL']],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', ['SAM_PACKED_LINEAR_WGSL']],
  ['DETR encoder', 'sam-detr-encoder-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_RELU_WGSL']],
  ['DETR decoder', 'sam-detr-decoder-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_RELU_WGSL']],
  ['scoring', 'sam-scoring-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_RELU_WGSL']],
  ['mask tail', 'sam-mask-tail-phase-program.js', ['SAM_PACKED_LINEAR_WGSL', 'SAM_PACKED_LINEAR_RELU_WGSL']],
];
const productionBindings = [
  ...['qProjection', 'kProjection', 'vProjection', 'outputProjection', 'mlpFc2'].map(kernel => [`ViT first-block ${kernel}`, 'sam-image-vit-first-block-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_PACKED_LINEAR_WGSL`)]),
  ['ViT first-block mlpFc1', 'sam-image-vit-first-block-phase-program.js', 'SAM_PACKED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_PACKED_LINEAR_GELU_WGSL/],
  ...['qProjection', 'kProjection', 'vProjection', 'outputProjection', 'mlpFc2'].map(kernel => [`ViT stack ${kernel}`, 'sam-image-vit-block-stack-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_PACKED_LINEAR_WGSL`)]),
  ['ViT stack mlpFc1', 'sam-image-vit-block-stack-phase-program.js', 'SAM_PACKED_LINEAR_GELU_WGSL', /mlpFc1:\s*\{\s*code:\s*SAM_PACKED_LINEAR_GELU_WGSL/],
  ['prompt text final projection', 'sam-prompt-text-ingress-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /projection:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
  ['prompt text QKV', 'sam-prompt-text-ingress-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /for \(const projection of \['q', 'k', 'v'\]\) \{\s*registerLayerKernel\(`\$\{prefix\}\.\$\{projection\}`, SAM_PACKED_LINEAR_WGSL/],
  ['prompt text output', 'sam-prompt-text-ingress-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.out`, SAM_PACKED_LINEAR_WGSL/],
  ['prompt text MLP fc1', 'sam-prompt-text-ingress-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.fc1`, SAM_PACKED_LINEAR_WGSL/],
  ['prompt text MLP fc2', 'sam-prompt-text-ingress-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /registerLayerKernel\(`\$\{prefix\}\.fc2`, SAM_PACKED_LINEAR_WGSL/],
  ['prompt FPN Q', 'sam-prompt-fpn-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /qLinear:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
  ['prompt FPN K', 'sam-prompt-fpn-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /kLinear:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
  ['prompt FPN V', 'sam-prompt-fpn-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /vLinear:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
  ['prompt FPN output', 'sam-prompt-fpn-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /outputLinear:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
  ['DETR encoder plain', 'sam-detr-encoder-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /addLinearKernel\('SelfQ',\s*SAM_PACKED_LINEAR_WGSL/],
  ['DETR encoder ReLU', 'sam-detr-encoder-phase-program.js', 'SAM_PACKED_LINEAR_RELU_WGSL', /addLinearKernel\('MlpFc1Relu',\s*SAM_PACKED_LINEAR_RELU_WGSL/],
  ['DETR decoder plain', 'sam-detr-decoder-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /addKernel\(k\('SelfQ'\),\s*SAM_PACKED_LINEAR_WGSL/],
  ['DETR decoder ReLU', 'sam-detr-decoder-phase-program.js', 'SAM_PACKED_LINEAR_RELU_WGSL', /addKernel\(k\('Mlp1'\),\s*SAM_PACKED_LINEAR_RELU_WGSL/],
  ['scoring text MLP fc1', 'sam-scoring-phase-program.js', 'SAM_PACKED_LINEAR_RELU_WGSL', /textMlpFc1Relu:\s*\{\s*code:\s*SAM_PACKED_LINEAR_RELU_WGSL/],
  ...['textMlpFc2', 'textProj', 'queryProj'].map(kernel => [`scoring ${kernel}`, 'sam-scoring-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_PACKED_LINEAR_WGSL`)]),
  ...['maskEmbedderLayer0', 'maskEmbedderLayer1'].map(kernel => [`mask tail ${kernel}`, 'sam-mask-tail-phase-program.js', 'SAM_PACKED_LINEAR_RELU_WGSL', new RegExp(`${kernel}:\\s*\\{\\s*code:\\s*SAM_PACKED_LINEAR_RELU_WGSL`)]),
  ['mask tail maskEmbedderLayer2', 'sam-mask-tail-phase-program.js', 'SAM_PACKED_LINEAR_WGSL', /maskEmbedderLayer2:\s*\{\s*code:\s*SAM_PACKED_LINEAR_WGSL/],
];

assert.equal(existsSync(sharedUrl), true, 'serving linears must share one packed WGSL family');
assert.match(packageJson.scripts.test, /sam-serving-packed-linear-contracts\.mjs/, 'the default suite must retain the serving packed-linear regression contract');
assert.match(packageJson.scripts.test, /sam-serving-packed-linear-wiring-contracts\.mjs/, 'the default suite must retain packed production-wiring coverage');

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
    /function linearWorkgroups\(tokens, outputChannels, device\) \{\s*return packedLinearDispatchForDevice\(tokens, outputChannels, device\);\s*\}/,
    `${file} must delegate effective-device dispatch to the exercised shared helper`,
  );
}

for (const [name, file, shaderSymbols] of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-packed-linear-wgsl\.js/, `${name} must consume the shared packed-linear family`);
  assert.match(source, /packedLinearDispatch(?:ForDevice)?\(/, `${name} must dispatch output tiles rather than scalar outputs`);
  assert.match(source, /maxComputeWorkgroupsPerDimension|packedLinearDispatchForDevice\(tokens, outputChannels, device\)/, `${name} must bind packed dispatch to the effective device limit`);
  assert.doesNotMatch(source, /\{ name:[^\n]+dispatch:\s*packedLinearDispatch\(/, `${name} production phases must not bypass the device-aware packed dispatch helper`);
  assert.doesNotMatch(source, /const LINEAR(?:_RELU|_GELU)?_WGSL = `/, `${name} must not retain a private scalar linear shader`);
  for (const shaderSymbol of shaderSymbols) assert.match(source, new RegExp(shaderSymbol), `${name} must register ${shaderSymbol}`);
}

for (const [name, file, shaderSymbol, registrationContract] of productionBindings) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, registrationContract, `${name} production kernel must register its shared packed shader`);
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
  assert.match(promptFpn, contract, `prompt FPN ${name} must dispatch its complete packed logical domain`);
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
    assert.match(source, contract, `${surface} ${name} must dispatch its complete packed logical domain with the effective device limit`);
    const underDispatched = source.replace(contract, match => match.replace('input.device', 'undefined'));
    assert.notEqual(underDispatched, source, `${surface} ${name} device-limit counterexample must alter production wiring`);
    assert.doesNotMatch(underDispatched, contract, `${surface} ${name} contract must reject dispatch detached from the effective device limit`);
  }
}

const { packedLinearDispatch, packedLinearDispatchForDevice } = await import('../src/sam-packed-linear-wgsl.js');
assert.deepEqual(packedLinearDispatch(33, 65), [9]);
assert.deepEqual(packedLinearDispatch(1_048_576, 16), [256, 256]);
assert.deepEqual(
  packedLinearDispatchForDevice(400, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [5, 5],
  'device-aware dispatch must honor the effective non-default workgroup limit',
);
assert.throws(() => packedLinearDispatch(0, 16), /tokenCount.*positive integer/);
assert.throws(() => packedLinearDispatch(Number.MAX_SAFE_INTEGER, 4), /two-dimensional device capacity/);

console.log('sam serving packed linear wiring contracts passed');
