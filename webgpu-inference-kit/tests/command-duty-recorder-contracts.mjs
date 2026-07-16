import assert from 'node:assert/strict';

import {
  WEBGPU_COMMAND_DUTY_REPORT_SCHEMA,
  createWebGpuCommandDutyObservationFromReport,
  createWebGpuCommandDutyRecorder,
} from '../src/index.js';

const identity = {
  routeId: 'sf3d.image-to-mesh.webgpu-local.v0',
  runId: 'sf3d-command-run-a',
  clock: {
    clockId: 'sf3d-worker-clock-a',
    source: 'performance.now',
    timeOriginEpochMs: 1_700_000_000_000,
  },
};

const ticks = [100, 102, 120, 123];
const recorder = createWebGpuCommandDutyRecorder({
  ...identity,
  now: () => ticks.shift(),
});

const firstResult = await recorder.measureSubmission({
  phase: 'triplane-attention',
  kind: 'compute',
  chunkControl: {
    controlId: 'attentionTiles',
    unit: 'attention-tile',
    current: 16,
    bounds: { min: 1, max: 16, stepFactor: 2 },
  },
  metadata: { kernelName: 'sf3d.triplane-attention', dispatch: [16, 16, 1] },
}, async () => 'submitted-attention');
assert.equal(firstResult, 'submitted-attention');

await recorder.measureSubmission({
  phase: 'mesh-readback',
  kind: 'copy',
  metadata: { tensorName: 'sf3d.mesh-vertices' },
}, async () => 'submitted-readback');

const report = recorder.finish();
assert.equal(report.schema, WEBGPU_COMMAND_DUTY_REPORT_SCHEMA);
assert.equal(report.status, 'succeeded');
assert.equal(report.retention, 'uncapped');
assert.equal(report.submissionCount, 2);
assert.equal(report.activeSubmissionCount, 0);
assert.equal(report.timingAuthority, 'host-submit-call-only-not-gpu-completion');
assert.deepEqual(report.clock, identity.clock);
assert.deepEqual(
  report.submissions.map(row => ({
    dutyId: row.descriptor.dutyId,
    phase: row.descriptor.phase,
    kind: row.descriptor.kind,
    outcome: row.outcome,
    submitStartMs: row.submitStartMs,
    submitEndMs: row.submitEndMs,
    submitCallDurationMs: row.submitCallDurationMs,
  })),
  [
    {
      dutyId: 'sf3d-command-run-a:command-duty:0',
      phase: 'triplane-attention',
      kind: 'compute',
      outcome: 'succeeded',
      submitStartMs: 100,
      submitEndMs: 102,
      submitCallDurationMs: 2,
    },
    {
      dutyId: 'sf3d-command-run-a:command-duty:1',
      phase: 'mesh-readback',
      kind: 'copy',
      outcome: 'succeeded',
      submitStartMs: 120,
      submitEndMs: 123,
      submitCallDurationMs: 3,
    },
  ],
);

const observation = createWebGpuCommandDutyObservationFromReport(report, {
  firingId: 'kiln-firing-sf3d-a',
  expectedRouteId: identity.routeId,
  expectedRunId: identity.runId,
  expectedClockId: identity.clock.clockId,
  measurements: [
    {
      dutyId: 'sf3d-command-run-a:command-duty:0',
      observedDurationMs: 48,
      foregroundOverlapDurationMs: 40,
    },
    {
      dutyId: 'sf3d-command-run-a:command-duty:1',
      observedDurationMs: 12,
      foregroundOverlapDurationMs: 8,
    },
  ],
});
assert.equal(observation.identity.firingId, 'kiln-firing-sf3d-a');
assert.equal(observation.retention, 'uncapped');
assert.equal(observation.dutyCount, 2);
assert.equal(observation.totals.observedDurationMs, 60);
assert.equal(observation.totals.foregroundOverlapDurationMs, 48);
assert.equal(observation.duties[0].descriptor.chunkControl.controlId, 'attentionTiles');

