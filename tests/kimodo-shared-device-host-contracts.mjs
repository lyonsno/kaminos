import assert from 'node:assert/strict';

const {
  KIMODO_SHARED_DEVICE_ROUTE,
  connectKimodoSharedDeviceForeground,
  snapshotKimodoSharedDevice,
} = await import('../kimodo-shared-device-host.mjs');

function makeDevice() {
  const queue = { submit() {} };
  return {
    queue,
    features: new Set(),
    limits: {
      maxBufferSize: 1 << 30,
      maxStorageBufferBindingSize: 1 << 30,
      maxComputeWorkgroupStorageSize: 32768,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
    },
  };
}

const device = makeDevice();
const sharedGpu = {
  device,
  queue: device.queue,
  backendIdentity: {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: 'contract-adapter',
    browser: 'contract-browser',
    requestedFeatures: [],
    features: [],
    limits: { ...device.limits },
    timestampQuery: 'unavailable',
  },
};

assert.equal(snapshotKimodoSharedDevice(sharedGpu).deviceTopology, 'same-device');
assert.equal(KIMODO_SHARED_DEVICE_ROUTE, 'kimodo.text-to-motion.webgpu-local.v0');
assert.throws(
  () => snapshotKimodoSharedDevice({ ...sharedGpu, queue: { submit() {} } }),
  /exact queue/,
  'a foreign queue fails before model work',
);

let requester = null;
let hostServiceActive = false;
let hostFrameCount = 0;
const prototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { requester = next; },
};
const host = {
  device,
  setForegroundServiceActive(active) { hostServiceActive = active; },
  runForegroundFrame(run) { hostFrameCount += 1; return run(); },
};
const producer = { device, deviceInjected: true };
const foreground = connectKimodoSharedDeviceForeground({ producer, prototype, host, sharedGpu });
assert.equal(typeof requester, 'function');
assert.equal(hostServiceActive, true);

const run = await foreground.beginRun('contract-run');
const request = requester({
  requestId: 'ordinary-1',
  metadata: { renderer: 'ordinary-volume' },
  run(service) {
    service.submit([{}], { metadata: { renderer: 'ordinary-volume' } });
    return { status: 'submitted', renderer: 'ordinary-volume' };
  },
});
await run.foregroundOpportunity({
  phase: 'transformer-pass',
  step: 1,
  numSteps: 100,
  pass: 'body-conditioned',
});
const receipt = await request.completion;
assert.equal(receipt.status, 'completed');
assert.equal(hostFrameCount, 1);
await run.finish();
assert.equal(foreground.snapshot().activeRun, null);
await foreground.dispose();
assert.equal(requester, null);
assert.equal(hostServiceActive, false);

assert.throws(
  () => connectKimodoSharedDeviceForeground({
    producer: { device: makeDevice(), deviceInjected: true },
    prototype,
    host,
    sharedGpu,
  }),
  /device mismatch/,
  'a producer-owned or foreign device cannot impersonate same-device composition',
);

console.log('Kimodo shared-device foreground host contracts passed');
