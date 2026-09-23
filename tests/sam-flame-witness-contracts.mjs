import assert from 'node:assert/strict';

const { validateSamFlameComposition } = await import('../sam-image-witness-checks.js');
const { waitForSamFlameComposition } = await import('../sam-image-witness.mjs');
const output = { outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  effectiveRouteId: 'sam3.detr-encoder.phase-program.webgpu-local.v0', invocationId: 'invocation-1', promptText: 'windows',
  instances: [{ index: 14 }] };
const sourceSha256 = 'sha256:source';
const presentation = { activeTab: 'assets', samImageViewportHidden: true };
const sceneObject = { type: 'image', image: { width: 1800, height: 1200,
  maskProvenance: { invocationId: output.invocationId, outputAuthority: output.outputAuthority,
    verificationState: output.verificationState, sourceImage: { sha256: sourceSha256 }, dimensions: [1800, 1200] },
  flameComposition: { method: '2d-image-space-mask', fireSimulationModified: false, persistence: 'live-only' } } };
const bridge = { presentation: 'source-image-mask-overlay', maskOverlayCount: 1, maskOverlay: {
  visible: true, method: '2d-image-space-mask', fireSimulationModified: false, persistence: 'live-only',
  outputAuthority: output.outputAuthority, verificationState: output.verificationState,
  invocationId: output.invocationId, instanceIndices: [14], sourceImageSha256: sourceSha256,
} };

assert.deepEqual(validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation }), {
  invocationId: 'invocation-1', route: output.effectiveRouteId, promptText: 'windows', presentation, sourceSha256,
  dimensions: [1800, 1200], instanceIndices: [14], method: '2d-image-space-mask',
  outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  fireSimulationModified: false, persistence: 'live-only',
});
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation: { activeTab: 'masks', samImageViewportHidden: false } }), /Assets scene/,
  'the witness must not accept the SAM preview as proof of live-scene composition');
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'wheel', presentation }), /prompt does not match/);
assert.throws(() => validateSamFlameComposition({ output: { ...output, outputAuthority: 'fixture' }, bridge, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation }), /not actual browser WebGPU/);
assert.throws(() => validateSamFlameComposition({ output, bridge: { ...bridge, presentation: 'camera-facing-plane' }, sceneObject, sourceSha256,
  expectedPrompt: 'windows', presentation }), /source-image mask presentation/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject: { ...sceneObject, image: {
  ...sceneObject.image, flameComposition: { ...sceneObject.image.flameComposition, fireSimulationModified: true },
} }, sourceSha256, expectedPrompt: 'windows', presentation }), /overstates the composition/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256: 'sha256:other',
  expectedPrompt: 'windows', presentation }), /source hash/);

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
