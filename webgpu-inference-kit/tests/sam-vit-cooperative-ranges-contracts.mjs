import assert from 'node:assert/strict';
import * as attention from '../src/sam-online-attention-wgsl.js';
import { readFileSync } from 'node:fs';
import * as linear from '../src/sam-vector-linear-wgsl.js';
import { defineComputeKernel } from '../src/runtime-primitives.js';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';
import { createSamRangePhaseRuntime } from '../src/sam-range-phase-program.js';

assert.equal(typeof attention.SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL, 'string', 'ViT needs its own full-domain range shader');
assert.equal(attention.SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL
  .replace('\nstruct QueryRange { query_offset: u32, };\n@group(0) @binding(5) var<uniform> query_range: QueryRange;', '')
  .replace('workgroup.x + query_range.query_offset', 'workgroup.x'), attention.SAM_VIT_ONLINE_ATTENTION_WGSL);

for (const [queries, windows] of [[1, 1], [127, 9], [128, 9], [129, 9], [576, 9], [5184, 1]]) {
  const kernels = { attention: { code: attention.SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL, bindings: [] } };
  const phases = attention.partitionSamAttentionPhase({ name: 'vit-attention', kernel: 'attention', dispatch: [queries, 16, windows * 2], yieldAfter: true }, kernels, { createUniformBuffer: spec => spec }, 128);
  assert.equal(phases.length, Math.ceil(queries / 128));
  let end = 0;
  for (const phase of phases) {
    assert.equal(kernels[phase.kernel].bindings.at(-1).resource.values.query_offset, end);
    assert.deepEqual(phase.dispatch, [Math.min(128, queries - end), 16, windows * 2]);
    assert.equal(phase.yieldAfter, true);
    end += phase.dispatch[0];
  }
  assert.equal(end, queries, 'full global and per-window domains, including tails');
}
for (const invalid of [0, -1, 0.5, NaN, Infinity, 65536]) {
  assert.throws(() => attention.partitionSamAttentionPhase({ kernel: 'attention', dispatch: [5184, 16, 1] }, { attention: { bindings: [] } }, { createUniformBuffer: spec => spec }, invalid), /queriesPerPhase/);
}
const source = readFileSync(new URL('../src/sam-image-vit-block-stack-phase-program.js', import.meta.url), 'utf8');
assert.match(source, /attention: \{ code: SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL/);
assert.match(source, /partitionSamAttentionPhase\(phase, kernels, runtime, 128\)/);
assert.match(source, /partitionSamLinearPhase\(\{ \.\.\.phase, yieldAfter: true \}/);
const partition = source.match(/const partitionPhase = phase => \{[^]*?\n      \};/);
assert.ok(partition);
const calls = [];
const layerShape = { paddedTotalValues: 72 * 72 * 1024 };
const shape = { tokenCount: 72 * 72, hiddenSize: 1024, intermediateSize: 4736 };
const phasePartition = new Function('shape', 'layerShape', 'kernels', 'runtime', 'partitionSamAttentionPhase', 'partitionSamLinearPhase', `${partition[0]} return partitionPhase;`)(shape, layerShape, {}, {}, () => [], (phase, dims) => { calls.push({ phase, dims }); return [phase]; });
for (const kernel of ['qProjection', 'kProjection', 'vProjection', 'outputProjection', 'mlpFc1', 'mlpFc2']) phasePartition({ kernel });
assert.equal(calls.length, 6, 'all dense backbone operations must cooperate');
for (const { phase, dims } of calls) {
  assert.equal(phase.yieldAfter, true);
  assert.equal(dims.tokens, 5184);
  assert.equal(dims.inputChannels, phase.kernel === 'mlpFc2' ? 4736 : 1024);
  assert.equal(dims.outputChannels, phase.kernel === 'mlpFc1' ? 4736 : 1024);
  assert.ok(dims.maxOutputsPerPhase >= 64);
  assert.ok(dims.maxOutputsPerPhase * dims.inputChannels <= 2 ** 30);
}
const instrument = source.match(/const instrumentedPhases = phases\.flatMap\(phase => \{[^]*?\n      \}\);/);
assert.ok(instrument, 'production phase expansion must precede one diagnostic readback per complete operation');
const expand = new Function('phases', 'partitionPhase', 'input', 'layerShape', 'phaseTensorNames', `${instrument[0]} return instrumentedPhases;`);
const full = { name: 'global-attention', kernel: 'attention' };
const before = { name: 'before', kernel: 'qRope' };
const after = { name: 'after', kernel: 'outputProjection' };
const chunkA = { name: 'global-attention', kernel: 'attentionQuery0' };
const chunkB = { name: 'global-attention-query-128', kernel: 'attentionQuery128' };
for (const diagnostic of [false, true]) {
  const result = expand([before, full, after], phase => phase === full ? [chunkA, chunkB] : [phase], { validateFinitePhaseLayerIndex: diagnostic ? 7 : undefined }, { layerIndex: 7 }, { qRope: 'qRope', attention: 'attention', outputProjection: 'projected' });
  assert.deepEqual(result.filter(phase => phase.kernel), [before, chunkA, chunkB, after]);
  const checkpoints = result.filter(phase => phase.readback);
  assert.equal(checkpoints.length, diagnostic ? 3 : 0);
  if (diagnostic) {
    assert.equal(result.indexOf(checkpoints[1]), result.indexOf(chunkB) + 1);
    assert.deepEqual(checkpoints[1].readback, { name: 'attention', tensor: 'tensor:attention' });
  }
}
function productionHostConstruction(facade) {
  let pipelines = 0, bindGroups = 0;
  const device = {
    createBindGroupLayout: descriptor => ({ descriptor }),
    createPipelineLayout: descriptor => ({ descriptor }),
    createBindGroup(descriptor) { bindGroups++; return { descriptor }; },
  };
  const runtime = {
    device,
    createUniformBuffer: spec => ({ ...spec, buffer: { values: spec.values }, byteLength: 16 }),
    defineComputeKernel: spec => defineComputeKernel(spec, { device,
      getShaderModule: (name, code) => ({ name, code }),
      getComputePipeline(name, descriptor) { pipelines++; return { name, descriptor }; },
    }),
    defineProgram(input) { return defineWebGpuPhaseProgram(input, { runtime }); },
  };
  const resources = new Map();
  const bind = (name, access) => {
    if (!resources.has(name)) resources.set(name, { buffer: { name }, byteLength: 16 });
    return { name, resource: resources.get(name), ...(access === 'uniform' ? { type: 'uniform' } : { access }) };
  };
  const names = ['qProjection', 'kProjection', 'vProjection', 'attention', 'outputProjection', 'mlpFc1', 'mlpFc2'];
  const kernels = {};
  const bindings = { ...linear, ...attention, bindTensor: (name, access = 'read-only-storage') => bind(name, access), bindUniform: name => bind(name, 'uniform') };
  for (const name of names) {
    const descriptor = source.match(new RegExp(`^        ${name}: (\\{[^\\n]+\\}),$`, 'm'));
    assert.ok(descriptor, `${name}: production kernel descriptor`);
    kernels[name] = new Function(...Object.keys(bindings), `return (${descriptor[1]});`)(...Object.values(bindings));
  }
  const partitionPhase = new Function('shape', 'layerShape', 'kernels', 'runtime', 'partitionSamAttentionPhase', 'partitionSamLinearPhase',
    `${partition[0]} return partitionPhase;`)(shape, layerShape, kernels, runtime, attention.partitionSamAttentionPhase, linear.partitionSamLinearPhase);
  const phases = names.flatMap(kernel => partitionPhase({ name: `native-global-${kernel}`, kernel, dispatch: kernel === 'attention' ? [5184, 16, 1] : [1], yieldAfter: true }));
  assert.equal(phases.length, 113, 'actual native global layer partition definitions');
  const codes = [attention.SAM_VIT_QUERY_RANGE_ONLINE_ATTENTION_WGSL, linear.SAM_VECTOR_LINEAR_RANGE_WGSL, linear.SAM_VECTOR_LINEAR_GELU_RANGE_WGSL];
  const program = facade(runtime, codes).defineProgram({ name: 'native-global-ranges', kernels, phases });
  assert.equal(new Set(program.phases.map(phase => phase.kernel.bindGroup)).size, 113);
  const ends = Object.fromEntries(names.map(name => [name, 0]));
  for (const [index, phase] of program.phases.entries()) {
    const name = names.find(name => phases[index].name === `native-global-${name}` || phases[index].name.startsWith(`native-global-${name}-`));
    const range = phase.kernel.bindGroup.descriptor.entries[5].resource.buffer.values;
    if (name === 'attention') {
      assert.equal(range.query_offset, ends[name]);
      ends[name] += phase.dispatch[0];
    } else {
      assert.equal(range.output_start, ends[name]);
      ends[name] += range.output_count;
    }
    assert.equal(phase.yieldAfter, true);
  }
  for (const name of names) assert.equal(ends[name], name === 'attention' ? 5184 : 5184 * (name === 'mlpFc1' ? 4736 : 1024));
  return { pipelines, bindGroups, executableBodies: new Set(program.phases.map(phase => phase.kernel.pipeline)).size };
}
assert.deepEqual(productionHostConstruction(runtime => runtime), { pipelines: 113, bindGroups: 113, executableBodies: 113 }, 'ordinary route exposes repeated native-global setup');
assert.deepEqual(productionHostConstruction(createSamRangePhaseRuntime), { pipelines: 3, bindGroups: 113, executableBodies: 3 }, 'native-global ranges share three production shader bodies');
console.log('SAM ViT cooperative attention ranges and production 113-to-3 pipeline setup passed');
