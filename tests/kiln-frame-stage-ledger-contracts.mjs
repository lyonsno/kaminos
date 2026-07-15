#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  KILN_FRAME_STAGE_LEDGER_SCHEMA,
  createKilnFrameStageLedger,
} from '../lib/kiln-frame-stage-ledger.mjs';

let nowMs = 100;
const timeOriginEpochMs = 1_780_000_000_000;
const ledger = createKilnFrameStageLedger({
  now: () => nowMs,
  timeOriginEpochMs,
});

assert.equal(KILN_FRAME_STAGE_LEDGER_SCHEMA, 'kaminos.kiln-frame-stage-ledger.v0');
assert.equal(ledger.snapshot().status, 'idle');
assert.throws(() => ledger.begin({}), /firingId/, 'the ledger cannot invent firing identity');

ledger.begin({ firingId: 'firing-causal-a' });
const liveFrameId = ledger.beginFrame({
  path: 'live',
  presentationOrdinal: 1,
  continuityMode: 'live-every-frame',
  rafTimestampMs: 100,
  sourceGeneration: 1,
  simulatorStep: 1,
});
ledger.recordStage(liveFrameId, {
  stage: 'live-source-encode',
  startMs: 100.2,
  endMs: 101.8,
  authority: 'cpu-performance-now',
});
ledger.recordStage(liveFrameId, {
  stage: 'hybrid-smoke-encode',
  startMs: 101.8,
  endMs: 102.7,
  authority: 'cpu-performance-now-not-gpu-execution',
});
ledger.recordStage(liveFrameId, {
  stage: 'queue-submit',
  startMs: 102.7,
  endMs: 102.8,
  authority: 'cpu-webgpu-submit-call',
});
nowMs = 103;
ledger.finishFrame(liveFrameId, {
  sourceGeneration: 1,
  simulatorStep: 1,
  compositorFrame: 1,
});

nowMs = 116;
ledger.recordPresentationOpportunity(liveFrameId, {
  timestampMs: 116,
  authority: 'next-volume-raf-opportunity-not-display-present',
});
ledger.recordEvent({
  stage: 'main-page-raf',
  startMs: 115.9,
  endMs: 115.9,
  authority: 'foreground-main-page-request-animation-frame',
  detail: { sampleIndex: 1 },
});
const heldFrameId = ledger.beginFrame({
  path: 'holdover',
  presentationOrdinal: 2,
  continuityMode: 'bounded-history-holdover',
  rafTimestampMs: 116,
  sourceGeneration: 1,
  simulatorStep: 1,
});
ledger.recordStage(heldFrameId, {
  stage: 'history-metadata-readback',
  startMs: 116.1,
  endMs: 119.5,
  authority: 'gpu-copy-map-readback-after-queue-drain',
});
ledger.recordStage(heldFrameId, {
  stage: 'queue-drain',
  startMs: 119.5,
  endMs: 141,
  authority: 'webgpu-on-submitted-work-done',
  detail: { boundary: 'post-hybrid-submit' },
});
ledger.recordStage(heldFrameId, {
  stage: 'draw-state-readback',
  startMs: 141,
  endMs: 143,
  authority: 'gpu-copy-map-readback-after-queue-drain',
});
nowMs = 144;
ledger.finishFrame(heldFrameId, {
  sourceGeneration: 1,
  simulatorStep: 1,
  compositorFrame: 2,
});

const recording = ledger.snapshot();
assert.equal(recording.status, 'recording');
assert.equal(recording.sampleRetention, 'uncapped');
assert.equal(recording.frames.length, 2);
assert.deepEqual(recording.pathCounts, { live: 1, holdover: 1, fallback: 0 });
assert.equal(recording.frames[0].volumeRafGapMs, null);
assert.equal(recording.frames[1].volumeRafGapMs, 16);
assert.equal(recording.frames[0].startEpochMs, timeOriginEpochMs + 100);
assert.equal(recording.frames[0].presentationOpportunity.status, 'observed');
assert.equal(recording.frames[0].presentationOpportunity.latencyFromFrameStartMs, 16);
assert.equal(recording.frames[0].presentationOpportunity.displayPresentAuthority, false);
assert.equal(recording.frames[1].presentationOpportunity.status, 'unavailable');
assert.match(recording.frames[1].presentationOpportunity.reason, /not observed/i);
assert.equal(recording.stageSummary['queue-drain'].count, 1);
assert.equal(recording.stageSummary['queue-drain'].totalMs, 21.5);
assert.equal(recording.stageSummary['history-metadata-readback'].maxMs, 3.4);
assert.equal(recording.events.length, 1);
assert.equal(recording.events[0].stage, 'main-page-raf');
assert.equal(recording.eventSummary['main-page-raf'].count, 1);
assert.equal(recording.mohelIndicator.uncappedFrames, true);
assert.equal(recording.mohelIndicator.frameCount, 2);
assert.equal(recording.mohelIndicator.eventCount, 1);

