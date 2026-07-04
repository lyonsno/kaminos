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
import {
  COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA,
  buildComputeRouteVisibleBenchModel,
  computeRouteVisibleBenchModelFromSearch,
  computeRouteVisibleBenchUrl,
} from '../compute-route-visible-bench.mjs';

const index = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

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
    visualSourceTruth: {
      source: 'live-webgpu-volume',
      fallbackReason: null,
      mayClaimLiveNovelty: true,
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
assert.equal(classifyFrameTailDamage({ frameP99Ms: 22, queueDoneP99Ms: 40 }).bucket, 'clean');
assert.ok(classifyFrameTailDamage({ frameP99Ms: 22, queueDoneP99Ms: 40 }).reasons.includes('frame_p99_clean'));
assert.ok(classifyFrameTailDamage({ frameP99Ms: 22, queueDoneP99Ms: 40 }).reasons.includes('queue_p99_clean'));

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
assert.equal(witness.visualSourceTruth.source, 'live-webgpu-volume');
assert.equal(witness.visualSourceTruth.mayClaimLiveNovelty, true);
assert.equal(witness.effectiveVolumeParams.renderScale, 0.75);
assert.equal(witness.effectiveVolumeParams.raySteps, 72);
assert.ok(witness.sourceTruthWarnings.includes('pipeline_route_completed_not_active_compute'));
assert.deepEqual(witness.falseClosureChecks.missingTiming, false);
assert.deepEqual(witness.falseClosureChecks.prerecordedMainPath, false);
assert.deepEqual(witness.falseClosureChecks.fixtureOrCachedRoute, false);
assert.deepEqual(witness.falseClosureChecks.schedulerUnverified, false);

const pipelineSchedulerReport = structuredClone(baseVisualReport);
delete pipelineSchedulerReport.pipelineReport.stages[0].effectiveRoute.scheduler;
delete pipelineSchedulerReport.pipelineReport.stages[0].effectiveRoute.backpressure;
delete pipelineSchedulerReport.pipelineReport.stages[0].effectiveRoute.optimization;
delete pipelineSchedulerReport.pipelineReport.stages[0].effectiveRoute.breathingRoom;
pipelineSchedulerReport.visualWitnessReport.runtimeQualityReceipt = {
  schema: 'volume-runtime-quality-ladder-v0',
  requested: 'live_high',
  effective: 'holdover',
  reason: 'visible-wait-contention',
  source: 'volume-runtime-quality-ladder-v0',
  changedControls: ['renderScale', 'raySteps', 'majorantCadence'],
  knobs: {
    renderScale: 0.6,
    raySteps: 48,
    adaptiveRays: 0.8,
    majorantCadence: 8,
  },
};
pipelineSchedulerReport.visualWitnessReport.controls = {
  ...pipelineSchedulerReport.visualWitnessReport.controls,
  renderScale: 0.6,
  raySteps: 48,
  adaptiveRays: 0.8,
  reconstructionStyle: 'crisp',
  pressureStrategy: 'global',
  pressureIterations: 0,
  majorantSkip: 0.25,
  majorantCadence: 8,
};
pipelineSchedulerReport.visualWitnessReport.visualSourceTruth = {
  source: 'live-webgpu-volume',
  fallbackReason: null,
  mayClaimLiveNovelty: true,
};
pipelineSchedulerReport.pipelineReport.stages[0].effectiveRoute.pipelineScheduler = {
  schema: 'kaminos.pipeline-scheduler-composition.v0',
  source: 'pipeline-adapter-report',
  verificationState: 'verified',
  requestedScheduler: {
    mode: 'cooperative',
    yieldMs: 2,
    waitForSubmittedWorkDone: true,
    phaseChunkSize: {
      spnPatch: 4,
      vitBlock: 6,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    yieldMs: 2,
    waitForSubmittedWorkDone: true,
    phaseChunkSize: {
      spnPatch: 4,
      vitBlock: 6,
    },
    unsupportedFields: [],
  },
  unsupportedFields: [],
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        spnPatch: 4,
        vitBlock: 6,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        spnPatch: 4,
        vitBlock: 6,
      },
      unsupportedFields: [],
    },
    unsupportedFields: [],
    verificationState: 'verified',
  },
  schedulerVerification: {
    schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
    status: 'verified',
    classification: 'observed-boundaries',
    downgrades: [],
    route: {
      pipelineId: 'sharp-image-to-splat-live-v0',
      requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
    },
    eventTrace: {
      schema: 'kaminos.webgpu-scheduler-event-trace.v0',
      events: [{ kind: 'js-yield-end', boundary: 'spn-patch-chunk' }],
    },
    boundaryAssertions: [
      {
        field: 'phaseChunkSize.spnPatch',
        status: 'verified',
        observedBoundary: 'spn-patch-chunk',
        observedCount: 35,
      },
    ],
    frameTail: {
      evidenceSource: 'browser-wall-clock',
      disclaimer: 'route-level-cooperative-boundary-timing',
    },
    falseAuthorityChecks: {
      timingProxyOnly: false,
      eventTraceMissing: false,
    },
  },
  backpressure: {
    schema: 'kaminos.webgpu-route-backpressure.v0',
    requestedBudget: 'visible-wait',
    effectiveBudget: 'furnace',
    memoryExclusivity: 'shared',
    warmCacheState: 'warm',
    frameTail: {
      sampleWindowMs: 30000,
      longFrameCount: 11,
      maxFrameGapMs: 182,
      p95FrameGapMs: 98,
      p99FrameGapMs: 171,
    },
  },
  phaseBoundaries: ['spn-patch-chunk', 'vit-block-segment', 'gaussian-phase'],
  backendIdentity: {
    modelFamily: 'SHARP',
    runtime: 'browser-webgpu',
    sharpWebgpuBranch: 'cc/pipeline-sharp-vit-unfuse-measure-0630',
    sharpWebgpuCommit: '8af0ef4',
  },
  optimizationIdentity: {
    vitEncoderMode: 'split',
    vitBlockChunkSize: 6,
    spnPatchChunkSize: 4,
    waitForSubmittedWorkDone: true,
    yieldMs: 2,
    gaussianPhaseYieldMs: 2,
  },
  raw: {
    breathingRoom: {
      schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
      status: 'verified',
      eventCount: 492,
    },
  },
  failureDowngrades: [],
};
const pipelineSchedulerWitness = buildComputeRouteContentionWitnessFromReport(pipelineSchedulerReport, {
  witnessId: 'contention-pipeline-scheduler-contract',
  requestedVisualBudget: {
    budgetId: 'live_high',
    rayBudgetPreset: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.equal(pipelineSchedulerWitness.pipelineScheduler.schema, 'kaminos.pipeline-scheduler-composition.v0');
assert.equal(pipelineSchedulerWitness.pipelineScheduler.source, 'pipeline-adapter-report');
assert.equal(pipelineSchedulerWitness.pipelineScheduler.scheduler.schema, 'kaminos.webgpu-route-scheduler.v0');
assert.equal(pipelineSchedulerWitness.pipelineScheduler.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
assert.equal(pipelineSchedulerWitness.pipelineScheduler.raw.breathingRoom.eventCount, 492);
assert.equal(pipelineSchedulerWitness.pipelineScheduler.schedulerVerification.status, 'verified');
assert.equal(pipelineSchedulerWitness.scheduler.verificationState, 'verified');
assert.equal(pipelineSchedulerWitness.scheduler.requestedScheduler.phaseChunkSize.spnPatch, 4);
assert.equal(pipelineSchedulerWitness.scheduler.effectiveScheduler.phaseChunkSize.vitBlock, 6);
assert.equal(pipelineSchedulerWitness.backpressure.effectiveBudget, 'furnace');
assert.equal(pipelineSchedulerWitness.backpressure.frameTail.p99FrameGapMs, 171);
assert.equal(pipelineSchedulerWitness.optimization.profile, 'cooperative');
assert.equal(pipelineSchedulerWitness.optimization.fusionBoundary, 'bounded-phase');
assert.equal(pipelineSchedulerWitness.optimization.vitEncoderMode, 'split');
assert.equal(pipelineSchedulerWitness.optimization.vitBlockChunkSize, 6);
assert.equal(pipelineSchedulerWitness.visualBudget.effective.runtimeQuality.requested, 'live_high');
assert.equal(pipelineSchedulerWitness.visualBudget.effective.runtimeQuality.effective, 'holdover');
assert.equal(pipelineSchedulerWitness.visualBudget.effective.runtimeQuality.source, 'volume-runtime-quality-ladder-v0');
assert.equal(pipelineSchedulerWitness.visualSourceTruth.source, 'live-webgpu-volume');
assert.equal(pipelineSchedulerWitness.visualSourceTruth.mayClaimLiveNovelty, true);
assert.equal(pipelineSchedulerWitness.effectiveVolumeParams.reconstructionStyle, 'crisp');
assert.equal(pipelineSchedulerWitness.effectiveVolumeParams.majorantCadence, 8);
assert.equal(pipelineSchedulerWitness.falseClosureChecks.schedulerUnverified, false);

const visibleBench = buildComputeRouteVisibleBenchModel({
  witness: pipelineSchedulerWitness,
});
assert.equal(COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA, 'kaminos.compute-route-visible-bench.v0');
assert.equal(visibleBench.schema, COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA);
assert.equal(visibleBench.routeId, 'sharp-image-to-splat-live-v0');
assert.match(visibleBench.primaryText, /^SHARP made a splat from this image while the furnace stayed live/);
assert.match(visibleBench.primaryText, /\.$/);
assert.doesNotMatch(visibleBench.primaryText, /kaminos\.|pipelineScheduler|schema|falseClosure|visualSource/i);
assert.equal(visibleBench.trustState, 'usable-with-warnings');
assert.equal(visibleBench.evidence.route.pipelineId, 'sharp-image-to-splat-live-v0');
assert.equal(visibleBench.evidence.route.activePhase, 'running');
assert.equal(visibleBench.evidence.scheduler.schema, 'kaminos.pipeline-scheduler-composition.v0');
assert.equal(visibleBench.evidence.scheduler.verificationState, 'verified');
assert.equal(visibleBench.evidence.schedulerVerification.status, 'verified');
assert.equal(visibleBench.evidence.schedulerVerification.classification, 'observed-boundaries');
assert.equal(visibleBench.evidence.scheduler.requestedMode, 'cooperative');
assert.equal(visibleBench.evidence.scheduler.effectiveMode, 'cooperative');
assert.equal(visibleBench.evidence.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
assert.equal(visibleBench.evidence.backpressure.effectiveBudget, 'furnace');
assert.equal(visibleBench.evidence.visualSource.source, 'live-webgpu-volume');
assert.equal(visibleBench.evidence.visualBudget.requested, 'live_high');
assert.equal(visibleBench.evidence.visualBudget.effective, 'live');
assert.equal(visibleBench.evidence.visualBudget.runtimeQualityEffective, 'holdover');
assert.equal(visibleBench.evidence.output.status, 'real-output-produced');
assert.equal(visibleBench.evidence.output.realArtifactCount, 1);
assert.equal(visibleBench.evidence.frameTail.bucket, 'hot');
assert.ok(visibleBench.evidence.warnings.includes('pipeline_route_completed_not_active_compute'));
assert.equal(visibleBench.evidence.falseClosure.visualSourceNotLive, false);
assert.equal(visibleBench.evidence.falseClosure.schedulerUnverified, false);

const misleadingLegacySchedulerReport = structuredClone(pipelineSchedulerReport);
misleadingLegacySchedulerReport.pipelineReport.stages[0].effectiveRoute.pipelineScheduler.verificationState = 'verified';
misleadingLegacySchedulerReport.pipelineReport.stages[0].effectiveRoute.pipelineScheduler.scheduler.verificationState = 'verified';
misleadingLegacySchedulerReport.pipelineReport.stages[0].effectiveRoute.pipelineScheduler.schedulerVerification = {
  schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
  status: 'scheduler-unverified',
  classification: 'config-only',
  downgrades: ['effective-scheduler-missing'],
  route: {
    pipelineId: 'sharp-image-to-splat-live-v0',
    requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
    effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
    backendClass: 'browser-webgpu',
  },
  frameTail: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
  },
  falseAuthorityChecks: {
    timingProxyOnly: true,
    eventTraceMissing: true,
  },
};
const misleadingLegacySchedulerWitness = buildComputeRouteContentionWitnessFromReport(misleadingLegacySchedulerReport, {
  witnessId: 'contention-nested-scheduler-receipt-authority',
  requestedVisualBudget: {
    budgetId: 'live_high',
    rayBudgetPreset: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.equal(misleadingLegacySchedulerWitness.pipelineScheduler.schedulerVerification.status, 'scheduler-unverified');
assert.equal(misleadingLegacySchedulerWitness.scheduler.verificationState, 'scheduler-unverified');
assert.equal(misleadingLegacySchedulerWitness.falseClosureChecks.schedulerUnverified, true);
assert.ok(misleadingLegacySchedulerWitness.witnessWarnings.includes('scheduler_unverified'));
const misleadingLegacyVisibleBench = buildComputeRouteVisibleBenchModel({
  witness: misleadingLegacySchedulerWitness,
});
assert.equal(misleadingLegacyVisibleBench.evidence.scheduler.verificationState, 'scheduler-unverified');
assert.equal(misleadingLegacyVisibleBench.evidence.schedulerVerification.status, 'scheduler-unverified');
assert.match(misleadingLegacyVisibleBench.primaryText, /could not prove the route scheduler stayed cooperative/);

const schedulerReceiptWitness = {
  ...pipelineSchedulerWitness,
  pipelineScheduler: {
    ...pipelineSchedulerWitness.pipelineScheduler,
    schedulerVerification: {
      schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
      status: 'scheduler-unverified',
      classification: 'config-only',
      downgrades: ['effective-scheduler-missing'],
      route: {
        pipelineId: 'sharp-image-to-splat-live-v0',
        requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
        effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
        backendClass: 'browser-webgpu',
      },
      frameTail: {
        evidenceSource: 'raf-and-queue-proxy',
        disclaimer: 'not-gpu-exclusive-or-present-latency',
        rafFps: 8.06,
        frameP95Ms: 124.1,
        queueDoneP95Ms: 473.6,
      },
      falseAuthorityChecks: {
        timingProxyOnly: true,
        eventTraceMissing: true,
      },
    },
  },
  schedulerVerification: {
    schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
    status: 'scheduler-unverified',
    classification: 'config-only',
    downgrades: ['effective-scheduler-missing'],
    frameTail: {
      evidenceSource: 'raf-and-queue-proxy',
      disclaimer: 'not-gpu-exclusive-or-present-latency',
    },
    falseAuthorityChecks: {
      timingProxyOnly: true,
      eventTraceMissing: true,
    },
  },
  falseClosureChecks: {
    ...pipelineSchedulerWitness.falseClosureChecks,
    schedulerUnverified: true,
  },
  frameTailDamage: {
    bucket: 'deranged',
    reasons: ['frame_p95_deranged', 'queue_p95_deranged'],
  },
  timing: {
    ...pipelineSchedulerWitness.timing,
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    rafFps: 8.06,
    frameP95Ms: 124.1,
    queueDoneP95Ms: 473.6,
  },
};
const schedulerReceiptVisibleBench = buildComputeRouteVisibleBenchModel({
  witness: schedulerReceiptWitness,
});
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.schema, 'kaminos.webgpu-scheduler-verification-receipt.v0');
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.status, 'scheduler-unverified');
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.classification, 'config-only');
assert.deepEqual(schedulerReceiptVisibleBench.evidence.schedulerVerification.downgrades, ['effective-scheduler-missing']);
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.timingEvidenceSource, 'raf-and-queue-proxy');
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.timingDisclaimer, 'not-gpu-exclusive-or-present-latency');
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.timingProxyOnly, true);
assert.equal(schedulerReceiptVisibleBench.evidence.schedulerVerification.eventTraceMissing, true);
assert.equal(schedulerReceiptVisibleBench.evidence.route.effectiveRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.match(schedulerReceiptVisibleBench.primaryText, /could not prove the route scheduler stayed cooperative/);

const mogeRuntimeSchedulerWitness = {
  ...schedulerReceiptWitness,
  routeIdentity: {
    pipelineId: 'moge-image-to-depth-live-v0',
    requestedRoute: 'adapter.moge-image-to-depth-live.v0',
    effectiveRoute: 'adapter.moge-image-to-depth-live.v0',
    backendClass: 'browser-webgpu',
  },
  runtime: {
    scheduler: {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      verificationState: 'scheduler-unverified',
    },
    backpressure: {
      schema: 'kaminos.webgpu-backpressure-receipt.v0',
      effectiveBudget: 'cooperative',
    },
    schedulerVerification: {
      schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
      status: 'scheduler-unverified',
      classification: 'config-only',
      observationClass: 'observed-stage-boundary',
      downgrades: ['yield-events-missing'],
      boundaryAssertions: [
        { stage: 'backbone', status: 'observed-stage-boundary' },
        { stage: 'decoder-heads', status: 'observed-stage-boundary' },
        { stage: 'output-readback', status: 'observed-stage-boundary' },
      ],
      eventTrace: {
        timingAuthority: 'queue-submit-wait',
      },
    },
  },
  schedulerVerification: null,
  pipelineScheduler: null,
  scheduler: null,
  falseClosureChecks: {
    ...schedulerReceiptWitness.falseClosureChecks,
    schedulerUnverified: true,
  },
};
const mogeRuntimeVisibleBench = buildComputeRouteVisibleBenchModel({
  witness: mogeRuntimeSchedulerWitness,
});
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.status, 'scheduler-unverified');
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.classification, 'config-only');
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.observationClass, 'observed-stage-boundary');
assert.deepEqual(mogeRuntimeVisibleBench.evidence.schedulerVerification.downgrades, ['yield-events-missing']);
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.eventTrace.timingAuthority, 'queue-submit-wait');
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.yieldUnverified, true);
assert.equal(mogeRuntimeVisibleBench.evidence.schedulerVerification.boundaryAssertions.length, 3);
assert.match(mogeRuntimeVisibleBench.primaryText, /observed stage boundaries, but it has not proven scheduler yields/);

