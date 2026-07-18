import assert from 'node:assert/strict';

import {
  FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
  WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA,
  WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
  createWebGpuForegroundOpportunityInterlock,
  createWebGpuInferenceRuntime,
  createWebGpuSchedulerApplication,
} from '../src/index.js';

let nowMs = 0;
const now = () => {
  nowMs += 1;
  return nowMs;
};

const submissions = [];
const queue = {
  submit(commandBuffers) {
    submissions.push(commandBuffers.map(commandBuffer => commandBuffer.label));
  },
};
const device = {
  queue,
  features: new Set(),
  limits: {},
};

const interlock = createWebGpuForegroundOpportunityInterlock({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'foreground-opportunity-contract-a',
  device,
  queue,
  now,
});

assert.equal(interlock.schema, WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA);
assert.equal(interlock.snapshot().retention, 'uncapped');

const idle = await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-idle',
  dutyId: 'sharp-duty-idle',
  phase: 'spn-fusion',
  position: 'before-encode',
});
assert.equal(idle.status, 'no-demand');
assert.equal(idle.capturedRequestCount, 0);

let deferredRequest;
const firstRequest = interlock.request({
  requestId: 'foreground-frame-1',
  metadata: { frameId: 'frame-1' },
  async run(opportunity) {
    assert.equal(opportunity.device, device);
    assert.equal(opportunity.queue, queue);
    assert.equal(opportunity.boundary.boundaryId, 'sharp-boundary-a');
    opportunity.submit([{ label: 'foreground-frame-1-command' }], {
      submissionId: 'foreground-frame-1-submit',
      metadata: { renderer: 'kiln-flame' },
    });
    deferredRequest = interlock.request({
      requestId: 'foreground-frame-2',
      run(nextOpportunity) {
        nextOpportunity.submit([{ label: 'foreground-frame-2-command' }], {
          submissionId: 'foreground-frame-2-submit',
        });
      },
    });
    return { frameId: 'frame-1' };
  },
});

const firstService = await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-a',
  dutyId: 'sharp-duty-a',
  phase: 'spn-fusion',
  position: 'before-encode',
});
assert.equal(firstService.status, 'serviced');
assert.equal(firstService.capturedRequestCount, 1);
assert.equal(firstService.servicedRequestCount, 1);
assert.deepEqual(submissions, [['foreground-frame-1-command']]);
assert.equal(interlock.snapshot().pendingRequestCount, 1);

const firstReceipt = await firstRequest.completion;
assert.equal(firstReceipt.schema, WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA);
assert.equal(firstReceipt.status, 'completed');
assert.equal(firstReceipt.submissionCount, 1);
assert.equal(firstReceipt.submissions[0].submissionId, 'foreground-frame-1-submit');
assert.equal(firstReceipt.submissions[0].submissionStatus, 'queue-submit-returned');
assert.equal(
  firstReceipt.authority,
  'foreground-callback-and-queue-submission-observed-no-gpu-completion-or-presentation-claim',
);

const secondService = await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-b',
  dutyId: 'sharp-duty-b',
  phase: 'gaussian-assembly',
  position: 'before-encode',
});
assert.equal(secondService.servicedRequestCount, 1);
assert.deepEqual(submissions.at(-1), ['foreground-frame-2-command']);
assert.equal((await deferredRequest.completion).status, 'completed');

let canceledCallbackRan = false;
const canceled = interlock.request({
  requestId: 'foreground-frame-canceled',
  run() { canceledCallbackRan = true; },
});
assert.equal(canceled.cancel('foreground-frame-superseded').status, 'canceled-before-service');
assert.equal((await canceled.completion).status, 'canceled-before-service');
await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-c',
  dutyId: 'sharp-duty-c',
  phase: 'gaussian-assembly',
  position: 'before-encode',
});
assert.equal(canceledCallbackRan, false);

let activeOpportunity;
let releaseActiveOpportunity;
let markActiveOpportunityStarted;
const activeOpportunityStarted = new Promise(resolve => { markActiveOpportunityStarted = resolve; });
const activeCancellation = interlock.request({
  requestId: 'foreground-frame-active-cancellation',
  async run(opportunity) {
    activeOpportunity = opportunity;
    markActiveOpportunityStarted();
    await new Promise(resolve => { releaseActiveOpportunity = resolve; });
  },
});
const activeCancellationService = interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-active-cancellation',
  dutyId: 'sharp-duty-active-cancellation',
  phase: 'gaussian-assembly',
  position: 'before-encode',
});
await activeOpportunityStarted;
assert.equal(
  activeCancellation.cancel('foreground-route-closed').status,
  'cancellation-requested',
);
assert.equal(activeOpportunity.signal.aborted, true);
assert.equal(activeOpportunity.signal.reason, 'foreground-route-closed');
assert.throws(
  () => activeOpportunity.submit([{ label: 'stale-foreground-command' }]),
  /canceled/i,
);
releaseActiveOpportunity();
assert.equal((await activeCancellationService).status, 'serviced');
const activeCancellationReceipt = await activeCancellation.completion;
assert.equal(activeCancellationReceipt.status, 'canceled-during-service');
assert.equal(activeCancellationReceipt.cancellation.reason, 'foreground-route-closed');
assert.equal(activeCancellationReceipt.submissionCount, 0);

