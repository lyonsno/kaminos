import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA,
  buildComputeRouteContentionWitness,
  buildComputeRouteContentionWitnessFromReport,
  classifyFrameTailDamage,
} from '../compute-route-contention-witness.mjs';

const baseVisualReport = {
  schema: 'kaminos.compute-route-fire-visual-report.v0',
  phase: 'complete',
  runPipeline: true,
  pipelineId: 'sharp-image-to-splat-live-v0',
  routeId: 'adapter.sharp-image-to-splat-live.v0',
  input: '/tmp/kaminos/source.png',
  pipelineReportPath: '/tmp/kaminos-route/pipeline-witness.json',
  activeWitness: {
    schema: 'kaminos.compute-route-fire-witness.v0',
    phase: 'pipeline-running',
    routeRun: {
      schema: 'kaminos.kiln.tray-route-run.v0',
      runId: 'sharp-image-to-splat-live-v0-active',
      requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      statusBadge: 'real',
      routePhase: 'running',
      receiptId: '/tmp/kaminos-route/pipeline-witness.json',
      sourceTruthWarnings: [],
      routeActivity: {
        routePhase: 'running',
        requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
        effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
        backendClass: 'browser-webgpu',
        visualAuthority: 'live-compute',
        truthMode: 'live',
        fire: {
          visualAuthority: 'live-compute',
          allowsFullBurn: true,
          spendIntensity: 1,
        },
      },
    },
    primaryBridge: {
      routeRunId: 'sharp-image-to-splat-live-v0-active',
      visualReceipt: {
        visualPhase: 'burn',
        allowsFullBurn: true,
        visualBackendId: 'beaming.volume-fire.kiln-v0',
      },
    },
  },
  finalWitness: {
    schema: 'kaminos.compute-route-fire-witness.v0',
    phase: 'pipeline-complete',
    routeRun: {
      schema: 'kaminos.kiln.tray-route-run.v0',
      runId: 'sharp-image-to-splat-live-v0-complete',
      requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      statusBadge: 'real',
      routePhase: 'completed',
      receiptId: '/tmp/kaminos-route/pipeline-witness.json',
      sourceTruthWarnings: ['pipeline_route_completed_not_active_compute'],
      routeActivity: {
        routePhase: 'completed',
        requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
        effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
        backendClass: 'browser-webgpu',
        visualAuthority: 'settled-output',
        truthMode: 'live',
        fire: {
          visualAuthority: 'settled-output',
          allowsFullBurn: false,
          spendIntensity: 0,
        },
      },
    },
    primaryBridge: {
      routeRunId: 'sharp-image-to-splat-live-v0-complete',
      visualReceipt: {
        visualPhase: 'cooled',
        allowsFullBurn: false,
        visualBackendId: 'beaming.volume-fire.kiln-v0',
      },
    },
  },
  visualWitnessReport: {
    schema: 'kaminos.volume-witness.v0',
    ok: true,
    evidenceMode: 'performance',
    visualEvidenceMode: 'performance-volume-signal',
    timingEvidenceSource: 'raf-and-queue-proxy',
    timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
    frameCount: 144,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: 31.7,
      frameDeltaMs: 19.8,
      frameP95Ms: 72.4,
      queueDoneMs: 35.1,
      queueDoneP95Ms: 140.2,
      queueSamples: 18,
    },
    controls: {
      rayBudgetPreset: 'live',
      raySteps: 72,
      adaptiveRays: 0.65,
      renderScale: 0.75,
    },
    simCostLedger: {
      simCostEvidenceSource: 'cpu-structural-pass-ledger-plus-raf-queue-proxy',
      fullGridPassesPerFrame: 5,
      fullGridCellVisitsPerFrame: 10485760,
    },
  },
  pipelineReport: {
    schema: 'kaminos.pipeline-witness.v0',
    ok: true,
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectivePipelineId: 'sharp-image-to-splat-live-v0',
    artifacts: {
      splat: {
        role: 'splat-candidate',
        status: 'real',
        path: '/tmp/kaminos-route/artifacts/sharp-output.ply',
        bytes: 66060836,
      },
    },
    stages: [
      {
        id: 'run-sharp-image-to-splat',
        status: 'real',
        requestedRoute: 'adapter.sharp-image-to-splat.v0',
        effectiveRoute: {
          id: 'adapter.sharp-image-to-splat.v0',
          effectiveBackend: 'browser-webgpu',
          scheduler: {
            schema: 'kaminos.webgpu-route-scheduler.v0',
            requestedScheduler: {
              mode: 'cooperative',
              yieldMs: 2,
              waitForSubmittedWorkDone: true,
              phaseChunkSize: {
                spnPatch: 1,
                vitBlock: 6,
              },
            },
            effectiveScheduler: {
              mode: 'cooperative',
              yieldMs: 2,
              waitForSubmittedWorkDone: true,
              phaseChunkSize: {
                spnPatch: 1,
                vitBlock: 6,
              },
              unsupportedFields: [],
            },
            verificationState: 'verified',
          },
          backpressure: {
            schema: 'kaminos.webgpu-route-backpressure.v0',
            requestedBudget: 'visible-wait',
            effectiveBudget: 'visible-wait',
            memoryExclusivity: 'shared',
            warmCacheState: 'warm',
            frameTail: {
              sampleWindowMs: 30000,
              longFrameCount: 7,
              maxFrameGapMs: 118,
              p95FrameGapMs: 72.4,
              p99FrameGapMs: null,
            },
          },
          optimization: {
            profile: 'cooperative',
            kernelProfile: 'sharp-vit-split-v0',
            fusionBoundary: 'bounded-phase',
          },
          breathingRoom: {
            schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
            verificationState: 'verified',
            requestedScheduler: {
              mode: 'cooperative',
              spnPatchChunkSize: 1,
              vitBlockChunkSize: 6,
            },
            effectiveScheduler: {
              mode: 'cooperative',
              spnPatchChunkSize: 1,
              vitBlockChunkSize: 6,
              unsupportedFields: [],
            },
          },
        },
      },
    ],
  },
};

