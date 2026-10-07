import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebGpuLinearShader } from '../src/linear-kernel.js';
import * as sam from '../src/sam-vector-linear-wgsl.js';
import { createLinearDispatch } from '../src/runtime-primitives.js';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';

assert.equal(typeof sam.partitionSamLinearPhase, 'function', 'SAM linear range partition primitive must exist');
const baseline = JSON.parse(readFileSync(new URL('fixtures/linear-source-baselines.json', import.meta.url)));
assert.equal(sam.SAM_VECTOR_LINEAR_WGSL, baseline.sam.identity);
assert.equal(sam.SAM_VECTOR_LINEAR_GELU_WGSL, baseline.sam.gelu);
for (const [base, ranged] of [[sam.SAM_VECTOR_LINEAR_WGSL, sam.SAM_VECTOR_LINEAR_RANGE_WGSL], [sam.SAM_VECTOR_LINEAR_GELU_WGSL, sam.SAM_VECTOR_LINEAR_GELU_RANGE_WGSL]]) {
  assert.equal(typeof ranged, 'string');
  assert.match(ranged, /@binding\(4\) var<uniform> dims: LinearDims/);
  assert.match(ranged, /@binding\(5\) var<uniform> output_range: LinearRange/);
  assert.match(ranged, /if \(local_index >= output_range.output_count\) \{ return; \}/);
  assert.match(ranged, /let index = output_range.output_start \+ local_index;/);
  assert.equal(ranged.replace(
    '\nstruct LinearRange {\n  output_start: u32,\n  output_count: u32,\n};\n@group(0) @binding(5) var<uniform> output_range: LinearRange;', '',
  ).replace(
    'let local_index = gid.x + gid.y * dispatch_grid.x * 64u;\n  if (local_index >= output_range.output_count) { return; }\n  let index = output_range.output_start + local_index;',
    'let index = gid.x + gid.y * dispatch_grid.x * 64u;',
  ), base, 'only range declaration and invocation addressing may differ');
  assert.equal(ranged.slice(ranged.indexOf('  let output_channel')), base.slice(base.indexOf('  let output_channel')), 'all addressing after index, reduction and activation unchanged');
  assert.equal(ranged.slice(ranged.indexOf('fn activate'), ranged.indexOf('@compute')), base.slice(base.indexOf('fn activate'), base.indexOf('@compute')));
  for (const code of [base, ranged]) {
    for (const [tokens, outputs, size, limit] of [[1, 1, 1, 65535], [3, 7, 8, 65535], [2, 513, 700, 4], [9, 13, 64, 65535]]) {
      const uniforms = [];
      const runtime = { device: { limits: { maxComputeWorkgroupsPerDimension: limit } }, createUniformBuffer(spec) { uniforms.push(spec); return spec; } };
      const bindings = ['input', 'weight', 'bias', 'output', 'dims'].map(name => ({ name, resource: { name } }));
      const kernels = { linear: { code, bindings } };
      const metadata = { source: 'parent', layer: 3 };
      const phase = { name: 'linear-phase', kernel: 'linear', dispatch: [99], yieldAfter: true, yieldReason: 'parent-yield', metadata };
      const phases = sam.partitionSamLinearPhase(phase, { tokens, inputChannels: 4, outputChannels: outputs, maxOutputsPerPhase: size }, runtime, kernels);
      assert.equal(phases.length, Math.ceil(tokens * outputs / size));
      const writes = new Uint8Array(tokens * outputs);
      const program = defineWebGpuPhaseProgram({ name: 'range-test', kernels, phases }, { runtime: { defineComputeKernel: spec => spec } });
      for (const [i, chunk] of phases.entries()) {
        const start = i * size, count = Math.min(size, writes.length - start);
        assert.deepEqual(uniforms[i].values, { output_start: start, output_count: count });
        assert.deepEqual(chunk.dispatch, createLinearDispatch(count, { workgroupSize: 64, maxWorkgroupsPerDimension: limit }));
        assert.equal(chunk.name, i === 0 ? phase.name : `${phase.name}-range-${start}`);
        assert.equal(chunk.yieldAfter, true);
        assert.equal(chunk.yieldReason, phase.yieldReason);
        assert.deepEqual(chunk.metadata, metadata);
        assert.equal(program.phases[i].kernel.bindings[5].resource, uniforms[i]);
        assert.equal(program.phases[i].kernel.code, ranged);
        assert.deepEqual(program.phases[i].kernel.bindings.slice(0, 5), bindings);
        const [x, y = 1] = chunk.dispatch;
        for (let row = 0; row < y; row++) for (let gx = 0; gx < x * 64; gx++) {
          const local = gx + row * x * 64;
          if (local < count) writes[start + local]++;
        }
      }
      assert.ok(writes.every(count => count === 1), 'all outputs, including token/channel-crossing tails, written once');
      assert.deepEqual(kernels.linear, { code, bindings }, 'template remains unchanged');
    }
  }
}
assert.match(createWebGpuLinearShader({ variant: 'sequential4-range', weightStorage: 'f16-packed-u32' }), /unpack2x16float/);
for (const invalid of [{ tokens: 0 }, { inputChannels: 0 }, { outputChannels: 0 }, { maxOutputsPerPhase: 0 }, { maxOutputsPerPhase: 1.5 }, { inputChannels: 3 }, { tokens: 2 ** 32 }, { tokens: 2 ** 31, outputChannels: 2 }]) {
  let allocated = 0;
  const runtime = { createUniformBuffer() { allocated++; } };
  assert.throws(() => sam.partitionSamLinearPhase({ name: 'x', kernel: 'x' }, { tokens: 1, inputChannels: 4, outputChannels: 1, maxOutputsPerPhase: 1, ...invalid }, runtime, { x: { code: sam.SAM_VECTOR_LINEAR_WGSL, bindings: [] } }), /positive integer|divisible|u32/);
  assert.equal(allocated, 0, 'invalid dimensions must fail before allocating');
}
// CPU replay checks range indexing, not native WGSL execution.
const inputs = [1, 2, 3, 4, 5, 6, 7, 8, -1, -2, -3, -4, -5, -6, -7, -8];
const weights = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, -1, 1, -1, 1, -1, 1, -1];
const bias = [0.5, -0.5, 1];
const kernels = { numeric: { code: sam.SAM_VECTOR_LINEAR_WGSL, bindings: [] } };
const phases = sam.partitionSamLinearPhase({ name: 'numeric', kernel: 'numeric', yieldAfter: true },
  { tokens: 2, inputChannels: 8, outputChannels: 3, maxOutputsPerPhase: 4 }, { createUniformBuffer: spec => spec }, kernels);
const actual = new Float32Array(6).fill(NaN);
for (const phase of phases) {
  const { output_start: start, output_count: count } = kernels[phase.kernel].bindings.at(-1).resource.values;
  for (let local = 0; local < count; local++) {
    const index = start + local, output = index % 3, token = Math.floor(index / 3);
    let sum = bias[output];
    for (let channel = 0; channel < 8; channel++) sum = Math.fround(sum + Math.fround(inputs[token * 8 + channel] * weights[output * 8 + channel]));
    actual[index] = sum;
  }
}
assert.deepEqual(Array.from(actual), [36.5, 7.5, -3, -35.5, -8.5, 5]);
let allocated = 0;
assert.throws(() => sam.partitionSamLinearPhase({ name: 'capacity', kernel: 'x' },
  { tokens: 1, inputChannels: 4, outputChannels: 257, maxOutputsPerPhase: 257 },
  { device: { limits: { maxComputeWorkgroupsPerDimension: 2 } }, createUniformBuffer() { allocated++; } },
  { x: { code: sam.SAM_VECTOR_LINEAR_WGSL, bindings: [] } }), /two-dimensional device capacity/);
assert.equal(allocated, 0);
console.log('SAM sequential4 complete linear range contracts passed');
