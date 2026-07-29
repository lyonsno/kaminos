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
              adjustmentGain: 0.375,
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

function createFakeRuntime({
  calls,
  now,
  failedSettlementError = null,
  browserYieldError = null,
  submissionRecorderError = null,
  duplicateSubmission = false,
}) {
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
        const result = await submit();
        if (duplicateSubmission) await submit();
        if (submissionRecorderError) throw submissionRecorderError;
        return result;
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
            if (browserYieldError) throw browserYieldError;
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

const manifest = createManifest();
assert.equal(manifest.schema, WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.phases), true);
assert.equal(Object.isFrozen(manifest.phases[0].boundaries[0].resources.retain), true);
assert.equal(manifest.progressWeight, 10);
assert.equal(manifest.phases[0].boundaries[0].chunking.adjustmentGain, 0.375);
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

const legacySubmitCalls = [];
const legacySubmitRuntime = createFakeRuntime({ calls: legacySubmitCalls, now });
const legacySubmitExecution = createWebGpuCooperativeExecution({
  runtime: legacySubmitRuntime,
  manifest,
  invocationId: 'sharp:firing:legacy-submit-callback',
  schedulingMode: 'cooperative',
  now,
});
let legacySubmitRan = false;
await assert.rejects(
  legacySubmitExecution.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        return { rangeId: 'legacy-submit-buffer' };
      },
      submit(commandBuffer) {
        legacySubmitRan = true;
        legacySubmitRuntime.queue.submit([commandBuffer]);
        throw new Error('caller threw after cooperative queue submission');
      },
    });
  }),
  error => {
    assert.match(error.message, /submit callbacks are unsupported/);
    assert.equal(error.cooperativeExecutionReport.queueCompletionAuthority, 'no-gpu-duty-submitted');
    assert.equal(error.cooperativeExecutionReport.submittedGpuDutyCount, 0);
    assert.equal(error.cooperativeExecutionReport.boundaries[0].planner.pendingRangeId, null);
    return true;
  },
);
assert.equal(legacySubmitRan, false);
assert.equal(legacySubmitCalls.some(call => call.startsWith('submit:')), false);

const recorderFailureCalls = [];
const recorderFailureRuntime = createFakeRuntime({
  calls: recorderFailureCalls,
  now,
  submissionRecorderError: new Error('recorder failed after submission'),
});
const recorderFailureExecution = createWebGpuCooperativeExecution({
  runtime: recorderFailureRuntime,
  manifest,
  invocationId: 'sharp:firing:recorder-post-submit-failure',
  schedulingMode: 'cooperative',
  now,
});
await assert.rejects(
  recorderFailureExecution.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        return { rangeId: 'recorder-failure-buffer' };
      },
    });
  }),
  error => {
    assert.equal(error.message, 'recorder failed after submission');
    const failureReport = error.cooperativeExecutionReport;
    assert.equal(failureReport.failure.phase, 'queue-submission');
    assert.equal(failureReport.queueCompletionAuthority, 'per-gpu-duty-prefix-fence');
    assert.equal(failureReport.submittedGpuDutyCount, 1);
    assert.equal(failureReport.observedPrefixFenceCount, 1);
    assert.equal(failureReport.unfencedSubmittedGpuDutyCount, 0);
    return true;
  },
);
assert.ok(recorderFailureCalls.includes('queue-fence'));

