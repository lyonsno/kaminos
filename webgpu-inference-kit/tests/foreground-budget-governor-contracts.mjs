import assert from 'node:assert/strict';

import {
  FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
  createForegroundBudgetGovernor,
} from '../src/index.js';

const firingId = 'sharp-firing-a';

function hostCorrelation({
  status = 'verified',
  foregroundGapDurationMs = 100,
  sharpCoveredDurationMs = 80,
  hostCoveredDurationMs = 10,
  sharedSharpHostDurationMs = 0,
  uncoveredDurationMs = 10,
  phaseRankings = [{ phase: 'presentation', overlapDurationMs: 10 }],
  unexplained = [],
  correlationFiringId = firingId,
} = {}) {
  return {
    schema: 'kaminos.foreground-host-event-correlation.v0',
    status,
    firingId: correlationFiringId,
    phaseRankings,
    totals: {
      foregroundGapDurationMs,
      sharpCoveredDurationMs,
      hostCoveredDurationMs,
      sharedSharpHostDurationMs,
      hostOnlyDurationMs: hostCoveredDurationMs - sharedSharpHostDurationMs,
      combinedCoveredDurationMs: foregroundGapDurationMs - uncoveredDurationMs,
      uncoveredDurationMs,
    },
    unexplainedGapsAtOrAboveThreshold: unexplained,
    failures: status === 'verified' ? [] : ['host-event-correlation-invalid'],
  };
}

function sharpCorrelation({
  phaseRankings = [{ phase: 'spn-fusion', overlapDurationMs: 72 }],
  correlationFiringId = firingId,
} = {}) {
  return {
    schema: 'kaminos.foreground-sharp-duty-correlation.v0',
    status: 'verified',
    firingId: correlationFiringId,
    phaseRankings,
    failures: [],
  };
}

function observation({
  episodeId,
  maxFrameGapMs = 120,
  host = hostCorrelation(),
  sharp = sharpCorrelation(),
} = {}) {
  return {
    episodeId,
    firingId,
    frameTail: {
      sampleWindowMs: 30_000,
      maxFrameGapMs,
      p95FrameGapMs: 42,
    },
    hostEventCorrelation: host,
    sharpDutyCorrelation: sharp,
  };
}

function governor() {
  return createForegroundBudgetGovernor({
    targetFrameGapMs: 50,
    failureWindowsBeforeAdjust: 2,
    successWindowsBeforeRelax: 2,
    scheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        spnFusionOutputItems: 8,
        gaussianCpuItems: 16_384,
      },
    },
    bounds: {
      yieldMs: { min: 0, max: 20, step: 4 },
      phaseChunkSize: {
        spnFusionOutputItems: { min: 1, max: 8, stepFactor: 2 },
        gaussianCpuItems: { min: 4_096, max: 16_384, stepFactor: 2 },
      },
    },
    phaseControlMap: {
      'spn-fusion': 'spnFusionOutputItems',
      gaussian: 'gaussianCpuItems',
    },
  });
}

const invalidGovernor = governor();
const invalid = invalidGovernor.observe(observation({
  episodeId: 'invalid-a',
  host: hostCorrelation({ status: 'invalid' }),
}));
assert.equal(invalid.schema, FOREGROUND_BUDGET_GOVERNOR_SCHEMA);
assert.equal(invalid.status, 'held-invalid-evidence');
assert.equal(invalid.action, 'hold');
assert.equal(invalid.schedulerChanged, false);
assert.equal(invalid.applicationAuthority, 'decision-state-only-not-runtime-application');
assert.equal(invalid.revision, 0);
assert.deepEqual(invalid.effectiveScheduler, invalid.previousScheduler);
assert.ok(invalid.failures.includes('host-correlation-invalid'));

const staleFiring = governor().observe(observation({
  episodeId: 'stale-firing-a',
  sharp: sharpCorrelation({ correlationFiringId: 'other-firing' }),
}));
assert.equal(staleFiring.status, 'held-invalid-evidence');
assert.ok(staleFiring.failures.includes('sharp-correlation-firing-mismatch'));