const cyclicResult = {};
cyclicResult.self = cyclicResult;
const unserializable = interlock.request({
  requestId: 'foreground-frame-unserializable-result',
  run() { return cyclicResult; },
});
const unserializableService = await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-unserializable-result',
  dutyId: 'sharp-duty-unserializable-result',
  phase: 'gaussian-assembly',
  position: 'before-encode',
});
assert.equal(unserializableService.status, 'failed');
const unserializableReceipt = await unserializable.completion;
assert.equal(unserializableReceipt.status, 'failed-before-submission');
assert.equal(unserializableReceipt.failure.phase, 'foreground-result-serialization');
assert.match(unserializableReceipt.failure.error.message, /circular|serialize|json/i);

const failed = interlock.request({
  requestId: 'foreground-frame-failed',
  run(opportunity) {
    opportunity.submit([{ label: 'foreground-frame-failed-command' }], {
      submissionId: 'foreground-frame-failed-submit',
    });
    throw new Error('foreground renderer exploded');
  },
});
const failedService = await interlock.serviceAtBoundary({
  invocationId: 'sharp-invocation-a',
  boundaryId: 'sharp-boundary-d',
  dutyId: 'sharp-duty-d',
  phase: 'gaussian-assembly',
  position: 'before-encode',
});
assert.equal(failedService.status, 'failed');
assert.equal(failedService.failures[0].requestId, 'foreground-frame-failed');
const failedReceipt = await failed.completion;
assert.equal(failedReceipt.status, 'failed-after-submission');
assert.equal(failedReceipt.failure.phase, 'foreground-callback');
assert.match(failedReceipt.failure.error.message, /renderer exploded/);
assert.equal(failedReceipt.submissionCount, 1);

assert.throws(
  () => interlock.request({ requestId: 'foreground-frame-1', run() {} }),
  /duplicate foreground opportunity request/i,
);
await assert.rejects(
  () => interlock.serviceAtBoundary({
    invocationId: 'sharp-invocation-a',
    boundaryId: 'wrong-position',
    dutyId: 'sharp-duty-wrong-position',
    phase: 'spn-fusion',
    position: 'after-submit',
  }),
  /before-encode/i,
);

let releaseSerializedFirst;
let markSerializedFirstStarted;
const serializedFirstStarted = new Promise(resolve => { markSerializedFirstStarted = resolve; });
let serializedSecondStarted = false;
const serializedInterlock = createWebGpuForegroundOpportunityInterlock({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'foreground-opportunity-serialized-services',
  device,
  queue,
  now,
});
serializedInterlock.request({
  requestId: 'serialized-foreground-frame-1',
  async run() {
    markSerializedFirstStarted();
    await new Promise(resolve => { releaseSerializedFirst = resolve; });
  },
});
const serializedFirstService = serializedInterlock.serviceAtBoundary({
  invocationId: 'sharp-serialized-invocation-a',
  boundaryId: 'sharp-serialized-boundary-a',
  dutyId: 'sharp-serialized-duty-a',
  phase: 'spn-fusion',
  position: 'before-encode',
});
await serializedFirstStarted;
serializedInterlock.request({
  requestId: 'serialized-foreground-frame-2',
  run() { serializedSecondStarted = true; },
});
const serializedSecondService = serializedInterlock.serviceAtBoundary({
  invocationId: 'sharp-serialized-invocation-b',
  boundaryId: 'sharp-serialized-boundary-b',
  dutyId: 'sharp-serialized-duty-b',
  phase: 'vit-block',
  position: 'before-encode',
});
await Promise.resolve();
assert.equal(
  serializedSecondStarted,
  false,
  'a later boundary must not service or encode through an active foreground service turn',
);
assert.equal(serializedInterlock.snapshot().activeServiceCount, 1);
assert.equal(serializedInterlock.snapshot().queuedServiceCount, 1);
releaseSerializedFirst();
assert.equal((await serializedFirstService).status, 'serviced');
assert.equal((await serializedSecondService).status, 'serviced');
assert.equal(serializedSecondStarted, true);
assert.equal(serializedInterlock.snapshot().activeServiceCount, 0);
assert.equal(serializedInterlock.snapshot().queuedServiceCount, 0);