const duplicateSubmissionCalls = [];
const duplicateSubmissionExecution = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({
    calls: duplicateSubmissionCalls,
    now,
    duplicateSubmission: true,
  }),
  manifest,
  invocationId: 'sharp:firing:duplicate-recorder-submit',
  schedulingMode: 'cooperative',
  now,
});
await assert.rejects(
  duplicateSubmissionExecution.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        return { rangeId: 'duplicate-recorder-buffer' };
      },
    });
  }),
  error => {
    assert.match(error.message, /duplicate GPU submission/);
    assert.equal(error.cooperativeExecutionReport.submittedGpuDutyCount, 1);
    assert.equal(error.cooperativeExecutionReport.observedPrefixFenceCount, 1);
    assert.equal(error.cooperativeExecutionReport.unfencedSubmittedGpuDutyCount, 0);
    return true;
  },
);
assert.equal(
  duplicateSubmissionCalls.filter(call => call.startsWith('submit:')).length,
  1,
);

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
assert.equal(report.completionPolicy, 'strict-prefix');
assert.equal(report.maxInFlightGpuDuties, 1);
assert.equal(report.queueCompletionAuthority, 'per-gpu-duty-prefix-fence');
assert.equal(report.progress.progress, 1);
assert.equal(report.progress.percent, 100);
assert.equal(report.boundaries[0].actualRangeCount, 2);
assert.equal(report.boundaries[1].actualRangeCount, 3);
assert.equal(report.boundaries[0].rangeCountAuthority, 'actual');
assert.equal(report.boundaries[1].rangeCountAuthority, 'actual');
assert.equal(report.boundaries[0].planner.requestedAdjustmentGain, 0.375);
assert.equal(report.boundaries[0].planner.effectiveAdjustmentGain, 0.375);
assert.ok(
  report.boundaries[0].planner.observations.every(
    observation => observation.effectiveAdjustmentGain === 0.375,
  ),
);
assert.equal(report.failure, null);
assert.equal(progressEvents.length, 5);
assert.equal(progressEvents.at(-1).percent, 100);
assert.ok(progressEvents.every(event => event.totalItems === 15));
assert.ok(progressEvents.every(event => Number.isFinite(event.percent)));

const defaultGainManifest = defineWebGpuCooperativeBoundaryManifest({
  manifestId: 'sharp.default-gain.v0',
  routeId: ROUTE_ID,
  phases: [{
    phaseId: 'feature-extraction',
    boundaries: [{
      boundaryId: 'default-gain-boundary',
      kind: 'gpu-command',
      unit: 'window-tile',
      totalItems: 8,
      progressWeight: 1,
      commandDutyKind: 'compute',
      chunking: {
        mode: 'adaptive',
        initialItems: 4,
        minItems: 1,
        maxItems: 8,
        targetDurationMs: 8,
      },
      yieldPolicy: 'after-duty',
    }],
  }],
});
assert.equal(defaultGainManifest.phases[0].boundaries[0].chunking.adjustmentGain, 1);
for (const adjustmentGain of [0, -0.25, 1.01, Number.NaN, null, '0.375', true, false]) {
  assert.throws(
    () => defineWebGpuCooperativeBoundaryManifest({
      manifestId: `sharp.invalid-gain.${String(adjustmentGain)}`,
      routeId: ROUTE_ID,
      phases: [{
        phaseId: 'feature-extraction',
        boundaries: [{
          ...defaultGainManifest.phases[0].boundaries[0],
          chunking: {
            ...defaultGainManifest.phases[0].boundaries[0].chunking,
            adjustmentGain,
          },
        }],
      }],
    }),
    /adjustmentGain/,
  );
}
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

const progressFailureCalls = [];
let progressFailureNowMs = 0;
const progressFailureNow = () => {
  progressFailureNowMs += 1;
  return progressFailureNowMs;
};
const progressFailure = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({
    calls: progressFailureCalls,
    now: progressFailureNow,
  }),
  manifest,
  invocationId: 'sharp:firing:progress-callback-failure',
  schedulingMode: 'cooperative',
  onProgress() {
    throw new Error('progress sink down');
  },
  now: progressFailureNow,
});
await assert.rejects(
  () => progressFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode({ range: exactRange }) {
        return { rangeId: exactRange.rangeId };
      },
    });
  }),
  error => {
    assert.equal(error.message, 'progress sink down');
    const failureReport = error.cooperativeExecutionReport;
    assert.equal(failureReport.status, 'failed');
    assert.equal(failureReport.failure.phase, 'progress-callback');
    assert.equal(failureReport.failure.boundaryId, 'spn-window-tiles');
    assert.equal(failureReport.failure.error.message, 'progress sink down');
    assert.equal(failureReport.boundaries[0].status, 'failed');
    assert.equal(failureReport.boundaries[0].failure.phase, 'progress-callback');
    assert.equal(failureReport.boundaries[0].completedItems, 4);
    assert.equal(failureReport.boundaries[0].ranges[0].status, 'observed');
    assert.equal(failureReport.boundaries[0].planner.pendingRangeId, null);
    assert.equal(failureReport.progress.completedItems, 4);
    return true;
  },
);

