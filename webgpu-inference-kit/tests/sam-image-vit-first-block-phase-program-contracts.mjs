import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-vit-first-block-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-vit-first-block-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image ViT first-block contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image ViT first-block route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID/, 'image ViT first-block route must export stable route identity');
assert.match(routeSource, /sam3\.image-vit-first-block\.phase-program\.webgpu-local\.v0/, 'image ViT first-block route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image ViT first-block route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image ViT first-block route must execute through runProgram');
assert.match(routeSource, /vit-block-layernorm1/, 'image ViT first-block route must expose layer_norm1 stage metadata');
assert.match(routeSource, /vit-block-window-partition/, 'image ViT first-block route must expose window partition and pad metadata');
assert.match(routeSource, /vit-block-qkv-projection/, 'image ViT first-block route must expose QKV projection metadata');
assert.match(routeSource, /vit-block-rope-attention/, 'image ViT first-block route must expose RoPE attention metadata');
assert.match(routeSource, /vit-block-output-projection/, 'image ViT first-block route must expose attention output projection metadata');
assert.match(routeSource, /vit-block-window-unpartition/, 'image ViT first-block route must expose crop\/unpartition metadata');
assert.match(routeSource, /vit-block-layernorm2/, 'image ViT first-block route must expose layer_norm2 stage metadata');
assert.match(routeSource, /vit-block-gelu-mlp/, 'image ViT first-block route must expose GELU MLP metadata');
assert.match(routeSource, /if \(x < -10\.0\) \{ return 0\.0; \}/, 'first-block GELU shader must saturate its negative tail before cubic overflow can produce NaN');
assert.match(routeSource, /if \(x > 10\.0\) \{ return x; \}/, 'first-block GELU shader must saturate its positive tail before cubic overflow');
assert.match(routeSource, /fn mlx_erf\(x: f32\)/, 'first-block GELU shader must port the MLX Metal erf implementation used by the reference backend');
assert.match(routeSource, /fn mlx_expm1f\(x: f32\)/, 'first-block GELU shader must port MLX Metal expm1 rather than substitute a different erf family');
assert.match(routeSource, /0\.927734375/, 'first-block GELU shader must preserve the MLX Metal erf branch boundary');
assert.doesNotMatch(routeSource, /0\.044715/, 'first-block GPU and CPU GELU paths must not retain the tanh approximation');
assert.match(routeSource, /readback-vit-first-block-hidden-states/, 'image ViT first-block route must expose readback identity');
assert.match(routeSource, /window partition\/pad\/crop/, 'image ViT first-block route must document the MLX window partition boundary');
assert.match(routeSource, /pairwise RoPE/, 'image ViT first-block route must document the SAM3 pairwise RoPE boundary');

assert.match(stackExporter, /expected-vit-first-block-hidden-states/, 'detector-stack packet must export expected SAM3 first ViT block hidden states');
assert.match(stackExporter, /vit-block0-layernorm1-weight/, 'detector-stack packet must export first block layer_norm1 weight');
assert.match(stackExporter, /vit-block0-q-proj-weight/, 'detector-stack packet must export first block q projection weight');
assert.match(stackExporter, /vit-block0-mlp-fc1-weight/, 'detector-stack packet must export first block MLP fc1 weight');
assert.match(stackExporter, /imageVitFirstBlock/, 'detector-stack packet must identify the image ViT first-block boundary');
assert.match(stackExporter, /mlx-detector-stack-vit-first-block-export/, 'detector-stack packet must expose the ViT first-block ingress mode');

assert.match(witness, /mlx-detector-stack-vit-first-block-export/, 'witness must allow detector-stack packet mode with browser-local first ViT block ingress');
assert.match(witness, /IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image ViT first-block route identity');
assert.match(witness, /imageVitFirstBlockReport/, 'witness must emit compact imageVitFirstBlock report evidence');
assert.match(witness, /vitFirstBlockHiddenStatesMaxAbsDiff/, 'witness must assert first-block hidden-state parity');
assert.match(witness, /receiptChain\.length !== 9/, 'witness must reject receipt chains that skip first ViT block ingress');

assert.match(smokeJs, /runSam3ImageVitFirstBlockPhaseProgramRoute/, 'browser smoke must execute image ViT first-block route');
assert.match(smokeJs, /image-vit-first-block-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local first ViT block ingress');
assert.match(smokeJs, /imageVitFirstBlockEvidence/, 'browser smoke state must preserve first-block evidence');
assert.match(smokeJs, /vitFirstBlockHiddenStatesOutput/, 'browser smoke must preserve first-block output identity as an ingress edge');
assert.match(smokeJs, /windowPartition/, 'browser smoke must preserve window partition metadata');
assert.match(smokeJs, /ropeWindow/, 'browser smoke must preserve RoPE window metadata');

const {
  SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitFirstBlockPhaseProgramCpuOracle,
  createSam3ImageVitFirstBlockPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageVitFirstBlockPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-vit-first-block-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'vit-prefix-hidden-states', 'sam3-image-vit-first-block-weights']);
assert.deepEqual(route.requiredOutputRoles, ['vit-first-block-hidden-states']);
assert.equal(validateRouteDefinition(route).ok, true);

const hiddenStates = new Float32Array([
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48,
]);
const zero8 = new Float32Array(8);
const one8 = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
const eye8 = new Float32Array([
  1, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 0,
  0, 0, 0, 0, 0, 0, 0, 1,
]);
const zero8x8 = new Float32Array(64);
const oracle = createSam3ImageVitFirstBlockPhaseProgramCpuOracle({
  hiddenStates,
  weights: {
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
  },
  shape: { batch: 1, height: 2, width: 3, hiddenSize: 8, numHeads: 2, windowSize: 2, intermediateSize: 8, layerNormEps: 0.000001, ropeTheta: 10000 },
});
assert.deepEqual(oracle.windowPartition, { originalHeight: 2, originalWidth: 3, paddedHeight: 2, paddedWidth: 4, windowSize: 2, windowCount: 2 });
assert.deepEqual(Array.from(oracle.layerNorm1.slice(0, 8)).map(value => Number(value.toFixed(6))), [-1.527525, -1.091089, -0.654654, -0.218218, 0.218218, 0.654654, 1.091089, 1.527525]);
assert.deepEqual(Array.from(oracle.windows.slice(0, 32)).map(value => Number(value.toFixed(6))), [
  -1.527525, -1.091089, -0.654654, -0.218218, 0.218218, 0.654654, 1.091089, 1.527525,
  -1.527525, -1.091089, -0.654654, -0.218218, 0.218218, 0.654654, 1.091089, 1.527525,
  -1.527525, -1.091089, -0.654654, -0.218218, 0.218218, 0.654654, 1.091089, 1.527525,
  -1.527525, -1.091089, -0.654654, -0.218218, 0.218218, 0.654654, 1.091089, 1.527525,
]);
assert.deepEqual(Array.from(oracle.ropeCos.slice(0, 4)).map(value => Number(value.toFixed(6))), [1, 1, 1, 1]);
assert.deepEqual(Array.from(oracle.ropeSin.slice(4, 8)).map(value => Number(value.toFixed(6))), [0.841471, 0.841471, 0, 0]);
assert.deepEqual(Array.from(oracle.vitFirstBlockHiddenStates), Array.from(hiddenStates), 'zero attention output and zero MLP should preserve residual identity after pad/crop');

console.log('sam image ViT first-block phase-program contracts passed');