const runtimeSubmissions = [];
const runtimeQueue = {
  submit(commandBuffers) {
    runtimeSubmissions.push(commandBuffers.map(commandBuffer => commandBuffer.label));
  },
};
const runtimeDevice = {
  queue: runtimeQueue,
  features: new Set(),
  limits: {},
  createCommandEncoder() {
    return {
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups() {},
          end() {},
        };
      },
      finish() { return { label: 'inference-command' }; },
    };
  },
};

const externalSnapshot = () => ({
  schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'external-foreground-opportunities',
  retention: 'uncapped',
  requestCount: 0,
  pendingRequestCount: 0,
  activeRequestCount: 0,
  activeServiceCount: 0,
  queuedServiceCount: 0,
  receiptCount: 0,
  serviceCount: 0,
  noDemandBoundaryCount: 0,
});
const externalMethods = {
  request() {},
  async serviceAtBoundary() {},
  snapshot: externalSnapshot,
  finish() {},
};
await assert.rejects(
  () => createWebGpuInferenceRuntime({
    routeId: 'sharp.image-to-splat.webgpu-local.v0',
    runtimeLabel: 'invalid-external-foreground-missing-finish',
    device: runtimeDevice,
    queue: runtimeQueue,
    adapterName: 'Invalid External Foreground Interlock',
    kernel: { profile: 'invalid-external-foreground-interlock' },
    foregroundOpportunities: {
      ...externalMethods,
      finish: undefined,
    },
  }),
  /finish/i,
);
await assert.rejects(
  () => createWebGpuInferenceRuntime({
    routeId: 'sharp.image-to-splat.webgpu-local.v0',
    runtimeLabel: 'invalid-external-foreground-snapshot',
    device: runtimeDevice,
    queue: runtimeQueue,
    adapterName: 'Invalid External Foreground Snapshot',
    kernel: { profile: 'invalid-external-foreground-snapshot' },
    foregroundOpportunities: {
      ...externalMethods,
      snapshot() {
        const snapshot = externalSnapshot();
        delete snapshot.pendingRequestCount;
        return snapshot;
      },
    },
  }),
  /pendingRequestCount/i,
);
let externalSnapshotIsValid = true;
const mutableExternalRuntime = await createWebGpuInferenceRuntime({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runtimeLabel: 'mutable-external-foreground-snapshot',
  device: runtimeDevice,
  queue: runtimeQueue,
  adapterName: 'Mutable External Foreground Snapshot',
  kernel: { profile: 'mutable-external-foreground-snapshot' },
  foregroundOpportunities: {
    ...externalMethods,
    snapshot() {
      const snapshot = externalSnapshot();
      if (!externalSnapshotIsValid) snapshot.activeServiceCount = -1;
      return snapshot;
    },
  },
});
externalSnapshotIsValid = false;
assert.throws(
  () => mutableExternalRuntime.foregroundOpportunitySnapshot(),
  /activeServiceCount.*non-negative integer/i,
);
const schedulerApplication = createWebGpuSchedulerApplication({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  scheduler: {
    mode: 'cooperative',
    yieldMs: 0,
    waitForSubmittedWorkDone: false,
    phaseChunkSize: { spnFusionOutputItems: 8 },
  },
  bounds: {
    yieldMs: { min: 0, max: 16, step: 1 },
    phaseChunkSize: {
      spnFusionOutputItems: { min: 1, max: 16, stepFactor: 2 },
    },
  },
});
const runtime = await createWebGpuInferenceRuntime({
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runtimeLabel: 'sharp-foreground-interleave-contract',
  device: runtimeDevice,
  queue: runtimeQueue,
  adapterName: 'Foreground Opportunity Adapter',
  kernel: { profile: 'sharp-foreground-opportunity-contract' },
  schedulerApplication,
  foregroundOpportunities: {
    runId: 'sharp-foreground-opportunity-runtime-a',
    now,
  },
});