const yieldFailureCalls = [];
let yieldFailureNowMs = 0;
const yieldFailureNow = () => {
  yieldFailureNowMs += 1;
  return yieldFailureNowMs;
};
const yieldFailure = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({
    calls: yieldFailureCalls,
    now: yieldFailureNow,
    browserYieldError: new Error('browser yield sink down'),
  }),
  manifest,
  invocationId: 'sharp:firing:browser-yield-failure',
  schedulingMode: 'cooperative',
  now: yieldFailureNow,
});
await assert.rejects(
  () => yieldFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('spn-window-tiles');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode({ range: exactRange }) {
        return { rangeId: exactRange.rangeId };
      },
    });
  }),
  error => {
    assert.equal(error.message, 'browser yield sink down');
    const failureReport = error.cooperativeExecutionReport;
    assert.equal(failureReport.status, 'failed');
    assert.equal(failureReport.failure.phase, 'browser-yield');
    assert.equal(failureReport.failure.boundaryId, 'spn-window-tiles');
    assert.equal(failureReport.failure.error.message, 'browser yield sink down');
    assert.equal(failureReport.boundaries[0].status, 'failed');
    assert.equal(failureReport.boundaries[0].failure.phase, 'browser-yield');
    assert.equal(failureReport.boundaries[0].completedItems, 4);
    assert.equal(failureReport.boundaries[0].ranges[0].status, 'observed');
    assert.equal(failureReport.boundaries[0].planner.pendingRangeId, null);
    assert.equal(failureReport.progress.completedItems, 4);
    return true;
  },
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
    });
    cancellation.abort('operator-cancelled');
    await gpu.runGpuDuty(gpu.nextRange(), {
      encode() {
        assert.fail('cancelled execution must not encode more work');
      },
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
  });
});
assert.equal(dynamic.finish().progress.percent, 100);

const boundedManifest = defineWebGpuCooperativeBoundaryManifest({
  manifestId: 'sf3d.fixed-channel-ranges.v0',
  routeId: ROUTE_ID,
  phases: [{
    phaseId: 'texture-bake',
    boundaries: [{
      boundaryId: 'texture-bake-channel-ranges',
      kind: 'gpu-command',
      unit: 'channel-range',
      totalItems: 3,
      progressWeight: 1,
      commandDutyKind: 'compute',
      chunking: {
        mode: 'fixed',
        chunkItems: 1,
      },
      yieldPolicy: 'after-duty',
      resources: {
        retain: ['sf3d.texture-atlas'],
        produce: ['sf3d.baked-texture'],
        release: [],
      },
    }],
  }],
});
const boundedCalls = [];
const boundedFences = [];
const boundedProgress = [];
let boundedNowMs = 0;
const boundedNow = () => {
  boundedNowMs += 1;
  return boundedNowMs;
};
const boundedRuntime = createFakeRuntime({
  calls: boundedCalls,
  now: boundedNow,
});
boundedRuntime.queue.onSubmittedWorkDone = () => {
  const fence = createDeferred();
  boundedFences.push(fence);
  boundedCalls.push(`queue-fence:${boundedFences.length - 1}`);
  return fence.promise;
};
const bounded = createWebGpuCooperativeExecution({
  runtime: boundedRuntime,
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  onProgress(progress) {
    boundedProgress.push(progress);
  },
  now: boundedNow,
});
await bounded.run(async cooperative => {
  const gpu = cooperative.startBoundary('texture-bake-channel-ranges');

  const first = gpu.nextRange();
  const firstAdmission = gpu.runGpuDuty(first, {
    encode({ range }) {
      return { rangeId: range.rangeId };
    },
  });
  await waitFor(
    () => boundedFences.length === 1,
    'bounded-prefix must submit the first GPU duty without waiting for its fence',
  );
  await firstAdmission;
  assert.equal(cooperative.progress().completedItems, 0);
  assert.equal(boundedProgress.length, 0);

  const second = gpu.nextRange();
  const secondAdmission = gpu.runGpuDuty(second, {
    encode({ range }) {
      return { rangeId: range.rangeId };
    },
  });
  await waitFor(
    () => boundedFences.length === 2,
    'bounded-prefix must submit two GPU duties before the oldest fence resolves',
  );
  assert.equal(cooperative.progress().completedItems, 0);
  assert.equal(boundedProgress.length, 0);
  boundedFences[0].resolve();
  const secondReceipt = await secondAdmission;
  assert.equal(secondReceipt.settledRangeId, first.rangeId);
  assert.equal(cooperative.progress().completedItems, 1);
  assert.equal(boundedProgress.length, 1);

  const third = gpu.nextRange();
  const thirdAdmission = gpu.runGpuDuty(third, {
    encode({ range }) {
      return { rangeId: range.rangeId };
    },
  });
  await waitFor(
    () => boundedFences.length === 3,
    'bounded-prefix must replenish the retired queue slot',
  );
  boundedFences[1].resolve();
  const thirdReceipt = await thirdAdmission;
  assert.equal(thirdReceipt.settledRangeId, second.rangeId);
  assert.equal(cooperative.progress().completedItems, 2);
  boundedFences[2].resolve();
});
const boundedReport = bounded.finish();
assert.equal(boundedReport.status, 'succeeded');
assert.equal(boundedReport.completionPolicy, 'bounded-prefix');
assert.equal(boundedReport.maxInFlightGpuDuties, 2);
assert.equal(boundedReport.maxObservedInFlightGpuDuties, 2);
assert.equal(boundedReport.issuedGpuDutyCount, 3);
assert.equal(boundedReport.retiredGpuDutyCount, 3);
assert.equal(boundedReport.progress.completedItems, 3);
assert.equal(boundedProgress.length, 3);
assert.deepEqual(
  boundedReport.gpuDuties.map(duty => [duty.rangeId, duty.status]),
  [
    ['sf3d:firing:bounded-prefix:texture-bake-channel-ranges:range:0', 'retired'],
    ['sf3d:firing:bounded-prefix:texture-bake-channel-ranges:range:1', 'retired'],
    ['sf3d:firing:bounded-prefix:texture-bake-channel-ranges:range:2', 'retired'],
  ],
);
assert.ok(boundedReport.gpuDuties.every(duty => duty.rawQueueDurationMs >= 0));

