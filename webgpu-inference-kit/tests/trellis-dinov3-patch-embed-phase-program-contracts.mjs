import assert from 'node:assert/strict';

const {
  TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  createTrellisDinoV3PatchEmbedDispatchPlan,
  createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle,
  createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

assert.equal(
  TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  'trellis2.dinov3.patch-embed.phase-program.webgpu-local.v0',
  'the first TRELLIS browser boundary must have a stable WebGPU-local identity',
);

const route = createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition({
  kernel: { profile: 'trellis2-dinov3-patch-embed-phase-program-v0', commit: 'test-fixture' },
});
assert.deepEqual(
  route.requiredInputRoles,
  ['source-image', 'trellis-dinov3-normalized-pixels', 'trellis-dinov3-patch-embed-weights'],
  'the route must preserve original-image, normalized-input, and source-layout weight custody',
);
assert.deepEqual(route.requiredOutputRoles, ['trellis-dinov3-patch-embeddings']);
assert.equal(validateRouteDefinition(route).ok, true);

const productionDispatch = createTrellisDinoV3PatchEmbedDispatchPlan({
  shape: { batch: 1, imageHeight: 512, imageWidth: 512, patchSize: 16, hiddenSize: 1024 },
  maxWorkgroupsPerDimension: 65_535,
});
assert.equal(productionDispatch.patchConv2dStride.logicalInvocations, 1_048_576);
assert.deepEqual(productionDispatch.patchConv2dStride.dispatch, [16_384]);

const oracle = createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle({
  pixelValues: new Float32Array([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]),
  weights: {
    // TRELLIS MLX loader's explicit layout: [out, kH, kW, in].
    projection: new Float32Array([
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]),
    bias: new Float32Array([0.5, -0.5]),
  },
  shape: { batch: 1, imageHeight: 2, imageWidth: 2, patchSize: 2, hiddenSize: 2 },
});

assert.deepEqual(
  Array.from(oracle.patchEmbeddings),
  [22.5, 25.5],
  'the kernel contract must preserve channel-last pixels and [out,kH,kW,in] DINO weights with bias',
);

assert.throws(
  () => createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle({
    pixelValues: new Float32Array(12),
    weights: { projection: new Float32Array(24), bias: new Float32Array(2) },
    shape: { batch: 1, imageHeight: 2, imageWidth: 2, patchSize: 2, hiddenSize: 2, weightLayout: 'out,in,kH,kW' },
  }),
  /weightLayout must be out,kH,kW,in/,
  'the port must fail loud instead of silently treating source checkpoint layout as MLX/WebGPU layout',
);

console.log('TRELLIS DINOv3 patch-embed phase-program contracts passed');
