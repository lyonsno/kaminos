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
assert.match(routeSource, /if \(x < -10\.0\) \{ return 0\.0; \}/, 'ViT MLP GELU shader must saturate its negative tail before cubic overflow can produce NaN');
assert.match(routeSource, /if \(x > 10\.0\) \{ return x; \}/, 'ViT MLP GELU shader must saturate its positive tail before cubic overflow');
assert.match(routeSource, /fn mlx_erf\(x: f32\)/, 'ViT MLP GELU shader must port the MLX Metal erf implementation used by the reference backend');
assert.match(routeSource, /fn mlx_expm1f\(x: f32\)/, 'ViT MLP GELU shader must port MLX Metal expm1 rather than substitute a different erf family');
assert.match(routeSource, /0\.927734375/, 'ViT MLP GELU shader must preserve the MLX Metal erf branch boundary');
assert.doesNotMatch(routeSource, /0\.044715/, 'ViT block-stack GPU and CPU GELU paths must not retain the tanh approximation');
assert.match(routeSource, /const RESIDUAL_ADD_WGSL = `[\s\S]*let index = gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u;[\s\S]*if \(index >= dims\.total_values\) \{ return; \}/, 'block-stack residual add must linearize tiled dispatch and guard rounded-up tail writes');
assert.match(routeSource, /createLinearDispatch/, 'ViT block-stack must use the shared device-limit-aware linear dispatch contract');
assert.match(routeSource, /maxComputeWorkgroupsPerDimension/, 'ViT block-stack must route against the effective adapter workgroup-dimension limit');
assert.match(routeSource, /gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u/, 'ViT block-stack shaders must reconstruct a linear invocation index from a two-dimensional dispatch');
assert.ok(
  (routeSource.match(/@builtin\(num_workgroups\) dispatch_grid: vec3<u32>/g) || []).length >= 8,
  'every ViT linear kernel family must receive the effective two-dimensional dispatch grid',
);
assert.doesNotMatch(routeSource, /dispatch:\s*\[workgroups\(/, 'ViT block-stack phases must not wrap a one-dimensional workgroup count');
assert.match(routeSource, /dispatch:\s*dispatchPlan\.mlpFc1\.dispatch/, 'ViT block-stack phases must consume the executable named dispatch plan');

assert.match(stackExporter, /--image-vit-block-stack-ingress/, 'detector-stack packet must expose image ViT block-stack ingress CLI flag');
assert.match(stackExporter, /--image-vit-full-backbone-ingress/, 'detector-stack packet must expose image ViT full-backbone ingress CLI flag');
assert.match(stackExporter, /expected-vit-block-stack-hidden-states/, 'detector-stack packet must export expected SAM3 ViT block-stack hidden states');
assert.match(stackExporter, /expected-vit-backbone-hidden-states/, 'detector-stack packet must export expected SAM3 full ViT backbone hidden states');
assert.match(stackExporter, /expected-vit-first-global-hidden-states/, 'detector-stack packet must export expected first-global checkpoint tensor');
assert.match(stackExporter, /expected-vit-layer-\{layer_index\}-hidden-states/, 'detector-stack packet must export an authenticated MLX checkpoint for every ViT layer');
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
assert.match(smokeJs, /validateFiniteCheckpoints:\s*true/, 'grounded browser smoke must fail at the first non-finite ViT layer checkpoint');
assert.match(smokeJs, /validateFinitePhaseLayerIndex:\s*vitFinitePhaseLayerIndex/, 'browser smoke must pass an invocation-scoped ViT phase diagnostic target');
assert.match(smokeJs, /expectedVitLayerCheckpoints/, 'browser smoke must load and pass authenticated per-layer MLX checkpoints');
assert.match(smokeJs, /expectedLayerCheckpoints:\s*expectedVitLayerCheckpoints/, 'browser smoke must bind loaded ViT checkpoints into the route input by the exact lexical owner name');
assert.match(smokeJs, /vitLayerParityCheckpoints:\s*imageVitBlockStackResult\?\.finiteCheckpoints/, 'composition debug evidence must preserve route-level ViT layer parity checkpoints');
assert.match(smokeJs, /layerParityCheckpoints:\s*result\.debugReadback\.vitLayerParityCheckpoints/, 'final browser state must preserve the authenticated layer parity curve');
assert.match(witness, /--vit-finite-phase-layer/, 'browser witness must expose a targeted ViT phase diagnostic without mutating the package');

const {
  SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitBlockStackDispatchPlan,
  createSam3ImageVitBlockStackPhaseProgramCpuOracle,
  createSam3ImageVitBlockStackPhaseProgramRouteDefinition,
  summarizeSam3FiniteValues,
  summarizeSam3FinitePhaseOutputs,
  summarizeSam3LayerParityCheckpoint,
  normalizeSam3ExpectedLayerCheckpoints,
  stableSam3Gelu,
  validateRouteDefinition,
} = await import('../src/index.js');

const partialLayerCheckpoints = normalizeSam3ExpectedLayerCheckpoints([
  { layerIndex: 0, hiddenStates: new Float32Array([1, 2]) },
  { layerIndex: 7, hiddenStates: new Float32Array([3, 4]) },
], [0, 1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual([...partialLayerCheckpoints.keys()], [0, 7], 'selected diagnostic checkpoints must remain a lawful subset of executed layers');
assert.throws(
  () => normalizeSam3ExpectedLayerCheckpoints([{ layerIndex: 7, hiddenStates: new Float32Array(1) }, { layerIndex: 7, hiddenStates: new Float32Array(1) }], [0, 7]),
  /duplicate.*layer 7/,
);
assert.throws(
  () => normalizeSam3ExpectedLayerCheckpoints([{ layerIndex: 8, hiddenStates: new Float32Array(1) }], [0, 7]),
  /layer 8.*not executed/,
);

const dispatchShape = {
  batch: 1,
  height: 32,
  width: 32,
  hiddenSize: 1024,
  numHeads: 16,
  windowSize: 24,
  intermediateSize: 4736,
  ropePretrainGridSize: 72,
  interpolateRope: true,
  startLayerIndex: 0,
  endLayerIndex: 31,
  firstGlobalLayerIndex: 7,
  finalLayerIndex: 31,
  fullBackbone: true,
  globalAttnIndexes: [7, 15, 23, 31],
};
const dispatch448 = createSam3ImageVitBlockStackDispatchPlan({
  shape: dispatchShape,
  layerIndex: 0,
  maxWorkgroupsPerDimension: 65_535,
});
assert.deepEqual(dispatch448.layerNorm1, { logicalInvocations: 1_024, dispatch: [16] });
assert.deepEqual(dispatch448.windowPartition, { logicalInvocations: 2_359_296, dispatch: [36_864] });
assert.deepEqual(dispatch448.mlpFc1, { logicalInvocations: 4_849_664, dispatch: [276, 275] });
assert.deepEqual(dispatch448.mlpFc2, { logicalInvocations: 1_048_576, dispatch: [16_384] });
assert.deepEqual(dispatch448.residualMlp, dispatch448.mlpFc2);

const dispatch1008Local = createSam3ImageVitBlockStackDispatchPlan({
  shape: { ...dispatchShape, height: 72, width: 72 },
  layerIndex: 0,
  maxWorkgroupsPerDimension: 65_535,
});
assert.deepEqual(dispatch1008Local.windowPartition, { logicalInvocations: 5_308_416, dispatch: [288, 288] });
assert.deepEqual(dispatch1008Local.qProjection, dispatch1008Local.windowPartition);
assert.deepEqual(dispatch1008Local.attention, dispatch1008Local.windowPartition);
assert.deepEqual(dispatch1008Local.mlpFc1, { logicalInvocations: 24_551_424, dispatch: [620, 619] });
assert.deepEqual(dispatch1008Local.windowUnpartition, { logicalInvocations: 5_308_416, dispatch: [288, 288] });

const dispatch1008Global = createSam3ImageVitBlockStackDispatchPlan({
  shape: { ...dispatchShape, height: 72, width: 72 },
  layerIndex: 7,
  isGlobal: true,
  maxWorkgroupsPerDimension: 65_535,
});
assert.deepEqual(dispatch1008Global.windowPartition, { logicalInvocations: 5_308_416, dispatch: [288, 288] });
for (const [phase, entry] of Object.entries(dispatch1008Global)) {
  assert.ok(entry.dispatch.every(dimension => dimension <= 65_535), `${phase} must respect the effective device limit`);
  assert.ok(entry.dispatch.reduce((product, dimension) => product * dimension, 1) * 64 >= entry.logicalInvocations, `${phase} must cover its logical invocation domain`);
}

assert.deepEqual(
  summarizeSam3LayerParityCheckpoint(3, true, new Float32Array([1, -2, 4]), new Float32Array([1.25, -2.125, 4])),
  { layerIndex: 3, isGlobal: true, elementCount: 3, maxAbsDiff: 0.25 },
  'layer parity checkpoint must preserve layer identity and the maximum absolute MLX/WebGPU error',
);
assert.throws(
  () => summarizeSam3LayerParityCheckpoint(3, true, new Float32Array([1]), new Float32Array([1, 2])),
  /length mismatch/,
  'layer parity checkpoint must reject partial expected tensors',
);

assert.equal(stableSam3Gelu(-Number.MAX_VALUE), 0, 'stable GELU must saturate extreme negative finite inputs to zero');
assert.equal(stableSam3Gelu(Number.MAX_VALUE), Number.MAX_VALUE, 'stable GELU must preserve extreme positive finite inputs');
assert.equal(Number.isFinite(stableSam3Gelu(-1e20)), true, 'stable GELU negative tail must remain finite');
for (const [input, expected] of [[-3, -0.0040495991706848145], [-1, -0.1586553156375885], [0, 0], [1, 0.8413447141647339], [3, 2.99595046043396], [1.1875, 1.0479505062103271]]) {
  assert.ok(Math.abs(stableSam3Gelu(input) - expected) <= 2.5e-7, `stable GELU must track MLX Metal exact GELU at ${input}`);
}

assert.deepEqual(
  summarizeSam3FiniteValues(new Float32Array([1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2])),
  {
    elementCount: 5,
    finiteCount: 2,
    nonFiniteCount: 3,
    nanCount: 1,
    positiveInfinityCount: 1,
    negativeInfinityCount: 1,
    firstNonFinite: { index: 1, kind: 'nan' },
  },
  'finite checkpoint summaries must preserve non-finite type and first index without JSON-null laundering',
);
assert.deepEqual(
  summarizeSam3FinitePhaseOutputs({
    layerNorm1: new Float32Array([1, 2]).buffer,
    attention: new Float32Array([3, Number.NaN]).buffer,
  }),
  [
    { phase: 'layerNorm1', elementCount: 2, finiteCount: 2, nonFiniteCount: 0, nanCount: 0, positiveInfinityCount: 0, negativeInfinityCount: 0, firstNonFinite: null },
    { phase: 'attention', elementCount: 2, finiteCount: 1, nonFiniteCount: 1, nanCount: 1, positiveInfinityCount: 0, negativeInfinityCount: 0, firstNonFinite: { index: 1, kind: 'nan' } },
  ],
  'phase checkpoint summaries must preserve ordered first-corruption evidence',
);

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

const interpolatedRopeOracle = createSam3ImageVitBlockStackPhaseProgramCpuOracle({
  hiddenStates,
  weights: { layers: [makeZeroBlock(0), makeZeroBlock(1)] },
  shape: {
    batch: 1,
    height: 2,
    width: 2,
    hiddenSize: 8,
    numHeads: 2,
    windowSize: 1,
    intermediateSize: 8,
    layerNormEps: 0.000001,
    ropeTheta: 10000,
    ropePretrainGridSize: 1,
    interpolateRope: true,
    startLayerIndex: 0,
    endLayerIndex: 1,
    globalAttnIndexes: [1],
    firstGlobalLayerIndex: 1,
  },
});
assert.ok(
  Math.abs(interpolatedRopeOracle.ropeCos[4] - Math.cos(0.5)) <= 1e-7,
  'global SAM 3.1 RoPE must scale coordinates from the pretrained grid instead of using unscaled target-grid positions',
);

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
