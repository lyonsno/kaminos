import assert from 'node:assert/strict';

import {
  WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
  WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
  WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA,
  validateWebGpuCooperativeExecutionReport,
} from '../src/index.js';

const clone = value => structuredClone(value);

function createBoundedReport() {
  const progress = {
    schema: WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
    routeId: 'sf3d.image-to-mesh.webgpu-local.v0',
    invocationId: 'sf3d:bounded:1',
    status: 'succeeded',
    completedItems: 2,
    totalItems: 2,
    progress: 1,
    percent: 100,
    completedWeight: 2,
    totalWeight: 2,
    currentPhaseId: null,
    currentBoundaryId: null,
    phases: [{
      phaseId: 'post-processor',
      status: 'complete',
      completedItems: 2,
      totalItems: 2,
      progress: 1,
      percent: 100,
      completedWeight: 2,
      totalWeight: 2,
    }],
  };
  const ranges = [0, 1].map(index => ({
    rangeId: `post-processor:range:${index}`,
    rangeIndex: index,
    itemStart: index,
    itemEnd: index + 1,
    itemCount: 1,
    status: 'complete',
  }));
  const gpuDuties = ranges.map((range, index) => ({
    dutyId: range.rangeId,
    rangeId: range.rangeId,
    rangeIndex: index,
    boundaryId: 'post-processor-channel-ranges',
    status: 'retired',
    submittedAtMs: index * 2,
    retiredAtMs: index * 2 + 1.5,
    rawQueueDurationMs: 1.5,
    timingAuthority: 'queue-work-done',
    failure: null,
  }));
  return {
    schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
    status: 'succeeded',
    routeId: progress.routeId,
    manifestId: 'sf3d.post-processor.v0',
    invocationId: progress.invocationId,
    schedulingMode: 'cooperative',
    completionPolicy: 'bounded-prefix',
    maxInFlightGpuDuties: 2,
    maxObservedInFlightGpuDuties: 2,
    issuedGpuDutyCount: 2,
    retiredGpuDutyCount: 2,
    inFlightGpuDutyCount: 0,
    inFlightGpuDutyIds: [],
    gpuDuties,
    schedulerRevision: 1,
    invocationScheduler: { mode: 'cooperative' },
    queueCompletionAuthority: 'bounded-per-gpu-duty-prefix-fence',
    submittedGpuDutyCount: 2,
    observedPrefixFenceCount: 2,
    unfencedSubmittedGpuDutyCount: 0,
    retention: 'uncapped',
    startedAtMs: 0,
    endedAtMs: 4,
    durationMs: 4,
    progress,
    boundaries: [{
      phaseId: 'post-processor',
      boundaryId: 'post-processor-channel-ranges',
      kind: 'gpu-command',
      unit: 'output-channel',
      status: 'complete',
      completedItems: 2,
      totalItems: 2,
      progress: 1,
      progressWeight: 2,
      rangeCount: 2,
      actualRangeCount: 2,
      rangeCountAuthority: 'actual',
      ranges,
      planner: {
        pendingRangeId: null,
        pendingRangeCount: 0,
      },
      resources: { retain: [], produce: [], release: [] },
      failure: null,
    }],
    failure: null,
  };
}

function createCancelledBoundedReport() {
  const report = createBoundedReport();
  const failure = {
    phase: 'cancellation',
    error: { name: 'AbortError', message: 'cancelled by contract fixture' },
    secondaryFailures: [],
  };
  report.status = 'cancelled';
  report.failure = {
    ...clone(failure),
    boundaryId: report.boundaries[0].boundaryId,
  };
  report.progress = {
    ...report.progress,
    status: 'cancelled',
    completedItems: 1,
    progress: 0.5,
    percent: 50,
    completedWeight: 1,
    currentPhaseId: report.boundaries[0].phaseId,
    currentBoundaryId: report.boundaries[0].boundaryId,
    phases: [{
      ...report.progress.phases[0],
      status: 'cancelled',
      completedItems: 1,
      progress: 0.5,
      percent: 50,
      completedWeight: 1,
    }],
  };
  report.issuedGpuDutyCount = 1;
  report.retiredGpuDutyCount = 0;
  report.submittedGpuDutyCount = 1;
  report.observedPrefixFenceCount = 1;
  report.maxObservedInFlightGpuDuties = 1;
  report.gpuDuties = [{
    ...report.gpuDuties[0],
    status: 'retired-after-failure',
  }];
  report.boundaries = [{
    ...report.boundaries[0],
    status: 'cancelled',
    completedItems: 1,
    progress: 0.5,
    rangeCount: 1,
    actualRangeCount: null,
    rangeCountAuthority: 'open-until-completion',
    ranges: [report.boundaries[0].ranges[0]],
    failure: clone(failure),
  }];
  report.lastTrustworthyBoundary = {
    phaseId: report.boundaries[0].phaseId,
    boundaryId: report.boundaries[0].boundaryId,
    kind: report.boundaries[0].kind,
    unit: report.boundaries[0].unit,
    status: report.boundaries[0].status,
    totalItems: report.boundaries[0].totalItems,
    completedItems: report.boundaries[0].completedItems,
    progressWeight: report.boundaries[0].progressWeight,
    ranges: clone(report.boundaries[0].ranges),
    failure: clone(report.boundaries[0].failure),
  };
  return report;
}

