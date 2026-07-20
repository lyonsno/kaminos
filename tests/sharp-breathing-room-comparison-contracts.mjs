import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  SHARP_BREATHING_ROOM_COMPARISON_SCHEMA,
  SHARP_MONODEPTH_PHASE_LABELS,
  SHARP_SPN_LOWRES_BLOCK_LABELS,
  createSharpBreathingRoomComparison,
  sharpBreathingRoomSchedulerProfileForMode,
  sharpBreathingRoomComparisonProfiles,
} from '../lib/sharp-breathing-room-comparison.mjs';
import { SHARP_BREATHING_ROOM_VALIDATION_SCHEMA } from '../lib/sharp-breathing-room-validation.mjs';
import { createSchedulerVerificationReceipt } from '../lib/scheduler-verification-receipt.mjs';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'pipelines', 'asset-pipelines.json');
const witnessPath = join(root, 'pipeline-witness.mjs');
const runnerPath = join(root, 'scripts', 'run-sharp-breathing-room-comparison.mjs');

function schedulerVerification({
  status = 'verified',
  timingAuthority = 'browser-wall-clock',
  boundaryAssertions = true,
  lowresBlocks = true,
  monodepthLabels = true,
} = {}) {
  const lowresEvents = lowresBlocks
    ? SHARP_SPN_LOWRES_BLOCK_LABELS.map((block, index) => ({
        tMs: 7 + index,
        phase: 'spn-fusion',
        boundary: 'spn-lowres-fusion',
        kind: 'js-yield-end',
        index,
        source: 'mock',
        details: { block },
      }))
    : [];
  const monodepthEvents = monodepthLabels
    ? SHARP_MONODEPTH_PHASE_LABELS.map((label, index) => ({
        tMs: 7 + lowresEvents.length + index,
        phase: label,
        boundary: 'monodepth-phase',
        kind: 'js-yield-end',
        index,
        source: 'mock',
        label: label.startsWith('fusion-') ? 'decoder.fusions.1' : undefined,
      }))
    : [];
  const eventTrace = {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority,
    events: status === 'verified'
      ? [
          { tMs: 1, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'chunk-start', index: 0, source: 'mock' },
          { tMs: 2, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-start', index: 0, source: 'mock' },
          { tMs: 3, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-end', index: 0, queueDoneMs: 1, source: 'mock' },
          { tMs: 4, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-start', index: 0, source: 'mock' },
          { tMs: 6, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-end', index: 0, yieldMs: 2, source: 'mock' },
          ...lowresEvents,
          ...monodepthEvents,
        ]
      : [],
  };
  const assertions = boundaryAssertions ? [
    {
      field: 'phaseChunkSize.spnPatch',
      requested: 1,
      effective: 1,
      status: 'verified',
      observedBoundary: 'spn-patch-chunk',
      observedCount: 1,
      expectedMinimumCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
      unsupportedReason: null,
    },
  ] : [];
  if (boundaryAssertions) {
    return createSchedulerVerificationReceipt({
      route: {
        pipelineId: 'sharp-image-to-splat-live-v0',
        requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
        effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
        backendClass: 'browser-webgpu',
        adapterReport: { path: '/tmp/sharp-adapter-report.json', sha256: '0'.repeat(64) },
      },
      scheduler: {
        schema: 'kaminos.webgpu-route-scheduler.v0',
        requestedScheduler: {
          mode: 'cooperative',
          phaseChunkSize: { spnPatch: 1 },
          waitForSubmittedWorkDone: true,
          yieldMs: 2,
        },
        effectiveScheduler: {
          mode: 'cooperative',
          phaseChunkSize: { spnPatch: 1 },
          waitForSubmittedWorkDone: true,
          yieldMs: 2,
          unsupportedFields: [],
        },
        verificationState: status,
      },
      backpressure: {
        schema: 'kaminos.webgpu-route-backpressure.v0',
        effectiveBudget: 'furnace',
      },
      eventTrace,
      boundaryAssertions: assertions,
      frameTail: {
        evidenceSource: timingAuthority,
        disclaimer: 'not-gpu-exclusive-or-present-latency',
        rafFps: 8.1,
        frameP95Ms: 124.1,
        queueDoneP95Ms: 473.6,
      },
    });
  }
  return {
    schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
    status,
    classification: status === 'verified' ? 'observed-boundary' : 'config-only',
    observationClass: status === 'verified' ? 'observed-stage-boundary' : 'config-only',
    downgrades: status === 'verified' ? [] : ['yield-events-missing'],
    eventTrace,
    boundaryAssertions: assertions,
    frameTail: {
      evidenceSource: timingAuthority,
      rafFps: 8.1,
      frameP95Ms: 124.1,
      queueDoneP95Ms: 473.6,
    },
  };
}

function routeRun({
  profileId,
  schedulerMode,
  sha256 = 'a'.repeat(64),
  outputBytes = 66060836,
  scheduler = schedulerVerification(),
  durationMs = 111000,
  frameP95Ms = 124.1,
  queueDoneP95Ms = 473.6,
} = {}) {
  return {
    profileId,
    witnessReport: {
      ok: true,
      requestedPipelineId: 'sharp-image-to-splat-live-v0',
      effectiveRouteConfig: {
        routeId: 'adapter.sharp-image-to-splat-live.v0',
      },
      stages: [
        {
          id: 'run-sharp-image-to-splat',
          status: 'real',
          effectiveRoute: {
            pipelineScheduler: {
              schema: 'kaminos.pipeline-scheduler-composition.v0',
              requestedScheduler: { mode: schedulerMode },
              effectiveScheduler: { mode: schedulerMode },
              schedulerVerification: scheduler,
            },
            adapterReport: {
              outputBytes,
              breathingRoom: {
                requestedScheduler: { mode: schedulerMode },
                effectiveScheduler: { mode: schedulerMode },
              },
            },
          },
          durationMs,
        },
      ],
      artifacts: {
        splat: {
          path: `/tmp/${profileId}.ply`,
          bytes: outputBytes,
          sha256,
          status: 'real',
        },
      },
      routePhaseTimeline: [
        { phase: 'sharp-webgpu:spn-patch-encoder', at: '2026-07-04T00:00:00.000Z' },
      ],
      currentRoutePhase: {
        phase: 'sharp-webgpu:write-metadata',
        finalSplatReady: true,
      },
    },
    contentionReport: {
      schema: 'kaminos.compute-route-contention-witness.v0',
      visualSourceTruth: {
        source: 'live-webgpu-volume',
        fallbackReason: null,
        mayClaimLiveNovelty: true,
      },
      timing: {
        evidenceSource: 'raf-and-queue-proxy',
        disclaimer: 'not-gpu-exclusive-or-present-latency',
        rafFps: 8.06,
        frameP95Ms,
        frameP99Ms: frameP95Ms + 25,
        queueDoneP95Ms,
        queueDoneP99Ms: queueDoneP95Ms + 50,
      },
      routePhaseTimeline: [
        { phase: 'sharp-webgpu:spn-patch-encoder' },
        { phase: 'sharp-webgpu:write-ply' },
      ],
    },
  };
}

const profiles = sharpBreathingRoomComparisonProfiles();
assert.equal(profiles.schema, 'kaminos.sharp-breathing-room-comparison-profiles.v0');
assert.equal(profiles.pairingKind, 'default-vs-cooperative');
assert.equal(profiles.profiles[0].id, 'baseline-default');
assert.equal(profiles.profiles[0].schedulerMode, 'default');
assert.equal(profiles.profiles[0].scheduler.mode, 'default');
assert.equal(profiles.profiles[0].env.KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE, 'default');
assert.equal(profiles.profiles[0].proofExpectation.schedulerVerification, 'not-verified-without-observed-events');
assert.equal(profiles.profiles[1].id, 'cooperative-spn-gaussian');
assert.equal(profiles.profiles[1].schedulerMode, 'friendly');
assert.equal(profiles.profiles[1].scheduler.mode, 'cooperative');
assert.equal(profiles.profiles[1].scheduler.spnPatchChunkSize, 1);
assert.equal(profiles.profiles[1].scheduler.waitForSubmittedWorkDone, true);
assert.equal(profiles.profiles[1].scheduler.gaussianPhaseYieldMs > 0, true);
assert.equal(profiles.profiles[1].scheduler.cpuChunkItems, 16384);
assert.equal(profiles.profiles[1].scheduler.routeTailYieldMs, 3);
assert.equal(profiles.profiles[1].scheduler.vitBlockChunkSize, 1);
assert.equal(profiles.profiles[1].scheduler.vitMicroduty, true);
assert.equal(profiles.profiles[1].scheduler.vitMicrodutyMode, 'dispatch-major');
assert.equal(profiles.profiles[1].scheduler.spnFusionChunkItems, 524288);
assert.equal(profiles.profiles[1].scheduler.plyAssemblyMode, 'worker');
assert.equal(profiles.profiles[1].scheduler.retirePostInferenceBuffers, true);
assert.deepEqual(profiles.profiles[1].unsupportedFields, []);
assert.equal(profiles.profiles[1].env.KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE, 'friendly');

const friendlyProfile = sharpBreathingRoomSchedulerProfileForMode('friendly');
assert.equal(friendlyProfile.id, 'cooperative-spn-gaussian');
assert.equal(friendlyProfile.scheduler.mode, 'cooperative');
assert.equal(friendlyProfile.scheduler.spnPatchChunkSize, 1);
assert.equal(friendlyProfile.scheduler.gaussianPhaseYieldMs, 4);
assert.equal(friendlyProfile.scheduler.vitBlockChunkSize, 1);
assert.equal(friendlyProfile.scheduler.vitMicroduty, true);
assert.equal(friendlyProfile.scheduler.vitMicrodutyMode, 'dispatch-major');
assert.equal(friendlyProfile.scheduler.spnFusionChunkItems, 524288);
assert.equal(friendlyProfile.scheduler.plyAssemblyMode, 'worker');
assert.equal(friendlyProfile.scheduler.retirePostInferenceBuffers, true);
assert.deepEqual(friendlyProfile.unsupportedFields, []);
assert.equal(sharpBreathingRoomSchedulerProfileForMode('cooperative-spn-gaussian').schedulerMode, 'friendly');
assert.throws(
  () => sharpBreathingRoomSchedulerProfileForMode('bogus-friendly'),
  /unknown SHARP breathing-room scheduler mode/,
  'unknown Wake button modes must fail loud instead of silently using default',
);

const valid = createSharpBreathingRoomComparison({
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  routeId: 'adapter.sharp-image-to-splat-live.v0',
  input: { path: '/tmp/source.png', sha256: 'f'.repeat(64), bytes: 10 },
  flameBudget: { budgetId: 'real-flame-over-sharp-0704', rayBudgetPreset: 'operator-live-fire' },
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default', durationMs: 120000 }),
    routeRun({ profileId: 'cooperative-spn-gaussian', schedulerMode: 'cooperative', durationMs: 118000 }),
  ],
});
assert.equal(valid.schema, SHARP_BREATHING_ROOM_COMPARISON_SCHEMA);
assert.equal(valid.validation.schema, SHARP_BREATHING_ROOM_VALIDATION_SCHEMA);
assert.equal(valid.validation.ok, true);
assert.equal(valid.validation.canClaim.breathingRoomSmoke, true);
assert.equal(valid.canClaim.breathingRoomSmoke, true);
assert.equal(valid.status, 'valid-smoke');
assert.equal(valid.evidenceClass, 'single-pair-smoke');
assert.equal(valid.claimBoundary, 'single-pair smoke only; no optimization, speedup, slowdown, or stable throughput claim');
assert.equal(valid.routeIdentity.requestedPipelineId, 'sharp-image-to-splat-live-v0');
assert.equal(valid.routeIdentity.effectiveRouteId, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(valid.outputEquivalence.status, 'same-output');
assert.equal(valid.outputEquivalence.sha256, 'a'.repeat(64));
assert.equal(valid.schedulerComparison.baseline.status, 'verified');
assert.equal(valid.schedulerComparison.cooperative.status, 'verified');
assert.equal(valid.schedulerComparison.cooperative.unsupportedFields.includes('vitBlockChunkSize'), false);
assert.equal(valid.schedulerComparison.cooperative.spnFusionCoverage.status, 'complete');
assert.deepEqual(valid.schedulerComparison.cooperative.spnFusionCoverage.missingSpnFusionBlocks, []);
assert.equal(valid.schedulerComparison.cooperative.monodepthPhaseCoverage.status, 'complete');
assert.deepEqual(valid.schedulerComparison.cooperative.monodepthPhaseCoverage.missingMonodepthPhaseLabels, []);
assert.equal(valid.timingComparison.adapterInferenceDurationMs.baseline, 120000);
assert.equal(valid.timingComparison.adapterInferenceDurationMs.cooperative, 118000);
assert.equal(valid.timingComparison.frameP95Ms.baseline, 124.1);
assert.equal(valid.timingComparison.queueDoneP95Ms.cooperative, 473.6);
assert.deepEqual(valid.falseClosureChecks.singlePairOptimizationClaimRejected, true);
assert.deepEqual(valid.downgrades, ['single-pair-smoke-not-optimization-proof']);

const mismatchedOutput = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default', sha256: 'a'.repeat(64) }),
    routeRun({ profileId: 'cooperative-spn-gaussian', schedulerMode: 'cooperative', sha256: 'b'.repeat(64) }),
  ],
});
assert.equal(mismatchedOutput.status, 'invalid');
assert.equal(mismatchedOutput.validation.errors.includes('same-input-output-mismatch'), true);
assert.ok(mismatchedOutput.downgrades.includes('same-input-output-mismatch'));
assert.equal(mismatchedOutput.falseClosureChecks.sameInputOutputMismatch, true);

const missingProof = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default' }),
    routeRun({
      profileId: 'cooperative-spn-gaussian',
      schedulerMode: 'cooperative',
      scheduler: schedulerVerification({ status: 'verified', boundaryAssertions: false }),
    }),
  ],
});
assert.equal(missingProof.status, 'invalid');
assert.ok(missingProof.downgrades.includes('cooperative-verified-without-boundary-proof'));
assert.equal(missingProof.falseClosureChecks.verifiedWithoutObservedBoundary, true);

