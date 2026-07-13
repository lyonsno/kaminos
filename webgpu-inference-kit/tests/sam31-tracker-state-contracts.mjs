import assert from 'node:assert/strict';

import {
  createSam31TrackerState,
  getSam31TrackerStateSnapshot,
  insertSam31TrackerFrame,
  prepareSam31TrackerTemporalInputs,
} from '../src/index.js';

const values = (length, offset) => new Float32Array(Array.from({ length }, (_, index) => offset + index / 1000));
const sha256 = async array => {
  const bytes = array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
};
const config = {
  numFrames: 3,
  frameTokenCount: 4,
  multiplexCount: 16,
  channels: 256,
  maskHeight: 8,
  maskWidth: 8,
  numMaskmem: 7,
  maxConditioningFrames: 4,
  maxObjectPointerFrames: 3,
  memoryTemporalStride: 1,
  useMaskmemTemporalPositionV2: true,
};

async function pointerReceipt(pointers, overrides = {}) {
  return {
    status: 'real',
    fallbackReason: null,
    requestedRouteId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
    effectiveRouteId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
    backend: { kind: 'webgpu-local', runtime: 'browser' },
    outputs: [{ role: 'sam31-multiplex-object-pointers', sha256: await sha256(pointers), shape: [16, 256] }],
    ...overrides,
  };
}

async function maskReceipt(maskLogits, objectScores, overrides = {}) {
  return {
    status: 'real',
    fallbackReason: null,
    requestedRouteId: 'sam3.1.mask-conditioning.phase-program.webgpu-local.v0',
    effectiveRouteId: 'sam3.1.mask-conditioning.phase-program.webgpu-local.v0',
    backend: { kind: 'webgpu-local', runtime: 'browser' },
    outputs: [
      { role: 'sam31-mask-conditioning-logits', sha256: await sha256(maskLogits), shape: [16, 1, 8, 8] },
      { role: 'sam31-mask-conditioning-object-scores', sha256: await sha256(objectScores), shape: [16, 1] },
    ],
    ...overrides,
  };
}

async function frame(frameIndex, kind, origin = {}) {
  const pointers = values(16 * 256, 50 + frameIndex);
  const maskLogits = values(16 * 8 * 8, 60 + frameIndex);
  const objectScores = values(16, 70 + frameIndex);
  return {
    frameIndex,
    kind,
    conditioningObjects: kind === 'conditioning' ? Array.from({ length: 16 }, (_, index) => index) : [],
    memory: values(4 * 256, 10 + frameIndex),
    memoryPosition: values(4 * 256, 20 + frameIndex),
    image: values(4 * 256, 30 + frameIndex),
    imagePosition: values(4 * 256, 40 + frameIndex),
    pointers,
    maskLogits,
    objectScores,
    origin: {
      kind: 'propagation-decoder',
      maskOwner: 'browser-webgpu',
      pointerOwner: 'browser-webgpu',
      pointerReceipt: await pointerReceipt(pointers),
      ...origin,
    },
  };
}

const state = createSam31TrackerState(config);
const firstInput = await frame(0, 'conditioning');
const originalMemory0 = firstInput.memory[0];
const originalPointer0 = firstInput.pointers[0];
const inserted = await insertSam31TrackerFrame(state, firstInput);
assert.equal(state.frames, undefined, 'internal frame storage must not be publicly reachable');
assert.equal(inserted.memory, undefined, 'insertion must not return mutable stored tensors');
assert.equal(Object.isFrozen(inserted), true);
firstInput.memory[0] = 12345;
firstInput.pointers[0] = 67890;

let prepared = prepareSam31TrackerTemporalInputs(state, { frameIndex: 1, trackInReverse: false });
assert.deepEqual(prepared.plan.selectedConditioningFrameIndices, [0]);
assert.deepEqual(prepared.plan.spatialFrames.map(entry => entry.frameIndex), [0]);
assert.deepEqual(prepared.plan.pointerFrames.map(entry => entry.frameIndex), [0]);
assert.equal(prepared.spatialFrames[0].memory[0], originalMemory0, 'mutating insertion input must not alter state');
assert.equal(prepared.pointerFrames[0].pointers[0], originalPointer0, 'mutating insertion input pointers must not alter state');
prepared.spatialFrames[0].memory[0] = -500;
prepared.pointerFrames[0].pointers[0] = -600;
const preparedAgain = prepareSam31TrackerTemporalInputs(state, { frameIndex: 1, trackInReverse: false });
assert.equal(preparedAgain.spatialFrames[0].memory[0], originalMemory0, 'mutating prepared clones must not alter state');
assert.equal(preparedAgain.pointerFrames[0].pointers[0], originalPointer0, 'mutating prepared pointer clones must not alter state');

await insertSam31TrackerFrame(state, await frame(1, 'non-conditioning'));
prepared = prepareSam31TrackerTemporalInputs(state, { frameIndex: 2, trackInReverse: false });
assert.deepEqual(prepared.plan.spatialFrames.map(entry => entry.frameIndex), [0, 1]);
assert.deepEqual(prepared.plan.pointerFrames.map(entry => entry.frameIndex), [0, 1]);
const snapshot = getSam31TrackerStateSnapshot(state);
assert.equal(snapshot.version, 2);
assert.deepEqual(snapshot.conditioningFrameIndices, [0]);
assert.deepEqual(snapshot.nonConditioningFrameIndices, [1]);
assert.deepEqual(snapshot.bridgeDebt, []);
assert.equal(snapshot.claims.browserNativeMaskConditioning, false, 'a propagation-decoder fixture is not a mask-conditioning claim');
for (const role of ['memory', 'memoryPosition', 'image', 'imagePosition', 'pointers', 'maskLogits', 'objectScores']) {
  assert.match(snapshot.frames[0].tensorDigests[role], /^sha256:[0-9a-f]{64}$/, `snapshot must bind ${role} bytes`);
}
const snapshotBeforePreparedMutation = JSON.stringify(snapshot);
assert.equal(JSON.stringify(getSam31TrackerStateSnapshot(state)), snapshotBeforePreparedMutation, 'external mutations must not change snapshot identity');

