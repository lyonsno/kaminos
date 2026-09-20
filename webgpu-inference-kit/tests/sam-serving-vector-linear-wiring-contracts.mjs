import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const consumers = [
  ['ViT first block', 'sam-image-vit-first-block-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_GELU_WGSL']],
  ['ViT stack', 'sam-image-vit-block-stack-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_GELU_WGSL']],
  ['prompt text', 'sam-prompt-text-ingress-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL']],
  ['prompt FPN', 'sam-prompt-fpn-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL']],
  ['DETR encoder', 'sam-detr-encoder-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_RELU_WGSL']],
  ['DETR decoder', 'sam-detr-decoder-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_RELU_WGSL']],
  ['scoring', 'sam-scoring-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_RELU_WGSL']],
  ['mask tail', 'sam-mask-tail-phase-program.js', ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_RELU_WGSL']],
];

assert.match(packageJson.scripts.test, /sam-serving-vector-linear-contracts\.mjs/, 'default tests must exercise the vector kernel contract');
assert.match(packageJson.scripts.test, /sam-serving-vector-linear-wiring-contracts\.mjs/, 'default tests must exercise vector production wiring');
assert.doesNotMatch(packageJson.scripts.test, /sam-serving-blocked-linear/, 'rejected blocked kernels must not remain in the default suite');

for (const [name, file, shaderSymbols] of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-vector-linear-wgsl\.js/, `${name} must import the shared vector family`);
  assert.doesNotMatch(source, /sam-blocked-linear|SAM_BLOCKED_LINEAR|blockedLinearDispatch/, `${name} must not retain the rejected blocked family`);
  assert.doesNotMatch(source, /const LINEAR(?:_RELU|_GELU)?_WGSL = `/, `${name} must not retain a private scalar linear shader`);
  for (const shaderSymbol of shaderSymbols) {
    assert.match(source, new RegExp(shaderSymbol), `${name} must register ${shaderSymbol}`);
  }
  if (file === 'sam-image-vit-block-stack-phase-program.js') {
    assert.match(source, /const linear = \(tokens, inputChannels, outputChannels\)/, 'ViT stack dispatch planning must carry the reduction width');
    assert.match(source, /vectorLinearDispatch\(tokens, inputChannels, outputChannels, \{ maxWorkgroupsPerDimension \}\)/, 'ViT stack dispatch must honor its explicit device limit');
    continue;
  }
  assert.match(
    source,
    /function linearWorkgroups\(tokens, inputChannels, outputChannels, device\) \{\s*return vectorLinearDispatchForDevice\(tokens, inputChannels, outputChannels, device\);\s*\}/,
    `${name} must carry the reduction width through device-aware dispatch`,
  );
  const calls = [...source.matchAll(/linearWorkgroups\(([^)\n]+)\)/g)].slice(1);
  assert.ok(calls.length > 0, `${name} must have production vector dispatches`);
  for (const [, args] of calls) {
    assert.equal(args.split(',').length, 4, `${name} vector dispatch must name tokens, input channels, output channels, and device: ${args}`);
    assert.match(args, /input\.device$/, `${name} vector dispatch must bind the effective device: ${args}`);
  }
}

const firstBlock = readFileSync(new URL('sam-image-vit-first-block-phase-program.js', root), 'utf8');
assert.match(firstBlock, /kernel: 'mlpFc1', dispatch: linearWorkgroups\(shape\.tokenCount, shape\.hiddenSize, shape\.intermediateSize, input\.device\)/);
assert.match(firstBlock, /kernel: 'mlpFc2', dispatch: linearWorkgroups\(shape\.tokenCount, shape\.intermediateSize, shape\.hiddenSize, input\.device\)/);

const promptText = readFileSync(new URL('sam-prompt-text-ingress-phase-program.js', root), 'utf8');
assert.match(promptText, /kernel: 'projection', dispatch: linearWorkgroups\(rows, shape\.hiddenSize, shape\.channels, input\.device\)/);

const encoder = readFileSync(new URL('sam-detr-encoder-phase-program.js', root), 'utf8');
assert.match(encoder, /MlpFc1Relu`, dispatch: linearWorkgroups\(spatialTokenCount, shape\.channels, shape\.mlpHidden, input\.device\)/);
assert.match(encoder, /MlpFc2`, dispatch: linearWorkgroups\(spatialTokenCount, shape\.mlpHidden, shape\.channels, input\.device\)/);

const decoder = readFileSync(new URL('sam-detr-decoder-phase-program.js', root), 'utf8');
assert.match(decoder, /k\('Ref1'\), dispatch: linearWorkgroups\(queryTokens, shape\.channels \* 2, shape\.channels, input\.device\)/, 'decoder sine projection must preserve its doubled reduction width');
assert.match(decoder, /k\('BoxHead3'\), dispatch: linearWorkgroups\(queryTokens, shape\.channels, 4, input\.device\)/, 'decoder box head must distinguish reduction and output widths');

console.log('sam serving vector linear wiring contracts passed');
