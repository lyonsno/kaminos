import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CRUCIBLE_FLAME_CONTINUITY_COMPARISON_SCHEMA,
  createCrucibleFlameContinuityComparison,
} from '../lib/crucible-flame-continuity-comparison.mjs';

const sourceAssetId = 'image:greenroom:flame-source-a';
const scheduler = {
  mode: 'cooperative',
  spnPatchChunkSize: 1,
  yieldMs: 3,
  waitForSubmittedWorkDone: true,
  gaussianPhaseYieldMs: 4,
  vitBlockChunkSize: 2,
  cpuChunkItems: 16384,
  routeTailYieldMs: 3,
};
const fireBudget = { resolution: 90, renderScale: 0.4, adaptiveRays: 1 };

function witnessReport(mode, {
  firingId = `firing-${mode}`,
  source = sourceAssetId,
  outputHash = 'sha256:stable-sharp-output',
  packageVersion = '0.1.11',
  sourceLockedVersion = packageVersion,
  requestedScheduler = scheduler,
  effectiveScheduler = scheduler,
  requestedBudget = fireBudget,
  effectiveBudget = fireBudget,
  effectiveMode = mode,
  live = mode === 'live-every-frame' ? 12 : 6,
  holdover = mode === 'bounded-history-holdover' ? 6 : 0,
  fallback = 0,
  p95FrameGapMs = mode === 'bounded-history-holdover' ? 29 : 46,
  p99FrameGapMs = mode === 'bounded-history-holdover' ? 43 : 72,
  maxFrameGapMs = mode === 'bounded-history-holdover' ? 51 : 91,
  routeStatus = 'complete',
  ok = true,
} = {}) {
  const continuityEvidence = {
    schema: 'kaminos.single-flame-continuity-runtime.v0',
    firingId,
    requested: mode,
    effective: effectiveMode,
    mode: holdover > 0 ? 'holdover' : 'live',
    presentationOrdinal: live + holdover,
    counts: { live, holdover, fallback },
    fallbackReason: fallback > 0 ? 'no-valid-history-slot' : null,
  };
  return {
    schema: 'crucible-viewport-witness.v0',
    ok,
    url: 'http://127.0.0.1:8197/?tab=generate',
    inFlightScreenshot: `/tmp/${mode}.png`,
    inFlightCapture: { status: 'captured', path: `/tmp/${mode}.png`, firingId },
    state: {
      sourceSelectionExercise: {
        attempted: true,
        requestedAssetId: sourceAssetId,
        effectiveAssetId: source,
      },
      webgpuInferenceKit: {
        sourceLockedVersion,
        requestedVersion: '0.1.11',
        effectiveVersion: packageVersion,
        status: 'matched',
      },
      fullRoute: {
        status: routeStatus,
        requestedPipelineId: 'sharp-image-to-splat-live-v0',
        effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
        requestedScheduler,
        effectiveScheduler,
        requestedFlameContinuity: mode,
        selectedFlameContinuity: mode,
        effectiveFlameContinuity: effectiveMode,
        flameContinuityEvidence: continuityEvidence,
        output: { path: `/tmp/${mode}.ply`, bytes: 4096, sha256: outputHash, status: 'real' },
        foregroundKilnHeartbeat: {
          schema: 'kaminos.foreground-kiln-heartbeat.v0',
          status: 'verified',
          firingId,
          requestedFireBudget: requestedBudget,
          effectiveFireBudget: effectiveBudget,
          p95FrameGapMs,
          p99FrameGapMs,
          maxFrameGapMs,
          effectiveFirePresentation: {
            firingId,
            flameContinuityRequested: mode,
            flameContinuityEffective: effectiveMode,
            flameContinuityEvidence: continuityEvidence,
          },
          samples: [
            { firePresentation: { flameContinuityEvidence: continuityEvidence } },
          ],
        },
      },
    },
  };
}

const liveReport = witnessReport('live-every-frame');
const holdoverReport = witnessReport('bounded-history-holdover');
const visualInspection = {
  status: 'inspected',
  verdict: 'improved',
  inspectedPaths: [liveReport.inFlightScreenshot, holdoverReport.inFlightScreenshot],
  notes: 'The held route preserved a visible flame during the longest Friendly duty interval.',
};
const comparison = createCrucibleFlameContinuityComparison({
  liveReport,
  holdoverReport,
  visualInspection,
});
assert.equal(comparison.schema, CRUCIBLE_FLAME_CONTINUITY_COMPARISON_SCHEMA);
assert.equal(comparison.status, 'verified');
assert.equal(comparison.classification, 'improved');
assert.deepEqual(comparison.failures, []);
assert.equal(comparison.agreement.source, 'matched');
assert.equal(comparison.agreement.scheduler, 'matched');
assert.equal(comparison.agreement.fireBudget, 'matched');
assert.equal(comparison.agreement.outputHash, 'matched');
assert.equal(comparison.agreement.webgpuInferenceKit, 'matched');
assert.equal(comparison.runs.holdover.counts.holdover, 6);
assert.equal(comparison.cadenceDelta.maxFrameGapMs, -40);

