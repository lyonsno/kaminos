import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const implementation = await readFile(new URL('../src/trellis-dinov3-prefix-block-phase-program.js', import.meta.url), 'utf8');
const referenceExporter = await readFile(new URL('../tools/trellis-dinov3-mlx-reference.py', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('../smokes/trellis-dinov3-prefix-block-browser.html', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const parityAssay = await readFile(new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url), 'utf8');
const { validateRouteDefinition } = await import('../src/index.js');

const kit = await import('../src/index.js');

assert.equal(
  kit.TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  'trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0',
  'the synthetic patch-only witness does not provide the checkpointed CLS/register/patch prefix and complete DINO block-0 route',
);

assert.equal(typeof kit.runTrellisDinoV3PrefixBlockPhaseProgramRoute, 'function');
const route = kit.createTrellisDinoV3PrefixBlockPhaseProgramRouteDefinition({
  kernel: { profile: 'trellis2-dinov3-prefix-block0-phase-program-v0', commit: 'contract-test' },
});
assert.equal(validateRouteDefinition(route).ok, true, 'the pinned DINOv3 prefix/block-0 route must satisfy the shared route contract');
assert.deepEqual(route.requiredInputRoles, [
  'source-image',
  'trellis-dinov3-normalized-pixels',
  'trellis-dinov3-checkpoint-tensors',
]);
assert.deepEqual(route.requiredOutputRoles, [
  'trellis-dinov3-patch-embeddings',
  'trellis-dinov3-prefix-hidden-states',
  'trellis-dinov3-block0-hidden-states',
]);
assert.equal(route.model.id, 'facebook/dinov3-vitl16-pretrain-lvd1689m');
assert.equal(route.model.revision, 'ea8dc2863c51be0a264bab82070e3e8836b02d51');
assert.equal(route.model.dtype, 'fp32', 'the route must not silently substitute a reduced-precision checkpoint');

const shape = {
  batch: 1, imageHeight: 512, imageWidth: 512, imageChannels: 3, patchSize: 16,
  patchHeight: 32, patchWidth: 32, patchTokens: 1024, prefixTokens: 5,
  tokenCount: 1029, hiddenSize: 1024, heads: 16, headDim: 64,
  intermediateSize: 4096, ropeTheta: 100, layerNormEpsilon: 1e-5,
};
const dispatch = kit.createTrellisDinoV3PrefixBlockDispatchPlan({ shape });
assert.deepEqual(dispatch.layerNorm1, [1029], 'each token needs one full-width F32 LayerNorm group');
assert.equal(dispatch.attentionScore.length, 2, 'attention-score dispatch must span all 16 global attention matrices without imposing a token cap');
assert.ok(dispatch.attentionScore[0] * dispatch.attentionScore[1] * 64 >= 16 * 1029 * 1029);
assert.equal(dispatch.mlpUp[0] * dispatch.mlpUp[1] * 64 >= 1029 * 4096, true);

const prefix = kit.createTrellisDinoV3PrefixCpuOracle({
  batch: 1, hiddenSize: 2, registerCount: 2, patchCount: 2,
  classToken: new Float32Array([10, 11]),
  registerTokens: new Float32Array([20, 21, 30, 31]),
  patchEmbeddings: new Float32Array([40, 41, 50, 51]),
});
assert.deepEqual(Array.from(prefix), [10, 11, 20, 21, 30, 31, 40, 41, 50, 51],
  'prefix order must be CLS, registers in checkpoint order, then row-major patch embeddings');
assert.match(implementation, /dtype: 'f32'/, 'runtime tensors must stay on the explicitly requested F32 route');
assert.match(implementation, /fp16 and implicit numeric conversion are not accepted/,
  'the route must reject reduced-precision or implicitly converted weight and pixel arrays');
assert.match(implementation, /finalNoAffineLayerNormApplied:false/,
  'block-0 output must remain before TRELLIS’ final no-affine LayerNorm');
assert.match(implementation, /attentionScores: tensor\('layer0\.attention-scores-f32'/,
  'global attention scores must use F32 storage for the full 1029-token sequence');
assert.match(referenceExporter, /EXPECTED_SOURCE_SHA256 = "abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21"/,
  'MLX reference export must reject a different source image instead of relabeling its output');
assert.match(referenceExporter, /sourceFileSha256/,
  'the MLX reference must bind its exact native DINOv3 implementation bytes');
assert.match(browserSmoke, /dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179/,
  'the browser comparison must reject a checkpoint other than the pinned HF safetensors file');
assert.match(browserSmoke, /shaderF16Requested:false/,
  'the matched browser route must not request or silently use shader-f16');
assert.match(browserSmoke, /effectiveRouteId !== route\.routeId/,
  'fallback or substituted effective WebGPU routes cannot count as parity');
assert.match(browserSmoke, /maxAbs, meanAbs: sumAbs \/ actual\.length, rmse/,
  'each stage comparison must report auditable tensor-difference statistics');
assert.match(browserRunner, /expectedBytes=outputSizes\[name\.replace\(/,
  'missing or partial WebGPU tensors must not be persisted as successful evidence');
assert.match(browserRunner, /request\.headers\['x-output-sha256'\]!==sha256/,
  'persisted browser outputs must be byte-hash verified by the runner');
assert.match(browserRunner, /failure_phase:phase/,
  'the browser smoke must retain the last failure phase when it cannot complete');
assert.match(parityAssay, /receiver:args.get\('--receiver'\)/,
  'the long matched command must preserve its caller-provided completion receiver');
assert.doesNotMatch(implementation, /let patch\s*=/, 'WGSL must not use the reserved patch identifier');
assert.match(implementation, /profile:runtime\.profile/, 'the route receipt consumes the staged timing profile');
assert.match(parityAssay, /referenceManifest:resolve\(referenceDir,'reference-manifest\.json'\)/,
  'the durable start receipt must identify both reference and terminal evidence paths');
assert.match(parityAssay, /last trustworthy MLX reference remained valid/,
  'a WebGPU failure must preserve the MLX reference as last trustworthy evidence without implying parity');

console.log('TRELLIS DINOv3 prefix/block-0 phase-program contracts passed');