const downstreamManifest = defineWebGpuCooperativeBoundaryManifest({
  manifestId: 'sf3d.gpu-then-cpu.v0',
  routeId: ROUTE_ID,
  phases: [
    {
      phaseId: boundedManifest.phases[0].phaseId,
      boundaries: [{
        ...boundedManifest.phases[0].boundaries[0],
        totalItems: 1,
      }],
    },
    {
      phaseId: 'materialization',
      boundaries: [{
        boundaryId: 'glb-materialization',
        kind: 'cpu-work',
        hostPhase: 'presentation',
        unit: 'primitive',
        totalItems: 1,
        progressWeight: 1,
        chunking: {
          mode: 'fixed',
          chunkItems: 1,
        },
        yieldPolicy: 'after-duty',
        resources: {
          retain: ['sf3d.baked-texture'],
          produce: ['sf3d.glb'],
          release: ['sf3d.baked-texture'],
        },
      }],
    },
  ],
});
const downstreamCalls = [];
const downstreamFence = createDeferred();
const downstreamRuntime = createFakeRuntime({ calls: downstreamCalls, now });
downstreamRuntime.queue.onSubmittedWorkDone = () => downstreamFence.promise;
let downstreamCpuWorkStarted = false;
const downstreamExecution = createWebGpuCooperativeExecution({
  runtime: downstreamRuntime,
  manifest: downstreamManifest,
  invocationId: 'sf3d:firing:bounded-prefix-downstream',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await downstreamExecution.run(async cooperative => {
  const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
  const gpuRange = gpu.nextRange();
  await gpu.runGpuDuty(gpuRange, {
    encode() {
      return { rangeId: gpuRange.rangeId };
    },
  });
  assert.equal(gpu.nextRange(), null);

  const cpu = cooperative.startBoundary('glb-materialization');
  const cpuRange = cpu.nextRange();
  const cpuDuty = cpu.runCpuDuty(cpuRange, {
    work() {
      downstreamCpuWorkStarted = true;
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const startedBeforeFence = downstreamCpuWorkStarted;
  downstreamFence.resolve();
  await cpuDuty;
  assert.equal(
    startedBeforeFence,
    false,
    'downstream CPU work must wait for the final bounded GPU prefix',
  );
  assert.equal(downstreamCpuWorkStarted, true);
});

const concurrentCalls = [];
const concurrentEncodeGate = createDeferred();
const concurrentExecution = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: concurrentCalls, now }),
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-concurrent-callers',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await concurrentExecution.run(async cooperative => {
  const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
  const first = gpu.nextRange();
  const second = gpu.nextRange();
  const firstAdmission = gpu.runGpuDuty(first, {
    async encode() {
      concurrentCalls.push('encode-start:0');
      await concurrentEncodeGate.promise;
      concurrentCalls.push('encode-end:0');
      return { rangeId: first.rangeId };
    },
  });
  const secondAdmission = gpu.runGpuDuty(second, {
    encode() {
      concurrentCalls.push('encode:1');
      return { rangeId: second.rangeId };
    },
  });
  await waitFor(
    () => concurrentCalls.includes('encode-start:0'),
    'the first concurrent caller must acquire GPU admission',
  );
  assert.equal(concurrentCalls.includes('encode:1'), false);
  concurrentEncodeGate.resolve();
  await Promise.all([firstAdmission, secondAdmission]);
  const third = gpu.nextRange();
  await gpu.runGpuDuty(third, {
    encode() {
      concurrentCalls.push('encode:2');
      return { rangeId: third.rangeId };
    },
  });
});
assert.deepEqual(
  concurrentCalls.filter(call => call.startsWith('submit:')),
  [
    'submit:sf3d:firing:bounded-prefix-concurrent-callers:texture-bake-channel-ranges:range:0',
    'submit:sf3d:firing:bounded-prefix-concurrent-callers:texture-bake-channel-ranges:range:1',
    'submit:sf3d:firing:bounded-prefix-concurrent-callers:texture-bake-channel-ranges:range:2',
  ],
);

const rejectedFenceCalls = [];
const rejectedFenceRuntime = createFakeRuntime({
  calls: rejectedFenceCalls,
  now,
});
let rejectedFenceIndex = 0;
rejectedFenceRuntime.queue.onSubmittedWorkDone = () => {
  rejectedFenceCalls.push(`queue-fence:${rejectedFenceIndex}`);
  rejectedFenceIndex += 1;
  return rejectedFenceIndex === 1
    ? Promise.reject(new Error('oldest prefix fence rejected'))
    : Promise.resolve();
};
const rejectedFenceExecution = createWebGpuCooperativeExecution({
  runtime: rejectedFenceRuntime,
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-rejection',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await assert.rejects(
  rejectedFenceExecution.run(async cooperative => {
    const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
    for (let rangeIndex = 0; rangeIndex < 2; rangeIndex += 1) {
      const range = gpu.nextRange();
      await gpu.runGpuDuty(range, {
        encode() {
          return { rangeId: range.rangeId };
        },
      });
    }
  }),
  error => {
    const report = error.cooperativeExecutionReport;
    assert.equal(error.message, 'oldest prefix fence rejected');
    assert.equal(report.failure.phase, 'queue-completion');
    assert.equal(report.inFlightGpuDutyCount, 0);
    assert.deepEqual(
      report.gpuDuties.map(duty => duty.status),
      ['failed', 'retired-after-failure'],
    );
    assert.equal(report.boundaries[0].planner.pendingRangeCount, 0);
    return true;
  },
);

const boundedYieldFailureRuntime = createFakeRuntime({
  calls: [],
  now,
  browserYieldError: new Error('bounded browser yield failed'),
});
const boundedYieldFailure = createWebGpuCooperativeExecution({
  runtime: boundedYieldFailureRuntime,
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-yield-failure',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await assert.rejects(
  boundedYieldFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
    const range = gpu.nextRange();
    await gpu.runGpuDuty(range, {
      encode() {
        return { rangeId: range.rangeId };
      },
    });
  }),
  error => {
    const report = error.cooperativeExecutionReport;
    assert.equal(error.message, 'bounded browser yield failed');
    assert.equal(report.failure.phase, 'browser-yield');
    assert.equal(report.inFlightGpuDutyCount, 0);
    assert.deepEqual(report.gpuDuties.map(duty => duty.status), ['retired-after-failure']);
    assert.equal(report.boundaries[0].planner.pendingRangeCount, 0);
    return true;
  },
);

const boundedEncodeFailure = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: [], now }),
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-encode-failure',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await assert.rejects(
  boundedEncodeFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
    const first = gpu.nextRange();
    await gpu.runGpuDuty(first, {
      encode() {
        return { rangeId: first.rangeId };
      },
    });
    const second = gpu.nextRange();
    await gpu.runGpuDuty(second, {
      encode() {
        throw new Error('second range encode failed');
      },
    });
  }),
  error => {
    const report = error.cooperativeExecutionReport;
    assert.equal(error.message, 'second range encode failed');
    assert.equal(report.failure.phase, 'command-encoding');
    assert.equal(report.inFlightGpuDutyCount, 0);
    assert.deepEqual(report.gpuDuties.map(duty => duty.status), ['retired-after-failure']);
    assert.equal(report.boundaries[0].planner.pendingRangeCount, 0);
    return true;
  },
);

