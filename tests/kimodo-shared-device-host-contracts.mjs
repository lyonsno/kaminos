import assert from 'node:assert/strict';

const {
  KIMODO_SHARED_DEVICE_ROUTE,
  kimodoSubmissionSchedule,
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
  requirements: { requiredFeatures: [], requiredLimits: {} },
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
assert.deepEqual(kimodoSubmissionSchedule('single-layer'), {
  mode: 'single-layer', layersPerDuty: 1, chunksPerPass: 16, maxInFlightDuties: 4,
}, 'single-layer is explicit, isolated from the full-pass default, and keeps the four-duty capacity fixed');
assert.throws(
  () => snapshotKimodoSharedDevice({ ...sharedGpu, queue: { submit() {} } }),
  /exact queue/,
  'a foreign queue fails before model work',
);
assert.throws(
  () => snapshotKimodoSharedDevice({
    ...sharedGpu,
    requirements: { requiredFeatures: [], requiredLimits: { maxStorageBufferBindingSize: (1 << 30) + 1 } },
  }),
  /requirements failed/,
  'the exact composed host requirements are validated against the borrowed device before allocation',
);

let requester = null;
let hostServiceActive = false;
let hostFrameCount = 0;
const prototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { requester = next; },
  async stopForegroundFrames() {},
};
const host = {
  device,
  setForegroundServiceActive(active) { hostServiceActive = active; },
  runForegroundFrame(run) { hostFrameCount += 1; return run(); },
};
const producer = { device, deviceInjected: true };
const foreground = connectKimodoSharedDeviceForeground({ prototype, host, sharedGpu });
assert.equal(typeof requester, 'function');
assert.equal(hostServiceActive, true);
const loadFrame = requester({
  requestId: 'ordinary-during-model-load',
  metadata: { phase: 'model-load' },
  run(service) {
    service.submit([{}], { metadata: { phase: 'model-load' } });
    return { status: 'submitted', phase: 'model-load' };
  },
});
assert.equal((await loadFrame.completion).status, 'completed');
assert.equal(hostFrameCount, 1, 'the persistent requester services an ordinary flame frame before producer attachment');
await assert.rejects(
  () => foreground.beginRun('producer-not-attached'),
  /attach the exact shared-device Kimodo producer/,
  'generation cannot begin before the loaded producer proves exact borrowed-device identity',
);
foreground.attachProducer(producer);
assert.equal(foreground.snapshot().producerAttached, true);

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
assert.equal(hostFrameCount, 2);
await run.finish();
assert.equal(foreground.snapshot().activeRun, null);
await foreground.dispose();
assert.equal(requester, null);
assert.equal(hostServiceActive, false);

const foreignProducerForeground = connectKimodoSharedDeviceForeground({ prototype, host, sharedGpu });
assert.throws(
  () => foreignProducerForeground.attachProducer({ device: makeDevice(), deviceInjected: true }),
  /producer device mismatch/,
  'a producer-owned or foreign device cannot impersonate same-device composition',
);
await foreignProducerForeground.dispose();

let failingRequester = null;
const failingPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { failingRequester = next; },
  async stopForegroundFrames() {},
};
const failingHost = {
  device,
  setForegroundServiceActive() {},
  runForegroundFrame() { throw new Error('three-render-failed'); },
};
const failingForeground = connectKimodoSharedDeviceForeground({ prototype: failingPrototype, host: failingHost, sharedGpu });
failingForeground.attachProducer(producer);
const failingRun = await failingForeground.beginRun('failing-run');
const failedFrame = failingRequester({
  requestId: 'ordinary-failure',
  run(service) {
    service.submit([{}]);
    return { status: 'submitted' };
  },
});
await assert.rejects(
  () => failingRun.foregroundOpportunity({ phase: 'transformer-pass', step: 0, numSteps: 1, pass: 'conditioned' }),
  /foreground.*failed/i,
  'a failed foreground callback rejects the model boundary instead of becoming success-shaped receipt data',
);
assert.match((await failedFrame.completion).status, /^failed-/);
await assert.rejects(
  () => failingRun.foregroundOpportunity({ phase: 'transformer-pass', step: 0, numSteps: 1, pass: 'unconditioned' }),
  /foreground.*failed/i,
  'the first foreground failure seals later model boundary admission',
);
await assert.rejects(() => failingRun.finish(), /foreground.*failed/i, 'quiescent finish cannot erase a failed receipt');
await failingForeground.dispose();

