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
assert.match(routeSource, /fpn-neck-maxpool-3/, 'image FPN-neck route must expose level-3 max-pool/downsample stage metadata');
assert.match(routeSource, /fpn-neck-proj1-3/, 'image FPN-neck route must expose level-3 1x1 projection stage metadata');
assert.match(routeSource, /fpn-neck-proj2-0/, 'image FPN-neck route must expose level-0 3x3 projection stage metadata');
assert.match(routeSource, /fpn-neck-proj2-3/, 'image FPN-neck route must expose level-3 3x3 projection stage metadata');
assert.match(routeSource, /readback-fpn-neck-features/, 'image FPN-neck route must expose FPN feature readback stage metadata');

assert.match(stackExporter, /--image-fpn-neck-ingress/, 'detector-stack packet must expose image FPN-neck ingress CLI flag');
assert.match(stackExporter, /mlx-detector-stack-image-fpn-neck-export/, 'detector-stack packet must expose FPN-neck ingress mode');
assert.match(stackExporter, /expected-fpn-neck-feature-0/, 'detector-stack packet must export expected FPN-neck feature level 0');
assert.match(stackExporter, /expected-fpn-neck-feature-1/, 'detector-stack packet must export expected FPN-neck feature level 1');
assert.match(stackExporter, /expected-fpn-neck-feature-2/, 'detector-stack packet must export expected FPN-neck feature level 2');
assert.match(stackExporter, /expected-fpn-neck-feature-3/, 'detector-stack packet must export expected FPN-neck feature level 3');
assert.match(stackExporter, /expected-prompt-fpn-feature/, 'image-FPN detector-stack packet must export expected prompt-FPN feature for browser prompt-FPN composition');
assert.match(stackExporter, /expected-pixel-embed/, 'image-FPN detector-stack packet must export expected pixel embed for browser pixel-decoder composition');
assert.match(stackExporter, /fpn-neck-layer0-scale0-weight/, 'detector-stack packet must export level-0 FPN transpose-conv weights');
assert.match(stackExporter, /fpn-neck-layer2-proj2-weight/, 'detector-stack packet must export level-2 FPN projection weights');
assert.match(stackExporter, /fpn-neck-layer3-proj2-weight/, 'detector-stack packet must export level-3 FPN projection weights');
assert.match(stackExporter, /encoder_tool\.add_downstream_weights\(weight_entries, out_dir, params, len\(ref\["composed_features"\]\)\)/, 'image-FPN detector-stack packet must export prompt cross-attention, pixel-decoder, and mask-tail weights through the reviewed downstream helper');
assert.match(stackExporter, /image-fpn-neck-detector-stack-composition/, 'detector-stack packet must preserve FPN-neck composition route kind');
assert.match(stackExporter, /browser-derived-from-fpn-neck-feature-2/, 'detector-stack packet metadata must mark encoder-src as browser-derived from FPN level 2 in image-FPN mode');
assert.match(stackExporter, /browser-position-embedding-sine-from-fpn-level-2-shape/, 'detector-stack packet metadata must mark encoder-pos as browser-computed from FPN level-2 shape in image-FPN mode');
assert.match(stackExporter, /encoderSrcMaxAbsDiff/, 'detector-stack packet tolerances must include FPN-derived encoder source parity');
assert.match(stackExporter, /encoderPosMaxAbsDiff/, 'detector-stack packet tolerances must include browser position parity');
assert.match(stackExporter, /legacy_detector_stack_tolerances/, 'detector-stack packet must keep a separate tight legacy tolerance budget');
assert.match(stackExporter, /gate_n_image_fpn_tolerances/, 'detector-stack packet must keep a separate Gate N image-FPN tolerance budget');
assert.match(stackExporter, /"binaryMismatchCount": 8/, 'legacy detector-stack packet budget must keep binary mismatch tolerance at 8');
assert.match(stackExporter, /"selectionBoxesMaxAbsDiff": 0\.0002/, 'legacy detector-stack packet budget must keep tight selection-box tolerance');
assert.match(stackExporter, /"binaryMismatchCount": 96/, 'image-FPN packet budget must carry the measured Gate Q binary mismatch tolerance');
assert.match(stackExporter, /"selectionBoxesMaxAbsDiff": 0\.006/, 'image-FPN packet budget must carry the measured Gate N selection-box tolerance');
assert.match(stackExporter, /"promptFpnMaxAbsDiff": 0\.001/, 'image-FPN packet budget must carry the measured browser prompt-FPN tolerance');
assert.match(stackExporter, /"pixelEmbedMaxAbsDiff": 0\.0015/, 'image-FPN packet budget must carry the measured browser pixel-decoder tolerance');
assert.match(stackExporter, /"toleranceBudgetSource": tolerance_budget_source/, 'detector-stack packet must surface the effective tolerance budget source');

