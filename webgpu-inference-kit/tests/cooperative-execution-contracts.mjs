import assert from 'node:assert/strict';

import {
  WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA,
  WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
  createWebGpuCooperativeExecution,
  defineWebGpuCooperativeBoundaryManifest,
} from '../src/index.js';

const ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';

function createManifest(overrides = {}) {
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: 'sharp.production-cooperative-boundaries.v0',
    routeId: ROUTE_ID,
    phases: [
      {
        phaseId: 'feature-extraction',
        boundaries: [
          {
            boundaryId: 'spn-window-tiles',
            kind: 'gpu-command',
            unit: 'window-tile',
            totalItems: 8,
            progressWeight: 8,
            commandDutyKind: 'compute',
            chunking: {
              mode: 'adaptive',
              initialItems: 4,
              minItems: 1,
              maxItems: 8,
              targetDurationMs: 8,
            },
            yieldPolicy: 'after-duty',
            resources: {
              retain: ['spn.weights'],
              produce: ['spn.features'],
              release: [],
            },
          },
        ],
      },
      {
        phaseId: 'materialization',
        boundaries: [
          {
            boundaryId: 'ply-compose',
            kind: 'cpu-work',
            unit: 'gaussian-record',
            totalItems: 7,
            progressWeight: 2,
            hostPhase: 'presentation',
            chunking: {
              mode: 'fixed',
              chunkItems: 3,
            },
            yieldPolicy: 'after-duty',
            resources: {
              retain: ['gaussian.attributes'],
              produce: ['scene.ply'],
              release: ['gaussian.attributes'],
            },
          },
        ],
      },
    ],
    metadata: {
      source: 'sharp-production-route',
    },
    ...overrides,
  });
}

function createFakeRuntime({ calls, now, failedSettlementError = null }) {
  const queue = {
    submit(commandBuffers) {
      calls.push(`submit:${commandBuffers[0].rangeId}`);
    },
    async onSubmittedWorkDone() {
      calls.push('queue-fence');
    },
  };

  return {
    routeId: ROUTE_ID,
    runtimeLabel: 'sharp-contract-runtime',
    queue,
    hostPhases: {
      snapshot() {
        return { status: 'recording' };
      },
    },
    commandDuties: {
      async measureSubmission(descriptor, submit) {
        calls.push(`measure-submit:${descriptor.metadata.boundaryId}`);
        return submit();
      },
    },
    async runInvocation({ invocationId }, fn) {
      calls.push(`invocation-start:${invocationId}`);
      try {
        return await fn({
          invocationId,
          schedulerRevision: 3,
          scheduler: {
            mode: 'cooperative',
            yieldMs: 0,
            waitForSubmittedWorkDone: false,
            phaseChunkSize: {},
          },
          async yieldToBrowser(metadata) {
            calls.push(`yield:${metadata.metadata.boundaryId}`);
            return { reason: metadata.reason, elapsedMs: 0 };
          },
        });
      } finally {
        calls.push(`invocation-end:${invocationId}`);
      }
    },
    async prepareCommandDutyAtBoundary(descriptor) {
      calls.push(`prepare:${descriptor.metadata.boundaryId}:${descriptor.metadata.rangeIndex}`);
      return {
        ...descriptor,
        dutyId: `duty:${descriptor.metadata.boundaryId}:${descriptor.metadata.rangeIndex}`,
      };
    },
    settleCommandDuty(descriptor, settlement) {
      calls.push(`settle:${descriptor.metadata.boundaryId}:${settlement.status}`);
      if (settlement.status === 'failed-before-encode' && failedSettlementError) {
        throw failedSettlementError;
      }
      return descriptor;
    },
    async runHostPhase(phase, work) {
      calls.push(`host-start:${phase}`);
      try {
        return await work();
      } finally {
        calls.push(`host-end:${phase}`);
      }
    },
    now,
  };
}

