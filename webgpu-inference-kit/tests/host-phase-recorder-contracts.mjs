import assert from 'node:assert/strict';

import {
  WEBGPU_HOST_PHASE,
  WEBGPU_HOST_PHASE_EVENT_BATCH_SCHEMA,
  WEBGPU_HOST_PHASE_RECORDER_SCHEMA,
  createWebGpuHostPhaseRecorder,
  projectWebGpuHostPhaseEvents,
} from '../src/index.js';

const routeId = 'sharp.image-to-splat.webgpu-local.v0';
const runId = 'sharp-run-host-phase-a';
const clock = {
  clockId: 'sharp-worker-performance-clock-a',
  source: 'performance.now',
  timeOriginEpochMs: 1_700_000_000_000,
};
const timestamps = [100, 112, 120, 124, 130, 150];
const recorder = createWebGpuHostPhaseRecorder({
  routeId,
  runId,
  clock,
  now: () => timestamps.shift(),
});

const preprocessing = recorder.begin(WEBGPU_HOST_PHASE.cpuPreprocess, {
  detail: { imageWidth: 512, imageHeight: 512 },
});
const liveSnapshot = recorder.snapshot();
assert.equal(liveSnapshot.schema, WEBGPU_HOST_PHASE_RECORDER_SCHEMA);
assert.equal(liveSnapshot.status, 'recording');
assert.equal(liveSnapshot.intervalCount, 0);
assert.equal(liveSnapshot.activeIntervalCount, 1);
assert.equal(liveSnapshot.retention, 'uncapped');
assert.equal(liveSnapshot.routeId, routeId);
assert.equal(liveSnapshot.runId, runId);
assert.deepEqual(liveSnapshot.clock, clock);

recorder.end(preprocessing, { detail: { outputShape: [1, 3, 512, 512] } });
assert.throws(
  () => projectWebGpuHostPhaseEvents(recorder.snapshot(), {
    firingId: 'kiln-firing-prefix',
    expectedRouteId: routeId,
    expectedRunId: runId,
    expectedClockId: clock.clockId,
  }),
  /terminal host phase report/,
  'a between-phase recording prefix must not project as complete foreground evidence',
);
const encoded = await recorder.measure(
  WEBGPU_HOST_PHASE.commandEncoding,
  async () => 'encoded',
  { detail: { commandCount: 17 } },
);
assert.equal(encoded, 'encoded');

await assert.rejects(
  () => recorder.measure(
    WEBGPU_HOST_PHASE.readback,
    async () => {
      throw new Error('mapAsync rejected');
    },
    { detail: { buffer: 'gaussians' } },
  ),
  /mapAsync rejected/,
);

const report = recorder.finish();
assert.equal(report.status, 'failed');
assert.equal(report.intervalCount, 3);
assert.equal(report.activeIntervalCount, 0);
assert.deepEqual(
  report.intervals.map(interval => ({
    phase: interval.phase,
    outcome: interval.outcome,
    startMs: interval.startMs,
    endMs: interval.endMs,
    durationMs: interval.durationMs,
  })),
  [
    { phase: 'cpu-preprocess', outcome: 'succeeded', startMs: 100, endMs: 112, durationMs: 12 },
    { phase: 'command-encoding', outcome: 'succeeded', startMs: 120, endMs: 124, durationMs: 4 },
    { phase: 'readback', outcome: 'failed', startMs: 130, endMs: 150, durationMs: 20 },
  ],
);
assert.deepEqual(report.failure, {
  intervalId: `${runId}:host-phase:2`,
  phase: 'readback',
  error: { name: 'Error', message: 'mapAsync rejected' },
});
assert.deepEqual(report.lastTrustworthyInterval, report.intervals[2]);
for (const interval of report.intervals) {
  assert.equal(interval.routeId, routeId);
  assert.equal(interval.runId, runId);
  assert.equal(interval.clockId, clock.clockId);
  assert.equal(interval.startEpochMs, clock.timeOriginEpochMs + interval.startMs);
  assert.equal(interval.endEpochMs, clock.timeOriginEpochMs + interval.endMs);
}
assert.deepEqual(report.intervals[0].detail, {
  imageWidth: 512,
  imageHeight: 512,
  outputShape: [1, 3, 512, 512],
});

