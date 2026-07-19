import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pageSource = readFileSync(join(root, 'structural-material-3d.html'), 'utf8');
const witnessSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs'), 'utf8');
const greenroomSource = readFileSync(join(root, 'structural-material-3d-shear-preview-greenroom-launch.mjs'), 'utf8');
const liveDrag = await import('../structural-material-3d-live-drag.js');

assert.equal(
  typeof liveDrag.buildLayeredStructuralShearContactPreview,
  'function',
  'Shear needs immediate visual compliance independent of resident GPU tear cadence',
);
assert.equal(
  typeof liveDrag.createAcceptedStructuralTearReceiptGate,
  'function',
  'fast Shear needs to suppress duplicate page application of resident replay receipts',
);

const acceptedTears = liveDrag.createAcceptedStructuralTearReceiptGate();
const tearEpoch1 = {
  status: 'passed',
  objectIdentity: 'hot-object:test',
  eventEpoch: 1,
};
assert.equal(acceptedTears.accept(tearEpoch1).accepted, true);
assert.deepEqual(acceptedTears.accept({ ...tearEpoch1, replayed: true }), {
  accepted: false,
  duplicate: true,
  key: 'hot-object:test:e1',
}, 'an idempotent resident replay cannot trigger a second material rebuild or haptic');
assert.equal(acceptedTears.accept({ ...tearEpoch1, eventEpoch: 2 }).accepted, true);
assert.deepEqual(acceptedTears.snapshot(), {
  acceptedCount: 2,
  duplicateCount: 1,
  acceptedKeys: ['hot-object:test:e1', 'hot-object:test:e2'],
});
acceptedTears.clear();
assert.deepEqual(acceptedTears.snapshot(), {
  acceptedCount: 0,
  duplicateCount: 0,
  acceptedKeys: [],
});

const state = {
  topologyEpoch: 12,
  connectivityEpoch: 7,
  nodes: [
    { id: 'n0', x: 0, y: 0, z: 0, pinned: true, displacement: { x: 0, y: 0, z: 0 } },
    { id: 'n1', x: 1, y: 0, z: 0, pinned: false, displacement: { x: 0.04, y: 0, z: 0 } },
    { id: 'n2', x: 2, y: 0, z: 0, pinned: false, displacement: { x: 0.02, y: 0, z: 0 } },
    { id: 'n3', x: 3, y: 0, z: 0, pinned: false, displacement: { x: 0.18, y: 0, z: 0 } },
  ],
  bonds: [
    { id: 'b0', a: 'n0', b: 'n1', alive: true },
    { id: 'b1', a: 'n1', b: 'n2', alive: true },
    { id: 'b2', a: 'n2', b: 'n3', alive: false },
  ],
};
const before = structuredClone(state);
const interaction = {
  operationMode: 'shear',
  gestureId: 'preview-shear-1',
  point: { x: 1, y: 0, z: 0 },
  vector: { x: 0.6, y: 0.8, z: 0 },
  dragLength: 0.24,
  radius: 0.25,
  inputLoad: 0.62,
  contactRamp: 1,
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'node',
    id: 'n1',
    segmentT: null,
  },
};

const preview = liveDrag.buildLayeredStructuralShearContactPreview(state, interaction);
const offsets = new Map(preview.nodeOffsets.map(entry => [entry.nodeId, entry]));
assert.equal(preview.status, 'active');
assert.equal(preview.authority, 'visual-only-shear-contact-compliance-not-fracture-v0');
assert.equal(preview.sourceTopologyEpoch, 12);
assert.equal(preview.sourceConnectivityEpoch, 7);
assert.equal(offsets.get('n1').weight, 1, 'the exact picked contact owns full preview response');
assert.ok(offsets.get('n1').magnitude > offsets.get('n2').magnitude, 'live adjacency attenuates response away from contact');
assert.equal(offsets.has('n0'), false, 'non-contact authored supports remain fixed');
assert.equal(offsets.has('n3'), false, 'preview response cannot cross an accepted dead bond');
assert.ok(offsets.get('n1').offset.x > 0 && offsets.get('n1').offset.y > 0, 'preview follows the camera-relative drag direction');
assert.ok(preview.maxOffset > 0, 'nonzero drag produces immediate visible compliance');
assert.deepEqual(state, before, 'visual Shear compliance cannot mutate accepted structural state');

const zeroPreview = liveDrag.buildLayeredStructuralShearContactPreview(state, {
  ...interaction,
  dragLength: 0,
  inputLoad: 0,
  contactRamp: 0,
});
assert.equal(zeroPreview.maxOffset, 0, 'zero-input Shear cannot fabricate deformation');

assert.match(pageSource, /buildLayeredStructuralShearContactPreview/, 'the product witness consumes the pure Shear preview field');
assert.match(pageSource, /visibleShearContactPreview/, 'the witness exposes preview state separately from accepted tear state');
assert.match(pageSource, /incremental-shear-preview/, 'Shear pointer samples use a measured incremental render path');
assert.match(
  pageSource,
  /operationMode === 'shear'[\s\S]*renderShearPreview/,
  'active Shear drag renders immediately instead of waiting for GPU tear acceptance',
);
assert.match(
  pageSource,
  /gpuTearAcceptanceGate\.accept\(receipt\)[\s\S]*if \(!acceptance\.accepted\)[\s\S]*return receipt;[\s\S]*routeStructuralHaptics/,
  'resident replay deduplication precedes page mutation, full render accounting, and haptics',
);
assert.match(
  pageSource,
  /sidecar => sidecar\.reinitialize\(nextState\)[\s\S]*receipt\.status === 'passed'[\s\S]*gpuTearAcceptanceGate\.clear\(\)/,
  'successful resident reinitialize resets the event-epoch replay namespace',
);
assert.match(witnessSource, /shearPreviewPrecededGpuExecution/, 'browser evidence holds GPU execution behind visible Shear response');
assert.match(witnessSource, /shearPreviewAdvancedWhileGpuHeld/, 'browser evidence requires multiple immediate Shear states');
assert.match(witnessSource, /shearPreviewRenderWithinFrameBudget/, 'browser evidence rejects Shear preview over one 60 Hz frame');
assert.match(witnessSource, /shearPreviewPreservedAcceptedState/, 'browser evidence rejects preview-authored fracture or haptics');
assert.match(witnessSource, /cancelledShearPreviewDidNotExecute/, 'the held evidence route must cancel without hidden resident mutation');
assert.match(witnessSource, /duplicateTearReplaySuppressed/, 'browser evidence rejects duplicate page application of a resident replay');
assert.match(witnessSource, /shearAcceptedScreenshotPixels/, 'visual evidence distinguishes held loading from accepted Shear fracture');
assert.match(greenroomSource, /continuous-shear-preview-greenroom-r5/, 'Shear response has a dedicated non-overwriting Greenroom artifact identity');

console.log('structural-material-3d Shear preview contracts passed');