const manifest = createManifest();
assert.equal(manifest.schema, WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.phases), true);
assert.equal(Object.isFrozen(manifest.phases[0].boundaries[0].resources.retain), true);
assert.equal(manifest.progressWeight, 10);
assert.deepEqual(
  manifest.phases.map(phase => [phase.phaseId, phase.progressWeight]),
  [['feature-extraction', 8], ['materialization', 2]],
);
assert.throws(
  () => { manifest.phases[0].boundaries[0].totalItems = 99; },
  /read only|readonly|not extensible|Cannot assign/i,
);

for (const invalid of [
  { manifestId: '' },
  { routeId: '' },
  { phases: [] },
  {
    phases: [
      ...manifest.phases,
      {
        phaseId: 'duplicate-boundary',
        boundaries: [{ ...manifest.phases[0].boundaries[0] }],
      },
    ],
  },
]) {
  assert.throws(() => createManifest(invalid));
}

assert.throws(
  () => createManifest({
    phases: [{
      phaseId: 'bad-kind',
      boundaries: [{
        ...manifest.phases[0].boundaries[0],
        kind: 'magic',
      }],
    }],
  }),
  /kind/,
);
assert.throws(
  () => createManifest({
    phases: [{
      phaseId: 'hidden-cap',
      boundaries: [{
        ...manifest.phases[0].boundaries[0],
        maxRanges: 10,
      }],
    }],
  }),
  /unsupported|maxRanges/i,
  'the public manifest must not admit a silent range cap',
);

const calls = [];
let nowMs = 100;
const now = () => {
  nowMs += 1;
  return nowMs;
};
const progressEvents = [];
const runtime = createFakeRuntime({ calls, now });
const execution = createWebGpuCooperativeExecution({
  runtime,
  manifest,
  invocationId: 'sharp:firing:cooperative',
  schedulingMode: 'cooperative',
  onProgress(progress) {
    progressEvents.push(progress);
  },
  now,
});

assert.deepEqual(execution.progress(), {
  schema: 'kaminos.webgpu-cooperative-progress.v0',
  routeId: ROUTE_ID,
  invocationId: 'sharp:firing:cooperative',
  status: 'pending',
  completedItems: 0,
  totalItems: 15,
  progress: 0,
  percent: 0,
  completedWeight: 0,
  totalWeight: 10,
  currentPhaseId: null,
  currentBoundaryId: null,
  phases: [
    {
      phaseId: 'feature-extraction',
      status: 'pending',
      completedItems: 0,
      totalItems: 8,
      progress: 0,
      percent: 0,
      completedWeight: 0,
      totalWeight: 8,
    },
    {
      phaseId: 'materialization',
      status: 'pending',
      completedItems: 0,
      totalItems: 7,
      progress: 0,
      percent: 0,
      completedWeight: 0,
      totalWeight: 2,
    },
  ],
});

const output = await execution.run(async cooperative => {
  const gpu = cooperative.startBoundary('spn-window-tiles');
  let range;
  while ((range = gpu.nextRange()) != null) {
    await gpu.runGpuDuty(range, {
      encode({ commandDuty, range: exactRange }) {
        calls.push(`encode:${exactRange.rangeIndex}`);
        assert.equal(commandDuty.metadata.boundaryId, 'spn-window-tiles');
        return { rangeId: exactRange.rangeId };
      },
      submit(commandBuffer) {
        runtime.queue.submit([commandBuffer]);
      },
    });
  }

  const cpu = cooperative.startBoundary('ply-compose');
  while ((range = cpu.nextRange()) != null) {
    await cpu.runCpuDuty(range, {
      work({ range: exactRange }) {
        calls.push(`cpu:${exactRange.itemStart}-${exactRange.itemEnd}`);
      },
    });
  }
  return 'coherent-ply';
});

