import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-packed-linear-wgsl.js', root);
const consumers = [
  'sam-image-vit-first-block-phase-program.js',
  'sam-image-vit-block-stack-phase-program.js',
  'sam-prompt-text-ingress-phase-program.js',
  'sam-prompt-fpn-phase-program.js',
  'sam-detr-encoder-phase-program.js',
  'sam-detr-decoder-phase-program.js',
  'sam-scoring-phase-program.js',
  'sam-mask-tail-phase-program.js',
];

assert.equal(existsSync(sharedUrl), true, 'serving linears must expose one shared packed-row WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';

function validatePackedKernelSource(source) {
  assert.match(source, /@compute @workgroup_size\(64\)/, 'the packed kernel must retain a full 64-lane workgroup');
  assert.match(source, /let output_groups = \(output_channels \+ 3u\) \/ 4u;/, 'one logical invocation must own four adjacent output channels');
  assert.match(source, /let invocation_index = gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u;/, 'the kernel must reconstruct its two-dimensional linear invocation index');
  assert.match(source, /if \(invocation_index >= token_count \* output_groups\) \{ return; \}/, 'rounded dispatch tails must return before buffer access');
  assert.match(source, /let token = invocation_index \/ output_groups;/, 'packed dispatch must map complete output groups within one token');
  assert.match(source, /let output_base = \(invocation_index % output_groups\) \* 4u;/, 'packed output groups must remain adjacent');
  assert.equal((source.match(/let input_value = input_values\[input_base \+ c\];/g) || []).length, 1, 'each invocation must load its input scalar exactly once per reduction step');
  assert.equal((source.match(/if \(output_channel < output_channels\)/g) || []).length, 3, 'bias, reduction, and store must independently guard the output tail');
  assert.match(source, /sums\[output_lane\] = sums\[output_lane\]\s*\+ input_value \* weight\[output_channel \* input_channels \+ c\];/, 'each owned output must preserve output-major weight addressing and its own accumulation order');
  assert.doesNotMatch(source, /var<workgroup>|workgroupBarrier\(/, 'the packed kernel must not reintroduce tiled synchronization');
  assert.match(source, /output_values\[token \* output_channels \+ output_channel\] = activate\(sums\[output_lane\]\);/, 'stores must remain token-major and use the matching accumulator');
  const reduction = source.indexOf('for (var c = 0u;');
  const activation = source.indexOf('activate(sums[', reduction);
  assert.ok(reduction >= 0 && activation > source.indexOf('\n  }\n\n  for (var output_lane', reduction), 'activation must happen after the complete reduction loop');
}

validatePackedKernelSource(shared);
const semanticCounterexamples = [
  ['transposed output store', shared.replace('output_values[token * output_channels + output_channel]', 'output_values[output_channel * token_count + token]')],
  ['transposed weight', shared.replace('weight[output_channel * input_channels + c]', 'weight[c * output_channels + output_channel]')],
  ['wrong token mapping', shared.replace('invocation_index / output_groups', 'invocation_index % output_groups')],
  ['missing dispatch-tail guard', shared.replace('if (invocation_index >= token_count * output_groups) { return; }', '// no dispatch-tail guard')],
  ['synchronized tile regression', shared.replace('@compute @workgroup_size(64)', 'var<workgroup> tile: array<f32, 64>;\n@compute @workgroup_size(64)')],
];
for (const [name, counterexample] of semanticCounterexamples) {
  assert.notEqual(counterexample, shared, `${name} counterexample must alter the shared kernel`);
  assert.throws(() => validatePackedKernelSource(counterexample), `packed kernel contract must reject ${name}`);
}

for (const file of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-packed-linear-wgsl\.js/, `${file} must consume the shared packed-row family`);
  assert.match(source, /packedLinearDispatch(?:ForDevice)?\(/, `${file} must use the shared packed-row dispatch contract`);
  assert.match(source, /maxComputeWorkgroupsPerDimension|packedLinearDispatchForDevice\(tokens, outputChannels, device\)/, `${file} must dispatch through the effective device limit`);
  assert.doesNotMatch(source, /sam-tiled-linear-wgsl\.js|SAM_TILED_LINEAR|tiledLinearDispatch/, `${file} must not retain the rejected synchronized tile path`);
}

const { packedLinearDispatch, packedLinearDispatchForDevice } = await import('../src/sam-packed-linear-wgsl.js');
assert.deepEqual(packedLinearDispatch(33, 65), [9]);
assert.deepEqual(packedLinearDispatch(1_048_576, 16), [256, 256]);
assert.deepEqual(
  packedLinearDispatchForDevice(400, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [5, 5],
  'device-aware dispatch must honor a non-default effective workgroup limit',
);
assert.throws(() => packedLinearDispatch(0, 16), /tokenCount.*positive integer/);
assert.throws(() => packedLinearDispatch(1, 0), /outputChannels.*positive integer/);

console.log('sam serving packed linear contracts passed');
