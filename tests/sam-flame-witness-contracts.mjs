import assert from 'node:assert/strict';

const { validateSamFlameComposition } = await import('../sam-image-witness-checks.js');
const { waitForSamFlameComposition } = await import('../sam-image-witness.mjs');
const output = { outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  effectiveRouteId: 'sam3.detr-encoder.phase-program.webgpu-local.v0', invocationId: 'invocation-1', promptText: 'windows',
  instances: [{ index: 14 }, { index: 15 }] };
const sourceSha256 = 'sha256:source';
const presentation = { activeTab: 'assets', samImageViewportHidden: true };
const sceneObject = { type: 'image', image: { width: 1800, height: 1200,
  maskProvenance: { invocationId: output.invocationId, outputAuthority: output.outputAuthority,
    verificationState: output.verificationState, sourceImage: { sha256: sourceSha256 }, dimensions: [1800, 1200], indices: [14] },
  flameComposition: { method: '2d-image-space-mask', status: 'live', fireSimulationModified: false, persistence: 'live-only' } } };
const bridge = { presentation: 'source-image-mask-overlay', maskOverlayCount: 1, maskOverlay: {
  visible: true, method: '2d-image-space-mask', fireSimulationModified: false, persistence: 'live-only',
  outputAuthority: output.outputAuthority, verificationState: output.verificationState,
  invocationId: output.invocationId, instanceIndices: [14], sourceImageSha256: sourceSha256,
} };
const selectedIndices = [14];
const volume = { active: true, backend: 'WebGPU:Apple', frameCount: 2, simStepCount: 2 };
const pixelEvidence = { authority: 'three-renderer-canvas-readback', foreground: {
  maskValue: 1, sourceRgba: [240, 240, 240, 255], composedRgba: [255, 170, 70, 255], uv: [0.4, 0.4],
}, background: { maskValue: 0, sourceRgba: [240, 240, 240, 255], composedRgba: [240, 240, 240, 255], uv: [0.5, 0.5] } };
const evidence = { selectedIndices, volume, pixelEvidence };

assert.deepEqual(validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence }), {
  invocationId: 'invocation-1', route: output.effectiveRouteId, promptText: 'windows', presentation, sourceSha256,
  dimensions: [1800, 1200], instanceIndices: [14], method: '2d-image-space-mask',
  outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  fireSimulationModified: false, persistence: 'live-only',
});
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation: { activeTab: 'masks', samImageViewportHidden: false }, ...evidence }), /Assets scene/,
  'the witness must not accept the SAM preview as proof of live-scene composition');
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'wheel', presentation, ...evidence }), /prompt does not match/);
assert.throws(() => validateSamFlameComposition({ output: { ...output, outputAuthority: 'fixture' }, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence }), /not actual browser WebGPU/);
assert.throws(() => validateSamFlameComposition({ output, bridge: { ...bridge, presentation: 'camera-facing-plane' }, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence }), /source-image mask presentation/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject: { ...sceneObject, image: {
  ...sceneObject.image, flameComposition: { ...sceneObject.image.flameComposition, fireSimulationModified: true },
} }, sourceSha256, expectedPrompt: 'windows', presentation, ...evidence }), /overstates the composition/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256: 'sha256:other',
  expectedPrompt: 'windows', presentation, ...evidence }), /source hash/);
assert.throws(() => validateSamFlameComposition({ output, bridge: { ...bridge,
  maskOverlay: { ...bridge.maskOverlay, instanceIndices: [15] } }, sceneObject: { ...sceneObject, image: {
  ...sceneObject.image, maskProvenance: { ...sceneObject.image.maskProvenance, indices: [15] },
} }, sourceSha256, expectedPrompt: 'windows', presentation, ...evidence }), /selected instance/,
'a valid but unselected candidate must not pass as the composed mask');
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence, volume: { ...volume, active: false } }), /not active and advancing/,
'a visible overlay flag cannot substitute for an advancing live flame');
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence,
  pixelEvidence: { ...pixelEvidence, foreground: { ...pixelEvidence.foreground, composedRgba: pixelEvidence.foreground.sourceRgba } } }), /masked foreground/,
'a blank flame canvas cannot pass the rendered-pixel witness');
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation, ...evidence,
  pixelEvidence: { ...pixelEvidence, background: { ...pixelEvidence.background, composedRgba: [255, 150, 40, 255] } } }), /masked background/,
'the flame must remain clipped outside the selected mask');

const observedDuringStall = { activeTab: 'masks', samBusy: false,
  volume: { active: false, error: null }, bridge: { maskOverlayCount: 1, maskOverlay: { visible: false } } };
const waitFailure = new Error('composition wait timed out');
await assert.rejects(waitForSamFlameComposition({
  waitForFunction: (_predicate, _argument, options) => {
    assert.equal(options.timeout, 120000, 'scene activation needs a bounded witness wait');
    return Promise.reject(waitFailure);
  },
  evaluate: () => Promise.resolve(observedDuringStall),
}), error => error.compositionDiagnostic === observedDuringStall,
'a stalled scene activation must preserve its last observable UI and renderer state');

console.log('SAM live-flame witness contracts passed');