for (const [label, options, pattern] of [
  ['route', { expectedRouteId: 'stale-route', expectedRunId: identity.runId, expectedClockId: identity.clock.clockId }, /route identity mismatch/],
  ['run', { expectedRouteId: identity.routeId, expectedRunId: 'stale-run', expectedClockId: identity.clock.clockId }, /run identity mismatch/],
  ['clock', { expectedRouteId: identity.routeId, expectedRunId: identity.runId, expectedClockId: 'stale-clock' }, /clock identity mismatch/],
]) {
  assert.throws(
    () => createWebGpuCommandDutyObservationFromReport(report, {
      firingId: label,
      measurements: [
        { dutyId: report.submissions[0].descriptor.dutyId, observedDurationMs: 1, foregroundOverlapDurationMs: 1 },
        { dutyId: report.submissions[1].descriptor.dutyId, observedDurationMs: 1, foregroundOverlapDurationMs: 1 },
      ],
      ...options,
    }),
    pattern,
  );
}

for (const [label, measurements, pattern] of [
  ['missing', [{ dutyId: report.submissions[0].descriptor.dutyId, observedDurationMs: 1, foregroundOverlapDurationMs: 1 }], /complete.*measurement|missing/i],
  ['extra', [
    { dutyId: report.submissions[0].descriptor.dutyId, observedDurationMs: 1, foregroundOverlapDurationMs: 1 },
    { dutyId: report.submissions[1].descriptor.dutyId, observedDurationMs: 1, foregroundOverlapDurationMs: 1 },
    { dutyId: 'foreign-duty', observedDurationMs: 1, foregroundOverlapDurationMs: 1 },
  ], /foreign|extra/i],
]) {
  assert.throws(
    () => createWebGpuCommandDutyObservationFromReport(report, {
      firingId: label,
      expectedRouteId: identity.routeId,
      expectedRunId: identity.runId,
      expectedClockId: identity.clock.clockId,
      measurements,
    }),
    pattern,
  );
}

const originalError = new Error('queue submit rejected');
const failedRecorder = createWebGpuCommandDutyRecorder({
  ...identity,
  runId: 'sf3d-command-run-failed',
  now: (() => {
    const values = [1, 2];
    return () => values.shift();
  })(),
});
await assert.rejects(
  () => failedRecorder.measureSubmission({ phase: 'failed-submit', kind: 'compute' }, async () => {
    throw originalError;
  }),
  error => error === originalError,
);
const failedReport = failedRecorder.finish();
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.submissions[0].outcome, 'failed');
assert.throws(
  () => createWebGpuCommandDutyObservationFromReport(failedReport, {
    firingId: 'failed-firing',
    expectedRouteId: identity.routeId,
    expectedRunId: 'sf3d-command-run-failed',
    expectedClockId: identity.clock.clockId,
    measurements: [],
  }),
  /succeeded.*report|failed report/i,
);

assert.throws(
  () => createWebGpuCommandDutyRecorder({ ...identity, maxSubmissions: 10 }),
  /uncapped/,
);

const instrumentationFailureRecorder = createWebGpuCommandDutyRecorder({
  ...identity,
  runId: 'sf3d-command-run-instrumentation-failure',
  now: (() => {
    const values = [1, Number.NaN];
    return () => values.shift();
  })(),
});
const submittedDespiteRecorderFailure = await instrumentationFailureRecorder.measureSubmission(
  { phase: 'submitted-before-clock-failure', kind: 'compute' },
  async () => 'queue-submit-succeeded',
);
assert.equal(submittedDespiteRecorderFailure, 'queue-submit-succeeded');
const instrumentationFailureReport = instrumentationFailureRecorder.finish();
assert.equal(instrumentationFailureReport.status, 'failed');
assert.equal(instrumentationFailureReport.submissionCount, 0);
assert.equal(instrumentationFailureReport.failure.dutyId, 'sf3d-command-run-instrumentation-failure:command-duty:0');
assert.match(instrumentationFailureReport.failure.recordingError.message, /non-finite timestamp/);
const forgedSuccessfulFailureReport = structuredClone(instrumentationFailureReport);
forgedSuccessfulFailureReport.status = 'succeeded';
assert.throws(
  () => createWebGpuCommandDutyObservationFromReport(forgedSuccessfulFailureReport, {
    firingId: 'forged-success-firing',
    expectedRouteId: identity.routeId,
    expectedRunId: 'sf3d-command-run-instrumentation-failure',
    expectedClockId: identity.clock.clockId,
    measurements: [],
  }),
  /failure.*report|report.*failure/i,
  'a forged succeeded status must not hide recorder failure state',
);

console.log('command duty recorder contracts passed');
