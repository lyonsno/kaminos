import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const sharedUrl = new URL('../src/sam-vector-linear-wgsl.js', import.meta.url);
assert.equal(existsSync(sharedUrl), true, 'serving linears must expose one shared four-wide reduction family');
const {
  SAM_VECTOR_LINEAR_WIDTH,
  SAM_VECTOR_LINEAR_GELU_WGSL,
  SAM_VECTOR_LINEAR_RELU_WGSL,
  SAM_VECTOR_LINEAR_WGSL,
  vectorLinearDispatch,
  vectorLinearDispatchForDevice,
} = await import('../src/sam-vector-linear-wgsl.js');
const emittedShaders = [
  SAM_VECTOR_LINEAR_WGSL,
  SAM_VECTOR_LINEAR_RELU_WGSL,
  SAM_VECTOR_LINEAR_GELU_WGSL,
];
for (const emitted of emittedShaders) {
  assert.equal(typeof emitted, 'string', 'every production variant must export emitted WGSL text');
  assert.doesNotMatch(emitted, /\/\*|\/\//, 'emitted linear WGSL must remain comment-free so semantic assertions need no comment parser');
}
const wgsl = SAM_VECTOR_LINEAR_WGSL;

assert.match(wgsl, /var<storage, read> input_values: array<f32>;/, 'resident input ranges must retain their scalar storage interpretation');
assert.match(wgsl, /var<storage, read> weight: array<f32>;/, 'resident weight ranges must retain their scalar storage interpretation');
assert.doesNotMatch(wgsl, /array<vec4<f32>>/, 'resident scalar tensor ranges must not be retyped as vec4 storage arrays');
assert.equal(SAM_VECTOR_LINEAR_WIDTH, 4, 'the shared scalar family must retain its four-channel loop width');
assert.match(wgsl, /@compute @workgroup_size\(64\)/, 'the vector family must preserve the accepted scalar workgroup shape');
assert.match(wgsl, /let index = gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u;/, 'the vector family must preserve complete two-dimensional logical dispatch');
assert.match(wgsl, /if \(index >= dims\.total_output\) \{ return; \}/, 'rounded dispatch tails must not write output');
assert.match(wgsl, /let input_base = token \* dims\.input_channels;/, 'input scalars must stay token-major');
assert.match(wgsl, /let weight_base = output_channel \* dims\.input_channels;/, 'weight scalars must stay output-major');
assert.match(wgsl, /for \(var channel = 0u; channel < dims\.input_channels; channel = channel \+ 4u\)/, 'the scalar storage reduction must consume four contiguous channels per iteration');
const orderedLanes = /sum = sum \+ input_values\[input_base \+ channel\] \* weight\[weight_base \+ channel\];\s*sum = sum \+ input_values\[input_base \+ channel \+ 1u\] \* weight\[weight_base \+ channel \+ 1u\];\s*sum = sum \+ input_values\[input_base \+ channel \+ 2u\] \* weight\[weight_base \+ channel \+ 2u\];\s*sum = sum \+ input_values\[input_base \+ channel \+ 3u\] \* weight\[weight_base \+ channel \+ 3u\];/;
assert.match(wgsl, orderedLanes, 'four-wide products must accumulate in original scalar channel order');
assert.doesNotMatch(wgsl, /\bdot\s*\(/, 'dot reduction must not change the accepted accumulation order');
assert.doesNotMatch(wgsl, /workgroupBarrier|var<workgroup>|sum0[01]|sum1[01]/, 'the vector family must not reintroduce synchronization or multiple-output register pressure');
assert.match(wgsl, /output_values\[index\] = activate\(sum\);/, 'one invocation must still produce exactly one activated output');

for (const emitted of emittedShaders) {
  assert.match(emitted, orderedLanes, 'every emitted activation variant must preserve ordered four-wide accumulation');
}

assert.deepEqual(vectorLinearDispatch(33, 256, 65), [34]);
assert.deepEqual(vectorLinearDispatch(1_048_576, 256, 16), [512, 512]);
assert.deepEqual(
  vectorLinearDispatchForDevice(20, 256, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [5],
  'device-aware dispatch must honor a non-default effective limit',
);
assert.throws(() => vectorLinearDispatch(1, 255, 16), /inputChannels.*divisible by 4/);
assert.throws(() => vectorLinearDispatch(0, 256, 16), /tokenCount.*positive integer/);
assert.throws(() => vectorLinearDispatch(1, 256, 0), /outputChannels.*positive integer/);

console.log('sam serving vector linear contracts passed');
