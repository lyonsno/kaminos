import assert from 'node:assert/strict';

import {
  createSam31TrackerState,
  getSam31TrackerStateSnapshot,
  insertSam31TrackerFrame,
  prepareSam31TrackerTemporalInputs,
} from '../src/index.js';

const values = (length, offset) => new Float32Array(Array.from({ length }, (_, index) => offset + index / 1000));
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
const state = createSam31TrackerState(config);
const frame = (frameIndex, kind, origin = {}) => ({
  frameIndex,
  kind,
  conditioningObjects: kind === 'conditioning' ? Array.from({ length: 16 }, (_, index) => index) : [],
  memory: values(4 * 256, 10 + frameIndex),
  memoryPosition: values(4 * 256, 20 + frameIndex),
  image: values(4 * 256, 30 + frameIndex),
  imagePosition: values(4 * 256, 40 + frameIndex),
  pointers: values(16 * 256, 50 + frameIndex),
  maskLogits: values(16 * 8 * 8, 60 + frameIndex),
  objectScores: values(16, 70 + frameIndex),
  origin: {
    kind: 'propagation-decoder',
    maskOwner: 'browser-webgpu',
    pointerOwner: 'browser-webgpu',
    pointerReceipt: {
      status: 'real',
      fallbackReason: null,
      requestedRouteId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
      effectiveRouteId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
      backend: { kind: 'webgpu-local', runtime: 'browser' },
    },
    ...origin,
  },
});

insertSam31TrackerFrame(state, frame(0, 'conditioning'));
let prepared = prepareSam31TrackerTemporalInputs(state, { frameIndex: 1, trackInReverse: false });
assert.deepEqual(prepared.plan.selectedConditioningFrameIndices, [0]);
assert.deepEqual(prepared.plan.spatialFrames.map(entry => entry.frameIndex), [0]);
assert.deepEqual(prepared.plan.pointerFrames.map(entry => entry.frameIndex), [0]);
assert.equal(prepared.spatialFrames[0].memory.length, 4 * 256);
assert.equal(prepared.pointerFrames[0].pointers.length, 16 * 256);
assert.notEqual(prepared.spatialFrames[0].memory, state.frames.get(0).memory, 'prepared tensors must not expose mutable state storage');

insertSam31TrackerFrame(state, frame(1, 'non-conditioning'));
prepared = prepareSam31TrackerTemporalInputs(state, { frameIndex: 2, trackInReverse: false });
assert.deepEqual(prepared.plan.spatialFrames.map(entry => entry.frameIndex), [0, 1]);
assert.deepEqual(prepared.plan.pointerFrames.map(entry => entry.frameIndex), [0, 1]);
const snapshot = getSam31TrackerStateSnapshot(state);
assert.equal(snapshot.version, 2);
assert.deepEqual(snapshot.conditioningFrameIndices, [0]);
assert.deepEqual(snapshot.nonConditioningFrameIndices, [1]);
assert.deepEqual(snapshot.bridgeDebt, []);
assert.equal(snapshot.claims.browserNativeMaskConditioning, false, 'a propagation-decoder fixture is not a mask-conditioning claim');

assert.throws(() => insertSam31TrackerFrame(state, frame(1, 'non-conditioning')), /already exists/, 'state insertion must not silently overwrite a frame');
assert.throws(() => insertSam31TrackerFrame(createSam31TrackerState(config), { ...frame(0, 'conditioning'), memory: new Float32Array(1) }), /memory length/, 'state must reject incomplete tensor geometry');
assert.throws(() => insertSam31TrackerFrame(createSam31TrackerState(config), { ...frame(0, 'conditioning'), maskLogits: values(16 * 4 * 4, 60) }), /maskLogits length/, 'state must reject the wrong mask geometry');
assert.throws(() => prepareSam31TrackerTemporalInputs(createSam31TrackerState(config), { frameIndex: 1 }), /conditioning frame/, 'temporal planning must not fabricate missing conditioning state');

const bridged = createSam31TrackerState(config);
insertSam31TrackerFrame(bridged, frame(0, 'conditioning', {
  kind: 'mask-conditioning',
  pointerOwner: 'official-reference-bridge',
  pointerReceipt: null,
}));
const bridgedSnapshot = getSam31TrackerStateSnapshot(bridged);
assert.deepEqual(bridgedSnapshot.bridgeDebt, ['interactive-mask-conditioning-object-pointer']);
assert.equal(bridgedSnapshot.claims.browserNativeMaskConditioning, false);
const maskBridged = createSam31TrackerState(config);
insertSam31TrackerFrame(maskBridged, frame(0, 'conditioning', {
  kind: 'mask-conditioning',
  maskOwner: 'official-reference-bridge',
}));
assert.deepEqual(getSam31TrackerStateSnapshot(maskBridged).bridgeDebt, ['interactive-mask-conditioning-mask-logits']);
assert.equal(getSam31TrackerStateSnapshot(maskBridged).claims.browserNativeMaskConditioning, false, 'reference-owned mask logits must not become a browser-native claim');
assert.throws(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), frame(0, 'conditioning', { kind: 'mask-conditioning', pointerOwner: 'browser-webgpu', pointerReceipt: null })),
  /browser-owned pointer requires a real non-fallback receipt/,
  'browser-native conditioning must fail without route evidence',
);
assert.throws(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), frame(0, 'conditioning', {
    kind: 'mask-conditioning',
    pointerReceipt: {
      status: 'real',
      fallbackReason: null,
      requestedRouteId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0',
      effectiveRouteId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
      backend: { kind: 'webgpu-local', runtime: 'browser' },
    },
  })),
  /requested and effective route ids must match/,
  'browser-native conditioning must reject a substituted pointer route',
);
assert.throws(
  () => insertSam31TrackerFrame(createSam31TrackerState(config), frame(0, 'conditioning', {
    kind: 'mask-conditioning',
    pointerReceipt: {
      status: 'real',
      fallbackReason: null,
      requestedRouteId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0',
      effectiveRouteId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0',
      backend: { kind: 'cpu', runtime: 'browser' },
    },
  })),
  /browser WebGPU backend/,
  'browser-native conditioning must reject a non-WebGPU pointer receipt',
);

console.log('sam3.1 persistent tracker-state contracts passed');