let windowRequester = null;
const windowPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { windowRequester = next; },
  async stopForegroundFrames() {},
};
const windowForeground = connectKimodoSharedDeviceForeground({
  prototype: windowPrototype,
  host: { device, setForegroundServiceActive() {}, runForegroundFrame() { throw new Error('cpu-window-frame-failed'); } },
  sharedGpu,
});
windowForeground.attachProducer(producer);
const windowRun = await windowForeground.beginRun('window-failure-run');
await assert.rejects(
  () => windowRun.withForeground('text-embedding', async () => {
    windowRequester({ requestId: 'window-failure', run: () => ({ status: 'submitted' }) });
    await Promise.resolve();
    return 'embedding-ok';
  }),
  /foreground.*failed/i,
  'CPU-only foreground windows reject when an admitted renderer callback fails',
);
await assert.rejects(() => windowRun.finish(), /foreground.*failed/i);
await windowForeground.dispose();

let cancellationRequester = null;
let enteredCallback;
let releaseCallback;
const callbackEntered = new Promise(resolve => { enteredCallback = resolve; });
const callbackRelease = new Promise(resolve => { releaseCallback = resolve; });
const cancellationPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { cancellationRequester = next; },
  async stopForegroundFrames() {},
};
const cancellationForeground = connectKimodoSharedDeviceForeground({
  prototype: cancellationPrototype,
  host: { device, setForegroundServiceActive() {}, async runForegroundFrame(run) { return run(); } },
  sharedGpu,
});
cancellationForeground.attachProducer(producer);
const cancellationRun = await cancellationForeground.beginRun('cancellation-run');
const cancelHandle = cancellationRequester({
  requestId: 'cancel-during-service',
  async run(service) {
    enteredCallback();
    await callbackRelease;
    if (!service.signal.aborted) service.submit([{}]);
    return { status: 'submitted' };
  },
});
const cancellationBoundary = cancellationRun.foregroundOpportunity({ phase: 'transformer-pass', step: 0, numSteps: 1, pass: 'conditioned' });
await callbackEntered;
cancelHandle.cancel('test-cancel');
releaseCallback();
await assert.rejects(() => cancellationBoundary, /foreground.*failed/i, 'cancellation during service rejects the model boundary');
assert.equal((await cancelHandle.completion).status, 'canceled-during-service');
await assert.rejects(() => cancellationRun.finish(), /foreground.*failed/i);
await cancellationForeground.dispose();

const teardownEvents = [];
let teardownRequester = null;
const teardownPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { teardownEvents.push(next ? 'attach' : 'detach'); teardownRequester = next; },
  async stopForegroundFrames() { teardownEvents.push('drain'); },
};
const teardownHost = {
  device,
  setForegroundServiceActive(active) { teardownEvents.push(active ? 'host-on' : 'host-off'); },
  runForegroundFrame(run) { return run(); },
};
const teardownForeground = connectKimodoSharedDeviceForeground({ prototype: teardownPrototype, host: teardownHost, sharedGpu });
teardownForeground.attachProducer(producer);
await teardownForeground.beginRun('teardown-active-run');
const teardownOne = teardownForeground.dispose();
const teardownTwo = teardownForeground.dispose();
assert.equal(teardownOne, teardownTwo, 'dispose is one idempotent asynchronous teardown promise');
await teardownOne;
assert.deepEqual(teardownEvents.slice(-3), ['drain', 'detach', 'host-off'], 'teardown drains before detaching and relinquishing scene ownership');
assert.equal(teardownRequester, null);