const visibleBenchUrl = computeRouteVisibleBenchUrl(pipelineSchedulerWitness, {
  baseUrl: 'http://127.0.0.1:18121/',
});
const visibleBenchParams = new URL(visibleBenchUrl).searchParams;
assert.equal(visibleBenchParams.get('kaminos_compute_route_visible_bench'), '1');
assert.ok(visibleBenchParams.get('compute_route_visible_bench_model')?.length > 100, 'visible smoke URL carries compact bench model payload');
assert.equal(visibleBenchParams.has('compute_route_contention_witness'), false, 'visible smoke URL does not embed the full contention witness');
const visibleBenchFromSearch = computeRouteVisibleBenchModelFromSearch(new URL(visibleBenchUrl).search);
assert.equal(visibleBenchFromSearch.schema, COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA);
assert.equal(visibleBenchFromSearch.routeId, 'sharp-image-to-splat-live-v0');
assert.match(visibleBenchFromSearch.primaryText, /^SHARP made a splat from this image while the furnace stayed live/);
assert.equal(visibleBenchFromSearch.evidence.frameTail.bucket, 'hot');
assert.equal(visibleBenchFromSearch.evidence.visualSource.source, 'live-webgpu-volume');
assert.equal(visibleBenchFromSearch.evidence.output.status, 'real-output-produced');
assert.match(index, /id="compute-route-visible-bench"/, 'Volume tab hosts the human-readable route bench');
assert.match(index, /data-compute-route-visible-bench-schema="kaminos\.compute-route-visible-bench\.v0"/, 'DOM preserves visible bench schema');
assert.match(index, /id="compute-route-visible-primary"/, 'visible bench has a human-primary sentence host');
assert.match(index, /id="compute-route-visible-evidence"/, 'visible bench has an evidence drawer');
assert.match(index, /renderComputeRouteVisibleBench/, 'Volume tab renders the route-aware contention witness explicitly');
assert.match(index, /clearRouteFireBenchForAcceptedVisibleBench/, 'accepted visible bench clears stale generic route-fire content');
assert.match(index, /routeFireSuppressedBy/, 'suppressed generic route-fire bench records why its old content was cleared');
assert.match(index, /setActiveTab\('volume'\)/, 'accepted visible bench opens on the Volume evidence tab even if later WebGPU init fails');
assert.match(index, /computeRouteVisibleTabClaim/, 'accepted visible bench records that it claimed the Volume tab for visible evidence');
assert.match(index, /bootstrapComputeRouteVisibleBenchRoute\(\)/, 'accepted visible bench bootstraps before renderer-heavy initialization can fail');
assert.match(index, /Scheduler verification/, 'visible bench names scheduler verification separately from scheduler config');
assert.match(index, /Observed boundary/, 'visible bench separates observed stage boundaries from verified scheduler proof');
assert.match(index, /Yield warning/, 'visible bench preserves yield-events-missing as a visible warning');
assert.match(index, /Timing authority/, 'visible bench shows timing authority for scheduler/frame-tail evidence');
assert.doesNotMatch(index, /Root request/, 'operator-facing route bench must not expose internal root-request wording');

