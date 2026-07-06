import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-pixel-decoder-phase-program.js', import.meta.url), 'utf8');

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
