import assert from 'node:assert/strict';
import {
  connectSf3dForeground,
  createSharedDeviceSf3dProducer,
  sharedGpuBufferRequirements,
  snapshotSf3dSharedDevice,
} from '../sf3d-host-device.mjs';

const device = {
  queue: { submit() {} },
  limits: { ...sharedGpuBufferRequirements },
  features: new Set(['feature-a']),
};
const sharedGpu = { adapter: { id: 'adapter' }, device, queue: device.queue, identity: 'current-main-host' };
const snapshot = snapshotSf3dSharedDevice(sharedGpu);
assert.equal(snapshot.hostIdentity, 'current-main-host');
assert.equal(snapshot.effectiveLimits.maxBufferSize, sharedGpuBufferRequirements.maxBufferSize);
assert.throws(() => snapshotSf3dSharedDevice({ ...sharedGpu, queue: {} }), /exact queue/);
assert.throws(() => snapshotSf3dSharedDevice({ ...sharedGpu, device: { ...device, limits: {} } }), /exceeds effective limit/);

let producerOptions;
const producer = await createSharedDeviceSf3dProducer(async options => {
  producerOptions = options;
  return { device: options.device, deviceInjected: true };
}, sharedGpu, { weightsUrl: '/api/read?root=greenroom&path=weights.bin' });
assert.equal(producer.device, device);
assert.equal(producerOptions.adapter, sharedGpu.adapter);
assert.equal(producerOptions.commit, snapshot.producerCommit);
await assert.rejects(createSharedDeviceSf3dProducer(async options => ({ device: {}, deviceInjected: true }), sharedGpu), /device-mismatch/);

let requester;
let serviceActive = false;
const events = [];
const prototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester: fn => { requester = fn; },
};
const host = {
  device,
  setForegroundServiceActive: active => { serviceActive = active; },
  runForegroundFrame: run => { events.push('scene'); return run(); },
};
const actualProducer = {
  device,
  requestForegroundOpportunity: request => ({
    completion: Promise.resolve().then(() => request.run({ device, queue: device.queue })).then(result => ({ status: 'completed', result })),
  }),
};
const receipts = [];
connectSf3dForeground(actualProducer, prototype, host, receipt => receipts.push(receipt));
assert.equal(serviceActive, true);
const receipt = await requester({
  requestId: 'current-main-frame-1',
  run: service => {
    assert.equal(service.device, device);
    events.push('flame');
    return { status: 'submitted', renderer: 'ordinary-volume' };
  },
}).completion;
assert.equal(receipt.status, 'completed');
assert.deepEqual(events, ['scene', 'flame']);
assert.equal(receipts.length, 1);
assert.throws(() => connectSf3dForeground(actualProducer, {
  ...prototype,
  foregroundGpuContext: () => ({ device, queue: device.queue, renderer: 'alternate-volume', productFrameOwner: 'prototype' }),
}, host), /actual ordinary renderer/);

console.log('current-main SF3D exact-device and foreground adapter contracts passed');
