import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
  classifySam31PropagationMemoryAdapter,
  createSam31MemoryEncoderPhaseProgramCpuOracle,
  createSam31MemoryEncoderPhaseProgramRouteDefinition,
  createSam31PropagationNeckPhaseProgramCpuOracle,
  createSam31PropagationNeckPhaseProgramRouteDefinition,
  createSam31PropagationNeckPhaseProgramRouteReceipt,
  evaluateSam31PropagationMemoryEvidence,
  runSam31PropagationNeckPhaseProgramRoute,
  validateRouteDefinition,
} from '../src/index.js';

const memoryRouteSource = readFileSync(new URL('../src/sam31-memory-encoder-phase-program.js', import.meta.url), 'utf8');
const evidenceSource = readFileSync(new URL('../src/sam31-propagation-memory-evidence.js', import.meta.url), 'utf8');
const browserSmokeSource = readFileSync(new URL('../smokes/sam31-propagation-memory-parity.js', import.meta.url), 'utf8');
const browserRunnerSource = readFileSync(new URL('../tools/sam31-propagation-memory-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(existsSync(new URL('../tools/sam31-propagation-memory-meta-packet.py', import.meta.url)), true, 'official Meta propagation-memory packet exporter must exist');
assert.equal(existsSync(new URL('../tools/sam31-propagation-memory-browser-parity-smoke.mjs', import.meta.url)), true, 'SAM3.1 propagation-memory browser parity runner must exist');
assert.equal(existsSync(new URL('../smokes/sam31-propagation-memory-parity.html', import.meta.url)), true, 'SAM3.1 propagation-memory browser parity page must exist');
assert.equal(existsSync(new URL('../smokes/sam31-propagation-memory-parity.js', import.meta.url)), true, 'SAM3.1 propagation-memory browser parity module must exist');
assert.match(packageJson.scripts['test:live:sam31-propagation-memory-meta'] || '', /sam31-propagation-memory-meta-packet-contracts\.mjs/, 'package must expose the official SAM3.1 composed packet contract explicitly');
assert.match(packageJson.scripts['test:live:sam31-propagation-memory-webgpu'] || '', /sam31-propagation-memory-browser-parity-smoke\.mjs/, 'package must expose real Chrome WebGPU parity explicitly');
assert.doesNotMatch(packageJson.scripts.test, /sam31-propagation-memory-meta-packet-contracts\.mjs/, 'default tests must not require the gated official checkpoint');
assert.doesNotMatch(memoryRouteSource, /gpuExecutor/, 'memory route must own its WebGPU implementation without an injected executor escape hatch');
assert.match(browserSmokeSource, /function serializeAdapterInfo\(/, 'browser evidence must serialize adapter identity through explicit fields');
assert.doesNotMatch(browserSmokeSource, /\{ \.\.\.adapter\.info \}/, 'browser evidence must not trust non-enumerable GPUAdapterInfo fields');
assert.doesNotMatch(browserSmokeSource, /Boolean\(adapter\.isFallbackAdapter\)/, 'browser evidence must not coerce missing fallback state into authoritative false');
assert.match(browserSmokeSource, /typeof adapter\.isFallbackAdapter === 'boolean'/, 'browser evidence must preserve only explicit boolean fallback state');
assert.match(evidenceSource, /adapterInfo\.isFallbackAdapter === false/, 'browser passage must require a non-fallback adapter');
assert.match(evidenceSource, /receipt\.status === 'real'/, 'browser passage must require real route receipts');
assert.match(evidenceSource, /receipt\.fallbackReason === null/, 'browser passage must reject receipt fallback reasons');
assert.match(evidenceSource, /requestedRouteIdsMatch/, 'browser passage must bind ordered requested and effective route identity');
assert.match(browserRunnerSource, /function terminalSummary\(/, 'browser runner must render a compact terminal summary');
assert.doesNotMatch(browserRunnerSource, /process\.stdout\.write\(`\$\{JSON\.stringify\(report, null, 2\)\}/, 'successful browser runner output must not duplicate the full durable report');
for (const kernel of [
  'MEMORY_MASK_RESAMPLE_WGSL',
  'MEMORY_CONV2D_WGSL',
  'MEMORY_LAYERNORM_WGSL',
  'MEMORY_DEPTHWISE_WGSL',
  'MEMORY_POINTWISE_1_GELU_WGSL',
  'MEMORY_POINTWISE_2_SCALE_RESIDUAL_WGSL',
  'MEMORY_POSITION_ENCODING_WGSL',
]) {
  assert.match(memoryRouteSource, new RegExp(`const ${kernel}`), `memory route must define native ${kernel}`);
}

assert.equal(SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.propagation-neck.phase-program.webgpu-local.v0');
assert.equal(SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.memory-encoder.phase-program.webgpu-local.v0');
assert.equal(typeof createSam31PropagationNeckPhaseProgramRouteReceipt, 'function');
assert.equal(typeof runSam31PropagationNeckPhaseProgramRoute, 'function');

const validBrowserEvidence = {
  adapterInfo: { isFallbackAdapter: false },
  receipts: [
    { requestedRouteId: SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, effectiveRouteId: SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, status: 'real', fallbackReason: null },
    { requestedRouteId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID, effectiveRouteId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID, status: 'real', fallbackReason: null },
  ],
  requestedRouteIds: [SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID],
  parity: { propagationMaxAbsDiff: 1e-7, memoryMaxAbsDiff: 1e-7, positionMaxAbsDiff: 1e-8 },
  tolerances: { webGpuPropagationMaxAbsDiff: 1e-5, webGpuMemoryMaxAbsDiff: 1e-5, webGpuPositionMaxAbsDiff: 1e-6 },
  uncapturedErrors: [],
};
assert.deepEqual(classifySam31PropagationMemoryAdapter({ vendor: 'apple', architecture: 'metal-3' }), {
  isFallbackAdapter: false,
  fallbackEvidenceSource: 'recognized-hardware-adapter-info',
});
assert.deepEqual(classifySam31PropagationMemoryAdapter({ vendor: '', architecture: '' }), {
  isFallbackAdapter: null,
  fallbackEvidenceSource: null,
});
assert.equal(evaluateSam31PropagationMemoryEvidence(validBrowserEvidence).passed, true);
assert.equal(evaluateSam31PropagationMemoryEvidence({ ...validBrowserEvidence, adapterInfo: {} }).passed, false, 'missing fallback-adapter evidence must fail passage');
assert.equal(evaluateSam31PropagationMemoryEvidence({ ...validBrowserEvidence, adapterInfo: { isFallbackAdapter: true } }).passed, false, 'fallback adapter must fail passage');
assert.equal(evaluateSam31PropagationMemoryEvidence({ ...validBrowserEvidence, receipts: validBrowserEvidence.receipts.map((receipt, index) => index === 0 ? { ...receipt, status: 'fallback' } : receipt) }).passed, false, 'fallback receipt status must fail passage');
assert.equal(evaluateSam31PropagationMemoryEvidence({ ...validBrowserEvidence, receipts: validBrowserEvidence.receipts.map((receipt, index) => index === 1 ? { ...receipt, fallbackReason: 'runtime substitution' } : receipt) }).passed, false, 'fallback reason must fail passage');
assert.equal(evaluateSam31PropagationMemoryEvidence({ ...validBrowserEvidence, requestedRouteIds: [...validBrowserEvidence.requestedRouteIds].reverse() }).passed, false, 'ordered route mismatch must fail passage');

const propagationRoute = createSam31PropagationNeckPhaseProgramRouteDefinition();
assert.deepEqual(propagationRoute.requiredInputRoles, [
  'source-image',
  'sam31-vit-backbone-hidden-states',
  'sam31-propagation-neck-weights',
]);
assert.deepEqual(propagationRoute.requiredOutputRoles, [
  'sam31-propagation-feature-0',
  'sam31-propagation-feature-1',
  'sam31-propagation-feature-2',
]);
assert.equal(validateRouteDefinition(propagationRoute).ok, true);

const hidden = new Float32Array([1, 2, 3, 4]);
const identityConv = multiplier => ({
  weight: new Float32Array([multiplier]),
  bias: new Float32Array([0]),
  kernelSize: 1,
  stride: 1,
  padding: 0,
  inChannels: 1,
  outChannels: 1,
});
const propagation = createSam31PropagationNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hidden,
  shape: {
    batch: 1,
    backboneHeight: 2,
    backboneWidth: 2,
    backboneChannels: 1,
    fpnHiddenSize: 1,
    levels: [
      { level: 0, scaleFactor: 1, height: 2, width: 2 },
      { level: 1, scaleFactor: 1, height: 2, width: 2 },
      { level: 2, scaleFactor: 1, height: 2, width: 2 },
    ],
  },
  weights: {
    levels: [
      { level: 0, scaleLayers: [], proj1: identityConv(1), proj2: identityConv(1) },
      { level: 1, scaleLayers: [], proj1: identityConv(2), proj2: identityConv(1) },
      { level: 2, scaleLayers: [], proj1: identityConv(3), proj2: identityConv(1) },
    ],
  },
});
assert.deepEqual(propagation.levels.map(level => level.shape), [
  [1, 2, 2, 1],
  [1, 2, 2, 1],
  [1, 2, 2, 1],
]);
assert.deepEqual(Array.from(propagation.features[0]), [1, 2, 3, 4]);
assert.deepEqual(Array.from(propagation.features[1]), [2, 4, 6, 8]);
assert.deepEqual(Array.from(propagation.features[2]), [3, 6, 9, 12]);

const memoryRoute = createSam31MemoryEncoderPhaseProgramRouteDefinition();
assert.deepEqual(memoryRoute.requiredInputRoles, [
  'source-image',
  'sam31-propagation-feature-2',
  'sam31-multiplex-mask-logits',
  'sam31-multiplex-conditioning',
  'sam31-memory-encoder-weights',
]);
assert.deepEqual(memoryRoute.requiredOutputRoles, [
  'sam31-mask-memory-features',
  'sam31-mask-memory-position-encoding',
]);
assert.equal(validateRouteDefinition(memoryRoute).ok, true);
for (const stage of [
  'memory-mask-resample',
  'memory-mask-downsample-0',
  'memory-feature-projection',
  'memory-feature-mask-add',
  'memory-fuser-0-depthwise',
  'memory-fuser-0-layernorm',
  'memory-fuser-0-pointwise-1-gelu',
  'memory-fuser-0-pointwise-2-scale-residual',
  'memory-position-encoding',
]) {
  assert.ok(memoryRoute.requiredStages.includes(stage), `memory route must expose ${stage}`);
}

const memory = createSam31MemoryEncoderPhaseProgramCpuOracle({
  propagationFeature: new Float32Array([2, 3, 4, 5, 6, 7, 8, 9]),
  maskLogits: new Float32Array([1]),
  shape: {
    batch: 1,
    featureHeight: 1,
    featureWidth: 2,
    featureChannels: 4,
    maskHeight: 1,
    maskWidth: 1,
    multiplexCount: 1,
    conditionChannels: true,
    conditioning: [1],
    resampledMaskHeight: 1,
    resampledMaskWidth: 2,
  },
  config: {
    sigmoidScale: 2,
    sigmoidBias: -1,
    positionTemperature: 10000,
  },
  weights: {
    downsampleLayers: [{
      conv: {
        weight: new Float32Array([1, 1, 2, 0, 0, 1, 1, -1]),
        bias: new Float32Array(4),
        kernelSize: 1,
        stride: 1,
        padding: 0,
        inChannels: 2,
        outChannels: 4,
      },
      layerNorm: { weight: new Float32Array([1, 1, 1, 1]), bias: new Float32Array(4), epsilon: 1e-6 },
    }],
    maskFinal: {
      weight: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      bias: new Float32Array(4),
      kernelSize: 1,
      stride: 1,
      padding: 0,
      inChannels: 4,
      outChannels: 4,
    },
    featureProjection: {
      weight: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      bias: new Float32Array(4),
      kernelSize: 1,
      stride: 1,
      padding: 0,
      inChannels: 4,
      outChannels: 4,
    },
    fuserLayers: [{
      depthwise: {
        weight: new Float32Array([1, 1, 1, 1]),
        bias: new Float32Array(4),
        kernelSize: 1,
        stride: 1,
        padding: 0,
        inChannels: 4,
        outChannels: 4,
        groups: 4,
      },
      layerNorm: { weight: new Float32Array([1, 1, 1, 1]), bias: new Float32Array(4), epsilon: 1e-6 },
      pointwise1: { weight: new Float32Array(64), bias: new Float32Array(16), inChannels: 4, outChannels: 16 },
      pointwise2: { weight: new Float32Array(64), bias: new Float32Array(4), inChannels: 16, outChannels: 4 },
      scale: new Float32Array([1, 1, 1, 1]),
    }],
  },
});
assert.deepEqual(memory.featureShape, [1, 1, 2, 4]);
assert.deepEqual(memory.positionShape, [1, 1, 2, 4]);
assert.ok(Number.isFinite(memory.features[0]));
assert.ok(Number.isFinite(memory.positionEncoding[0]));
assert.notEqual(memory.features[0], 2, 'mask encoding must materially enter the memory feature');

assert.throws(() => createSam31MemoryEncoderPhaseProgramCpuOracle({
  propagationFeature: new Float32Array(4),
  maskLogits: new Float32Array([1]),
  shape: { batch: 1, featureHeight: 1, featureWidth: 1, featureChannels: 4, maskHeight: 1, maskWidth: 1, multiplexCount: 16, conditionChannels: true, conditioning: new Array(16).fill(0), resampledMaskHeight: 1, resampledMaskWidth: 1 },
  config: { sigmoidScale: 2, sigmoidBias: -1, positionTemperature: 10000 },
  weights: { downsampleLayers: [], fuserLayers: [] },
}), /maskLogits length/, 'multiplex mask ownership must fail when object-channel evidence is partial');

assert.throws(() => createSam31MemoryEncoderPhaseProgramCpuOracle({
  propagationFeature: new Float32Array(4),
  maskLogits: new Float32Array(4),
  shape: { batch: 1, featureHeight: 1, featureWidth: 1, featureChannels: 4, maskHeight: 2, maskWidth: 2, multiplexCount: 1, conditionChannels: true, conditioning: [1], resampledMaskHeight: 1, resampledMaskWidth: 1 },
  config: { sigmoidScale: 2, sigmoidBias: -1, positionTemperature: 10000 },
  weights: { downsampleLayers: [], fuserLayers: [] },
}), /upsample-only/, 'plain bilinear route must reject shapes where official antialias semantics would be load-bearing');

console.log('sam3.1 propagation and memory phase-program contracts passed');
