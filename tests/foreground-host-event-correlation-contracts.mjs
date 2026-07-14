import assert from 'node:assert/strict';

import { createForegroundHostEventCorrelation } from '../lib/foreground-kiln-heartbeat.mjs';

const firingId = 'firing-host-correlation-a';
const clockOrigin = 1_700_000_000_000;

function event({
  eventId,
  source,
  phase,
  startMs,
  endMs,
  eventFiringId = firingId,
} = {}) {
  return {
    eventId,
    firingId: eventFiringId,
    kind: 'browser-host',
    source,
    phase,
    startMs,
    endMs,
    startEpochMs: clockOrigin + startMs,
    endEpochMs: clockOrigin + endMs,
    durationMs: endMs - startMs,
  };
}

function heartbeat(hostEvents, overrides = {}) {
  return {
    schema: 'kaminos.foreground-kiln-heartbeat.v0',
    firingId,
    clock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: clockOrigin,
    },
    hostEventRetention: 'uncapped',
    hostEventCount: hostEvents.length,
    hostEvents,
    ...overrides,
  };
}

function gap({
  startMs = 100,
  endMs = 200,
  sharp = [{ startMs: 100, endMs: 140, phase: 'spn-fusion', boundary: 'spn-fusion' }],
} = {}) {
  return {
    sampleIndex: 1,
    startEpochMs: clockOrigin + startMs,
    endEpochMs: clockOrigin + endMs,
    durationMs: endMs - startMs,
    overlaps: sharp.map((interval, index) => ({
      runId: 'sharp-run-a',
      dutyId: `sharp-run-a:${index}`,
      phase: interval.phase,
      boundary: interval.boundary,
      startEpochMs: clockOrigin + interval.startMs,
      endEpochMs: clockOrigin + interval.endMs,
      overlapDurationMs: interval.endMs - interval.startMs,
    })),
  };
}

const mixed = createForegroundHostEventCorrelation({
  foregroundHeartbeat: heartbeat([
    event({ eventId: 'longtask-a', source: 'performance-observer-longtask', phase: 'longtask', startMs: 130, endMs: 160 }),
    event({ eventId: 'readback-a', source: 'runtime-explicit', phase: 'buffer-map-readback', startMs: 150, endMs: 180 }),
    event({ eventId: 'present-a', source: 'runtime-explicit', phase: 'presentation', startMs: 170, endMs: 190 }),
  ]),
  foregroundGaps: [gap()],
  unexplainedThresholdMs: 50,
});

assert.equal(mixed.schema, 'kaminos.foreground-host-event-correlation.v0');
assert.equal(mixed.status, 'verified');
assert.equal(mixed.cadenceStatus, 'passed');
assert.equal(mixed.totals.foregroundGapDurationMs, 100);
assert.equal(mixed.totals.sharpCoveredDurationMs, 40);
assert.equal(mixed.totals.hostCoveredDurationMs, 60, 'overlapping host events are unioned');
assert.equal(mixed.totals.sharedSharpHostDurationMs, 10);
assert.equal(mixed.totals.hostOnlyDurationMs, 50);
assert.equal(mixed.totals.combinedCoveredDurationMs, 90, 'SHARP and host coverage are unioned once');
assert.equal(mixed.totals.uncoveredDurationMs, 10);
assert.deepEqual(mixed.correlatedGaps[0].uncoveredSegments, [{
  startEpochMs: clockOrigin + 190,
  endEpochMs: clockOrigin + 200,
  durationMs: 10,
}]);
assert.deepEqual(
  mixed.phaseRankings.map(row => [row.phase, row.overlapDurationMs]),
  [['buffer-map-readback', 30], ['longtask', 30], ['presentation', 20]],
);
assert.deepEqual(mixed.unexplainedGapsAtOrAboveThreshold, []);

const unexplained = createForegroundHostEventCorrelation({
  foregroundHeartbeat: heartbeat([
    event({ eventId: 'short-host-a', source: 'runtime-explicit', phase: 'host-phase', startMs: 120, endMs: 130 }),
  ]),
  foregroundGaps: [gap({ sharp: [{ startMs: 100, endMs: 120, phase: 'spn', boundary: 'spn' }] })],
  unexplainedThresholdMs: 50,
});
assert.equal(unexplained.status, 'verified');
assert.equal(unexplained.cadenceStatus, 'failed');
assert.deepEqual(unexplained.unexplainedGapsAtOrAboveThreshold, [{
  sampleIndex: 1,
  startEpochMs: clockOrigin + 130,
  endEpochMs: clockOrigin + 200,
  durationMs: 70,
}]);

for (const [name, foregroundHeartbeat, expectedFailure] of [
  ['partial events', heartbeat([], { hostEventCount: 1 }), 'host-events-capped-or-partial'],
  ['capped retention', heartbeat([], { hostEventRetention: 'top-100' }), 'host-events-capped-or-partial'],
  ['wrong firing', heartbeat([event({ eventId: 'wrong-run', source: 'runtime-explicit', phase: 'host', startMs: 110, endMs: 120, eventFiringId: 'stale-firing' })]), 'host-event-firing-mismatch'],
  ['reversed interval', heartbeat([{ ...event({ eventId: 'reversed', source: 'runtime-explicit', phase: 'host', startMs: 110, endMs: 120 }), endMs: 100, endEpochMs: clockOrigin + 100, durationMs: -10 }]), 'host-event-interval-invalid'],
  ['clock mismatch', heartbeat([{ ...event({ eventId: 'wrong-clock', source: 'runtime-explicit', phase: 'host', startMs: 110, endMs: 120 }), startEpochMs: clockOrigin + 111.5 }]), 'host-event-clock-mismatch'],
]) {
  const report = createForegroundHostEventCorrelation({
    foregroundHeartbeat,
    foregroundGaps: [gap()],
  });
  assert.equal(report.status, 'invalid', `${name} must fail attribution authority`);
  assert.ok(report.failures.includes(expectedFailure), `${name} must report ${expectedFailure}`);
}

console.log('foreground host-event correlation contracts passed');
