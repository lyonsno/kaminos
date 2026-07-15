import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-vit-prefix-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-vit-prefix-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image ViT-prefix contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image ViT-prefix route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
const backboneSource = readFileSync(new URL('../src/sam31-two-image-backbone.js', import.meta.url), 'utf8');
assert.match(routeSource, /SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID/, 'image ViT-prefix route must export stable route identity');
assert.match(backboneSource, /positionEmbeddings:\s*values\.subarray\(hiddenSize\)/, 'CLS removal must preserve the authenticated absolute-position backing store for offset residency');
assert.doesNotMatch(backboneSource, /positionEmbeddings:\s*values\.slice\(hiddenSize\)/, 'CLS removal must not copy the resident package artifact into an unauthenticated backing store');
assert.match(routeSource, /sam3\.image-vit-prefix\.phase-program\.webgpu-local\.v0/, 'image ViT-prefix route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image ViT-prefix route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image ViT-prefix route must execute through runProgram');
assert.match(routeSource, /tile-position-embeddings/, 'image ViT-prefix route must expose tiled absolute position embedding metadata');
assert.match(routeSource, /add-position-embeddings/, 'image ViT-prefix route must expose patch-plus-position metadata');
assert.match(routeSource, /vit-prefix-layernorm/, 'image ViT-prefix route must expose backbone LayerNorm metadata');
assert.match(routeSource, /readback-vit-prefix-hidden-states/, 'image ViT-prefix route must expose readback identity for ingress parity');
assert.match(routeSource, /tiling \(repeating\), not interpolation/, 'image ViT-prefix route must document the SAM3/HF tiling boundary rather than interpolation');
assert.match(routeSource, /B,H,W,C/, 'image ViT-prefix route must preserve SAM3 spatial channel-last boundary language');

assert.match(stackExporter, /expected-vit-prefix-hidden-states/, 'detector-stack packet must export expected SAM3 ViT-prefix hidden states');
assert.match(stackExporter, /vit-position-embeddings/, 'detector-stack packet must export SAM3 learned absolute position embeddings');
assert.match(stackExporter, /vit-backbone-layernorm-weight/, 'detector-stack packet must export SAM3 ViT backbone layer norm weight');
assert.match(stackExporter, /imageVitPrefix/, 'detector-stack packet must identify the image ViT-prefix ingress boundary');
assert.match(stackExporter, /mlx-detector-stack-vit-prefix-export/, 'detector-stack packet must expose the ViT-prefix ingress mode');

assert.match(witness, /mlx-detector-stack-vit-prefix-export/, 'witness must allow detector-stack packet mode with browser-local ViT-prefix ingress');
assert.match(witness, /IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image ViT-prefix route identity');
assert.match(witness, /imageVitPrefixReport/, 'witness must emit compact imageVitPrefix report evidence');
assert.match(witness, /vitPrefixHiddenStatesMaxAbsDiff/, 'witness must assert ViT-prefix hidden-state parity');
assert.match(witness, /receiptChain\.length !== 8/, 'witness must reject receipt chains that skip image ViT-prefix ingress');

assert.match(smokeJs, /runSam3ImageVitPrefixPhaseProgramRoute/, 'browser smoke must execute image ViT-prefix route');
assert.match(smokeJs, /image-vit-prefix-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local ViT-prefix ingress');
assert.match(smokeJs, /imageVitPrefixEvidence/, 'browser smoke state must preserve image ViT-prefix evidence');
assert.match(smokeJs, /vitPrefixHiddenStatesOutput/, 'browser smoke must preserve ViT-prefix output identity as an ingress edge');
assert.match(smokeJs, /positionEmbeddingsSha256/, 'browser smoke must preserve position embedding identity');
assert.match(smokeJs, /backboneLayerNormWeightSha256/, 'browser smoke must preserve backbone layernorm identity');

const {
  SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitPrefixPhaseProgramCpuOracle,
  createSam3ImageVitPrefixPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageVitPrefixPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-vit-prefix-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'patch-embeddings', 'sam3-image-vit-prefix-weights']);
assert.deepEqual(route.requiredOutputRoles, ['vit-prefix-hidden-states']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3ImageVitPrefixPhaseProgramCpuOracle({
  patchEmbeddings: new Float32Array([
    1, 3,
    5, 7,
    2, 4,
    6, 8,
  ]),
  weights: {
    positionEmbeddings: new Float32Array([10, 20]),
    layerNormWeight: new Float32Array([2, 3]),
    layerNormBias: new Float32Array([0.5, -0.5]),
  },
  shape: { batch: 1, patchHeight: 2, patchWidth: 2, hiddenSize: 2, pretrainGridSize: 1 },
});
assert.deepEqual(Array.from(oracle.tiledPositionEmbeddings), [10, 20, 10, 20, 10, 20, 10, 20]);
assert.deepEqual(Array.from(oracle.patchPlusPosition), [11, 23, 15, 27, 12, 24, 16, 28]);
assert.deepEqual(Array.from(oracle.vitPrefixHiddenStates), [-1.5, 2.5, -1.5, 2.5, -1.5, 2.5, -1.5, 2.5]);

console.log('sam image ViT-prefix phase-program contracts passed');