const failedTeardownEvents = [];
let failedTeardownRequester = null;
const failedTeardownPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) {
    failedTeardownEvents.push(next ? 'attach' : 'detach');
    failedTeardownRequester = next;
  },
  async pauseForegroundFrames() { failedTeardownEvents.push('pause'); },
  async stopForegroundFrames() { failedTeardownEvents.push('drain'); },
};
const failedTeardownForeground = connectKimodoSharedDeviceForeground({
  prototype: failedTeardownPrototype,
  host: {
    device,
    setForegroundServiceActive(active) { failedTeardownEvents.push(active ? 'host-on' : 'host-off'); },
    runForegroundFrame() { throw new Error('teardown-frame-failed'); },
  },
  sharedGpu,
});
failedTeardownForeground.attachProducer(producer);
const failedTeardownRun = await failedTeardownForeground.beginRun('failed-teardown-active-run');
const failedTeardownFrame = failedTeardownRequester({
  requestId: 'failed-teardown-frame',
  run(service) {
    service.submit([{}]);
    return { status: 'submitted' };
  },
});
await assert.rejects(
  () => failedTeardownRun.foregroundOpportunity({ phase: 'transformer-pass', step: 0, numSteps: 1, pass: 'conditioned' }),
  /foreground.*failed/i,
);
await failedTeardownFrame.completion;
await assert.rejects(
  () => failedTeardownForeground.dispose(),
  /foreground.*failed/i,
  'teardown preserves an active-run foreground failure as its terminal result',
);
assert.equal(failedTeardownRequester, null, 'failed teardown still detaches the requester');
assert.deepEqual(
  failedTeardownEvents.slice(-4),
  ['pause', 'drain', 'detach', 'host-off'],
  'failed teardown drains and relinquishes scene ownership before returning its failure',
);

let windowDrainRequester = null;
let releaseWindowWork;
const windowDrainWork = new Promise(resolve => { releaseWindowWork = resolve; });
const windowDrainForeground = connectKimodoSharedDeviceForeground({
  prototype: {
    foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
    setForegroundOpportunityRequester(next) { windowDrainRequester = next; },
    stopForegroundFrameAdmission() {},
    async awaitForegroundFrames() {},
    async stopForegroundFrames() {},
  },
  host: { device, setForegroundServiceActive() {}, runForegroundFrame(runFrame) { return runFrame(); } },
  sharedGpu,
});
windowDrainForeground.attachProducer(producer);
const windowDrainRun = await windowDrainForeground.beginRun('window-drain-run');
const activeWindow = windowDrainRun.withForeground('text-embedding', () => windowDrainWork);
await Promise.resolve();
await assert.rejects(
  () => windowDrainRun.finish(),
  /CPU foreground window/,
  'finish before CPU window settlement reports the pre-finish condition',
);
assert.equal(
  windowDrainForeground.snapshot().activeRun,
  'window-drain-run',
  'a pre-finish rejection retains host custody of the kit run for a lawful retry',
);
releaseWindowWork('embedded');
await activeWindow;
await windowDrainForeground.dispose();
assert.equal(windowDrainRequester, null, 'retrying finish during disposal drains and detaches the settled CPU-window run');

let pendingDrainRequester = null;
let pendingFrameCompletion = Promise.resolve();
const pendingDrainEvents = [];
const pendingDrainPrototype = {
  foregroundGpuContext: () => ({ device, queue: device.queue, active: true, renderer: 'ordinary-volume', productFrameOwner: 'prototype' }),
  setForegroundOpportunityRequester(next) { pendingDrainRequester = next; },
  stopForegroundFrameAdmission() { pendingDrainEvents.push('stop-admission'); },
  async awaitForegroundFrames() { pendingDrainEvents.push('await-pending'); await pendingFrameCompletion; },
  async stopForegroundFrames() { pendingDrainEvents.push('stop'); },
};
const pendingDrainForeground = connectKimodoSharedDeviceForeground({
  prototype: pendingDrainPrototype,
  host: { device, setForegroundServiceActive() {}, runForegroundFrame(runFrame) { return runFrame(); } },
  sharedGpu,
});
pendingDrainForeground.attachProducer(producer);
const pendingDrainRun = await pendingDrainForeground.beginRun('pending-frame-drain-run');
const pendingFrame = pendingDrainRequester({
  requestId: 'pending-frame-at-dispose',
  run(service) {
    service.submit([{}]);
    return { status: 'submitted' };
  },
});
pendingFrameCompletion = pendingFrame.completion;
const pendingDispose = pendingDrainForeground.dispose();
const pendingOutcome = await Promise.race([
  pendingDispose.then(() => 'disposed'),
  new Promise(resolve => setTimeout(() => resolve('pending'), 100)),
]);
if (pendingOutcome === 'pending') await pendingDrainRun.finish();
await pendingDispose;
assert.equal(pendingOutcome, 'disposed', 'disposal services an active-run pending frame instead of waiting on it before finish');
assert.deepEqual(
  pendingDrainEvents.slice(0, 3),
  ['stop-admission', 'await-pending', 'stop'],
  'teardown stops admission, finishes the run, then awaits the pending frame before final stop',
);

console.log('Kimodo shared-device foreground host contracts passed');
