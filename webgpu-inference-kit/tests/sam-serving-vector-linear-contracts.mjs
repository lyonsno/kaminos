import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const sharedUrl = new URL('../src/sam-vector-linear-wgsl.js', import.meta.url);
assert.equal(existsSync(sharedUrl), true, 'serving linears must expose one shared scalar reduction family');
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
assert.equal(SAM_VECTOR_LINEAR_WIDTH, 1, 'the measured four-wide scalar unroll must remain retired');
assert.match(wgsl, /@compute @workgroup_size\(64\)/, 'the shared family must preserve the accepted scalar workgroup shape');
assert.match(wgsl, /let index = gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u;/, 'the shared family must preserve complete two-dimensional logical dispatch');
assert.match(wgsl, /if \(index >= dims\.total_output\) \{ return; \}/, 'rounded dispatch tails must not write output');
assert.match(wgsl, /let input_base = token \* dims\.input_channels;/, 'input scalars must stay token-major');
assert.match(wgsl, /let weight_base = output_channel \* dims\.input_channels;/, 'weight scalars must stay output-major');
assert.match(wgsl, /for \(var channel = 0u; channel < dims\.input_channels; channel = channel \+ 1u\)/, 'the measured scalar control must consume one channel per iteration');
const scalarAccumulation = /sum = sum \+ input_values\[input_base \+ channel\] \* weight\[weight_base \+ channel\];/;
assert.match(wgsl, scalarAccumulation, 'the scalar control must retain the accepted accumulation statement');
assert.doesNotMatch(wgsl, /input_base \+ channel \+ [123]u/, 'the retired four-wide unroll must not survive in any lane');
assert.doesNotMatch(wgsl, /\bdot\s*\(/, 'dot reduction must not change the accepted accumulation order');
assert.doesNotMatch(wgsl, /workgroupBarrier|var<workgroup>|sum0[01]|sum1[01]/, 'the shared family must not reintroduce synchronization or multiple-output register pressure');
assert.match(wgsl, /output_values\[index\] = activate\(sum\);/, 'one invocation must still produce exactly one activated output');

for (const emitted of emittedShaders) {
  assert.match(emitted, scalarAccumulation, 'every emitted activation variant must preserve scalar accumulation');
  assert.doesNotMatch(emitted, /input_base \+ channel \+ [123]u/, 'every emitted activation variant must retire the four-wide unroll');
}

assert.deepEqual(vectorLinearDispatch(33, 256, 65), [34]);
assert.deepEqual(vectorLinearDispatch(1_048_576, 256, 16), [512, 512]);
assert.deepEqual(
  vectorLinearDispatchForDevice(20, 256, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [5],
  'device-aware dispatch must honor a non-default effective limit',
);
assert.deepEqual(vectorLinearDispatch(1, 255, 16), [1], 'scalar reduction must admit non-four-divisible widths');
assert.throws(() => vectorLinearDispatch(0, 256, 16), /tokenCount.*positive integer/);
assert.throws(() => vectorLinearDispatch(1, 256, 0), /outputChannels.*positive integer/);

console.log('sam serving vector linear contracts passed');
