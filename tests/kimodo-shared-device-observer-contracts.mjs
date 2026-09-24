import assert from 'node:assert/strict';
import { emptyObservationReport, mergeObservation } from '../kimodo-shared-device-observation.mjs';

const report = emptyObservationReport({ requestedUrl: 'http://127.0.0.1:8096/kimodo-shared-device.html' });
mergeObservation(report, {
  at: '2026-09-24T12:00:00.000Z',
  url: 'http://127.0.0.1:8096/kimodo-shared-device.html',
  pageRuntimeId: 1000,
  pageStatePresent: true,
  state: { status: 'generating', progressSequence: 3 },
  samples: [{ atMs: 10, frameCount: 1 }],
  frameIntervals: [16.7],
  foregroundReceipts: [{ requestId: 'r1' }],
  runs: [{ runId: 'run-1', pageP95Ms: null }],
  completedRuns: [],
});
mergeObservation(report, {
  at: '2026-09-24T12:00:00.500Z',
  url: 'http://127.0.0.1:8096/kimodo-shared-device.html',
  pageRuntimeId: 1000,
  pageStatePresent: true,
  state: { status: 'succeeded', progressSequence: 4 },
  samples: [{ atMs: 27, frameCount: 2 }],
  frameIntervals: [17.1],
  foregroundReceipts: [{ requestId: 'r2' }],
  runs: [{ runId: 'run-1', pageP95Ms: 17.1 }],
  completedRuns: [{ runId: 'run-1', telemetry: { observedDuties: 16 } }],
});

assert.equal(report.telemetry.samples.length, 2, 'successive observer reads preserve every newly observed frame sample');
assert.equal(report.telemetry.frameIntervalsMs.length, 2, 'successive observer reads preserve every newly observed RAF interval');
assert.equal(report.telemetry.foregroundReceipts.length, 2, 'successive observer reads preserve foreground service receipts');
assert.deepEqual(report.telemetry.runs, [{ runId: 'run-1', pageP95Ms: 17.1 }], 'mutable per-run telemetry is refreshed through completion');
assert.deepEqual(report.telemetry.completedRuns, [{ runId: 'run-1', telemetry: { observedDuties: 16 } }], 'completed run telemetry is appended once as a durable terminal record');

assert.throws(() => mergeObservation(report, {
  at: '2026-09-24T12:00:01.000Z',
  url: 'http://127.0.0.1:8096/kimodo-shared-device.html',
  pageRuntimeId: 1000,
  pageStatePresent: true,
  state: { status: 'succeeded', progressSequence: 4 },
  sampleOffset: 0,
  samples: [],
  frameIntervalOffset: 2,
  frameIntervals: [],
  foregroundReceiptOffset: 2,
  foregroundReceipts: [],
  runs: [],
}), /offset/, 'a reset or skipped cursor fails loudly instead of producing a partial-success report');

assert.throws(() => mergeObservation(report, {
  at: '2026-09-24T12:00:01.250Z',
  url: 'http://127.0.0.1:8096/kimodo-shared-device.html',
  pageRuntimeId: 2000,
  pageStatePresent: true,
  state: { status: 'idle', progressSequence: 0 },
  samples: [], frameIntervals: [], foregroundReceipts: [], runs: [], completedRuns: [],
}), /page runtime changed/, 'a reload is detected even before replacement arrays grow past the prior cursor');

mergeObservation(report, {
  at: '2026-09-24T12:00:01.500Z',
  url: null,
  pageRuntimeId: 1000,
  pageStatePresent: false,
  state: null,
  samples: [],
  frameIntervals: [],
  foregroundReceipts: [],
  runs: [],
});
assert.equal(report.observations.at(-1).pageStatePresent, false, 'missing page state is represented as missing, not an empty successful run');
console.log('Kimodo shared-device observer contracts passed');
