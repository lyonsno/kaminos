import assert from 'node:assert/strict';

const { validateSamFlameComposition } = await import('../sam-image-witness-checks.js');
const output = { outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  effectiveRouteId: 'sam3.detr-encoder.phase-program.webgpu-local.v0', invocationId: 'invocation-1',
  instances: [{ index: 14 }] };
const sourceSha256 = 'sha256:source';
const sceneObject = { type: 'image', image: { width: 1800, height: 1200,
  maskProvenance: { invocationId: output.invocationId, outputAuthority: output.outputAuthority,
    verificationState: output.verificationState, sourceImage: { sha256: sourceSha256 }, dimensions: [1800, 1200] },
  flameComposition: { method: '2d-image-space-mask', fireSimulationModified: false, persistence: 'live-only' } } };
const bridge = { presentation: 'source-image-mask-overlay', maskOverlayCount: 1, maskOverlay: {
  visible: true, method: '2d-image-space-mask', fireSimulationModified: false, persistence: 'live-only',
  outputAuthority: output.outputAuthority, verificationState: output.verificationState,
  invocationId: output.invocationId, instanceIndices: [14], sourceImageSha256: sourceSha256,
} };

assert.deepEqual(validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256 }), {
  invocationId: 'invocation-1', route: output.effectiveRouteId, sourceSha256,
  dimensions: [1800, 1200], instanceIndices: [14], method: '2d-image-space-mask',
  outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  fireSimulationModified: false, persistence: 'live-only',
});
assert.throws(() => validateSamFlameComposition({ output: { ...output, outputAuthority: 'fixture' }, bridge, sceneObject, sourceSha256 }), /not actual browser WebGPU/);
assert.throws(() => validateSamFlameComposition({ output, bridge: { ...bridge, presentation: 'camera-facing-plane' }, sceneObject, sourceSha256 }), /source-image mask presentation/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject: { ...sceneObject, image: {
  ...sceneObject.image, flameComposition: { ...sceneObject.image.flameComposition, fireSimulationModified: true },
} }, sourceSha256 }), /overstates the composition/);
assert.throws(() => validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256: 'sha256:other' }), /source hash/);

console.log('SAM live-flame witness contracts passed');