assert.equal(output, 'coherent-ply');
const report = execution.finish();
assert.equal(report.schema, WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA);
assert.equal(report.status, 'succeeded');
assert.equal(report.schedulingMode, 'cooperative');
assert.equal(report.queueCompletionAuthority, 'per-gpu-duty-prefix-fence');
assert.equal(report.progress.progress, 1);
assert.equal(report.progress.percent, 100);
assert.equal(report.boundaries[0].actualRangeCount, 2);
assert.equal(report.boundaries[1].actualRangeCount, 3);
assert.equal(report.boundaries[0].rangeCountAuthority, 'actual');
assert.equal(report.boundaries[1].rangeCountAuthority, 'actual');
assert.equal(report.failure, null);
assert.equal(progressEvents.length, 5);
assert.equal(progressEvents.at(-1).percent, 100);
assert.ok(progressEvents.every(event => event.totalItems === 15));
assert.ok(progressEvents.every(event => Number.isFinite(event.percent)));
assert.deepEqual(
  calls.slice(0, 9),
  [
    'invocation-start:sharp:firing:cooperative',
    'prepare:spn-window-tiles:0',
    'encode:0',
    'settle:spn-window-tiles:encoded',
    'measure-submit:spn-window-tiles',
    'submit:sharp:firing:cooperative:spn-window-tiles:range:0',
    'queue-fence',
    'yield:spn-window-tiles',
    'prepare:spn-window-tiles:1',
  ],
  'a cooperative GPU duty must prepare, encode, settle, submit, fence, then yield',
);

const disabledCalls = [];
let disabledNowMs = 0;
const disabledNow = () => {
  disabledNowMs += 1;
  return disabledNowMs;
};
const disabledRuntime = createFakeRuntime({ calls: disabledCalls, now: disabledNow });
const disabled = createWebGpuCooperativeExecution({
  runtime: disabledRuntime,
  manifest,
  invocationId: 'sharp:firing:disabled',
  schedulingMode: 'disabled',
  now: disabledNow,
});
await disabled.run(async cooperative => {
  const gpu = cooperative.startBoundary('spn-window-tiles');
  let range;
  while ((range = gpu.nextRange()) != null) {
    await gpu.runGpuDuty(range, {
      encode({ range: exactRange }) {
        return { rangeId: exactRange.rangeId };
      },
      submit(commandBuffer) {
        disabledRuntime.queue.submit([commandBuffer]);
      },
    });
  }
  const cpu = cooperative.startBoundary('ply-compose');
  while ((range = cpu.nextRange()) != null) {
    await cpu.runCpuDuty(range, { work() {} });
  }
});
const disabledReport = disabled.finish();
assert.equal(disabledReport.status, 'succeeded');
assert.equal(disabledReport.schedulingMode, 'disabled');
assert.equal(disabledReport.queueCompletionAuthority, 'one-terminal-prefix-fence');
assert.equal(disabledReport.progress.progress, 1);
assert.equal(disabledCalls.filter(call => call.startsWith('prepare:')).length, 0);
assert.equal(disabledCalls.filter(call => call.startsWith('yield:')).length, 0);
assert.equal(disabledCalls.filter(call => call === 'queue-fence').length, 1);
assert.equal(disabledCalls.filter(call => call.startsWith('measure-submit:')).length, 2);

const failureCalls = [];
let failureNowMs = 0;
const failureNow = () => {
  failureNowMs += 1;
  return failureNowMs;
};
const failed = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: failureCalls, now: failureNow }),
  manifest,
  invocationId: 'sharp:firing:encode-failure',
  schedulingMode: 'cooperative',
  now: failureNow,
});
await assert.rejects(
  () => failed.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        throw new Error('shader binding mismatch');
      },
      submit() {
        assert.fail('failed encoding must not submit');
      },
    });
  }),
  error => {
    assert.match(error.message, /shader binding mismatch/);
    assert.equal(error.cooperativeExecutionReport.status, 'failed');
    assert.equal(error.cooperativeExecutionReport.failure.phase, 'command-encoding');
    assert.equal(error.cooperativeExecutionReport.progress.completedItems, 0);
    return true;
  },
);
assert.ok(
  failureCalls.includes('settle:spn-window-tiles:failed-before-encode'),
  'an encode failure must settle the scheduler boundary instead of leaking it',
);
assert.equal(failed.snapshot().status, 'failed');