const liveVisualSourceTruth = {
  source: 'live-webgpu-volume',
  fallbackReason: null,
  mayClaimLiveNovelty: true,
};

assert.throws(() => buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: liveVisualSourceTruth,
  timing: { frameP95Ms: 33 },
}), /timing evidenceSource and disclaimer are required/);

assert.throws(() => buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: liveVisualSourceTruth,
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

const weakVisibleBench = buildComputeRouteVisibleBenchModel({
  witness: schedulerUnverifiedWitness,
});
assert.match(weakVisibleBench.primaryText, /^SHARP made a splat from this image, but Kaminos could not prove the route scheduler stayed cooperative/);
assert.equal(weakVisibleBench.trustState, 'needs-review');
assert.equal(weakVisibleBench.evidence.scheduler.verificationState, 'scheduler-unverified');
assert.ok(weakVisibleBench.evidence.warnings.includes('scheduler_unverified'));

const optimisticSchedulerWithoutEffective = buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: liveVisualSourceTruth,
  timing: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    frameP95Ms: 72,
    queueDoneP95Ms: 140,
  },
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: { mode: 'cooperative' },
    effectiveScheduler: null,
    verificationState: 'verified',
  },
});
assert.equal(optimisticSchedulerWithoutEffective.scheduler.verificationState, 'scheduler-unverified');
assert.equal(optimisticSchedulerWithoutEffective.falseClosureChecks.schedulerUnverified, true);
assert.ok(optimisticSchedulerWithoutEffective.witnessWarnings.includes('scheduler_unverified'));
assert.ok(optimisticSchedulerWithoutEffective.witnessWarnings.includes('requested_scheduler_without_effective_scheduler'));

