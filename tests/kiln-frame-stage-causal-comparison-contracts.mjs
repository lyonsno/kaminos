#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KILN_FRAME_STAGE_CAUSAL_COMPARISON_SCHEMA,
  createKilnFrameStageCausalComparison,
} from '../lib/kiln-frame-stage-causal-comparison.mjs';

const origin = 1_780_000_000_000;

function stage(stageName, startMs, endMs, authority = 'fixture-authority') {
  return {
    stage: stageName,
    startMs,
    endMs,
    startEpochMs: origin + startMs,
    endEpochMs: origin + endMs,
    durationMs: endMs - startMs,
    authority,
  };
}

function ledger({ firingId, mode }) {
  const holdover = mode === 'bounded-history-holdover';
  return {
    schema: 'kaminos.kiln-frame-stage-ledger.v0',
    status: 'complete',
    evidenceStatus: 'verified',
    sampleRetention: 'uncapped',
    firingId,
    clock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: origin,
    },
    frameCount: 3,
    eventCount: 4,
    frames: [
      {
        frameId: `${firingId}:1`,
        path: 'live',
        presentationOrdinal: 1,
        startEpochMs: origin,
        volumeRafGapMs: null,
        stages: [stage('live-source-encode', 1, 5), stage('hybrid-smoke-encode', 5, 6)],
      },
      {
        frameId: `${firingId}:2`,
        path: holdover ? 'holdover' : 'live',
        presentationOrdinal: 2,
        startEpochMs: origin + 16,
        volumeRafGapMs: 16,
        stages: holdover
          ? [
              stage('history-metadata-readback', 18, 30),
              stage('queue-drain', 30, 70),
              stage('hybrid-smoke-encode', 70, 71),
              stage('draw-state-readback', 71, 75),
            ]
          : [stage('live-source-encode', 18, 25), stage('hybrid-smoke-encode', 25, 26)],
      },
      {
        frameId: `${firingId}:3`,
        path: 'live',
        presentationOrdinal: 3,
        startEpochMs: origin + 80,
        volumeRafGapMs: 64,
        stages: [stage('live-source-encode', 81, 85), stage('hybrid-smoke-encode', 85, 86)],
      },
    ],
    events: [0, 16, 80, 96].map((timestampMs, sampleIndex) => ({
      ...stage('main-page-raf', timestampMs, timestampMs, 'foreground-main-page-request-animation-frame'),
      detail: { sampleIndex },
    })),
    failures: [],
    pathCounts: holdover
      ? { live: 2, holdover: 1, fallback: 0 }
      : { live: 3, holdover: 0, fallback: 0 },
    mohelIndicator: { uncappedFrames: true, frameCount: 3, eventCount: 4 },
  };
}

function report({ mode, firingId, outputHash = 'same-output' }) {
  return {
    schema: 'crucible-viewport-witness.v0',
    ok: true,
    state: {
      sourceSelectionExercise: {
        requestedAssetId: 'image-inbox:s_15_img.png',
        effectiveAssetId: 'image-inbox:s_15_img.png',
      },
      fullRoute: {
        status: 'complete',
        requestedPipelineId: 'sharp-image-to-splat-live-v0',
        effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
        requestedScheduler: { mode: 'cooperative', yieldMs: 3 },
        effectiveScheduler: { mode: 'cooperative', yieldMs: 3 },
        requestedFlameContinuity: mode,
        selectedFlameContinuity: mode,
        effectiveFlameContinuity: mode,
        output: { sha256: outputHash, status: 'real' },
        foregroundKilnHeartbeat: {
          firingId,
          requestedFireBudget: { resolution: 90, renderScale: 0.4, adaptiveRays: 1 },
          effectiveFireBudget: { resolution: 90, renderScale: 0.4, adaptiveRays: 1 },
        },
        backgroundHeartbeat: {
          gpuDutyIntervals: {
            schema: 'sharp-webgpu.submitted-work-drain-intervals.v0',
            timingAuthority: 'queue-on-submitted-work-done-host-await-not-gpu-exclusive',
            count: 1,
            intervals: [{
              dutyId: `${firingId}:sharp-duty`,
              startEpochMs: origin + 16,
              endEpochMs: origin + 75,
              phase: 'inference',
              boundary: 'submitted-work-drain',
            }],
          },
        },
        kilnFrameStageLedger: ledger({ firingId, mode }),
      },
    },
  };
}

const liveReport = report({ mode: 'live-every-frame', firingId: 'firing-live' });
const holdoverReport = report({ mode: 'bounded-history-holdover', firingId: 'firing-holdover' });
const comparison = createKilnFrameStageCausalComparison({ liveReport, holdoverReport });

assert.equal(KILN_FRAME_STAGE_CAUSAL_COMPARISON_SCHEMA, 'kaminos.kiln-frame-stage-causal-comparison.v0');
assert.equal(comparison.status, 'verified');
assert.equal(comparison.conclusion, 'shared-sharp-duty-dominant');
assert.equal(comparison.runs.live.mainPageGaps.length, 3, 'the analyzer must not cap ordinary gaps');
assert.equal(comparison.runs.live.disruptions.length, 1);
assert.equal(comparison.runs.live.disruptions[0].durationMs, 64);
assert.ok(comparison.runs.live.disruptionOverlap.sharpDutyFraction > 0.9);
assert.ok(comparison.runs.holdover.disruptionOverlap.sharpDutyFraction > 0.9);
assert.ok(comparison.runs.holdover.disruptionOverlap.holdoverSyncFraction > 0.8);
assert.equal(comparison.findings.sharedSharpDuty.status, 'supported');
assert.equal(comparison.findings.holdoverSync.status, 'additive');
assert.match(comparison.claimBoundary, /host intervals.*not GPU-exclusive.*not display present/i);
assert.equal(comparison.mohelIndicator.gapsUncapped, true);

const mismatched = createKilnFrameStageCausalComparison({
  liveReport,
  holdoverReport: report({
    mode: 'bounded-history-holdover',
    firingId: 'firing-holdover-mismatch',
    outputHash: 'different-output',
  }),
});
assert.equal(mismatched.status, 'invalid');
assert.ok(mismatched.failures.includes('output-hash-mismatch'));
assert.equal(mismatched.conclusion, 'invalid');

const partial = structuredClone(holdoverReport);
partial.state.fullRoute.kilnFrameStageLedger.events.pop();
const partialComparison = createKilnFrameStageCausalComparison({ liveReport, holdoverReport: partial });
assert.equal(partialComparison.status, 'invalid');
assert.ok(partialComparison.failures.includes('holdover-ledger-events-partial'));

const root = mkdtempSync(join(tmpdir(), 'kaminos-frame-stage-causal-'));
try {
  const script = new URL('../scripts/compare-kiln-frame-stages.mjs', import.meta.url).pathname;
  const failureReportPath = join(root, 'failure.json');
  const failure = spawnSync(process.execPath, [
    script,
    '--live-report', join(root, 'missing-live.json'),
    '--holdover-report', join(root, 'missing-holdover.json'),
    '--report', failureReportPath,
  ], { encoding: 'utf8' });
  assert.notEqual(failure.status, 0);
  assert.equal(existsSync(failureReportPath), true, 'a pre-comparison failure must still write a durable causal report');
  const failureDocument = JSON.parse(readFileSync(failureReportPath, 'utf8'));
  assert.equal(failureDocument.schema, 'kaminos.kiln-frame-stage-causal-comparison-failure.v0');
  assert.equal(failureDocument.phase, 'reading-witness-reports');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('kiln frame stage causal comparison contracts passed');