const expectations = {
  expectedRouteId: 'sf3d.image-to-mesh.webgpu-local.v0',
  expectedManifestId: 'sf3d.post-processor.v0',
  expectedInvocationId: 'sf3d:bounded:1',
  expectedSchedulingMode: 'cooperative',
  expectedCompletionPolicy: 'bounded-prefix',
  expectedGpuDutyCount: 2,
  expectedMaxInFlightGpuDuties: 2,
  requireConfiguredDepthObserved: true,
};

function expectFailure(mutator, pattern) {
  const report = createBoundedReport();
  mutator(report);
  const result = validateWebGpuCooperativeExecutionReport(report, expectations);
  assert.equal(result.ok, false, `validator accepted invalid report: ${pattern}`);
  assert.match(result.errors.join('\n'), pattern);
}

const valid = validateWebGpuCooperativeExecutionReport(createBoundedReport(), expectations);
assert.equal(valid.schema, WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA);
assert.equal(valid.ok, true);
assert.deepEqual(valid.errors, []);
assert.equal(Object.isFrozen(valid), true);
assert.equal(Object.isFrozen(valid.errors), true);

const validCancellation = validateWebGpuCooperativeExecutionReport(
  createCancelledBoundedReport(),
  {
    ...expectations,
    expectedStatus: 'cancelled',
    expectedGpuDutyCount: undefined,
    requireConfiguredDepthObserved: false,
  },
);
assert.equal(validCancellation.ok, true, validCancellation.errors.join('\n'));

expectFailure(
  report => { report.observedPrefixFenceCount = 1; },
  /observedPrefixFenceCount.*submittedGpuDutyCount/,
);
expectFailure(
  report => { report.unfencedSubmittedGpuDutyCount = 1; },
  /unfencedSubmittedGpuDutyCount.*zero/,
);
expectFailure(
  report => { report.gpuDuties = []; },
  /gpuDuties.*issuedGpuDutyCount/,
);
expectFailure(
  report => { report.gpuDuties[0].rawQueueDurationMs = null; },
  /rawQueueDurationMs.*finite nonnegative/,
);
expectFailure(
  report => { report.gpuDuties[0].timingAuthority = 'host-wait'; },
  /timingAuthority.*queue-work-done/,
);
expectFailure(
  report => {
    report.progress.completedItems = 1;
    report.progress.progress = 0.5;
    report.progress.percent = 50;
  },
  /progress.*terminal completion/,
);
expectFailure(
  report => {
    report.inFlightGpuDutyCount = 1;
    report.inFlightGpuDutyIds = [report.gpuDuties[1].dutyId];
  },
  /inFlightGpuDutyCount.*zero/,
);
expectFailure(
  report => { report.queueCompletionAuthority = 'per-gpu-duty-prefix-fence'; },
  /queueCompletionAuthority.*bounded-per-gpu-duty-prefix-fence/,
);
expectFailure(
  report => { report.maxObservedInFlightGpuDuties = 1; },
  /maxObservedInFlightGpuDuties.*configured maxInFlightGpuDuties/,
);
expectFailure(
  report => { report.boundaries[0].actualRangeCount = 1; },
  /actualRangeCount.*ranges/,
);
expectFailure(
  report => {
    report.runtimeTelemetry = {
      commandDuties: {
        retention: 'uncapped',
        duties: [
          { boundaryId: 'forged-boundary', rangeId: 'forged-range' },
          { boundaryId: 'forged-boundary', rangeId: 'forged-range-2' },
        ],
      },
    };
  },
  /runtimeTelemetry\.commandDuties\.duties\[0\].*retained GPU-command range/,
);

const wrongExpectedCount = validateWebGpuCooperativeExecutionReport(
  createBoundedReport(),
  { ...expectations, expectedGpuDutyCount: 3 },
);
assert.equal(wrongExpectedCount.ok, false);
assert.match(wrongExpectedCount.errors.join('\n'), /expectedGpuDutyCount.*3/);