const proxyOnly = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default' }),
    routeRun({
      profileId: 'cooperative-spn-gaussian',
      schedulerMode: 'cooperative',
      scheduler: schedulerVerification({ timingAuthority: 'raf-and-queue-proxy' }),
    }),
  ],
});
assert.equal(proxyOnly.status, 'invalid');
assert.ok(proxyOnly.downgrades.includes('cooperative-scheduler-proof-proxy-only'));
assert.equal(proxyOnly.falseClosureChecks.proxyOnlySchedulerProof, true);

const missingLowresBlocks = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default' }),
    routeRun({
      profileId: 'cooperative-spn-gaussian',
      schedulerMode: 'cooperative',
      scheduler: schedulerVerification({ lowresBlocks: false }),
    }),
  ],
});
assert.equal(missingLowresBlocks.status, 'invalid');
assert.ok(missingLowresBlocks.downgrades.includes('cooperative-spn-lowres-labels-missing'));
assert.equal(missingLowresBlocks.falseClosureChecks.spnLowresLabelsMissing, true);
assert.deepEqual(missingLowresBlocks.schedulerComparison.cooperative.spnFusionCoverage.missingSpnFusionBlocks, SHARP_SPN_LOWRES_BLOCK_LABELS);

const missingMonodepthLabels = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default' }),
    routeRun({
      profileId: 'cooperative-spn-gaussian',
      schedulerMode: 'cooperative',
      scheduler: schedulerVerification({ monodepthLabels: false }),
    }),
  ],
});
assert.equal(missingMonodepthLabels.status, 'invalid');
assert.ok(missingMonodepthLabels.downgrades.includes('cooperative-monodepth-phase-labels-missing'));
assert.equal(missingMonodepthLabels.falseClosureChecks.monodepthPhaseLabelsMissing, true);
assert.deepEqual(
  missingMonodepthLabels.schedulerComparison.cooperative.monodepthPhaseCoverage.missingMonodepthPhaseLabels,
  SHARP_MONODEPTH_PHASE_LABELS,
);

