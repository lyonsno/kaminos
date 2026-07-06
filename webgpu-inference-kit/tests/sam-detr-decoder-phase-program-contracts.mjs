import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrDecoderPhaseProgramCpuOracle,
  createSam3DetrDecoderPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-detr-decoder-phase-program.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam-detr-decoder-phase-program-contracts\.mjs/, 'default test must include portable DETR decoder phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-detr-decoder']?.includes('sam-detr-decoder-mlx-packet-contracts.mjs'), 'live DETR decoder MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-detr-decoder-mlx-packet-contracts\.mjs/, 'default test must not require private MLX DETR decoder packet export');
assert.equal(existsSync(new URL('../tools/sam-detr-decoder-mlx-packet.py', import.meta.url)), true, 'DETR decoder MLX packet exporter must exist');
assert.equal(existsSync(routeSourceUrl), true, 'DETR decoder route source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'DETR decoder route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'DETR decoder route must execute through runProgram');
assert.match(routeSource, /detr-decoder-sine-box-position/, 'DETR decoder route must include sine box position phases');
assert.match(routeSource, /detr-decoder-box-rpb/, 'DETR decoder route must include BoxRPB phases');
assert.match(routeSource, /detr-decoder-vision-attention-softmax/, 'DETR decoder route must include vision cross-attention softmax phases');
assert.match(routeSource, /detr-decoder-box-refinement/, 'DETR decoder route must include box refinement phases');
assert.match(routeSource, /sam3-detr-decoder-phase-program-v0/, 'DETR decoder route must stamp kernel profile identity');

const route = createSam3DetrDecoderPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-detr-decoder-phase-program-v0', commit: 'abc1234' },
  shape: {
    batch: 1,
    queryTokens: 1,
    promptTokens: 1,
    spatialTokens: 1,
    channels: 2,
    heads: 1,
    layerCount: 1,
    mlpHidden: 3,
    sineFeatures: 1,
    height: 1,
    width: 1,
  },
});
assert.equal(route.routeId, SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-detr-decoder-tensors', 'sam3-detr-decoder-weights']);
assert.deepEqual(route.requiredOutputRoles, ['last-hs', 'reference-boxes', 'presence-logits']);
for (const requiredStage of [
  'detr-decoder-ref-point-head-1-0',
  'detr-decoder-pad-query-position-0',
  'detr-decoder-box-rpb-x-hidden-0',
  'detr-decoder-self-q-0',
  'detr-decoder-self-output-0',
  'detr-decoder-text-q-0',
  'detr-decoder-vision-key-add-pos-0',
  'detr-decoder-mlp-fc1-0',
  'detr-decoder-output-layernorm-0',
  'detr-decoder-box-head-1-0',
  'detr-decoder-slice-presence-0',
  'detr-decoder-presence-layernorm-0',
]) {
  assert.ok(
    route.requiredStages.includes(requiredStage),
    `DETR decoder requiredStages must include granular executed phase ${requiredStage}`,
  );
}
assert.equal(validateRouteDefinition(route).ok, true);

const zero2 = new Float32Array(2);
const zero4 = new Float32Array(4);
const zeroMatrix2 = new Float32Array(4);
const zeroMlp1 = new Float32Array(6);
const zeroMlp2 = new Float32Array(6);
const zeroHead1 = new Float32Array(4);
const zeroHead2 = new Float32Array(4);
const zeroBoxHead3 = new Float32Array(8);
const oracle = createSam3DetrDecoderPhaseProgramCpuOracle({
  visionFeatures: new Float32Array([0, 0]),
  visionPosEncoding: new Float32Array([0, 0]),
  promptFeatures: new Float32Array([0, 0]),
  promptMask: new Float32Array([1]),
  queryEmbed: new Float32Array([1, 3]),
  referencePoints: new Float32Array([0, 0, 0, 0]),
  presenceToken: new Float32Array([0.5, -0.5]),
  layers: [{
    selfQWeight: zeroMatrix2, selfQBias: zero2, selfKWeight: zeroMatrix2, selfKBias: zero2, selfVWeight: zeroMatrix2, selfVBias: zero2, selfOWeight: zeroMatrix2, selfOBias: zero2,
    selfLayerNormWeight: new Float32Array([1, 1]), selfLayerNormBias: zero2,
    textQWeight: zeroMatrix2, textQBias: zero2, textKWeight: zeroMatrix2, textKBias: zero2, textVWeight: zeroMatrix2, textVBias: zero2, textOWeight: zeroMatrix2, textOBias: zero2,
    textLayerNormWeight: new Float32Array([1, 1]), textLayerNormBias: zero2,
    visionQWeight: zeroMatrix2, visionQBias: zero2, visionKWeight: zeroMatrix2, visionKBias: zero2, visionVWeight: zeroMatrix2, visionVBias: zero2, visionOWeight: zeroMatrix2, visionOBias: zero2,
    visionLayerNormWeight: new Float32Array([1, 1]), visionLayerNormBias: zero2,
    fc1Weight: zeroMlp1, fc1Bias: new Float32Array(3), fc2Weight: zeroMlp2, fc2Bias: zero2,
    mlpLayerNormWeight: new Float32Array([1, 1]), mlpLayerNormBias: zero2,
  }],
  outputLayerNormWeight: new Float32Array([1, 1]),
  outputLayerNormBias: zero2,
  refPointHeadLayer1Weight: new Float32Array(8),
  refPointHeadLayer1Bias: zero2,
  refPointHeadLayer2Weight: zeroMatrix2,
  refPointHeadLayer2Bias: zero2,
  boxHeadLayer1Weight: zeroHead1,
  boxHeadLayer1Bias: zero2,
  boxHeadLayer2Weight: zeroHead2,
  boxHeadLayer2Bias: zero2,
  boxHeadLayer3Weight: zeroBoxHead3,
  boxHeadLayer3Bias: zero4,
  boxRpbXLayer1Weight: zeroHead1,
  boxRpbXLayer1Bias: zero2,
  boxRpbXLayer2Weight: new Float32Array(2),
  boxRpbXLayer2Bias: new Float32Array(1),
  boxRpbYLayer1Weight: zeroHead1,
  boxRpbYLayer1Bias: zero2,
  boxRpbYLayer2Weight: new Float32Array(2),
  boxRpbYLayer2Bias: new Float32Array(1),
  presenceLayerNormWeight: new Float32Array([1, 1]),
  presenceLayerNormBias: zero2,
  presenceHeadLayer1Weight: zeroHead1,
  presenceHeadLayer1Bias: zero2,
  presenceHeadLayer2Weight: zeroHead2,
  presenceHeadLayer2Bias: zero2,
  presenceHeadLayer3Weight: new Float32Array(2),
  presenceHeadLayer3Bias: new Float32Array(1),
  shape: {
    batch: 1,
    queryTokens: 1,
    promptTokens: 1,
    spatialTokens: 1,
    channels: 2,
    heads: 1,
    layerCount: 1,
    mlpHidden: 3,
    sineFeatures: 1,
    height: 1,
    width: 1,
  },
});

assert.equal(oracle.lastHs.length, 2);
assert.ok(Math.abs(oracle.lastHs[0] + 1) < 0.00001, `lastHs[0] ${oracle.lastHs[0]}`);
assert.ok(Math.abs(oracle.lastHs[1] - 1) < 0.00001, `lastHs[1] ${oracle.lastHs[1]}`);
assert.deepEqual(Array.from(oracle.referenceBoxes), [0.5, 0.5, 0.5, 0.5]);
assert.deepEqual(Array.from(oracle.presenceLogits), [0]);

console.log('sam DETR decoder phase-program contracts passed');