let releaseRuntimeForeground;
let markRuntimeForegroundStarted;
const runtimeForegroundStarted = new Promise(resolve => { markRuntimeForegroundStarted = resolve; });
runtime.requestForegroundOpportunity({
  requestId: 'runtime-serialized-foreground-frame',
  async run() {
    markRuntimeForegroundStarted();
    await new Promise(resolve => { releaseRuntimeForeground = resolve; });
  },
});
const runtimeInvocationA = runtime.runInvocation(
  { invocationId: 'runtime-serialized-invocation-a' },
  context => runtime.runKernel({
    name: 'serialized-spn-fusion-a',
    pipeline: {},
    bindGroup: {},
    bindings: [],
  }, {
    schedulerInvocation: context,
    dispatch: [1],
  }),
);
await runtimeForegroundStarted;
assert.throws(
  () => runtime.prepareCommandDuty({ phase: 'raw-adapter-bypass' }),
  /prepareCommandDutyAtBoundary/i,
);
let secondInferenceEncoded = false;
const runtimeInvocationB = runtime.runInvocation(
  { invocationId: 'runtime-serialized-invocation-b' },
  context => runtime.runKernel({
    name: 'serialized-vit-block-b',
    pipeline: {},
    bindGroup: {},
    bindings: [],
  }, {
    schedulerInvocation: context,
    dispatch() {
      secondInferenceEncoded = true;
      return [1];
    },
  }),
);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(
  secondInferenceEncoded,
  false,
  'a concurrent inference invocation must wait for the active foreground service turn',
);
releaseRuntimeForeground();
await Promise.all([runtimeInvocationA, runtimeInvocationB]);
assert.equal(secondInferenceEncoded, true);

const runtimeFrame = runtime.requestForegroundOpportunity({
  requestId: 'runtime-foreground-frame-1',
  run(opportunity) {
    opportunity.submit([{ label: 'runtime-foreground-command' }], {
      submissionId: 'runtime-foreground-submit-1',
    });
    runtime.applySchedulerDecision({
      schema: FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
      routeId: 'sharp.image-to-splat.webgpu-local.v0',
      status: 'adjusted',
      action: 'reduce-phase-chunk',
      target: 'spnFusionOutputItems',
      schedulerChanged: true,
      applicationAuthority: 'decision-state-only-not-runtime-application',
      revision: 1,
      previousScheduler: {
        mode: 'cooperative',
        yieldMs: 0,
        waitForSubmittedWorkDone: false,
        phaseChunkSize: { spnFusionOutputItems: 8 },
      },
      effectiveScheduler: {
        mode: 'cooperative',
        yieldMs: 0,
        waitForSubmittedWorkDone: false,
        phaseChunkSize: { spnFusionOutputItems: 4 },
      },
      failures: [],
    });
  },
});
await runtime.runInvocation({ invocationId: 'runtime-sharp-invocation-a' }, context => runtime.runKernel({
  name: 'spn-fusion',
  pipeline: {},
  bindGroup: {},
  bindings: [],
}, {
  schedulerInvocation: context,
  commandDuty: {
    chunkControl: {
      controlId: 'spnFusionOutputItems',
      unit: 'output-item',
      current: 8,
      bounds: { min: 1, max: 16, stepFactor: 2 },
    },
  },
  dispatch({ commandDuty }) {
    assert.equal(
      commandDuty.chunkControl.current,
      4,
      'a scheduler decision produced by foreground work must govern the immediately following inference duty',
    );
    return [1];
  },
}));
assert.deepEqual(runtimeSubmissions.slice(-2), [
  ['runtime-foreground-command'],
  ['inference-command'],
]);
assert.equal((await runtimeFrame.completion).status, 'completed');
assert.equal(runtime.finishForegroundOpportunities().status, 'succeeded');

const runtimeFailure = runtime.requestForegroundOpportunity({
  requestId: 'runtime-foreground-frame-failed',
  run() { throw new Error('runtime foreground callback failed'); },
});
await assert.rejects(
  runtime.runInvocation({ invocationId: 'runtime-sharp-invocation-b' }, context => runtime.runKernel({
    name: 'spn-fusion',
    pipeline: {},
    bindGroup: {},
    bindings: [],
  }, {
    schedulerInvocation: context,
    commandDuty: {
      chunkControl: {
        controlId: 'spnFusionOutputItems',
        unit: 'output-item',
        current: 8,
        bounds: { min: 1, max: 16, stepFactor: 2 },
      },
    },
    dispatch: [1],
  })),
  /runtime foreground callback failed/i,
);
assert.equal((await runtimeFailure.completion).status, 'failed-before-submission');
const failedBoundary = runtime.schedulerSnapshot().boundaries
  .find(boundary => boundary.invocationId === 'runtime-sharp-invocation-b');
assert.equal(failedBoundary.status, 'failed-before-encode');
assert.equal(failedBoundary.failure.phase, 'foreground-opportunity');
assert.equal(failedBoundary.submissionStatus, 'not-submitted');

console.log('foreground opportunity contracts passed');