assert.match(witness, /mlx-detector-stack-image-fpn-neck-export/, 'witness must allow detector-stack packet mode with browser-local image FPN-neck ingress');
assert.match(witness, /IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image FPN-neck route identity');
assert.match(witness, /imageFpnNeckReport/, 'witness must emit compact imageFpnNeck report evidence');
assert.match(witness, /fpnNeckFeature0MaxAbsDiff/, 'witness must assert FPN-neck level-0 parity');
assert.match(witness, /fpnNeckFeature3MaxAbsDiff/, 'witness must assert FPN-neck level-3 parity');
assert.match(witness, /expectedFpnNeckFeature3Sha256/, 'witness terminal tensorPacket guard must require expected FPN-neck level-3 tensor identity');
assert.match(witness, /!report\.fpnNeckFeature3TensorSha256/, 'witness compact image-FPN report guard must require expected FPN-neck level-3 tensor identity');
assert.match(witness, /level3DetectorConsumption/, 'witness must preserve that level 3 is produced but not detector-consumed');
assert.doesNotMatch(witness, /level3FpnNeck/, 'witness must not preserve the stale non-claim that level 3 FPN neck is absent');
assert.match(witness, /expectedChainLength = report\.mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE \? 13 : 9/, 'witness shared ViT-block evidence guard must accept the 13-route image-FPN prompt/text chain');
assert.match(witness, /receiptChain\.length !== 13/, 'witness must reject image-FPN detector-stack receipt chains that skip browser prompt/text, prompt-FPN, or pixel-decoder composition');
assert.match(witness, /lastState\.compositionRouteReceipts\.length !== 13/, 'witness terminal detector-stack guard must accept the full 13-route image-FPN prompt/text prompt/pixel chain');
assert.doesNotMatch(witness, /lastState\.compositionRouteReceipts\.length !== 10/, 'witness terminal detector-stack guard must not retain the stale ten-route image-FPN chain');
assert.match(witness, /promptFpnReceipt,\s*\n\s*pixelDecoderReceipt,\s*\n\s*decoderReceipt/, 'witness terminal detector-stack guard must account for prompt-FPN and pixel-decoder receipts before decoder');
assert.match(witness, /promptFpnOutput\?\.artifactId !== compositionEdge\?\.promptFpnOutput\?\.artifactId/, 'witness terminal detector-stack guard must bind prompt-FPN receipt output to the composition edge');
assert.match(witness, /pixelDecoderOutput\?\.artifactId !== compositionEdge\?\.pixelEmbedOutput\?\.artifactId/, 'witness terminal detector-stack guard must bind pixel-decoder receipt output to the composition edge');
assert.match(witness, /effectiveToleranceBudgetSource/, 'witness report must preserve the effective tolerance budget source');
assert.match(witness, /browser-fpn-prompt-text-pixel-detector-stack/, 'witness must recognize the image-FPN prompt/text prompt/pixel tolerance budget source');
assert.match(witness, /sam3-detr-encoder-tensors/, 'witness must inspect the DETR encoder tensor input receipt');
assert.match(witness, /detrEncoderInput\?\.artifactId !== 'sam3-detr-encoder-tensors:browser-fpn-image-ingress-composition'/, 'witness must assert the DETR encoder input artifact comes from browser FPN image ingress composition');
assert.match(witness, /detrEncoderInput\?\.sha256 !== ingress\.detrImageIngressTensorSha256/, 'witness must assert the DETR encoder input hash equals the browser FPN ingress aggregate');
assert.match(witness, /browserPromptFpnPixelEvidence/, 'witness report must preserve browser prompt-FPN and pixel-decoder evidence at top level');
assert.match(witness, /PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID/, 'witness must assert image-FPN detector-stack prompt-FPN route receipt identity');
assert.match(witness, /PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'witness must assert image-FPN detector-stack pixel-decoder route receipt identity');

assert.match(smokeJs, /runSam3ImageFpnNeckPhaseProgramRoute/, 'browser smoke must execute image FPN-neck route');
assert.match(smokeJs, /image-fpn-neck-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local FPN-neck ingress');
assert.match(smokeJs, /imageFpnNeckEvidence/, 'browser smoke state must preserve FPN-neck evidence');
assert.match(smokeJs, /fpnNeckFeature0MaxAbsDiff/, 'browser smoke must preserve FPN-neck level-0 parity');
assert.match(smokeJs, /fpnNeckFeature3MaxAbsDiff/, 'browser smoke must preserve FPN-neck level-3 parity');
assert.match(smokeJs, /level3DetectorConsumption/, 'browser smoke must name only detector non-consumption for produced level 3');
assert.doesNotMatch(smokeJs, /level3FpnNeck/, 'browser smoke must not non-claim produced level-3 FPN neck output');
assert.match(smokeJs, /fpnNeckFeature0Output/, 'browser smoke must preserve FPN-neck output identity as an ingress edge');
assert.match(smokeJs, /fpnNeckFeature3Output/, 'browser smoke must preserve FPN-neck level-3 output identity as an ingress edge');
assert.match(smokeJs, /createSam3DetrImageIngressFromFpnFeatures/, 'browser smoke must construct DETR image ingress from browser-produced FPN features');
assert.match(smokeJs, /browserFpnDetrIngressEvidence/, 'browser smoke state must expose FPN-derived DETR ingress evidence');
assert.match(smokeJs, /detrImageIngressTensorSha256/, 'browser smoke must receipt-bind DETR encoder tensors to the FPN-derived image ingress');
assert.match(smokeJs, /encoderSrcSource: 'browser-fpn-neck-feature-2'/, 'browser smoke must advertise browser FPN level 2 as the DETR encoder source owner');
assert.match(smokeJs, /sam3-prompt-fpn-tensors:browser-image-fpn-detector-stack-composition/, 'browser smoke must receipt-bind DETR encoder output into browser prompt-FPN for image-FPN detector-stack mode');
assert.match(smokeJs, /sam3-pixel-decoder-tensors:browser-image-fpn-detector-stack-composition/, 'browser smoke must receipt-bind browser FPN and prompt-FPN outputs into pixel decoder for image-FPN detector-stack mode');
assert.match(smokeJs, /sam3-pixel-embed:browser-image-fpn-detector-stack-composition/, 'browser smoke must expose browser-produced pixel embed before mask-tail in image-FPN detector-stack mode');
assert.match(smokeJs, /browserPromptFpnPixelEvidence/, 'browser smoke state must expose browser prompt-FPN and pixel-decoder evidence');

const {
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrImageIngressFromFpnFeatures,
  createSam3PositionEmbeddingSine,
  createSam3ImageFpnNeckPhaseProgramCpuOracle,
  createSam3ImageFpnNeckPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageFpnNeckPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-fpn-neck-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'vit-backbone-hidden-states', 'sam3-image-fpn-neck-weights']);
assert.deepEqual(route.requiredOutputRoles, ['fpn-neck-feature-0', 'fpn-neck-feature-1', 'fpn-neck-feature-2', 'fpn-neck-feature-3']);
const level0StageOffset = route.requiredStages.indexOf('fpn-neck-transpose-conv-0-scale0');
assert.notEqual(level0StageOffset, -1, 'route must advertise the first level-0 FPN transpose-conv stage');
assert.deepEqual(
  route.requiredStages.slice(level0StageOffset, level0StageOffset + 3),
  ['fpn-neck-transpose-conv-0-scale0', 'fpn-neck-gelu-0', 'fpn-neck-transpose-conv-0-scale1'],
  'route required-stage metadata must preserve level-0 FPN execution order',
);
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
    {
      level: 3,
      scaleLayers: [],
      downsample: 'maxpool2d',
      proj1: { weight: new Float32Array([4]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
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
      { level: 3, scaleFactor: 0.5, height: 1, width: 1 },
    ],
  },
});
assert.deepEqual(oracle.levels.map(level => level.level), [0, 1, 2, 3]);
assert.deepEqual(oracle.levels.map(level => level.shape), [[1, 2, 2, 1], [1, 2, 2, 1], [1, 2, 2, 1], [1, 1, 1, 1]]);
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[0]), Array.from(hiddenStates), 'identity 1x1 level-0 FPN neck should preserve hidden states');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[1]), Array.from(hiddenStates, value => value * 2), 'level-1 FPN neck should apply level-local projection');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[2]), Array.from(hiddenStates, value => value * 3), 'level-2 FPN neck should apply level-local projection');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[3]), [16], 'level-3 FPN neck should max-pool the backbone before level-local projection');