const boundedRecorderFailure = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({
    calls: [],
    now,
    submissionRecorderError: new Error('bounded recorder failed after submit'),
  }),
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-recorder-failure',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  now,
});
await assert.rejects(
  boundedRecorderFailure.run(async cooperative => {
    const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
    const range = gpu.nextRange();
    await gpu.runGpuDuty(range, {
      encode() {
        return { rangeId: range.rangeId };
      },
    });
  }),
  error => {
    const report = error.cooperativeExecutionReport;
    assert.equal(error.message, 'bounded recorder failed after submit');
    assert.equal(report.failure.phase, 'queue-submission');
    assert.equal(report.submittedGpuDutyCount, 1);
    assert.equal(report.observedPrefixFenceCount, 1);
    assert.equal(report.issuedGpuDutyCount, 1);
    assert.equal(report.inFlightGpuDutyCount, 0);
    assert.equal(report.gpuDuties.length, 1);
    assert.equal(report.gpuDuties[0].status, 'retired-after-failure');
    assert.ok(report.gpuDuties[0].rawQueueDurationMs >= 0);
    return true;
  },
);

const boundedCancellationController = new AbortController();
const boundedCancellation = createWebGpuCooperativeExecution({
  runtime: createFakeRuntime({ calls: [], now }),
  manifest: boundedManifest,
  invocationId: 'sf3d:firing:bounded-prefix-cancellation',
  schedulingMode: 'cooperative',
  completionPolicy: 'bounded-prefix',
  maxInFlightGpuDuties: 2,
  signal: boundedCancellationController.signal,
  now,
});
await assert.rejects(
  boundedCancellation.run(async cooperative => {
    const gpu = cooperative.startBoundary('texture-bake-channel-ranges');
    const first = gpu.nextRange();
    await gpu.runGpuDuty(first, {
      encode() {
        return { rangeId: first.rangeId };
      },
    });
    boundedCancellationController.abort('cancel after bounded issuance');
    cooperative.throwIfCancelled();
  }),
  error => {
    const report = error.cooperativeExecutionReport;
    assert.equal(error.name, 'AbortError');
    assert.equal(report.status, 'cancelled');
    assert.equal(report.failure.phase, 'cancellation');
    assert.equal(report.inFlightGpuDutyCount, 0);
    assert.deepEqual(report.gpuDuties.map(duty => duty.status), ['retired-after-failure']);
    assert.equal(report.boundaries[0].planner.pendingRangeCount, 0);
    return true;
  },
);

