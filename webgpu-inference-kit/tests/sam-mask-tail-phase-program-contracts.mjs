import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-mask-tail-phase-program.js', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-mask-tail-phase-program-contracts\.mjs/, 'default test must include portable mask-tail phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-mask-tail']?.includes('sam-mask-tail-mlx-packet-contracts.mjs'), 'live mask-tail MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-mask-tail-mlx-packet-contracts\.mjs/, 'default test must not require private MLX mask-tail packet export');
assert.equal(existsSync(new URL('../tools/sam-mask-tail-mlx-packet.py', import.meta.url)), true, 'mask-tail MLX packet exporter must exist');

assert.match(routeSource, /defineProgram/, 'mask-tail route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'mask-tail route must execute through runProgram');
assert.match(routeSource, /mask-embedder-layer-0/, 'mask-tail route must include mask embedder MLP phase names');
assert.match(routeSource, /instance-projection-1x1/, 'mask-tail route must include instance projection phase');
assert.match(routeSource, /sam3-mask-tail-phase-program-v0/, 'mask-tail route must stamp kernel profile identity');

const route = createSam3MaskTailPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-mask-tail-tensors', 'sam3-mask-tail-weights']);
assert.deepEqual(route.requiredOutputRoles, ['mask-logits', 'mask-binary']);
assert.equal(validateRouteDefinition(route).ok, true);

const shape = { batch: 1, maskTokens: 1, channels: 2, height: 1, width: 2 };
const oracle = createSam3MaskTailPhaseProgramCpuOracle({
  lastHs: new Float32Array([1, -2]),
  pixelEmbed: new Float32Array([3, 4, -1, 2]),
  weights: {
    maskEmbedder: [
      { weight: new Float32Array([1, 0, 0, 1]), bias: new Float32Array([0, 1]) },
      { weight: new Float32Array([1, 0, 0, 1]), bias: new Float32Array([0, 0]) },
      { weight: new Float32Array([2, 0, 0, -1]), bias: new Float32Array([0, 0]) },
    ],
    instanceProjection: {
      weight: new Float32Array([1, 0, 0, 1]),
      bias: new Float32Array([0, 0]),
    },
  },
  shape,
});
assert.deepEqual(Array.from(oracle.maskEmbeddings), [2, 0]);
assert.deepEqual(Array.from(oracle.upscaledEmbedding), [3, -1, 4, 2]);
assert.deepEqual(Array.from(oracle.maskLogits), [6, -2]);
assert.deepEqual(Array.from(oracle.binaryMask), [1, 0]);

console.log('sam mask tail phase-program contracts passed');