const detrIngress = createSam3DetrImageIngressFromFpnFeatures({
  fpnNeckFeatures: [
    new Float32Array([1, 2, 3, 4]),
    new Float32Array([10, 11, 12, 13]),
    new Float32Array([20, 21, 22, 23, 24, 25, 26, 27]),
  ],
  levels: [
    { level: 0, batch: 1, height: 1, width: 1 },
    { level: 1, batch: 1, height: 1, width: 1 },
    { level: 2, batch: 1, height: 1, width: 2 },
  ],
  channels: 4,
});
assert.equal(detrIngress.encoderSrcSource, 'browser-fpn-neck-feature-2');
assert.deepEqual(Array.from(detrIngress.encoderSrc), [20, 21, 22, 23, 24, 25, 26, 27], 'DETR encoder source must be the row-major browser FPN level-2 tensor');
assert.deepEqual(detrIngress.shape, { batch: 1, height: 1, width: 2, channels: 4, spatialTokens: 2 });

const expectedPos = createSam3PositionEmbeddingSine({ batch: 1, height: 1, width: 2, channels: 4 });
assert.equal(detrIngress.encoderPos.length, expectedPos.length);
for (let index = 0; index < expectedPos.length; index += 1) {
  assert.ok(Math.abs(detrIngress.encoderPos[index] - expectedPos[index]) < 1e-7, `DETR ingress position value ${index} must match PositionEmbeddingSine`);
}
const yAngle = (1 / (1 + 1e-6)) * Math.PI * 2;
const x0Angle = (1 / (2 + 1e-6)) * Math.PI * 2;
assert.ok(Math.abs(detrIngress.encoderPos[0] - Math.sin(yAngle)) < 1e-7, 'position encoding must put y sine first');
assert.ok(Math.abs(detrIngress.encoderPos[1] - Math.cos(yAngle)) < 1e-7, 'position encoding must put y cosine second');
assert.ok(Math.abs(detrIngress.encoderPos[2] - Math.sin(x0Angle)) < 1e-7, 'position encoding must put x sine after y channels');
assert.ok(Math.abs(detrIngress.encoderPos[3] - Math.cos(x0Angle)) < 1e-7, 'position encoding must put x cosine after y channels');

assert.throws(() => createSam3ImageFpnNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hiddenStates,
  weights,
  shape: { batch: 1, backboneHeight: 2, backboneWidth: 2, backboneChannels: 1, fpnHiddenSize: 1, levels: [{ level: 0, scaleFactor: 1, height: 2, width: 2 }] },
}), /shape\.levels/);
assert.throws(() => createSam3DetrImageIngressFromFpnFeatures({
  fpnNeckFeatures: [new Float32Array([1])],
  levels: [{ level: 0, batch: 1, height: 1, width: 1 }],
  channels: 4,
}), /requested DETR source level/);

console.log('sam image FPN-neck phase-program contracts passed');
