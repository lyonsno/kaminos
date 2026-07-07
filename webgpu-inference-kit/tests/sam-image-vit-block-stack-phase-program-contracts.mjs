import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-vit-block-stack-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-vit-block-stack-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image ViT block-stack contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image ViT block-stack route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID/, 'image ViT block-stack route must export stable route identity');
assert.match(routeSource, /sam3\.image-vit-block-stack\.phase-program\.webgpu-local\.v0/, 'image ViT block-stack route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image ViT block-stack route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image ViT block-stack route must execute through runProgram');
assert.match(routeSource, /vit-block-stack-layernorm1/, 'image ViT block-stack route must expose layer_norm1 stage metadata');
assert.match(routeSource, /vit-block-stack-window-partition/, 'image ViT block-stack route must expose non-global window partition metadata');
assert.match(routeSource, /vit-block-stack-global-attention/, 'image ViT block-stack route must expose global-attention stage metadata');
assert.match(routeSource, /vit-block-stack-rope-attention/, 'image ViT block-stack route must expose RoPE attention metadata');
assert.match(routeSource, /vit-block-stack-layer-range/, 'image ViT block-stack route must preserve layer range identity');
assert.match(routeSource, /firstGlobalLayerIndex/, 'image ViT block-stack route must record first global layer identity');
assert.match(routeSource, /global_attn_indexes/, 'image ViT block-stack route must name the reference global-attention boundary');

assert.match(stackExporter, /--image-vit-block-stack-ingress/, 'detector-stack packet must expose image ViT block-stack ingress CLI flag');
assert.match(stackExporter, /--image-vit-full-backbone-ingress/, 'detector-stack packet must expose image ViT full-backbone ingress CLI flag');
assert.match(stackExporter, /expected-vit-block-stack-hidden-states/, 'detector-stack packet must export expected SAM3 ViT block-stack hidden states');
assert.match(stackExporter, /expected-vit-backbone-hidden-states/, 'detector-stack packet must export expected SAM3 full ViT backbone hidden states');
assert.match(stackExporter, /expected-vit-first-global-hidden-states/, 'detector-stack packet must export expected first-global checkpoint tensor');
assert.match(stackExporter, /vit-block-stack-layer7-q-proj-weight/, 'detector-stack packet must export first global layer projection weights');
assert.match(stackExporter, /vit-block-stack-layer31-q-proj-weight/, 'detector-stack packet must export final full-backbone layer projection weights');
assert.match(stackExporter, /mlx-detector-stack-vit-block-stack-export/, 'detector-stack packet must expose the ViT block-stack ingress mode');
assert.match(stackExporter, /mlx-detector-stack-vit-backbone-export/, 'detector-stack packet must expose the full ViT backbone ingress mode');
assert.match(stackExporter, /firstGlobalLayerIndex/, 'detector-stack packet must record the first global layer index');
assert.match(stackExporter, /fullBackbone/, 'detector-stack packet must record full-backbone identity when the range reaches the final ViT layer');