for (const [name, mutation, expectedFailure] of [
  ['source mismatch', { holdoverReport: witnessReport('bounded-history-holdover', { source: 'image:wrong' }) }, 'source-identity-mismatch'],
  ['output mismatch', { holdoverReport: witnessReport('bounded-history-holdover', { outputHash: 'sha256:wrong' }) }, 'output-hash-mismatch'],
  ['package mismatch', { holdoverReport: witnessReport('bounded-history-holdover', { packageVersion: '0.1.23' }) }, 'webgpu-kit-version-mismatch'],
  ['scheduler mismatch', { holdoverReport: witnessReport('bounded-history-holdover', { effectiveScheduler: { ...scheduler, yieldMs: 16 } }) }, 'scheduler-identity-mismatch'],
  ['symmetric scheduler fallback', {
    liveReport: witnessReport('live-every-frame', { effectiveScheduler: { ...scheduler, yieldMs: 16 } }),
    holdoverReport: witnessReport('bounded-history-holdover', { effectiveScheduler: { ...scheduler, yieldMs: 16 } }),
  }, 'scheduler-identity-mismatch'],
  ['budget mismatch', { holdoverReport: witnessReport('bounded-history-holdover', { effectiveBudget: { ...fireBudget, renderScale: 0.5 } }) }, 'fire-budget-mismatch'],
  ['symmetric budget fallback', {
    liveReport: witnessReport('live-every-frame', { effectiveBudget: { ...fireBudget, renderScale: 0.5 } }),
    holdoverReport: witnessReport('bounded-history-holdover', { effectiveBudget: { ...fireBudget, renderScale: 0.5 } }),
  }, 'fire-budget-mismatch'],
  ['symmetric package lock drift', {
    liveReport: witnessReport('live-every-frame', { sourceLockedVersion: '0.1.23' }),
    holdoverReport: witnessReport('bounded-history-holdover', { sourceLockedVersion: '0.1.23' }),
  }, 'webgpu-kit-version-mismatch'],
  ['incomplete route', { holdoverReport: witnessReport('bounded-history-holdover', { routeStatus: 'error' }) }, 'holdover-witness-invalid'],
  ['live route contains held frames', { liveReport: witnessReport('live-every-frame', { holdover: 1 }) }, 'live-holdover-count-present'],
  ['fallback route', { holdoverReport: witnessReport('bounded-history-holdover', { effectiveMode: 'live-every-frame', holdover: 0, fallback: 6 }) }, 'holdover-effective-route-mismatch'],
  ['missing held frames', { holdoverReport: witnessReport('bounded-history-holdover', { holdover: 0 }) }, 'holdover-count-missing'],
  ['failed input witness', { liveReport: witnessReport('live-every-frame', { ok: false }) }, 'live-witness-invalid'],
]) {
  const rejected = createCrucibleFlameContinuityComparison({
    liveReport,
    holdoverReport,
    visualInspection,
    ...mutation,
  });
  assert.equal(rejected.status, 'invalid', `${name} must invalidate the comparison`);
  assert.ok(rejected.failures.includes(expectedFailure), `${name} must report ${expectedFailure}`);
}

const uninspected = createCrucibleFlameContinuityComparison({ liveReport, holdoverReport });
assert.equal(uninspected.status, 'awaiting-visual-inspection');
assert.equal(uninspected.classification, 'unclassified');
assert.ok(uninspected.failures.includes('visual-inspection-missing'));
const invalidVisualVerdict = createCrucibleFlameContinuityComparison({
  liveReport,
  holdoverReport,
  visualInspection: { ...visualInspection, verdict: 'looks-good' },
});
assert.equal(invalidVisualVerdict.status, 'invalid');
assert.ok(invalidVisualVerdict.failures.includes('visual-verdict-invalid'));

const root = mkdtempSync(join(tmpdir(), 'kaminos-continuity-comparison-'));
try {
  const script = new URL('../scripts/compare-crucible-flame-continuity.mjs', import.meta.url).pathname;
  const failureReportPath = join(root, 'failure.json');
  const failure = spawnSync(process.execPath, [
    script,
    '--live-report', join(root, 'missing-live.json'),
    '--holdover-report', join(root, 'missing-holdover.json'),
    '--report', failureReportPath,
  ], { encoding: 'utf8' });
  assert.notEqual(failure.status, 0);
  assert.equal(existsSync(failureReportPath), true, 'pre-comparison failure must still write a durable report');
  const failureDocument = JSON.parse(readFileSync(failureReportPath, 'utf8'));
  assert.equal(failureDocument.schema, 'kaminos.crucible-flame-continuity-comparison-failure.v0');
  assert.equal(failureDocument.ok, false);
  assert.equal(failureDocument.phase, 'reading-witness-reports');
  assert.equal(failureDocument.comparisonWritten, false);

  const livePath = join(root, 'live.json');
  const holdoverPath = join(root, 'holdover.json');
  const comparisonPath = join(root, 'comparison.json');
  writeFileSync(livePath, JSON.stringify(liveReport));
  writeFileSync(holdoverPath, JSON.stringify(holdoverReport));
  const success = spawnSync(process.execPath, [
    script,
    '--live-report', livePath,
    '--holdover-report', holdoverPath,
    '--report', comparisonPath,
    '--visual-verdict', 'improved',
    '--visual-notes', visualInspection.notes,
  ], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  const document = JSON.parse(readFileSync(comparisonPath, 'utf8'));
  assert.equal(document.status, 'verified');
  assert.equal(document.classification, 'improved');
  assert.deepEqual(document.visualInspection.inspectedPaths, visualInspection.inspectedPaths);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Crucible flame continuity comparison contracts passed.');