const originalOperationError = new Error('original readback failure');
const failingClockTicks = [1, 2, 10, 5];
const recorderFailure = createWebGpuHostPhaseRecorder({
  routeId,
  runId: 'recorder-failure-run',
  clock,
  now: () => failingClockTicks.shift(),
});
const trustworthyPhase = recorderFailure.begin(WEBGPU_HOST_PHASE.cpuPreprocess);
recorderFailure.end(trustworthyPhase);
await assert.rejects(
  () => recorderFailure.measure(
    WEBGPU_HOST_PHASE.readback,
    async () => {
      throw originalOperationError;
    },
  ),
  error => error === originalOperationError,
  'instrumentation failure must not replace the exact measured operation error',
);
const recorderFailureSnapshot = recorderFailure.snapshot();
assert.equal(recorderFailureSnapshot.activeIntervalCount, 0);
assert.equal(recorderFailureSnapshot.intervalCount, 1);
assert.deepEqual(recorderFailureSnapshot.lastTrustworthyInterval, recorderFailureSnapshot.intervals[0]);
assert.equal(recorderFailureSnapshot.lastTrustworthyInterval.phase, 'cpu-preprocess');
assert.deepEqual(recorderFailureSnapshot.failure, {
  intervalId: 'recorder-failure-run:host-phase:1',
  phase: 'readback',
  error: { name: 'Error', message: 'original readback failure' },
  recordingError: { name: 'Error', message: 'host phase clock moved backwards; interval was not recorded' },
});
assert.equal(recorderFailure.finish().status, 'failed');

const projected = projectWebGpuHostPhaseEvents(report, {
  firingId: 'kiln-firing-a',
  expectedRouteId: routeId,
  expectedRunId: runId,
  expectedClockId: clock.clockId,
});
assert.equal(projected.schema, WEBGPU_HOST_PHASE_EVENT_BATCH_SCHEMA);
assert.equal(projected.status, 'verified');
assert.equal(projected.retention, 'uncapped');
assert.equal(projected.eventCount, 3);
assert.deepEqual(projected.clock, clock);
assert.deepEqual(
  projected.events.map(event => ({
    eventId: event.eventId,
    firingId: event.firingId,
    routeId: event.routeId,
    runId: event.runId,
    clockId: event.clockId,
    kind: event.kind,
    source: event.source,
    phase: event.phase,
    outcome: event.outcome,
    startEpochMs: event.startEpochMs,
    endEpochMs: event.endEpochMs,
  })),
  report.intervals.map(interval => ({
    eventId: interval.intervalId,
    firingId: 'kiln-firing-a',
    routeId,
    runId,
    clockId: clock.clockId,
    kind: 'webgpu-runtime-host-phase',
    source: 'runtime-explicit',
    phase: interval.phase,
    outcome: interval.outcome,
    startEpochMs: interval.startEpochMs,
    endEpochMs: interval.endEpochMs,
  })),
);

for (const [name, mutate, pattern] of [
  ['phase', interval => { interval.phase = 'bogus-phase'; }, /phase is invalid/],
  ['outcome', interval => { interval.outcome = 'teleported'; }, /outcome is invalid/],
  ['duration', interval => { interval.durationMs = 999; }, /duration is invalid/],
]) {
  const corrupted = JSON.parse(JSON.stringify(report));
  mutate(corrupted.intervals[0]);
  assert.throws(
    () => projectWebGpuHostPhaseEvents(corrupted, {
      firingId: `kiln-firing-corrupt-${name}`,
      expectedRouteId: routeId,
      expectedRunId: runId,
      expectedClockId: clock.clockId,
    }),
    pattern,
    `${name} corruption must fail before projection is marked verified`,
  );
}

for (const [name, options, pattern] of [
  ['route', { expectedRouteId: 'stale-route', expectedRunId: runId, expectedClockId: clock.clockId }, /route identity mismatch/],
  ['run', { expectedRouteId: routeId, expectedRunId: 'stale-run', expectedClockId: clock.clockId }, /run identity mismatch/],
  ['clock', { expectedRouteId: routeId, expectedRunId: runId, expectedClockId: 'stale-clock' }, /clock identity mismatch/],
]) {
  assert.throws(
    () => projectWebGpuHostPhaseEvents(report, { firingId: name, ...options }),
    pattern,
    `${name} mismatch must not produce authoritative foreground events`,
  );
}

for (const [name, input, pattern] of [
  ['missing route', { runId, clock }, /routeId/],
  ['missing run', { routeId, clock }, /runId/],
  ['missing clock', { routeId, runId }, /clock/],
  ['capped retention', { routeId, runId, clock, maxIntervals: 1 }, /uncapped/],
]) {
  assert.throws(
    () => createWebGpuHostPhaseRecorder(input),
    pattern,
    `${name} must fail before recording misleading evidence`,
  );
}

const unfinished = createWebGpuHostPhaseRecorder({
  routeId,
  runId: 'unfinished-run',
  clock,
  now: () => 200,
});
unfinished.begin(WEBGPU_HOST_PHASE.presentation);
assert.throws(() => unfinished.finish(), /active host phase/);
assert.equal(unfinished.snapshot().activeIntervalCount, 1);

console.log('host phase recorder contracts passed');