const partialVerifiedSchedulerWithoutEffective = buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: liveVisualSourceTruth,
  timing: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    frameP95Ms: 72,
    queueDoneP95Ms: 140,
  },
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    verificationState: 'verified',
  },
});
assert.equal(partialVerifiedSchedulerWithoutEffective.scheduler.verificationState, 'scheduler-unverified');
assert.equal(partialVerifiedSchedulerWithoutEffective.falseClosureChecks.schedulerUnverified, true);
assert.ok(partialVerifiedSchedulerWithoutEffective.witnessWarnings.includes('scheduler_unverified'));

const p99OnlyWitness = buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: liveVisualSourceTruth,
  timing: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    frameP99Ms: 22,
    queueDoneP99Ms: 40,
  },
});
assert.equal(p99OnlyWitness.falseClosureChecks.missingTiming, false);
assert.equal(p99OnlyWitness.frameTailDamage.bucket, 'clean');
assert.ok(p99OnlyWitness.frameTailDamage.reasons.includes('frame_p99_clean'));
assert.ok(p99OnlyWitness.frameTailDamage.reasons.includes('queue_p99_clean'));

assert.throws(() => buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  visualWitnessReport: {
    ...baseVisualReport.visualWitnessReport,
    visualSourceTruth: {
      source: 'cached-volume',
      fallbackReason: 'cache-hit',
      mayClaimLiveNovelty: false,
    },
  },
}), /non-live visual source truth cannot be primary contention evidence/);

const missingVisualSourceTruthReport = structuredClone(baseVisualReport);
delete missingVisualSourceTruthReport.visualWitnessReport.visualSourceTruth;
assert.throws(() => buildComputeRouteContentionWitnessFromReport(missingVisualSourceTruthReport), /non-live visual source truth cannot be primary contention evidence/);

assert.throws(() => buildComputeRouteContentionWitnessFromReport({
  ...baseVisualReport,
  visualWitnessReport: {
    ...baseVisualReport.visualWitnessReport,
    visualSourceTruth: {
      source: 'cached',
      fallbackReason: null,
      mayClaimLiveNovelty: true,
    },
  },
}), /non-live visual source truth cannot be primary contention evidence/);

assert.throws(() => buildComputeRouteContentionWitness({
  routeIdentity: witness.routeIdentity,
  routePhase: witness.routePhase,
  visualBudget: witness.visualBudget,
  visualSourceTruth: {
    source: 'unknown-source',
    fallbackReason: null,
    mayClaimLiveNovelty: true,
  },
  timing: {
    evidenceSource: 'raf-and-queue-proxy',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    frameP95Ms: 72,
    queueDoneP95Ms: 140,
  },
}), /non-live visual source truth cannot be primary contention evidence/);

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