{
  const report = createBoundedReport();
  const thirdRange = {
    rangeId: 'post-processor:range:2',
    rangeIndex: 2,
    itemStart: 2,
    itemEnd: 3,
    itemCount: 1,
    status: 'complete',
  };
  report.progress.completedItems = 3;
  report.progress.totalItems = 3;
  report.progress.phases[0].completedItems = 3;
  report.progress.phases[0].totalItems = 3;
  report.boundaries[0].completedItems = 3;
  report.boundaries[0].totalItems = 3;
  report.boundaries[0].rangeCount = 3;
  report.boundaries[0].actualRangeCount = 3;
  report.boundaries[0].ranges.push(thirdRange);
  const result = validateWebGpuCooperativeExecutionReport(report, {
    ...expectations,
    expectedGpuDutyCount: undefined,
  });
  assert.equal(result.ok, false, 'completed GPU ranges require one duty each');
  assert.match(result.errors.join('\n'), /gpuDuties.*completed GPU-command ranges/);
}

{
  const report = createBoundedReport();
  report.gpuDuties[0].boundaryId = 'unrelated-boundary';
  report.gpuDuties[0].rangeId = 'unrelated-range';
  report.gpuDuties[0].rangeIndex = 99;
  const result = validateWebGpuCooperativeExecutionReport(report, expectations);
  assert.equal(result.ok, false, 'duty identities must bind to completed GPU ranges');
  assert.match(result.errors.join('\n'), /gpuDuties\[0\].*retained GPU-command range/);
}

{
  const report = createCancelledBoundedReport();
  report.progress.completedItems = 0;
  report.progress.progress = 0;
  report.progress.percent = 0;
  report.progress.completedWeight = 0;
  Object.assign(report.progress.phases[0], {
    completedItems: 0,
    progress: 0,
    percent: 0,
    completedWeight: 0,
  });
  const result = validateWebGpuCooperativeExecutionReport(report, {
    ...expectations,
    expectedStatus: 'cancelled',
    expectedGpuDutyCount: undefined,
    requireConfiguredDepthObserved: false,
  });
  assert.equal(result.ok, false, 'terminal progress must reconcile with retained boundary ranges');
  assert.match(result.errors.join('\n'), /progress.*completed boundary work/);
}

{
  const report = createBoundedReport();
  report.completionPolicy = 'strict-prefix';
  report.maxInFlightGpuDuties = 1;
  report.maxObservedInFlightGpuDuties = 1;
  report.queueCompletionAuthority = 'per-gpu-duty-prefix-fence';
  report.gpuDuties = report.gpuDuties.map(() => ({ bogus: true }));
  const result = validateWebGpuCooperativeExecutionReport(report, {
    ...expectations,
    expectedCompletionPolicy: 'strict-prefix',
    expectedMaxInFlightGpuDuties: undefined,
    requireConfiguredDepthObserved: false,
  });
  assert.equal(result.ok, false, 'strict-prefix duties require semantic range and fence evidence');
  assert.match(result.errors.join('\n'), /gpuDuties\[0\]/);
}

{
  const report = createCancelledBoundedReport();
  report.lastTrustworthyBoundary.ranges = report.lastTrustworthyBoundary.ranges.map(range => ({
    status: range.status,
    itemCount: range.itemCount,
    itemEnd: range.itemEnd,
    itemStart: range.itemStart,
    rangeIndex: range.rangeIndex,
    rangeId: range.rangeId,
  }));
  report.lastTrustworthyBoundary.failure = {
    secondaryFailures: [],
    error: {
      message: report.lastTrustworthyBoundary.failure.error.message,
      name: report.lastTrustworthyBoundary.failure.error.name,
    },
    phase: report.lastTrustworthyBoundary.failure.phase,
  };
  const result = validateWebGpuCooperativeExecutionReport(report, {
    ...expectations,
    expectedStatus: 'cancelled',
    expectedGpuDutyCount: undefined,
    requireConfiguredDepthObserved: false,
  });
  assert.equal(
    result.ok,
    true,
    `object key order must not change report meaning:\n${result.errors.join('\n')}`,
  );
}

{
  const report = createBoundedReport();
  report.status = 'cancelled';
  report.progress.status = 'running';
  report.failure = null;
  report.boundaries = [null];
  report.retiredGpuDutyCount = 0;
  report.gpuDuties = report.gpuDuties.map(duty => ({
    ...duty,
    status: 'retired-after-failure',
  }));
  const result = validateWebGpuCooperativeExecutionReport(report, {
    ...expectations,
    expectedStatus: 'cancelled',
  });
  assert.equal(result.ok, false, 'cancelled reports require terminal failure authority');
  assert.match(result.errors.join('\n'), /progress.status.*cancelled/);
  assert.match(result.errors.join('\n'), /failure.*cancelled/);
  assert.match(result.errors.join('\n'), /boundaries\[0\].*object/);
}

assert.throws(
  () => validateWebGpuCooperativeExecutionReport(createBoundedReport(), {
    ...expectations,
    expectedGpuDutyCount: -1,
  }),
  /expectedGpuDutyCount.*nonnegative safe integer/,
);

console.log('cooperative report validation contracts passed');
