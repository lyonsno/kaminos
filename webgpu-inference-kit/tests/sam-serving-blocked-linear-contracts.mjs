import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const sharedUrl = new URL('sam-blocked-linear-wgsl.js', root);
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

assert.equal(existsSync(sharedUrl), true, 'serving linears must expose one shared blocked WGSL family');
const shared = existsSync(sharedUrl) ? readFileSync(sharedUrl, 'utf8') : '';

function executableBlockedKernelWgsl(source) {
  const match = source.match(/const BLOCKED_LINEAR_WGSL = `([\s\S]*?)`;/);
  assert.ok(match, 'the blocked kernel must retain one inspectable WGSL template');
  return match[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

function validateBlockedKernelSource(source) {
  assert.match(source, /const OUTPUT_TILE = 16;/, 'the blocked kernel must produce a 16 by 16 output tile');
  assert.match(source, /const REDUCTION_TILE = 128;/, 'the reduction tile must amortize synchronization across 128 channels');
  const wgsl = executableBlockedKernelWgsl(source);
  assert.match(wgsl, /var<workgroup> input_tile: array<f32, 2048>;/, 'the input tile must retain sixteen 128-wide rows');
  assert.match(wgsl, /var<workgroup> weight_tile: array<f32, 2048>;/, 'the weight tile must retain sixteen 128-wide rows');
  assert.equal((wgsl.match(/workgroupBarrier\(\);/g) || []).length, 2, 'each reduction block must use exactly one load and one reuse barrier');
  assert.match(wgsl, /@compute @workgroup_size\(8, 8, 1\)/, 'the blocked kernel must retain 64 cooperative invocations');
  assert.match(wgsl, /for \(var k_base = 0u; k_base < input_channels; k_base = k_base \+ 128u\)/, 'the outer reduction must advance by one complete block');
  assert.match(wgsl, /for \(var tile_index = lane; tile_index < 2048u; tile_index = tile_index \+ 64u\)/, 'all 64 invocations must cooperatively load both complete tiles');
  assert.match(wgsl, /let tile_row = tile_index \/ 128u;/, 'cooperative loads must preserve tile rows');
  assert.match(wgsl, /let tile_column = tile_index % 128u;/, 'cooperative loads must preserve contiguous reduction columns');
  assert.match(wgsl, /input_tile\[tile_index\] = 0\.0;\s*if \(token < token_count && input_channel < input_channels\)/, 'input tile rows must be zeroed before guarded partial-tile loads');
  assert.match(wgsl, /weight_tile\[tile_index\] = 0\.0;\s*if \(output_channel < output_channels && input_channel < input_channels\)/, 'weight tile rows must be zeroed before guarded partial-tile loads');
  assert.match(wgsl, /for \(var k_local = 0u; k_local < 128u; k_local = k_local \+ 1u\)/, 'each loaded reduction block must be consumed completely in order');
  assert.match(wgsl, /let input0 = input_tile\[local_id\.y \* 128u \+ k_local\];/, 'input0 must read the first token row');
  assert.match(wgsl, /let input1 = input_tile\[\(local_id\.y \+ 8u\) \* 128u \+ k_local\];/, 'input1 must read the second token row');
  assert.match(wgsl, /let weight0 = weight_tile\[local_id\.x \* 128u \+ k_local\];/, 'weight0 must read the first output row');
  assert.match(wgsl, /let weight1 = weight_tile\[\(local_id\.x \+ 8u\) \* 128u \+ k_local\];/, 'weight1 must read the second output row');
  assert.match(wgsl, /sum00 = sum00 \+ input0 \* weight0;/, 'sum00 must pair the first token and first output rows');
  assert.match(wgsl, /sum01 = sum01 \+ input0 \* weight1;/, 'sum01 must pair the first token and second output rows');
  assert.match(wgsl, /sum10 = sum10 \+ input1 \* weight0;/, 'sum10 must pair the second token and first output rows');
  assert.match(wgsl, /sum11 = sum11 \+ input1 \* weight1;/, 'sum11 must pair the second token and second output rows');
  for (const accumulator of ['sum00', 'sum01', 'sum10', 'sum11']) {
    assert.match(wgsl, new RegExp(`var ${accumulator} =`), `${accumulator} must be an explicit scalar accumulator`);
    assert.match(wgsl, new RegExp(`${accumulator} = ${accumulator}\\s*\\+`), `${accumulator} must preserve scalar accumulation order`);
    assert.match(wgsl, new RegExp(`activate\\(${accumulator}\\)`), `${accumulator} must feed one final activated store`);
  }
  assert.doesNotMatch(wgsl, /array<f32, 4>|output_lane|token_half|output_half/, 'the blocked kernel must not dynamically index its four output accumulators');
  assert.equal((wgsl.match(/if \(token\d < token_count && output\d < output_channels\)/g) || []).length, 4, 'all four stores must independently guard token and output tails');
  assert.match(wgsl, /output_values\[token0 \* output_channels \+ output0\] = activate\(sum00\);/, 'the first output must remain token-major');
  assert.match(wgsl, /output_values\[token0 \* output_channels \+ output1\] = activate\(sum01\);/, 'the second output must remain token-major');
  assert.match(wgsl, /output_values\[token1 \* output_channels \+ output0\] = activate\(sum10\);/, 'the third output must remain token-major');
  assert.match(wgsl, /output_values\[token1 \* output_channels \+ output1\] = activate\(sum11\);/, 'the fourth output must remain token-major');
}

validateBlockedKernelSource(shared);
const semanticCounterexamples = [
  ['narrow reduction tile', shared.replaceAll('128u', '16u')],
  ['missing reuse barrier', shared.replace('workgroupBarrier();', '// missing load barrier')],
  ['missing input tail zero', shared.replace('input_tile[tile_index] = 0.0;', '// missing input tail zero')],
  ['missing weight tail zero', shared.replace('weight_tile[tile_index] = 0.0;', '// missing weight tail zero')],
  ['token1 aliases token0 row', shared.replace('(local_id.y + 8u) * 128u + k_local', 'local_id.y * 128u + k_local')],
  ['output1 aliases output0 row', shared.replace('(local_id.x + 8u) * 128u + k_local', 'local_id.x * 128u + k_local')],
  ['sum00 crosses operands', shared.replace('sum00 = sum00 + input0 * weight0;', 'sum00 = sum00 + input1 * weight0;')],
  ['sum01 crosses operands', shared.replace('sum01 = sum01 + input0 * weight1;', 'sum01 = sum01 + input0 * weight0;')],
  ['sum10 crosses operands', shared.replace('sum10 = sum10 + input1 * weight0;', 'sum10 = sum10 + input0 * weight0;')],
  ['sum11 crosses operands', shared.replace('sum11 = sum11 + input1 * weight1;', 'sum11 = sum11 + input0 * weight0;')],
  ['transposed first output store', shared.replace('output_values[token0 * output_channels + output0]', 'output_values[output0 * token_count + token0]')],
  ['omitted fourth accumulator update', shared.replace('sum11 = sum11', 'sum11_omitted = sum11')],
  ['dynamic accumulator regression', shared.replace('var sum00 =', 'var sums: array<f32, 4>;\n  var sum00 =')],
  [
    'comment-hidden input tail zero',
    shared.replace(
      'input_tile[tile_index] = 0.0;',
      'input_tile[tile_index] = 1.0;\n      // input_tile[tile_index] = 0.0;',
    ),
  ],
  [
    'comment-hidden weight tail zero',
    shared.replace(
      'weight_tile[tile_index] = 0.0;',
      'weight_tile[tile_index] = 1.0;\n      // weight_tile[tile_index] = 0.0;',
    ),
  ],
  [
    'comment-hidden input1 row alias',
    shared.replace(
      'let input1 = input_tile[(local_id.y + 8u) * 128u + k_local];',
      'let input1 = input_tile[local_id.y * 128u + k_local];\n      // let input1 = input_tile[(local_id.y + 8u) * 128u + k_local];',
    ),
  ],
  [
    'comment-hidden weight1 row alias',
    shared.replace(
      'let weight1 = weight_tile[(local_id.x + 8u) * 128u + k_local];',
      'let weight1 = weight_tile[local_id.x * 128u + k_local];\n      // let weight1 = weight_tile[(local_id.x + 8u) * 128u + k_local];',
    ),
  ],
  ...[
    ['sum00', 'input0 * weight0', 'input1 * weight0'],
    ['sum01', 'input0 * weight1', 'input0 * weight0'],
    ['sum10', 'input1 * weight0', 'input0 * weight0'],
    ['sum11', 'input1 * weight1', 'input0 * weight0'],
  ].map(([accumulator, expectedPair, wrongPair]) => [
    `comment-hidden ${accumulator} operand pair`,
    shared.replace(
      `${accumulator} = ${accumulator} + ${expectedPair};`,
      `${accumulator} = ${accumulator} + ${wrongPair};\n      // ${accumulator} = ${accumulator} + ${expectedPair};`,
    ),
  ]),
];
for (const [name, counterexample] of semanticCounterexamples) {
  assert.notEqual(counterexample, shared, `${name} counterexample must alter the shared kernel`);
  assert.throws(() => validateBlockedKernelSource(counterexample), `blocked kernel contract must reject ${name}`);
}

for (const file of consumers) {
  const source = readFileSync(new URL(file, root), 'utf8');
  assert.match(source, /sam-blocked-linear-wgsl\.js/, `${file} must consume the shared blocked family`);
  assert.match(source, /blockedLinearDispatch(?:ForDevice)?\(/, `${file} must use the shared blocked dispatch contract`);
  assert.match(source, /maxComputeWorkgroupsPerDimension|blockedLinearDispatchForDevice\(tokens, outputChannels, device\)/, `${file} must dispatch through the effective device limit`);
  assert.doesNotMatch(source, /sam-(?:tiled|packed)-linear-wgsl\.js|SAM_(?:TILED|PACKED)_LINEAR|(?:tiled|packed)LinearDispatch/, `${file} must not retain a rejected serving-linear family`);
}

const {
  SAM_BLOCKED_LINEAR_TILE,
  blockedLinearDispatch,
  blockedLinearDispatchForDevice,
} = await import('../src/sam-blocked-linear-wgsl.js');
assert.deepEqual(SAM_BLOCKED_LINEAR_TILE, {
  tokens: 16,
  outputs: 16,
  reduction: 128,
  workgroupStorageBytes: 16_384,
});
assert.deepEqual(blockedLinearDispatch(33, 65), [5, 3, 1]);
assert.deepEqual(blockedLinearDispatch(1_048_576, 16), [1, 65_535, 2]);
assert.deepEqual(
  blockedLinearDispatchForDevice(400, 16, { limits: { maxComputeWorkgroupsPerDimension: 7 } }),
  [1, 7, 4],
  'device-aware dispatch must honor a non-default effective workgroup limit',
);
assert.throws(() => blockedLinearDispatch(0, 16), /tokenCount.*positive integer/);
assert.throws(() => blockedLinearDispatch(1, 0), /outputChannels.*positive integer/);

console.log('sam serving blocked linear contracts passed');
