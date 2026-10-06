import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';
import { createLinearDispatch } from '../src/runtime-primitives.js';

import {
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-pixel-decoder-phase-program.js', import.meta.url), 'utf8');
const pixelModule = await import('../src/sam-pixel-decoder-phase-program.js');
assert.equal(typeof pixelModule.createSamPixelConvolutionChunks, 'function', 'pixel convolution must expose its complete cooperative output partition');
for (const [batch, channels, height, width] of [[1, 256, 288, 288], [2, 256, 145, 143], [2, 3, 7, 11], [1, 256, 1, 1]]) {
  const chunks = pixelModule.createSamPixelConvolutionChunks({ batch, channels }, { height, width });
  let end = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.offset, end, 'convolution chunks must neither skip nor repeat outputs');
    assert.ok(Number.isSafeInteger(chunk.count) && chunk.count > 0);
    end += chunk.count;
  }
  assert.equal(end, batch * channels * height * width, 'all batches and tails must execute');
  if (height === 288) {
    assert.equal(chunks.length, 36);
    assert.equal(chunks[0].count, 8 * width * channels);
  }
}
const convSource = routeSource.match(/const CONV3X3_WGSL = `([\s\S]*?)`;/)[1];
assert.match(convSource, /if \(local_index >= dims\.output_count\) \{ return; \}/);
assert.match(convSource, /let index = dims\.output_start \+ local_index;/);
assert.match(routeSource, /createSamPixelConvolutionChunks\(shape, targetLevel\)/);
assert.match(routeSource, /dispatch: workgroups\(chunk\.count, input\.device\)/);
const expand = routeSource.match(/      const convolutionPhaseIndex = [\s\S]*?\n      \}\)\);/)[0];
for (const [height, width, batch] of [[288, 288, 1], [145, 143, 2]]) {
  const targetLevel = { height, width };
  const sourceLevel = { height: Math.ceil(height / 2), width: Math.ceil(width / 2) };
  const shape = { batch, channels: 256, groups: 32, levels: [targetLevel, sourceLevel] };
  const total = batch * height * width * shape.channels;
  const tensors = Object.fromEntries(['input', 'weight', 'bias', 'output'].map(name => [name, { name }]));
  const kernels = { conv: { code: convSource, bindings: [...Object.keys(tensors).map(name => ({ name, resource: `tensor:${name}` })), { name: 'dims', resource: 'uniform:full' }] } };
  const uniforms = {};
  const phases = [{ name: 'upsample' }, { name: 'pixel-conv3x3-0', kernel: 'conv', yieldAfter: true }, { name: 'stats' }, { name: 'normalize' }];
  const runtime = { createUniformBuffer: spec => spec, defineComputeKernel: spec => spec };
  new Function('phases', 'kernels', 'uniforms', 'shape', 'runtime', 'input', 'targetLevel', 'total', 'index', 'createSamPixelConvolutionChunks', 'workgroups', expand)(
    phases, kernels, uniforms, shape, runtime, { device: {} }, targetLevel, total, 0,
    pixelModule.createSamPixelConvolutionChunks, count => createLinearDispatch(count, { workgroupSize: 64 }),
  );
  assert.equal(phases[0].name, 'upsample');
  assert.equal(phases.at(-2).name, 'stats');
  assert.equal(phases.at(-1).name, 'normalize');
  const program = defineWebGpuPhaseProgram({ name: 'pixel-partition', tensors, uniforms, kernels, phases: phases.slice(1, -2) }, { runtime });
  let offset = 0;
  for (const phase of program.phases) {
    assert.equal(phase.yieldAfter, true);
    assert.equal(phase.kernel.bindings[3].resource, tensors.output);
    const dims = phase.kernel.bindings[4].resource;
    assert.deepEqual(dims.schema.map(field => field.name), ['batch', 'channels', 'source_height', 'source_width', 'target_height', 'target_width', 'total', 'groups', 'output_start', 'output_count']);
    assert.equal(dims.values.output_start, offset);
    assert.equal(dims.values.total, total);
    assert.equal(dims.values.batch, batch);
    assert.equal(dims.values.target_width, width);
    assert.equal(dims.values.target_height, height);
    const lanes = phase.dispatch.reduce((a, b) => a * b, 64);
    assert.ok(lanes >= dims.values.output_count && lanes - dims.values.output_count < 64);
    offset += dims.values.output_count;
  }
  assert.equal(offset, total);
}

assert.match(packageJson.scripts.test, /sam-pixel-decoder-phase-program-contracts\.mjs/, 'default test must include portable pixel-decoder phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-pixel-decoder']?.includes('sam-pixel-decoder-mlx-packet-contracts.mjs'), 'live pixel-decoder MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-pixel-decoder-mlx-packet-contracts\.mjs/, 'default test must not require private MLX pixel-decoder packet export');
assert.equal(existsSync(new URL('../tools/sam-pixel-decoder-mlx-packet.py', import.meta.url)), true, 'pixel-decoder MLX packet exporter must exist');

assert.match(routeSource, /defineProgram/, 'pixel-decoder route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'pixel-decoder route must execute through runProgram');
assert.match(routeSource, /pixel-upsample-add-0/, 'pixel-decoder route must include upsample/add phase names');
assert.match(routeSource, /pixel-conv3x3-0/, 'pixel-decoder route must include conv phase names');
assert.match(routeSource, /pixel-groupnorm-stats-0/, 'pixel-decoder route must compute groupnorm stats on GPU');
assert.match(routeSource, /pixel-groupnorm-relu-0/, 'pixel-decoder route must apply groupnorm affine and ReLU on GPU');
assert.match(routeSource, /sam3-pixel-decoder-phase-program-v0/, 'pixel-decoder route must stamp kernel profile identity');

const route = createSam3PixelDecoderPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-pixel-decoder-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-pixel-decoder-tensors', 'sam3-pixel-decoder-weights']);
assert.deepEqual(route.requiredOutputRoles, ['pixel-embed']);
assert.equal(validateRouteDefinition(route).ok, true);

const shape = {
  batch: 1,
  channels: 2,
  groups: 1,
  levels: [
    { height: 2, width: 2 },
    { height: 1, width: 1 },
  ],
};
const oracle = createSam3PixelDecoderPhaseProgramCpuOracle({
  features: [
    new Float32Array(8),
    new Float32Array(2),
  ],
  weights: {
    stages: [
      {
        convWeight: new Float32Array([
          0, 0, 0, 0, 0, 0,
          0, 0, 1, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 1, 0, 0,
          0, 0, 0, 0, 0, 0,
        ]),
        convBias: new Float32Array([2, 4]),
        normWeight: new Float32Array([1, 1]),
        normBias: new Float32Array([0, 0]),
      },
    ],
  },
  shape,
});
const expected = [0, 0.999995, 0, 0.999995, 0, 0.999995, 0, 0.999995];
assert.equal(oracle.pixelEmbed.length, expected.length);
for (let index = 0; index < expected.length; index += 1) {
  assert.ok(Math.abs(oracle.pixelEmbed[index] - expected[index]) < 0.00001, `pixel ${index}: ${oracle.pixelEmbed[index]} !== ${expected[index]}`);
}

console.log('sam pixel decoder phase-program contracts passed');
