import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-patch-embed-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');
const encoderExporter = readFileSync(new URL('../tools/sam-detr-encoder-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-patch-embed-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image patch-embed ingress contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image patch-embed route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID/, 'image patch-embed route must export stable route identity');
assert.match(routeSource, /sam3\.image-patch-embed\.phase-program\.webgpu-local\.v0/, 'image patch-embed route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image patch-embed route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image patch-embed route must execute through runProgram');
assert.match(routeSource, /patch-conv2d-stride/, 'image patch-embed route must expose stride patch-conv phase metadata');
assert.match(routeSource, /readback-patch-embeddings/, 'image patch-embed route must expose readback identity for ingress parity');
assert.match(routeSource, /out,kH,kW,in/, 'image patch-embed route must document SAM3 MLX Conv2d weight layout');

assert.match(encoderExporter, /patch_embeddings/, 'DETR encoder reference export must expose patch embeddings before ViT layer execution');
assert.match(stackExporter, /expected-patch-embeddings/, 'detector-stack packet must export expected SAM3 patch embeddings');
assert.match(stackExporter, /patch-embed-projection-weight/, 'detector-stack packet must export SAM3 patch projection weights');
assert.match(stackExporter, /imagePatchEmbed/, 'detector-stack packet must identify the image patch-embed ingress boundary');
assert.match(stackExporter, /mlx-detector-stack-patch-embed-export/, 'detector-stack packet must expose the patch-embed ingress mode');

assert.match(witness, /mlx-detector-stack-patch-embed-export/, 'witness must allow detector-stack packet mode with browser-local patch embed ingress');
assert.match(witness, /IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image patch-embed route identity');
assert.match(witness, /imagePatchEmbedReport/, 'witness must emit compact imagePatchEmbed report evidence');
assert.match(witness, /patchEmbeddingsMaxAbsDiff/, 'witness must assert patch-embedding parity');
assert.match(witness, /receiptChain\.length !== 7/, 'witness must reject receipt chains that skip image patch-embed ingress');

assert.match(smokeJs, /runSam3ImagePatchEmbedPhaseProgramRoute/, 'browser smoke must execute image patch-embed ingress route');
assert.match(smokeJs, /image-patch-embed-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local patch embed ingress');
assert.match(smokeJs, /imagePatchEmbedEvidence/, 'browser smoke state must preserve image patch-embed evidence');
assert.match(smokeJs, /patchEmbeddingsOutput/, 'browser smoke must preserve patch embeddings output identity as an ingress edge');
assert.match(smokeJs, /patchProjectionWeightSha256/, 'browser smoke must preserve patch projection weight identity');

const {
  SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImagePatchEmbedPhaseProgramCpuOracle,
  createSam3ImagePatchEmbedPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImagePatchEmbedPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-patch-embed-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'pixel-values', 'sam3-image-patch-embed-weights']);
assert.deepEqual(route.requiredOutputRoles, ['patch-embeddings']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3ImagePatchEmbedPhaseProgramCpuOracle({
  pixelValues: new Float32Array([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]),
  weights: {
    projection: new Float32Array([
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      -1, -1, -1,
      -1, -1, -1,
      -1, -1, -1,
      -1, -1, -1,
    ]),
  },
  shape: { batch: 1, imageHeight: 2, imageWidth: 2, imageChannels: 3, patchSize: 2, patchHeight: 1, patchWidth: 1, hiddenSize: 2 },
});
assert.deepEqual(Array.from(oracle.patchEmbeddings), [78, -78]);

console.log('sam image patch-embed phase-program contracts passed');
