import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { defineComputeKernel } from '../src/runtime-primitives.js';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';
import { SAM_VECTOR_LINEAR_RANGE_WGSL as code } from '../src/sam-vector-linear-wgsl.js';

const url = new URL('../src/sam-range-phase-program.js', import.meta.url);
assert.ok(existsSync(url), 'SAM program-local pipeline reuse primitive must exist');
const { createSamRangePhaseRuntime } = await import(url);
let setups = 0;
const device = {
  createBindGroupLayout: descriptor => ({ descriptor }),
  createPipelineLayout: descriptor => ({ descriptor }),
  createBindGroup: descriptor => ({ descriptor }),
};
const runtime = { device, defineComputeKernel(input) {
  setups++;
  return defineComputeKernel(input, { device, getShaderModule: (name, code) => ({ name, code }), getComputePipeline: (name, descriptor) => ({ name, descriptor }) });
} };
const facade = createSamRangePhaseRuntime(runtime, [code]);
const resource = (id, bufferOffset, byteLength) => ({ buffer: { id }, bufferOffset, byteLength });
const a = resource('a', 256, 128), b = resource('b', 512, 64);
function spec(name, value = a, overrides = {}) {
  return { name, code, bindings: [{ name: 'output', resource: value, access: 'storage', visibility: 4 }, { name: 'range', resource: value, type: 'uniform', visibility: 4 }], metadata: { owner: name }, ...overrides };
}
function build(first, second) {
  return facade.defineProgram({ name: 'test', kernels: { a: first, b: second }, phases: [{ name: 'a', kernel: 'a', dispatch: [1], yieldAfter: true }, { name: 'b', kernel: 'b', dispatch: [2], yieldAfter: true }] });
}
const originalA = spec('a'), originalB = spec('b', b);
const before = JSON.stringify([originalA, originalB]);
const baseline = defineWebGpuPhaseProgram({ name: 'baseline', kernels: { a: originalA, b: originalB },
  phases: [{ name: 'a', kernel: 'a', dispatch: [1] }, { name: 'b', kernel: 'b', dispatch: [2] }],
}, { runtime });
assert.equal(setups, 2, 'ordinary phase program sets up both repeated descriptors');
assert.notEqual(baseline.phases[0].kernel.pipeline, baseline.phases[1].kernel.pipeline);
setups = 0;
const program = build(originalA, originalB);
assert.equal(setups, 1, 'repeated SAM range descriptors must set up one pipeline per program');
const [first, second] = program.phases.map(phase => phase.kernel);
for (const field of ['pipeline', 'pipelineLayout', 'bindGroupLayout', 'shaderModule']) assert.equal(second[field], first[field]);
assert.notEqual(second.bindGroup, first.bindGroup);
assert.equal(second.name, 'b');
assert.deepEqual(second.metadata, { owner: 'b' });
assert.deepEqual(second.bindings, first.bindings);
assert.deepEqual(second.bindGroup.descriptor.entries, [0, 1].map(binding => ({ binding, resource: { buffer: b.buffer, offset: 512, size: 64 } })));
assert.equal(JSON.stringify([originalA, originalB]), before, 'original descriptors unchanged');
second.metadata.owner = 'changed';
assert.equal(originalB.metadata.owner, 'b');
assert.equal(program.phases[1].yieldAfter, true);
assert.deepEqual(program.phases[1].dispatch, [2, 1, 1]);
build(spec('a'), spec('b'));
assert.equal(setups, 2, 'cache must not escape one construction');
for (const overrides of [{ code: code + '\n' }, { entryPoint: 'other' }, { shaderModuleDescriptor: {} }, { bindings: [{ name: 'output', resource: b, access: 'read-only-storage', visibility: 4 }, { name: 'range', resource: b, type: 'uniform', visibility: 4 }] }, { bindings: [{ name: 'output', resource: b, access: 'storage', visibility: 1 }, { name: 'range', resource: b, type: 'uniform', visibility: 4 }] }]) {
  const count = setups;
  build(spec('a'), spec('b', b, overrides));
  assert.equal(setups - count, 2, 'different code/entrypoint/layout or shader descriptors must not reuse');
}
const renamed = build(spec('a'), spec('b', resource('zero', 0, 0), { bindings: [{ name: 'newOutput', resource: b, access: 'storage' }, { name: 'newRange', resource: b, type: 'uniform' }] }));
assert.deepEqual(renamed.phases[1].kernel.bindings.map(binding => binding.name), ['newOutput', 'newRange']);
const zero = resource('zero', 0, 0);
const zeroProgram = build(spec('a'), spec('zero', zero));
assert.deepEqual(zeroProgram.phases[1].kernel.bindGroup.descriptor.entries[0].resource, { buffer: zero.buffer }, 'zero offset/size omission matches original primitive');
const named = facade.defineProgram({ name: 'named', tensors: { output: b }, uniforms: { first: a, second: b },
  kernels: Object.fromEntries(['first', 'second'].map(name => [name, { ...spec(name), bindings: [
    { name: 'output', resource: 'tensor:output', access: 'storage' }, { name: 'range', resource: `uniform:${name}`, type: 'uniform' },
  ] }])), phases: ['first', 'second'].map(name => ({ name, kernel: name, dispatch: [1] })) });
assert.equal(named.phases[0].kernel.pipeline, named.phases[1].kernel.pipeline);
assert.equal(named.phases[1].kernel.bindGroup.descriptor.entries[1].resource.buffer, b.buffer, 'existing resolver selects the current named uniform');
assert.throws(() => build(spec('a'), spec('bad', b, { bindings: [{ name: 'output', resource: {} }, { name: 'range', resource: b, type: 'uniform' }] })), /buffer/);
assert.throws(() => build(spec('a'), spec('bad', b, { bindings: [{ name: '', resource: b }, { name: 'range', resource: b, type: 'uniform' }] })), /binding name/);
const bypass = createSamRangePhaseRuntime(runtime, []);
const previousSetups = setups;
bypass.defineProgram({ name: 'not-admitted', kernels: { a: spec('a'), b: spec('b') }, phases: [{ name: 'a', kernel: 'a', dispatch: [1] }, { name: 'b', kernel: 'b', dispatch: [1] }] });
assert.equal(setups - previousSetups, 2, 'unlisted shaders retain original setup');
for (const [file, codes] of [
  ['sam-image-vit-block-stack-phase-program.js', ['SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL', 'SAM_VECTOR_LINEAR_RANGE_WGSL', 'SAM_VECTOR_LINEAR_GELU_RANGE_WGSL']],
  ['sam-detr-encoder-phase-program.js', ['SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL']],
  ['sam-pixel-decoder-phase-program.js', ['CONV3X3_WGSL']],
  ['sam-image-fpn-neck-phase-program.js', ['CONV2D_RANGE_WGSL']],
]) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.ok(source.includes(`createSamRangePhaseRuntime(runtime, [${codes.join(', ')}]).defineProgram(`), `${file}: exact range codes wired`);
  if (file === 'sam-image-fpn-neck-phase-program.js') assert.doesNotMatch(source.slice(source.indexOf('async function runSam31TrackingNeckPhaseProgramRoute')), /createSamRangePhaseRuntime/);
}
console.log('SAM program-local range pipeline reuse contracts passed');