await assert.rejects(async () => insertSam31TrackerFrame(state, await frame(1, 'non-conditioning')), /already exists/, 'state insertion must not silently overwrite a frame');
await assert.rejects(async () => insertSam31TrackerFrame(createSam31TrackerState(config), { ...await frame(0, 'conditioning'), memory: new Float32Array(1) }), /memory length/, 'state must reject incomplete tensor geometry');
await assert.rejects(async () => insertSam31TrackerFrame(createSam31TrackerState(config), { ...await frame(0, 'conditioning'), maskLogits: values(16 * 4 * 4, 60) }), /maskLogits length/, 'state must reject the wrong mask geometry');
assert.throws(() => prepareSam31TrackerTemporalInputs(createSam31TrackerState(config), { frameIndex: 1 }), /conditioning frame/, 'temporal planning must not fabricate missing conditioning state');

const pointerBridged = createSam31TrackerState(config);
const pointerBridgedInput = await frame(0, 'conditioning', {
  kind: 'mask-conditioning',
  pointerOwner: 'official-reference-bridge',
  pointerReceipt: null,
});
pointerBridgedInput.origin.maskReceipt = await maskReceipt(pointerBridgedInput.maskLogits, pointerBridgedInput.objectScores);
await insertSam31TrackerFrame(pointerBridged, pointerBridgedInput);
assert.deepEqual(getSam31TrackerStateSnapshot(pointerBridged).bridgeDebt, ['interactive-mask-conditioning-object-pointer']);
assert.equal(getSam31TrackerStateSnapshot(pointerBridged).claims.browserNativeMaskConditioning, false);

const maskBridged = createSam31TrackerState(config);
await insertSam31TrackerFrame(maskBridged, await frame(0, 'conditioning', {
  kind: 'mask-conditioning',
  maskOwner: 'official-reference-bridge',
}));
assert.deepEqual(getSam31TrackerStateSnapshot(maskBridged).bridgeDebt, ['interactive-mask-conditioning-mask-logits']);
assert.equal(getSam31TrackerStateSnapshot(maskBridged).claims.browserNativeMaskConditioning, false);

const nativeInput = await frame(0, 'conditioning', { kind: 'mask-conditioning' });
nativeInput.origin.maskReceipt = await maskReceipt(nativeInput.maskLogits, nativeInput.objectScores);
const native = createSam31TrackerState(config);
await insertSam31TrackerFrame(native, nativeInput);
assert.deepEqual(getSam31TrackerStateSnapshot(native).bridgeDebt, []);
assert.equal(getSam31TrackerStateSnapshot(native).claims.browserNativeMaskConditioning, true);

await assert.rejects(
  async () => insertSam31TrackerFrame(createSam31TrackerState(config), await frame(0, 'conditioning', { kind: 'mask-conditioning', maskReceipt: null })),
  /browser-owned mask conditioning requires a real non-fallback receipt/,
  'browser-native mask conditioning must fail without mask-route evidence',
);
const wrongMaskHash = await frame(0, 'conditioning', { kind: 'mask-conditioning' });
wrongMaskHash.origin.maskReceipt = await maskReceipt(wrongMaskHash.maskLogits, wrongMaskHash.objectScores);
wrongMaskHash.origin.maskReceipt.outputs[0].sha256 = `sha256:${'0'.repeat(64)}`;
await assert.rejects(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), wrongMaskHash),
  /maskLogits digest does not match mask receipt/,
  'browser-native mask conditioning must bind literal logits to its route output',
);
await assert.rejects(
  async () => insertSam31TrackerFrame(createSam31TrackerState(config), await frame(0, 'conditioning', { kind: 'mask-conditioning', pointerOwner: 'browser-webgpu', pointerReceipt: null })),
  /browser-owned pointer requires a real non-fallback receipt/,
  'browser-native conditioning must fail without pointer-route evidence',
);
const wrongRoute = await frame(0, 'conditioning', { kind: 'mask-conditioning', maskOwner: 'official-reference-bridge' });
wrongRoute.origin.pointerReceipt = await pointerReceipt(wrongRoute.pointers, { requestedRouteId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0' });
await assert.rejects(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), wrongRoute),
  /requested and effective route ids must match/,
  'browser-native conditioning must reject a substituted pointer route',
);
const wrongBackend = await frame(0, 'conditioning', { kind: 'mask-conditioning', maskOwner: 'official-reference-bridge' });
wrongBackend.origin.pointerReceipt = await pointerReceipt(wrongBackend.pointers, { backend: { kind: 'cpu', runtime: 'browser' } });
await assert.rejects(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), wrongBackend),
  /browser WebGPU backend/,
  'browser-native conditioning must reject a non-WebGPU pointer receipt',
);

console.log('sam3.1 persistent tracker-state contracts passed');