assert.equal(COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA, 'kaminos.compute-route-contention-witness.v0');
assert.equal(classifyFrameTailDamage({ frameP95Ms: 18, queueDoneP95Ms: 28 }).bucket, 'clean');
assert.equal(classifyFrameTailDamage({ frameP95Ms: 34, queueDoneP95Ms: 64 }).bucket, 'warm');
assert.equal(classifyFrameTailDamage({ frameP95Ms: 72, queueDoneP95Ms: 140 }).bucket, 'hot');
assert.equal(classifyFrameTailDamage({ frameP95Ms: 160, queueDoneP95Ms: 310 }).bucket, 'deranged');
assert.equal(classifyFrameTailDamage({}).bucket, 'unknown');
assert.ok(classifyFrameTailDamage({}).reasons.includes('frame_p95_missing'));
assert.ok(classifyFrameTailDamage({}).reasons.includes('queue_p95_missing'));

const witness = buildComputeRouteContentionWitnessFromReport(baseVisualReport, {
  witnessId: 'contention-contract-001',
  requestedVisualBudget: {
    budgetId: 'live',
    rayBudgetPreset: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});

assert.equal(witness.schema, COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA);
assert.equal(witness.witnessId, 'contention-contract-001');
assert.equal(witness.acceptanceSurface, 'wake.compute-route-contention-witness');
assert.equal(witness.routeIdentity.pipelineId, 'sharp-image-to-splat-live-v0');
assert.equal(witness.routeIdentity.requestedRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(witness.routeIdentity.effectiveRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(witness.routeIdentity.backendClass, 'browser-webgpu');
assert.equal(witness.routePhase.active.routePhase, 'running');
assert.equal(witness.routePhase.active.visualPhase, 'burn');
assert.equal(witness.routePhase.active.allowsFullBurn, true);
assert.equal(witness.routePhase.final.routePhase, 'completed');
assert.equal(witness.routePhase.final.visualPhase, 'cooled');
assert.equal(witness.routePhase.final.allowsFullBurn, false);
assert.equal(witness.visualBudget.requested.budgetId, 'live');
assert.equal(witness.visualBudget.requested.prerecorded, false);
assert.equal(witness.visualBudget.effective.evidenceMode, 'performance');
assert.equal(witness.visualBudget.effective.rayBudgetPreset, 'live');
assert.equal(witness.visualBudget.effective.liveSimulation, true);
assert.equal(witness.timing.evidenceSource, 'raf-and-queue-proxy');
assert.equal(witness.timing.disclaimer, 'not-gpu-exclusive-or-present-latency');
assert.equal(witness.timing.frameP95Ms, 72.4);
assert.equal(witness.timing.queueDoneP95Ms, 140.2);
assert.equal(witness.frameTailDamage.bucket, 'hot');
assert.ok(witness.frameTailDamage.reasons.includes('frame_p95_hot'));
assert.ok(witness.frameTailDamage.reasons.includes('queue_p95_hot'));
assert.equal(witness.outputHandoff.status, 'real-output-produced');
assert.equal(witness.outputHandoff.artifactCount, 1);
assert.equal(witness.scheduler.schema, 'kaminos.webgpu-route-scheduler.v0');
assert.equal(witness.scheduler.verificationState, 'verified');
assert.equal(witness.scheduler.requestedScheduler.phaseChunkSize.vitBlock, 6);
assert.equal(witness.scheduler.effectiveScheduler.unsupportedFields.length, 0);
assert.equal(witness.scheduler.adapterEvidence.schema, 'kaminos.sharp-webgpu-scheduler-evidence.v0');
assert.equal(witness.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
assert.equal(witness.backpressure.requestedBudget, 'visible-wait');
assert.equal(witness.backpressure.frameTail.sampleWindowMs, 30000);
assert.equal(witness.optimization.profile, 'cooperative');
assert.equal(witness.optimization.fusionBoundary, 'bounded-phase');
assert.ok(witness.sourceTruthWarnings.includes('pipeline_route_completed_not_active_compute'));
assert.deepEqual(witness.falseClosureChecks.missingTiming, false);
assert.deepEqual(witness.falseClosureChecks.prerecordedMainPath, false);
assert.deepEqual(witness.falseClosureChecks.fixtureOrCachedRoute, false);
assert.deepEqual(witness.falseClosureChecks.schedulerUnverified, false);

assert.throws(() => buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  timing: { frameP95Ms: 33 },
}), /timing evidenceSource and disclaimer are required/);

assert.throws(() => buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  timing: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
  },
}), /finite frame-tail and queue-tail timing are required/);

