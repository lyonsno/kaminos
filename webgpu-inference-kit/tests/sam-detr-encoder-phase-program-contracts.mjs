import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrEncoderPhaseProgramCpuOracle,
  createSam3DetrEncoderPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-detr-encoder-phase-program.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam-detr-encoder-phase-program-contracts\.mjs/, 'default test must include portable DETR encoder phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-detr-encoder']?.includes('sam-detr-encoder-mlx-packet-contracts.mjs'), 'live DETR encoder MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-detr-encoder-mlx-packet-contracts\.mjs/, 'default test must not require private MLX DETR encoder packet export');
assert.equal(existsSync(new URL('../tools/sam-detr-encoder-mlx-packet.py', import.meta.url)), true, 'DETR encoder MLX packet exporter must exist');
assert.equal(existsSync(routeSourceUrl), true, 'DETR encoder route source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'DETR encoder route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'DETR encoder route must execute through runProgram');
assert.match(routeSource, /detr-encoder-layernorm1/, 'DETR encoder route must include self-attention LayerNorm phases');
assert.match(routeSource, /detr-encoder-self-attention-softmax/, 'DETR encoder route must include self-attention softmax phases');
assert.match(routeSource, /detr-encoder-cross-attention-softmax/, 'DETR encoder route must include text cross-attention softmax phases');
assert.match(routeSource, /detr-encoder-mlp-fc1-relu/, 'DETR encoder route must include ReLU MLP expansion phases');
assert.match(routeSource, /sam3-detr-encoder-phase-program-v0/, 'DETR encoder route must stamp kernel profile identity');

const route = createSam3DetrEncoderPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-detr-encoder-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-detr-encoder-tensors', 'sam3-detr-encoder-weights']);
assert.deepEqual(route.requiredOutputRoles, ['encoder-hidden-states']);
assert.equal(validateRouteDefinition(route).ok, true);

const identity2 = new Float32Array([1, 0, 0, 1]);
const zero2 = new Float32Array([0, 0]);
const oracle = createSam3DetrEncoderPhaseProgramCpuOracle({
  encoderSrc: new Float32Array([1, 3]),
  encoderPos: new Float32Array([0, 0]),
  promptFeatures: new Float32Array([1, 0, 0, 1]),
  promptMask: new Float32Array([1, 1]),
  layers: [{
    layerNorm1Weight: new Float32Array([1, 1]),
    layerNorm1Bias: new Float32Array([0, 0]),
    selfQWeight: identity2,
    selfQBias: zero2,
    selfKWeight: identity2,
    selfKBias: zero2,
    selfVWeight: identity2,
    selfVBias: zero2,
    selfOWeight: identity2,
    selfOBias: zero2,
    layerNorm2Weight: new Float32Array([1, 1]),
    layerNorm2Bias: new Float32Array([0, 0]),
    crossQWeight: identity2,
    crossQBias: zero2,
    crossKWeight: identity2,
    crossKBias: zero2,
    crossVWeight: identity2,
    crossVBias: zero2,
    crossOWeight: identity2,
    crossOBias: zero2,
    layerNorm3Weight: new Float32Array([1, 1]),
    layerNorm3Bias: new Float32Array([0, 0]),
    fc1Weight: new Float32Array(6),
    fc1Bias: new Float32Array(3),
    fc2Weight: new Float32Array(6),
    fc2Bias: zero2,
  }],
  shape: {
    batch: 1,
    spatialTokens: 1,
    promptTokens: 2,
    channels: 2,
    heads: 1,
    layerCount: 1,
    mlpHidden: 3,
    height: 1,
    width: 1,
  },
});

assert.equal(oracle.encoderHiddenStates.length, 2);
assert.ok(Math.abs(oracle.encoderHiddenStates[0] - 0.19557) < 0.0001, `encoder[0] ${oracle.encoderHiddenStates[0]}`);
assert.ok(Math.abs(oracle.encoderHiddenStates[1] - 4.80443) < 0.0001, `encoder[1] ${oracle.encoderHiddenStates[1]}`);

console.log('sam DETR encoder phase-program contracts passed');
