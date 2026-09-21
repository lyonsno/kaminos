import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../src/core.js';

assert.equal(typeof core.createWebGpuLinearShader, 'function', 'common linear generator must be public');
const { createWebGpuLinearShader } = core;
const baseline = JSON.parse(await readFile(new URL('fixtures/linear-source-baselines.json', import.meta.url)));
const sam = await import('../src/sam-vector-linear-wgsl.js');
assert.equal(createWebGpuLinearShader({ variant: 'sequential4' }), baseline.sam.identity);
assert.equal(createWebGpuLinearShader({ variant: 'sequential4', activationExpression: 'max(value, 0.0)' }), baseline.sam.relu);
assert.equal(sam.SAM_VECTOR_LINEAR_WGSL, baseline.sam.identity);
assert.equal(sam.SAM_VECTOR_LINEAR_RELU_WGSL, baseline.sam.relu);
assert.equal(sam.SAM_VECTOR_LINEAR_GELU_WGSL, baseline.sam.gelu);
assert.equal(createWebGpuLinearShader({ variant: 'split4' }), baseline.split4);
assert.equal(createWebGpuLinearShader({ variant: 'split4-range' }), baseline.split4Range);
for (const variant of ['sequential4', 'split4', 'split4-range']) {
  const packed = createWebGpuLinearShader({ variant, weightStorage: 'f16-packed-u32' });
  assert.match(packed, /weight: array<u32>/);
  assert.match(packed, /unpack2x16float/);
  assert.doesNotMatch(packed, /enable f16|array<f16>|__\w+__/);
  assert.equal(createWebGpuLinearShader({ variant, weightStorage: 'f32' }),
    createWebGpuLinearShader({ variant }));
}
for (const options of [{}, { variant: 'auto' }, { variant: 'sequential4', weightStorage: 'fp8' },
  { variant: 'split4', activationExpression: '' }, { variant: 'split4', activationHelpers: null }]) {
  assert.throws(() => createWebGpuLinearShader(options), /variant|weightStorage|activation/);
}
console.log('shared linear source and option contracts passed');