assert.match(witness, /mlx-detector-stack-vit-block-stack-export/, 'witness must allow detector-stack packet mode with browser-local ViT block-stack ingress');
assert.match(witness, /mlx-detector-stack-vit-backbone-export/, 'witness must allow detector-stack packet mode with browser-local full ViT backbone ingress');
assert.match(witness, /IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image ViT block-stack route identity');
assert.match(witness, /imageVitBlockStackReport/, 'witness must emit compact imageVitBlockStack report evidence');
assert.match(witness, /vitBlockStackHiddenStatesMaxAbsDiff/, 'witness must assert block-stack hidden-state parity');
assert.match(witness, /vitBackboneHiddenStatesMaxAbsDiff/, 'witness must assert full-backbone hidden-state parity');
assert.match(witness, /receiptChain\.length !== 9/, 'witness must reject receipt chains that skip block-stack ingress');

assert.match(smokeJs, /runSam3ImageVitBlockStackPhaseProgramRoute/, 'browser smoke must execute image ViT block-stack route');
assert.match(smokeJs, /image-vit-block-stack-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local block-stack ingress');
assert.match(smokeJs, /image-vit-backbone-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local full-backbone ingress');
assert.match(smokeJs, /imageVitBlockStackEvidence/, 'browser smoke state must preserve block-stack evidence');
assert.match(smokeJs, /vitBlockStackHiddenStatesOutput/, 'browser smoke must preserve block-stack output identity as an ingress edge');
assert.match(smokeJs, /firstGlobalLayerIndex/, 'browser smoke must preserve first global-attention boundary identity');
assert.match(smokeJs, /fullBackbone/, 'browser smoke must preserve full-backbone range identity');

const {
  SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitBlockStackPhaseProgramCpuOracle,
  createSam3ImageVitBlockStackPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageVitBlockStackPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-vit-block-stack-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'vit-prefix-hidden-states', 'sam3-image-vit-block-stack-weights']);
assert.deepEqual(route.requiredOutputRoles, ['vit-block-stack-hidden-states']);
assert.equal(validateRouteDefinition(route).ok, true);

const hiddenStates = new Float32Array([
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32,
]);
const zero8 = new Float32Array(8);
const one8 = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
const eye8 = Float32Array.from({ length: 64 }, (_, index) => (Math.floor(index / 8) === index % 8 ? 1 : 0));
const zero8x8 = new Float32Array(64);
const makeZeroBlock = layerIndex => ({
  layerIndex,
  isGlobal: layerIndex === 1,
  layerNorm1Weight: one8,
  layerNorm1Bias: zero8,
  qProjWeight: zero8x8,
  qProjBias: zero8,
  kProjWeight: zero8x8,
  kProjBias: zero8,
  vProjWeight: eye8,
  vProjBias: zero8,
  oProjWeight: zero8x8,
  oProjBias: zero8,
  layerNorm2Weight: one8,
  layerNorm2Bias: zero8,
  mlpFc1Weight: zero8x8,
  mlpFc1Bias: zero8,
  mlpFc2Weight: zero8x8,
  mlpFc2Bias: zero8,
});
const oracle = createSam3ImageVitBlockStackPhaseProgramCpuOracle({
  hiddenStates,
  weights: { layers: [makeZeroBlock(0), makeZeroBlock(1)] },
  shape: {
    batch: 1,
    height: 2,
    width: 2,
    hiddenSize: 8,
    numHeads: 2,
    windowSize: 2,
    intermediateSize: 8,
    layerNormEps: 0.000001,
    ropeTheta: 10000,
    startLayerIndex: 0,
    endLayerIndex: 1,
    globalAttnIndexes: [1],
    firstGlobalLayerIndex: 1,
  },
});
assert.deepEqual(oracle.layerRange, { startLayerIndex: 0, endLayerIndex: 1, layerCount: 2, firstGlobalLayerIndex: 1, finalLayerIndex: 1, fullBackbone: false });
assert.deepEqual(oracle.layerModes, ['window', 'global']);
assert.deepEqual(oracle.layerCheckpoints.map(checkpoint => checkpoint.layerIndex), [0, 1]);
assert.deepEqual(oracle.layerCheckpoints.map(checkpoint => checkpoint.isGlobal), [false, true]);
assert.deepEqual(Array.from(oracle.vitBlockStackHiddenStates), Array.from(hiddenStates), 'zero attention output and zero MLP should preserve residual identity through window then global block');

const fullBackboneOracle = createSam3ImageVitBlockStackPhaseProgramCpuOracle({
  hiddenStates,
  weights: { layers: [makeZeroBlock(0), makeZeroBlock(1), makeZeroBlock(2), makeZeroBlock(3)] },
  shape: {
    batch: 1,
    height: 2,
    width: 2,
    hiddenSize: 8,
    numHeads: 2,
    windowSize: 2,
    intermediateSize: 8,
    layerNormEps: 0.000001,
    ropeTheta: 10000,
    startLayerIndex: 0,
    endLayerIndex: 3,
    globalAttnIndexes: [1, 3],
    firstGlobalLayerIndex: 1,
    finalLayerIndex: 3,
    fullBackbone: true,
  },
});
assert.deepEqual(fullBackboneOracle.layerRange, { startLayerIndex: 0, endLayerIndex: 3, layerCount: 4, firstGlobalLayerIndex: 1, finalLayerIndex: 3, fullBackbone: true });
assert.deepEqual(fullBackboneOracle.layerModes, ['window', 'global', 'window', 'global']);
assert.deepEqual(fullBackboneOracle.layerCheckpoints.map(checkpoint => checkpoint.layerIndex), [0, 1, 2, 3]);
assert.deepEqual(Array.from(fullBackboneOracle.vitBlockStackHiddenStates), Array.from(hiddenStates), 'full-backbone zero-update oracle should preserve residual identity across multiple global boundaries');

assert.throws(() => createSam3ImageVitBlockStackPhaseProgramCpuOracle({
  hiddenStates,
  weights: { layers: [makeZeroBlock(0), makeZeroBlock(1)] },
  shape: {
    batch: 1,
    height: 2,
    width: 2,
    hiddenSize: 8,
    numHeads: 2,
    windowSize: 2,
    intermediateSize: 8,
    layerNormEps: 0.00001,
    ropeTheta: 10000,
    startLayerIndex: 0,
    endLayerIndex: 1,
    globalAttnIndexes: [1],
    firstGlobalLayerIndex: 1,
  },
}), /shape\.layerNormEps/);

assert.throws(() => createSam3ImageVitBlockStackPhaseProgramCpuOracle({
  hiddenStates,
  weights: { layers: [makeZeroBlock(0), makeZeroBlock(1)] },
  shape: {
    batch: 1,
    height: 2,
    width: 2,
    hiddenSize: 8,
    numHeads: 2,
    windowSize: 2,
    intermediateSize: 8,
    layerNormEps: 0.000001,
    ropeTheta: 5000,
    startLayerIndex: 0,
    endLayerIndex: 1,
    globalAttnIndexes: [1],
    firstGlobalLayerIndex: 1,
  },
}), /shape\.ropeTheta/);

console.log('sam image ViT block-stack phase-program contracts passed');
