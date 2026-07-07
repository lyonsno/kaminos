import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-fpn-neck-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-fpn-neck-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image FPN-neck contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image FPN-neck route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID/, 'image FPN-neck route must export stable route identity');
assert.match(routeSource, /sam3\.image-fpn-neck\.phase-program\.webgpu-local\.v0/, 'image FPN-neck route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image FPN-neck route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image FPN-neck route must execute through runProgram');
assert.match(routeSource, /fpn-neck-transpose-conv-0-scale0/, 'image FPN-neck route must expose level-0 first transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-transpose-conv-0-scale1/, 'image FPN-neck route must expose level-0 second transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-transpose-conv-1/, 'image FPN-neck route must expose level-1 transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-proj1-2/, 'image FPN-neck route must expose level-2 1x1 projection stage metadata');
assert.match(routeSource, /fpn-neck-proj2-0/, 'image FPN-neck route must expose level-0 3x3 projection stage metadata');
assert.match(routeSource, /readback-fpn-neck-features/, 'image FPN-neck route must expose FPN feature readback stage metadata');

assert.match(stackExporter, /--image-fpn-neck-ingress/, 'detector-stack packet must expose image FPN-neck ingress CLI flag');
assert.match(stackExporter, /mlx-detector-stack-image-fpn-neck-export/, 'detector-stack packet must expose FPN-neck ingress mode');
assert.match(stackExporter, /expected-fpn-neck-feature-0/, 'detector-stack packet must export expected FPN-neck feature level 0');
assert.match(stackExporter, /expected-fpn-neck-feature-1/, 'detector-stack packet must export expected FPN-neck feature level 1');
assert.match(stackExporter, /expected-fpn-neck-feature-2/, 'detector-stack packet must export expected FPN-neck feature level 2');
assert.match(stackExporter, /fpn-neck-layer0-scale0-weight/, 'detector-stack packet must export level-0 FPN transpose-conv weights');
assert.match(stackExporter, /fpn-neck-layer2-proj2-weight/, 'detector-stack packet must export level-2 FPN projection weights');
assert.match(stackExporter, /image-fpn-neck-detector-stack-composition/, 'detector-stack packet must preserve FPN-neck composition route kind');

assert.match(witness, /mlx-detector-stack-image-fpn-neck-export/, 'witness must allow detector-stack packet mode with browser-local image FPN-neck ingress');
assert.match(witness, /IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image FPN-neck route identity');
assert.match(witness, /imageFpnNeckReport/, 'witness must emit compact imageFpnNeck report evidence');
assert.match(witness, /fpnNeckFeature0MaxAbsDiff/, 'witness must assert FPN-neck level-0 parity');
assert.match(witness, /receiptChain\.length !== 10/, 'witness must reject receipt chains that skip FPN-neck ingress');

assert.match(smokeJs, /runSam3ImageFpnNeckPhaseProgramRoute/, 'browser smoke must execute image FPN-neck route');
assert.match(smokeJs, /image-fpn-neck-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local FPN-neck ingress');
assert.match(smokeJs, /imageFpnNeckEvidence/, 'browser smoke state must preserve FPN-neck evidence');
assert.match(smokeJs, /fpnNeckFeature0MaxAbsDiff/, 'browser smoke must preserve FPN-neck level-0 parity');
assert.match(smokeJs, /fpnNeckFeature0Output/, 'browser smoke must preserve FPN-neck output identity as an ingress edge');

const {
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageFpnNeckPhaseProgramCpuOracle,
  createSam3ImageFpnNeckPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageFpnNeckPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-fpn-neck-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'vit-backbone-hidden-states', 'sam3-image-fpn-neck-weights']);
assert.deepEqual(route.requiredOutputRoles, ['fpn-neck-feature-0', 'fpn-neck-feature-1', 'fpn-neck-feature-2']);
assert.equal(validateRouteDefinition(route).ok, true);

const hiddenStates = new Float32Array([1, 2, 3, 4]);
const weights = {
  levels: [
    {
      level: 0,
      scaleLayers: [
        { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, stride: 1, inChannels: 1, outChannels: 1 },
      ],
      proj1: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
    {
      level: 1,
      scaleLayers: [],
      proj1: { weight: new Float32Array([2]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
    {
      level: 2,
      scaleLayers: [],
      proj1: { weight: new Float32Array([3]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
  ],
};
const oracle = createSam3ImageFpnNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hiddenStates,
  weights,
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
});
assert.deepEqual(oracle.levels.map(level => level.level), [0, 1, 2]);
assert.deepEqual(oracle.levels.map(level => level.shape), [[1, 2, 2, 1], [1, 2, 2, 1], [1, 2, 2, 1]]);
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[0]), Array.from(hiddenStates), 'identity 1x1 level-0 FPN neck should preserve hidden states');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[1]), Array.from(hiddenStates, value => value * 2), 'level-1 FPN neck should apply level-local projection');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[2]), Array.from(hiddenStates, value => value * 3), 'level-2 FPN neck should apply level-local projection');

assert.throws(() => createSam3ImageFpnNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hiddenStates,
  weights,
  shape: { batch: 1, backboneHeight: 2, backboneWidth: 2, backboneChannels: 1, fpnHiddenSize: 1, levels: [{ level: 0, scaleFactor: 1, height: 2, width: 2 }] },
}), /shape\.levels/);

console.log('sam image FPN-neck phase-program contracts passed');
