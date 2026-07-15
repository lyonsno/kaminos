import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import * as kit from '../src/index.js';
import { maximumSam31ParityValue, resolveSam31SpatialPositionEmbeddings } from '../smokes/sam31-two-image-backbone.js';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const backboneSource = readFileSync(new URL('smokes/sam31-two-image-backbone.js', root), 'utf8');
const trackerDriverSource = readFileSync(new URL('tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', root), 'utf8');
const trackerSmokeSource = readFileSync(new URL('smokes/sam31-two-frame-tracker-parity.js', root), 'utf8');
const ingressExporterSource = readFileSync(new URL('tools/sam31-two-image-ingress-meta-packet.py', root), 'utf8');

assert.doesNotMatch(backboneSource, /JSON\.stringify\(maximums\)\.match/, 'two-image parity aggregation must inspect numeric values rather than digits embedded in field names');
assert.match(trackerDriverSource, /kaminos\.sam31-two-image-tracker\.browser-parity-smoke\.v0/, 'two-image browser evidence must emit a schema that names the raw-image tracker boundary');
assert.equal(maximumSam31ParityValue({ frame0: { feature2: 0.25 }, frame1: { feature0: -0.5 } }), 0.5, 'two-image parity aggregation must ignore digits in diagnostic field names');
assert.equal(maximumSam31ParityValue({ frame0: Number.NaN }), Number.POSITIVE_INFINITY, 'non-finite parity must fail loud through aggregate evidence');
assert.match(trackerSmokeSource, /parityMaximum:\s*imageBackbone\.parityMaximum/, 'the tracker summary must preserve the aggregate raw-image backbone parity maximum');
assert.match(ingressExporterSource, /--diagnostic-vit-layers/, 'pinned ingress export must accept caller-selected ViT layer checkpoints');
assert.match(ingressExporterSource, /trunk\.blocks\[layer_index\]\.register_forward_hook/, 'diagnostic checkpoints must come from official Meta ViT block execution');
assert.match(ingressExporterSource, /frame-\{frame_index\}-vit-layer-\{layer_index\}-hidden-states/, 'diagnostic checkpoint roles must preserve frame and layer identity');
assert.match(ingressExporterSource, /"diagnosticVitLayers": diagnostic_vit_layers/, 'the authenticated manifest must declare the effective selected layer list');
assert.match(ingressExporterSource, /--diagnostic-vit-phase-layer/, 'pinned ingress export must accept one selected official phase layer');
assert.match(ingressExporterSource, /block\.attn\.proj\.register_forward_hook/, 'official attention projection output must anchor pre-MLP phase parity');
assert.match(ingressExporterSource, /linear is block\.mlp\.fc1/, 'post-GELU MLP evidence must observe the effective Meta CPU compatibility helper for the selected block');
assert.match(ingressExporterSource, /captures\.__setitem__\("vit-phase-mlpHidden"/, 'the effective helper must preserve the post-GELU tensor under the browser-aligned phase name');
assert.match(ingressExporterSource, /frame-\{frame_index\}-vit-layer-\{diagnostic_vit_phase_layer\}-phase-\{phase\}/, 'phase checkpoint roles must preserve frame, layer, and phase identity');
assert.match(ingressExporterSource, /"diagnosticVitPhaseLayer": diagnostic_vit_phase_layer/, 'the authenticated manifest must declare the effective phase-layer selection');
assert.match(backboneSource, /expectedLayerCheckpoints:\s*expectedLayerCheckpoints/, 'browser backbone must bind selected source checkpoints into the WebGPU block stack');
assert.match(backboneSource, /expectedPhaseCheckpoints:\s*expectedPhaseCheckpoints/, 'browser backbone must bind selected official phase checkpoints into the WebGPU block stack');
assert.match(backboneSource, /parity\.vitPhases = Object\.fromEntries/, 'browser evidence must preserve numeric phase parity under the existing tolerance gate');
assert.match(backboneSource, /parity\.vitLayers = Object\.fromEntries/, 'browser evidence must preserve per-layer numeric parity without diagnostic metadata contamination');

const spatialPositions = resolveSam31SpatialPositionEmbeddings({
  values: new Float32Array([100, 101, 1, 2, 3, 4, 5, 6, 7, 8]),
  shape: [1, 5, 2],
  hiddenSize: 2,
});
assert.equal(spatialPositions.pretrainGridSize, 2, 'SAM 3.1 must infer the pretrained grid after removing the CLS position');
assert.deepEqual(Array.from(spatialPositions.positionEmbeddings), [1, 2, 3, 4, 5, 6, 7, 8], 'SAM 3.1 must remove the pretrained CLS position before spatial tiling');
assert.throws(
  () => resolveSam31SpatialPositionEmbeddings({ values: new Float32Array(12), shape: [1, 6, 2], hiddenSize: 2 }),
  /spatial position count 5 is not square/,
  'SAM 3.1 must fail loud when the post-CLS positional tail is not a square grid',
);

for (const [name, factory] of [
  ['preprocess', kit.createSam3ImagePreprocessPhaseProgramRouteDefinition],
  ['patch embed', kit.createSam3ImagePatchEmbedPhaseProgramRouteDefinition],
  ['ViT prefix', kit.createSam3ImageVitPrefixPhaseProgramRouteDefinition],
  ['ViT block stack', kit.createSam3ImageVitBlockStackPhaseProgramRouteDefinition],
]) {
  const route = factory({ model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460' } });
  assert.equal(route.model.id, 'facebook/sam3.1', `${name} route must preserve the effective SAM 3.1 model identity`);
  assert.equal(route.model.revision, 'daa63191845a41281374e725f4c9e51c7a824460', `${name} route must preserve the pinned SAM 3.1 revision`);
}

for (const name of [
  'SAM31_INTERACTIVE_NECK_PHASE_PROGRAM_ROUTE_ID',
  'SAM31_IMAGE_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID',
  'SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID',
  'createSam31TrackingNeckPhaseProgramCpuOracle',
  'createSam31InteractiveNeckPhaseProgramRouteDefinition',
  'createSam31ImagePropagationNeckPhaseProgramRouteDefinition',
  'runSam31InteractiveNeckPhaseProgramRoute',
  'runSam31ImagePropagationNeckPhaseProgramRoute',
  'createSam31DecoderHighResolutionProjectionPhaseProgramCpuOracle',
  'createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition',
  'runSam31DecoderHighResolutionProjectionPhaseProgramRoute',
  'verifySam31TwoImageIngressPacketAuthority',
]) {
  assert.notEqual(kit[name], undefined, `SAM 3.1 two-image ingress requires exported ${name}`);
}

assert.equal(kit.SAM31_INTERACTIVE_NECK_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.interactive-neck.phase-program.webgpu-local.v0');
assert.equal(kit.SAM31_IMAGE_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.image-propagation-neck.phase-program.webgpu-local.v0');
assert.equal(kit.SAM31_DECODER_HIGH_RESOLUTION_PROJECTION_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.decoder-high-resolution-projection.phase-program.webgpu-local.v0');

const interactiveRoute = kit.createSam31InteractiveNeckPhaseProgramRouteDefinition();
assert.deepEqual(interactiveRoute.requiredInputRoles, [
  'source-image',
  'sam31-vit-backbone-hidden-states',
  'sam31-interactive-neck-weights',
]);
assert.deepEqual(interactiveRoute.requiredOutputRoles, [
  'sam31-interactive-feature-0',
  'sam31-interactive-feature-1',
  'sam31-interactive-feature-2',
  'sam31-interactive-position-2',
]);
assert.equal(kit.validateRouteDefinition(interactiveRoute).ok, true);

const propagationRoute = kit.createSam31ImagePropagationNeckPhaseProgramRouteDefinition();
assert.deepEqual(propagationRoute.requiredInputRoles, [
  'source-image',
  'sam31-vit-backbone-hidden-states',
  'sam31-propagation-neck-weights',
]);
assert.deepEqual(propagationRoute.requiredOutputRoles, [
  'sam31-propagation-feature-0',
  'sam31-propagation-feature-1',
  'sam31-propagation-feature-2',
  'sam31-propagation-position-2',
]);
assert.equal(kit.validateRouteDefinition(propagationRoute).ok, true);

const firstProjection = multiplier => ({
  weight: new Float32Array([multiplier, multiplier, multiplier, multiplier]),
  bias: new Float32Array(4),
  kernelSize: 1,
  stride: 1,
  padding: 0,
  inChannels: 1,
  outChannels: 4,
});
const identityProjection = {
  weight: new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]),
  bias: new Float32Array(4),
  kernelSize: 1,
  stride: 1,
  padding: 0,
  inChannels: 4,
  outChannels: 4,
};
const neckOracle = kit.createSam31TrackingNeckPhaseProgramCpuOracle({
  branch: 'interactive',
  backboneHiddenStates: new Float32Array([1, 2, 3, 4]),
  shape: {
    batch: 1,
    backboneHeight: 2,
    backboneWidth: 2,
    backboneChannels: 1,
    fpnHiddenSize: 4,
    levels: [
      { level: 0, scaleFactor: 1, height: 2, width: 2 },
      { level: 1, scaleFactor: 1, height: 2, width: 2 },
      { level: 2, scaleFactor: 1, height: 2, width: 2 },
    ],
  },
  weights: {
    levels: [0, 1, 2].map(level => ({ level, scaleLayers: [], proj1: firstProjection(level + 1), proj2: identityProjection })),
  },
});
assert.deepEqual(Array.from(neckOracle.features[2].slice(0, 8)), [3, 3, 3, 3, 6, 6, 6, 6]);
assert.equal(neckOracle.position2.length, 16, 'tracking neck must produce browser-owned level-2 position encoding');

const projectionRoute = kit.createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition();
assert.deepEqual(projectionRoute.requiredInputRoles, [
  'source-image',
  'sam31-decoder-high-resolution-feature-0',
  'sam31-decoder-high-resolution-feature-1',
  'sam31-decoder-high-resolution-projection-weights',
]);
assert.deepEqual(projectionRoute.requiredOutputRoles, [
  'sam31-decoder-high-resolution-s0',
  'sam31-decoder-high-resolution-s1',
]);
assert.equal(kit.validateRouteDefinition(projectionRoute).ok, true);
const projectionOracle = kit.createSam31DecoderHighResolutionProjectionPhaseProgramCpuOracle({
  feature0: new Float32Array([1, 2, 3, 4]),
  feature1: new Float32Array([5, 6]),
  shape: {
    batch: 1,
    feature0Height: 1,
    feature0Width: 2,
    feature1Height: 1,
    feature1Width: 1,
    inputChannels: 2,
    s0Channels: 1,
    s1Channels: 1,
  },
  weights: {
    s0: { weight: new Float32Array([10, 20]), bias: new Float32Array([1]) },
    s1: { weight: new Float32Array([-1, 2]), bias: new Float32Array([0.5]) },
  },
});
assert.deepEqual(Array.from(projectionOracle.highResolutionS0), [51, 111], 's0 projection must emit decoder-native B,C,H,W order');
assert.deepEqual(Array.from(projectionOracle.highResolutionS1), [7.5], 's1 projection must emit decoder-native B,C,H,W order');

assert.equal(existsSync(new URL('tools/sam31-two-image-ingress-meta-packet.py', root)), true, 'pinned Meta two-image packet exporter must exist');
const trackerExporter = readFileSync(new URL('tools/sam31-two-frame-tracker-meta-packet.py', root), 'utf8');
assert.match(trackerExporter, /--ingress-packet-dir/, 'tracker exporter must accept an exact image-ingress packet');
assert.match(trackerExporter, /--expected-ingress-manifest-sha256/, 'tracker exporter must require invocation-scoped ingress authority');
assert.equal(existsSync(new URL('tools/sam31-two-image-tracker-browser-parity-smoke.mjs', root)), true, 'full two-image Chrome witness must exist');
assert.equal(existsSync(new URL('smokes/sam31-two-image-tracker-parity.js', root)), true, 'full two-image browser transaction must exist');

assert.equal(
  packageJson.scripts['test:live:sam31-two-image-ingress-meta'],
  'node tests/sam31-two-image-ingress-meta-packet-contracts.mjs',
  'the exact SAM 3.1 two-image packet must be directly runnable',
);
assert.equal(
  packageJson.scripts['test:live:sam31-two-image-tracker-webgpu'],
  'node tools/sam31-two-image-tracker-browser-parity-smoke.mjs',
  'the raw-image-to-tracked-mask browser witness must be directly runnable',
);

console.log('sam3.1 two-image ingress contracts passed');