assert.throws(() => buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  visualWitnessReport: {
    ...baseVisualReport.visualWitnessReport,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      frameP95Ms: null,
      queueDoneP95Ms: null,
    },
  },
}), /finite frame-tail and queue-tail timing are required/);

assert.throws(() => buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  visualWitnessReport: {
    ...baseVisualReport.visualWitnessReport,
    timing: null,
  },
}), /visualWitnessReport.timing is required/);

assert.throws(() => buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  activeWitness: {
    ...baseVisualReport.activeWitness,
    routeRun: {
      ...baseVisualReport.activeWitness.routeRun,
      statusBadge: 'fixture',
      sourceTruthWarnings: ['pipeline_route_fixture_or_mock_adapter'],
    },
  },
}), /fixture or cached route cannot be primary contention evidence/);

assert.throws(() => buildComputeRouteContentionWitnessFromReport(baseVisualReport, {
  requestedVisualBudget: {
    budgetId: 'video-loop',
    liveSimulation: false,
    prerecorded: true,
  },
}), /pre-recorded visual budget cannot be primary contention evidence/);

const schedulerUnverifiedWitness = buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  pipelineReport: {
    ...baseVisualReport.pipelineReport,
    stages: [
      {
        ...baseVisualReport.pipelineReport.stages[0],
        effectiveRoute: {
          ...baseVisualReport.pipelineReport.stages[0].effectiveRoute,
          scheduler: {
            schema: 'kaminos.webgpu-route-scheduler.v0',
            requestedScheduler: {
              mode: 'cooperative',
              yieldMs: 5,
              waitForSubmittedWorkDone: true,
            },
            effectiveScheduler: null,
            verificationState: 'scheduler-unverified',
          },
        },
      },
    ],
  },
});
assert.equal(schedulerUnverifiedWitness.scheduler.verificationState, 'scheduler-unverified');
assert.equal(schedulerUnverifiedWitness.falseClosureChecks.schedulerUnverified, true);
assert.ok(schedulerUnverifiedWitness.witnessWarnings.includes('scheduler_unverified'));

const tmp = mkdtempSync(join(tmpdir(), 'kaminos-contention-witness-contract-'));
const inputReport = join(tmp, 'compute-route-fire-report.json');
const outputReport = join(tmp, 'contention-report.json');
writeFileSync(inputReport, `${JSON.stringify(baseVisualReport, null, 2)}\n`);
const stdout = execFileSync(process.execPath, [
  fileURLToPath(new URL('../compute-route-contention-witness.mjs', import.meta.url)),
  '--input-report', inputReport,
  '--report', outputReport,
  '--witness-id', 'contention-cli-contract',
  '--requested-budget-id', 'live',
  '--requested-ray-budget-preset', 'live',
], { encoding: 'utf8' });
assert.equal(stdout.trim(), outputReport);
const cliReport = JSON.parse(readFileSync(outputReport, 'utf8'));
assert.equal(cliReport.schema, COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA);
assert.equal(cliReport.witnessId, 'contention-cli-contract');
assert.equal(cliReport.frameTailDamage.bucket, 'hot');
assert.equal(cliReport.visualBudget.requested.budgetId, 'live');