const compactRecording = ledger.snapshot({ includeRows: false });
assert.equal(compactRecording.frameCount, 2);
assert.equal(compactRecording.eventCount, 1);
assert.equal(Object.hasOwn(compactRecording, 'frames'), false);
assert.equal(Object.hasOwn(compactRecording, 'events'), false);
assert.equal(Object.hasOwn(compactRecording, 'stageSummary'), false);
assert.equal(Object.hasOwn(compactRecording, 'pathCounts'), false);

assert.throws(
  () => ledger.recordStage(heldFrameId, {
    stage: 'made-up-stage',
    startMs: 144,
    endMs: 145,
    authority: 'wishful-thinking',
  }),
  /unsupported stage/i,
  'unknown stages cannot silently enter causal evidence',
);
assert.throws(
  () => ledger.recordStage(heldFrameId, {
    stage: 'queue-drain',
    startMs: 150,
    endMs: 149,
    authority: 'webgpu-on-submitted-work-done',
  }),
  /ordered/i,
  'reversed intervals cannot masquerade as timing evidence',
);
assert.throws(
  () => ledger.beginFrame({
    path: 'mystery',
    presentationOrdinal: 3,
    continuityMode: 'bounded-history-holdover',
  }),
  /unsupported frame path/i,
  'a frame must identify the route that actually ran',
);

const fallbackLedger = createKilnFrameStageLedger({
  now: () => nowMs,
  timeOriginEpochMs,
});
fallbackLedger.begin({ firingId: 'firing-fallback-a' });
const fallbackFrameId = fallbackLedger.beginFrame({
  path: 'holdover',
  presentationOrdinal: 1,
  continuityMode: 'bounded-history-holdover',
  rafTimestampMs: nowMs,
});
fallbackLedger.setFramePath(fallbackFrameId, 'fallback', {
  reason: 'selected history slot failed closed before draw',
});
assert.equal(fallbackLedger.snapshot().frames[0].path, 'fallback');
assert.deepEqual(fallbackLedger.snapshot().frames[0].pathTransitions, [{
  from: 'holdover',
  to: 'fallback',
  reason: 'selected history slot failed closed before draw',
}]);
assert.deepEqual(
  fallbackLedger.snapshot().pathCounts,
  { live: 0, holdover: 0, fallback: 1 },
  'the ledger must report the route that actually ran, not only the requested route',
);
assert.throws(
  () => fallbackLedger.setFramePath(fallbackFrameId, 'mystery', { reason: 'bad route' }),
  /unsupported frame path/i,
);

const terminalLedger = createKilnFrameStageLedger({
  now: () => nowMs,
  timeOriginEpochMs,
});
terminalLedger.begin({ firingId: 'firing-terminal-tail-a' });
const terminalFrameId = terminalLedger.beginFrame({
  path: 'live',
  presentationOrdinal: 1,
  continuityMode: 'live-every-frame',
  rafTimestampMs: nowMs,
});
terminalLedger.finishFrame(terminalFrameId, { endMs: nowMs + 1 });
terminalLedger.markTerminalPresentationUnavailable(terminalFrameId, {
  reason: 'fire episode ended before a subsequent volume RAF opportunity',
});
const terminalComplete = terminalLedger.end({ firingId: 'firing-terminal-tail-a', status: 'complete' });
assert.equal(terminalComplete.evidenceStatus, 'verified');
assert.equal(terminalComplete.frames[0].presentationOpportunity.status, 'unavailable');
assert.equal(terminalComplete.frames[0].presentationOpportunity.expectedTerminalTail, true);
assert.match(terminalComplete.frames[0].presentationOpportunity.reason, /fire episode ended/i);

const mutable = ledger.snapshot();
mutable.frames[0].stages[0].durationMs = 999;
assert.equal(ledger.snapshot().frames[0].stages[0].durationMs, 1.6, 'snapshots cannot mutate ledger truth');

const complete = ledger.end({ firingId: 'firing-causal-a', status: 'complete' });
assert.equal(complete.status, 'complete');
assert.equal(complete.failures.length, 1);
assert.match(complete.failures[0], /presentation opportunity unavailable.*ordinal 2/i);
assert.equal(complete.evidenceStatus, 'partial');
assert.throws(
  () => ledger.end({ firingId: 'wrong-firing', status: 'complete' }),
  /does not match/i,
  'a different firing cannot close the ledger',
);

console.log('kiln frame stage ledger contracts passed');