const missingFlameTiming = createSharpBreathingRoomComparison({
  runs: [
    routeRun({ profileId: 'baseline-default', schedulerMode: 'default', frameP95Ms: null }),
    routeRun({ profileId: 'cooperative-spn-gaussian', schedulerMode: 'cooperative' }),
  ],
});
assert.equal(missingFlameTiming.status, 'invalid');
assert.ok(missingFlameTiming.downgrades.includes('baseline-frame-queue-evidence-missing'));
assert.equal(missingFlameTiming.falseClosureChecks.missingFrameQueueEvidence, true);

assert.ok(existsSync(runnerPath), 'Pipeline must ship a headless SHARP breathing-room comparison runner for Wake harness composition');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-sharp-breathing-comparison-'));
try {
  const input = join(tempRoot, 'source.png');
  const mockSharpCommand = join(tempRoot, 'mock-sharp-command.mjs');
  const report = join(tempRoot, 'comparison.json');
  const outDir = join(tempRoot, 'out');
  writeFileSync(input, 'fake image bytes\n');
  writeFileSync(mockSharpCommand, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
const artifactPaths = JSON.parse(process.env.KAMINOS_PIPELINE_ARTIFACT_PATHS || '{}');
const scheduler = JSON.parse(process.env.KAMINOS_SHARP_WEBGPU_SCHEDULER || '{"mode":"default"}');
const bytes = readFileSync(input);
const hash = createHash('sha256').update(bytes).digest('hex');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  'ply',
  'format ascii 1.0',
  'element vertex 1',
  'property float x',
  'property float y',
  'property float z',
  'end_header',
  '0 0 0',
  ''
].join('\\n'));
for (const path of [artifactPaths.depthMap, artifactPaths.metadata, artifactPaths.autoCropEvidence].filter(Boolean)) {
  mkdirSync(dirname(path), { recursive: true });
}
writeFileSync(artifactPaths.depthMap, 'depth\\n');
writeFileSync(artifactPaths.metadata, JSON.stringify({ schema: 'kaminos.sharp-webgpu-metadata.v0' }) + '\\n');
writeFileSync(artifactPaths.autoCropEvidence, JSON.stringify({ schema: 'kaminos.splat-autocrop-evidence.v0', status: 'complete' }) + '\\n');
const stat = statSync(output);
const isCooperative = scheduler.mode === 'cooperative';
writeFileSync(report, JSON.stringify({
  schema: 'mock.sharp-adapter-report.v0',
  ok: true,
  input: { path: input, sha256: hash, bytes: bytes.length },
  output: { path: output, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(output)).digest('hex') },
  outputBytes: stat.size,
  breathingRoom: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    status: isCooperative ? 'verified' : 'scheduler-unverified',
    requestedScheduler: scheduler,
    effectiveScheduler: scheduler,
    unsupportedFields: isCooperative ? ['vitBlockChunkSize'] : [],
    telemetry: {
      timingAuthority: isCooperative ? 'browser-wall-clock' : 'not-observed',
      events: isCooperative ? [
        { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'chunk-start' },
        { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-start' },
        { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-end' },
        { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-start' },
        { phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-end' },
        { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'queue-work-done-start' },
        { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'queue-work-done-end' },
        { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'js-yield-start' },
        { phase: 'gaussian', boundary: 'gaussian-phase', kind: 'js-yield-end' },
        ...${JSON.stringify(SHARP_SPN_LOWRES_BLOCK_LABELS)}.map(block => ({ phase: 'spn-fusion', boundary: 'spn-lowres-fusion', kind: 'js-yield-end', details: { block } })),
        ...${JSON.stringify(SHARP_MONODEPTH_PHASE_LABELS)}.map(label => ({ phase: label, boundary: 'monodepth-phase', kind: 'js-yield-end', label: label.startsWith('fusion-') ? 'decoder.fusions.1' : undefined }))
      ] : [],
      boundaryAssertions: isCooperative ? [
        { field: 'phaseChunkSize.spnPatch', status: 'verified', observedBoundary: 'spn-patch-chunk', observedCount: 1, observedQueueWaitCount: 1, observedYieldCount: 1 },
        { field: 'phaseYieldMs.gaussianPhase', status: 'verified', observedBoundary: 'gaussian-phase', observedCount: 1, observedQueueWaitCount: 1, observedYieldCount: 1 }
      ] : []
    }
  },
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: artifactPaths.depthMap },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: artifactPaths.metadata },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', schema: 'kaminos.splat-autocrop-evidence.v0', path: artifactPaths.autoCropEvidence }
  ],
  outputs: {
    splat: { id: 'splat', role: 'splat-candidate', path: output },
    depthMap: { id: 'depthMap', role: 'depth-map', path: artifactPaths.depthMap },
    metadata: { id: 'metadata', role: 'sharp-webgpu-metadata', path: artifactPaths.metadata },
    autoCropEvidence: { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', schema: 'kaminos.splat-autocrop-evidence.v0', path: artifactPaths.autoCropEvidence }
  }
}, null, 2) + '\\n');
`);
  chmodSync(mockSharpCommand, 0o755);
  const proc = spawnSync(process.execPath, [
    runnerPath,
    '--manifest', manifestPath,
    '--witness', witnessPath,
    '--input', input,
    '--out-dir', outDir,
    '--report', report,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_COMMAND: mockSharpCommand,
    },
  });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  const runnerReport = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(runnerReport.schema, SHARP_BREATHING_ROOM_COMPARISON_SCHEMA);
  assert.equal(runnerReport.validation.schema, SHARP_BREATHING_ROOM_VALIDATION_SCHEMA);
  assert.equal(runnerReport.status, 'invalid');
  assert.equal(runnerReport.validation.ok, false);
  assert.equal(runnerReport.validation.errors.some(error => error.endsWith('-fixture-route')), true);
  assert.equal(runnerReport.falseClosureChecks.fallbackOrFixtureRoute, true);
  assert.ok(runnerReport.downgrades.includes('flame-contention-evidence-not-provided'));
  assert.equal(runnerReport.runs.length, 2);
  assert.equal(runnerReport.runs[0].profileId, 'baseline-default');
  assert.equal(runnerReport.runs[1].profileId, 'cooperative-spn-gaussian');
  assert.equal(runnerReport.runs[0].witnessReportPath.startsWith(outDir), true);
  assert.equal(runnerReport.runs[1].witnessReportPath.startsWith(outDir), true);
  assert.equal(runnerReport.schedulerComparison.cooperative.unsupportedFields.includes('vitBlockChunkSize'), true);
  assert.equal(runnerReport.claimBoundary, 'single-pair smoke only; no optimization, speedup, slowdown, or stable throughput claim');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