const doubleFailureCalls = [];
let doubleFailureNowMs = 0;
const doubleFailureNow = () => {
  doubleFailureNowMs += 1;
  return doubleFailureNowMs;
};
const doubleFailure = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({
    calls: doubleFailureCalls,
    now: doubleFailureNow,
    failedSettlementError: new Error('settlement sink down'),
  }),
  manifest,
  invocationId: 'sharp:firing:encode-and-settlement-failure',
  schedulingMode: 'cooperative',
  now: doubleFailureNow,
});
await assert.rejects(
  () => doubleFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        throw new Error('encode blew');
      },
      submit() {
        assert.fail('double failure must not submit');
      },
    });
  }),
  error => {
    assert.equal(error.message, 'encode blew', 'scheduler settlement must not mask the model failure');
    const failureReport = error.cooperativeExecutionReport;
    assert.equal(failureReport.status, 'failed');
    assert.equal(failureReport.failure.phase, 'command-encoding');
    assert.equal(failureReport.failure.boundaryId, 'spn-window-tiles');
    assert.equal(failureReport.failure.error.message, 'encode blew');
    assert.deepEqual(failureReport.failure.secondaryFailures, [{
      phase: 'scheduler-settlement',
      error: {
        name: 'Error',
        message: 'settlement sink down',
      },
    }]);
    assert.equal(failureReport.boundaries[0].status, 'failed');
    assert.equal(failureReport.boundaries[0].failure.error.message, 'encode blew');
    assert.equal(failureReport.boundaries[0].planner.status, 'failed');
    assert.equal(failureReport.boundaries[0].planner.pendingRangeId, null);
    assert.equal(failureReport.boundaries[0].ranges[0].status, 'failed');
    return true;
  },
);

const cancellation = new AbortController();
const cancelledCalls = [];
let cancelledNowMs = 0;
const cancelledNow = () => {
  cancelledNowMs += 1;
  return cancelledNowMs;
};
const cancelled = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: cancelledCalls, now: cancelledNow }),
  manifest,
  invocationId: 'sharp:firing:cancelled',
  schedulingMode: 'cooperative',
  signal: cancellation.signal,
  now: cancelledNow,
});
await assert.rejects(
  () => cancelled.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode({ range: exactRange }) {
        return { rangeId: exactRange.rangeId };
      },
      submit() {},
    });
    cancellation.abort('operator-cancelled');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        assert.fail('cancelled execution must not encode more work');
      },
      submit() {},
    });
  }),
  error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.cooperativeExecutionReport.status, 'cancelled');
    assert.equal(error.cooperativeExecutionReport.failure.phase, 'cancellation');
    assert.equal(error.cooperativeExecutionReport.progress.completedItems, 4);
    return true;
  },
);

const incomplete = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: [], now }),
  manifest,
  invocationId: 'sharp:firing:incomplete',
  schedulingMode: 'cooperative',
  now,
});
await assert.rejects(
  () => incomplete.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode({ range: exactRange }) {
        return { rangeId: exactRange.rangeId };
      },
      submit() {},
    });
  }),
  error => {
    assert.match(error.message, /incomplete cooperative boundaries/i);
    assert.equal(error.cooperativeExecutionReport.status, 'failed');
    assert.equal(error.cooperativeExecutionReport.failure.phase, 'completion');
    return true;
  },
);

const dynamicManifest = createManifest({
  phases: [{
    phaseId: 'dynamic',
    boundaries: [{
      ...manifest.phases[0].boundaries[0],
      boundaryId: 'dynamic-tiles',
      totalItems: null,
    }],
  }],
});
const dynamic = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: [], now }),
  manifest: dynamicManifest,
  invocationId: 'sharp:firing:dynamic',
  schedulingMode: 'cooperative',
  now,
});
assert.equal(dynamic.progress().totalItems, null);
assert.equal(dynamic.progress().progress, null);
await dynamic.run(async cooperative => {
  const boundary = cooperative.startBoundary('dynamic-tiles', { totalItems: 1 });
  await boundary.runGpuDuty(boundary.nextRange(), {
    encode({ range: exactRange }) {
      return { rangeId: exactRange.rangeId };
    },
    submit() {},
  });
});
assert.equal(dynamic.finish().progress.percent, 100);

console.log('cooperative execution contracts passed');
