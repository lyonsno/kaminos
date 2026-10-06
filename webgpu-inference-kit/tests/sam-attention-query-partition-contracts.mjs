import assert from 'node:assert/strict';
import * as attention from '../src/sam-online-attention-wgsl.js';
import { readFileSync } from 'node:fs';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';

assert.equal(typeof attention.partitionSamAttentionPhase, 'function', 'SAM query partition primitive must exist');
for (const queries of [1, 255, 256, 257, 5184]) {
  const uniforms = [];
  const runtime = { createUniformBuffer(spec) { uniforms.push(spec); return spec; } };
  const kernels = { self: { code: attention.SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL, bindings: ['q', 'k', 'v', 'output', 'dims'].map(name => ({ name, resource: name === 'dims' ? 'uniform:fullDims' : `tensor:${name}` })) } };
  const phase = { name: 'self-attention', kernel: 'self', dispatch: [queries, 8, 2], yieldAfter: true };
  const phases = attention.partitionSamAttentionPhase(phase, kernels, runtime);
  assert.equal(phases.length, Math.ceil(queries / 256));
  const writes = new Uint8Array(queries * 8 * 2);
  let offset = 0;
  for (const [index, chunk] of phases.entries()) {
    const count = Math.min(256, queries - offset);
    assert.deepEqual(chunk.dispatch, [count, 8, 2]);
    assert.equal(chunk.yieldAfter, true);
    assert.equal(uniforms[index].values.query_offset, offset);
    assert.equal(kernels[chunk.kernel].bindings.at(-1).resource, uniforms[index]);
    assert.deepEqual(kernels[chunk.kernel].bindings[0], kernels.self.bindings[0]);
    for (let b = 0; b < 2; b++) for (let h = 0; h < 8; h++) for (let q = offset; q < offset + count; q++) writes[(b * 8 + h) * queries + q]++;
    offset += count;
  }
  assert.equal(offset, queries);
  assert.ok(writes.every(value => value === 1), 'every query/head/batch exactly once');
  const tensors = Object.fromEntries(['q', 'k', 'v', 'output'].map(name => [name, { name }]));
  const fullDims = { query_tokens: queries, key_tokens: queries, batch: 2 };
  const program = defineWebGpuPhaseProgram({ name: 'partition-test', tensors, uniforms: { fullDims }, kernels, phases }, {
    runtime: { defineComputeKernel: spec => spec },
  });
  assert.equal(program.phases.length, phases.length);
  for (const [index, chunk] of program.phases.entries()) {
    assert.equal(chunk.kernel.code, attention.SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL);
    assert.equal(chunk.kernel.bindings[3].resource, tensors.output);
    assert.equal(chunk.kernel.bindings[4].resource, fullDims);
    assert.equal(chunk.kernel.bindings[5].resource, uniforms[index]);
    assert.equal(chunk.yieldAfter, true);
  }
}
assert.equal(attention.SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL.replace('\nstruct QueryRange { query_offset: u32, };\n@group(0) @binding(5) var<uniform> query_range: QueryRange;', '').replace('workgroup.x + query_range.query_offset', 'workgroup.x'), attention.SAM_ONLINE_ATTENTION_WGSL, 'only query addressing and its uniform may differ');
const source = readFileSync(new URL('../src/sam-detr-encoder-phase-program.js', import.meta.url), 'utf8');
assert.match(source, /partitionSamAttentionPhase\(/);
assert.match(source, /addLinearKernel\('SelfAttention', SAM_QUERY_RANGE_ONLINE_ATTENTION_WGSL/);
assert.match(source, /phases\.splice\(attentionIndex, 1, \.\.\.partitionSamAttentionPhase\(phases\[attentionIndex\], kernels, runtime\)\)/);
const expansion = source.match(/const attentionIndex = [^]*?\n      phases\.splice\([^]*?\);/)[0];
const phases = [{ name: 'before' }, { name: 'detr-encoder-self-attention-softmax-3', kernel: 'self', dispatch: [5184, 8, 2], yieldAfter: true }, { name: 'after' }];
const kernels = { self: { bindings: [] } };
new Function('phases', 'kernels', 'runtime', 'layerIndex', 'partitionSamAttentionPhase', expansion)(phases, kernels, { createUniformBuffer: spec => spec }, 3, attention.partitionSamAttentionPhase);
assert.equal(phases.length, 23);
assert.equal(phases[0].name, 'before');
assert.equal(phases[1].name, 'detr-encoder-self-attention-softmax-3');
assert.equal(phases.at(-1).name, 'after');
assert.deepEqual(phases.at(-2).dispatch, [64, 8, 2]);
assert.equal(kernels[phases.at(-2).kernel].bindings.at(-1).resource.values.query_offset, 5120);
console.log('SAM attention complete query partitions passed');
