import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sharedUrl = new URL('../src/sam-vector-linear-wgsl.js', import.meta.url);
assert.equal(existsSync(sharedUrl), true, 'serving linears must expose one shared vec4 load family');
const source = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';

const template = source.match(/const VECTOR_LINEAR_WGSL = `([\s\S]*?)`;/)?.[1] ?? '';
const wgsl = template
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

assert.match(wgsl, /var<storage, read> input_values: array<vec4<f32>>;/, 'input rows must use aligned vec4 storage loads');
assert.match(wgsl, /var<storage, read> weight: array<vec4<f32>>;/, 'weight rows must use aligned vec4 storage loads');
assert.match(wgsl, /@compute @workgroup_size\(64\)/, 'the vector family must preserve the accepted scalar workgroup shape');
assert.match(wgsl, /let index = gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u;/, 'the vector family must preserve complete two-dimensional logical dispatch');
assert.match(wgsl, /if \(index >= dims\.total_output\) \{ return; \}/, 'rounded dispatch tails must not write output');
assert.match(wgsl, /let packed_input_channels = dims\.input_channels \/ 4u;/, 'the reduction domain must represent four contiguous channels per load');
assert.match(wgsl, /let input_base = token \* packed_input_channels;/, 'input vectors must stay token-major');
assert.match(wgsl, /let weight_base = output_channel \* packed_input_channels;/, 'weight vectors must stay output-major');
assert.match(wgsl, /for \(var packed_channel = 0u; packed_channel < packed_input_channels; packed_channel = packed_channel \+ 1u\)/, 'every packed channel must be consumed');
assert.match(wgsl, /let input_vector = input_values\[input_base \+ packed_channel\];/, 'each input vector must be loaded once');
assert.match(wgsl, /let weight_vector = weight\[weight_base \+ packed_channel\];/, 'each weight vector must be loaded once');
const orderedLanes = /sum = sum \+ input_vector\.x \* weight_vector\.x;\s*sum = sum \+ input_vector\.y \* weight_vector\.y;\s*sum = sum \+ input_vector\.z \* weight_vector\.z;\s*sum = sum \+ input_vector\.w \* weight_vector\.w;/;
assert.match(wgsl, orderedLanes, 'vec4 products must accumulate in original scalar channel order');
assert.doesNotMatch(wgsl, /\bdot\s*\(/, 'dot reduction must not change the accepted accumulation order');
assert.doesNotMatch(wgsl, /workgroupBarrier|var<workgroup>|sum0[01]|sum1[01]/, 'the vector family must not reintroduce synchronization or multiple-output register pressure');
assert.match(wgsl, /output_values\[index\] = activate\(sum\);/, 'one invocation must still produce exactly one activated output');

for (const symbol of ['SAM_VECTOR_LINEAR_WGSL', 'SAM_VECTOR_LINEAR_RELU_WGSL', 'SAM_VECTOR_LINEAR_GELU_WGSL']) {
  assert.match(source, new RegExp(`export const ${symbol} =`), `${symbol} must remain a shared production variant`);
}

const {
  vectorLinearDispatch,
  vectorLinearDispatchForDevice,
} = await import('../src/sam-vector-linear-wgsl.js');
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