const unexplained = governor().observe(observation({
  episodeId: 'unexplained-a',
  host: hostCorrelation({
    unexplained: [{ sampleIndex: 1, startEpochMs: 100, endEpochMs: 180, durationMs: 80 }],
  }),
}));
assert.equal(unexplained.status, 'instrumentation-required');
assert.equal(unexplained.action, 'instrument-unattributed-gap');
assert.equal(unexplained.schedulerChanged, false);
assert.equal(unexplained.revision, 0);

const hostBound = governor().observe(observation({
  episodeId: 'host-bound-a',
  host: hostCorrelation({
    sharpCoveredDurationMs: 10,
    hostCoveredDurationMs: 80,
    phaseRankings: [{ phase: 'ply-blob-assembly', overlapDurationMs: 75 }],
  }),
  sharp: sharpCorrelation({ phaseRankings: [{ phase: 'gaussian', overlapDurationMs: 10 }] }),
}));
assert.equal(hostBound.status, 'host-phase-split-required');
assert.equal(hostBound.action, 'split-host-phase');
assert.equal(hostBound.target, 'ply-blob-assembly');
assert.equal(hostBound.schedulerChanged, false, 'host work must not be disguised as a GPU scheduler adjustment');

const chunkGovernor = governor();
const firstSharpWindow = chunkGovernor.observe(observation({ episodeId: 'sharp-bound-a' }));
assert.equal(firstSharpWindow.status, 'accumulating-pressure');
assert.equal(firstSharpWindow.action, 'reduce-phase-chunk');
assert.equal(firstSharpWindow.schedulerChanged, false);
assert.equal(firstSharpWindow.consecutivePressureWindows, 1);
const reducedChunk = chunkGovernor.observe(observation({ episodeId: 'sharp-bound-b' }));
assert.equal(reducedChunk.status, 'adjusted');
assert.equal(reducedChunk.action, 'reduce-phase-chunk');
assert.equal(reducedChunk.measuredPhase, 'spn-fusion');
assert.equal(reducedChunk.target, 'spnFusionOutputItems');
assert.equal(reducedChunk.schedulerChanged, true);
assert.equal(reducedChunk.previousScheduler.phaseChunkSize.spnFusionOutputItems, 8);
assert.equal(reducedChunk.effectiveScheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(reducedChunk.revision, 1);
assert.equal(reducedChunk.attribution.sharpOnlyDurationMs, 80);
assert.equal(reducedChunk.attribution.hostOnlyDurationMs, 10);

const firstHealthyWindow = chunkGovernor.observe(observation({ episodeId: 'healthy-a', maxFrameGapMs: 36 }));
assert.equal(firstHealthyWindow.status, 'maintaining');
assert.equal(firstHealthyWindow.schedulerChanged, false);
const relaxedChunk = chunkGovernor.observe(observation({ episodeId: 'healthy-b', maxFrameGapMs: 34 }));
assert.equal(relaxedChunk.status, 'relaxed');
assert.equal(relaxedChunk.action, 'relax-phase-chunk');
assert.equal(relaxedChunk.effectiveScheduler.phaseChunkSize.spnFusionOutputItems, 8);
assert.equal(relaxedChunk.revision, 2);

const distributedGovernor = governor();
const distributedSharp = sharpCorrelation({
  phaseRankings: [
    { phase: 'spn-fusion', overlapDurationMs: 32 },
    { phase: 'gaussian', overlapDurationMs: 28 },
    { phase: 'monodepth', overlapDurationMs: 20 },
  ],
});
distributedGovernor.observe(observation({ episodeId: 'distributed-a', sharp: distributedSharp }));
const donated = distributedGovernor.observe(observation({ episodeId: 'distributed-b', sharp: distributedSharp }));
assert.equal(donated.status, 'adjusted');
assert.equal(donated.action, 'increase-yield-budget');
assert.equal(donated.previousScheduler.yieldMs, 4);
assert.equal(donated.effectiveScheduler.yieldMs, 8);
assert.equal(donated.revision, 1);

assert.throws(
  () => createForegroundBudgetGovernor({
    targetFrameGapMs: 50,
    scheduler: { mode: 'cooperative', yieldMs: 4, waitForSubmittedWorkDone: true, phaseChunkSize: {} },
  }),
  /caller-declared bounds/,
  'the governor must not invent hidden scheduler limits',
);

console.log('foreground budget governor contracts passed');