assert.throws(
  () => createWebGpuCooperativeExecution({
    runtime: createFakeRuntime({ calls: [], now }),
    manifest,
    invocationId: 'sharp:firing:adaptive-bounded-prefix',
    schedulingMode: 'cooperative',
    completionPolicy: 'bounded-prefix',
    maxInFlightGpuDuties: 2,
    now,
  }),
  /bounded-prefix.*fixed|adaptive.*bounded-prefix/i,
);
assert.throws(
  () => createWebGpuCooperativeExecution({
    runtime: createFakeRuntime({ calls: [], now }),
    manifest: boundedManifest,
    invocationId: 'sf3d:firing:bounded-prefix-missing-depth',
    schedulingMode: 'cooperative',
    completionPolicy: 'bounded-prefix',
    now,
  }),
  /maxInFlightGpuDuties.*positive safe integer/,
);
assert.throws(
  () => createWebGpuCooperativeExecution({
    runtime: createFakeRuntime({ calls: [], now }),
    manifest: boundedManifest,
    invocationId: 'sf3d:firing:strict-prefix-stale-depth',
    schedulingMode: 'cooperative',
    maxInFlightGpuDuties: 2,
    now,
  }),
  /only with bounded-prefix/,
);
assert.throws(
  () => createWebGpuCooperativeExecution({
    runtime: createFakeRuntime({ calls: [], now }),
    manifest: boundedManifest,
    invocationId: 'sf3d:firing:bounded-prefix-disabled',
    schedulingMode: 'disabled',
    completionPolicy: 'bounded-prefix',
    maxInFlightGpuDuties: 2,
    now,
  }),
  /requires cooperative scheduling/,
);

console.log('cooperative execution contracts passed');
