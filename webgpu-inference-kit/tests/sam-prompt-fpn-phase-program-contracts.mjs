import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  createSam3PromptFpnPhaseProgramCpuOracle,
  createSam3PromptFpnPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-prompt-fpn-phase-program.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam-prompt-fpn-phase-program-contracts\.mjs/, 'default test must include portable prompt-FPN phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-prompt-fpn']?.includes('sam-prompt-fpn-mlx-packet-contracts.mjs'), 'live prompt-FPN MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-prompt-fpn-mlx-packet-contracts\.mjs/, 'default test must not require private MLX prompt-FPN packet export');
assert.equal(existsSync(new URL('../tools/sam-prompt-fpn-mlx-packet.py', import.meta.url)), true, 'prompt-FPN MLX packet exporter must exist');
assert.equal(existsSync(routeSourceUrl), true, 'prompt-FPN route source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'prompt-FPN route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'prompt-FPN route must execute through runProgram');
assert.match(routeSource, /prompt-layernorm/, 'prompt-FPN route must include prompt LayerNorm phase names');
assert.match(routeSource, /prompt-qkv/, 'prompt-FPN route must include q/k/v projection phase names');
assert.match(routeSource, /prompt-attention-softmax/, 'prompt-FPN route must include masked attention phase names');
assert.match(routeSource, /prompt-output-residual/, 'prompt-FPN route must include output projection and residual phase names');
assert.match(routeSource, /sam3-prompt-fpn-phase-program-v0/, 'prompt-FPN route must stamp kernel profile identity');

const route = createSam3PromptFpnPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-prompt-fpn-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-prompt-fpn-tensors', 'sam3-prompt-fpn-weights']);
assert.deepEqual(route.requiredOutputRoles, ['prompt-fpn-feature']);
assert.equal(validateRouteDefinition(route).ok, true);

const identity2 = new Float32Array([1, 0, 0, 1]);
const zero2 = new Float32Array([0, 0]);
const oracle = createSam3PromptFpnPhaseProgramCpuOracle({
  encoderHiddenStates: new Float32Array([1, 3]),
  promptFeatures: new Float32Array([1, 0, 0, 1]),
  promptMask: new Float32Array([1, 1]),
  weights: {
    layerNormWeight: new Float32Array([1, 1]),
    layerNormBias: new Float32Array([0, 0]),
    qWeight: identity2,
    qBias: zero2,
    kWeight: identity2,
    kBias: zero2,
    vWeight: identity2,
    vBias: zero2,
    oWeight: identity2,
    oBias: zero2,
  },
  shape: {
    batch: 1,
    spatialTokens: 1,
    promptTokens: 2,
    channels: 2,
    heads: 1,
    height: 1,
    width: 1,
  },
});

assert.equal(oracle.updatedEncoderHiddenStates.length, 2);
assert.equal(oracle.promptFpnFeature.length, 2);
assert.ok(Math.abs(oracle.updatedEncoderHiddenStates[0] - 1.19557) < 0.0001, `updated[0] ${oracle.updatedEncoderHiddenStates[0]}`);
assert.ok(Math.abs(oracle.updatedEncoderHiddenStates[1] - 3.80443) < 0.0001, `updated[1] ${oracle.updatedEncoderHiddenStates[1]}`);
assert.deepEqual(Array.from(oracle.promptFpnFeature), Array.from(oracle.updatedEncoderHiddenStates), 'single-token prompt FPN feature must reshape the updated encoder state');

console.log('sam prompt-FPN phase-program contracts passed');
