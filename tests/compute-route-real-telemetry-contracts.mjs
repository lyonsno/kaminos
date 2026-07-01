import assert from 'node:assert/strict';

import {
  buildComputeRouteContentionWitnessFromReport,
} from '../compute-route-contention-witness.mjs';

const telemetryReport = {
  schema: 'kaminos.compute-route-fire-visual-report.v0',
  phase: 'complete',
  runPipeline: true,
  pipelineId: 'sharp-image-to-splat-live-v0',
  routeId: 'adapter.sharp-image-to-splat-live.v0',
  input: '/tmp/kaminos/source.png',
  pipelineReportPath: '/tmp/kaminos-route/pipeline-witness.json',
  pipelineExit: {
    status: 0,
    startedAt: '2026-06-30T23:45:00.000Z',
    finishedAt: '2026-06-30T23:45:44.250Z',
    durationMs: 44250,
    stdoutTail: 'sharp route complete\n',
    stderrTail: '',
  },
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
    timingEvidenceSource: 'raf-and-queue-proxy',
    timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
    frameCount: 144,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      frameP95Ms: 72.4,
      queueDoneP95Ms: 140.2,
    },
  },
  pipelineReport: {
    schema: 'kaminos.pipeline-witness.v0',
    ok: true,
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectivePipelineId: 'sharp-image-to-splat-live-v0',
    phase: 'complete',
    effectiveRouteConfig: {
      routeId: 'adapter.sharp-image-to-splat-live.v0',
      outputRoot: '/tmp/kaminos-route/pipeline-out',
      stageCount: 2,
    },
    artifacts: {
      input: {
        role: 'source-image',
        status: 'requested',
        path: '/tmp/kaminos/source.png',
        bytes: 172400,
        sha256: 'sha256:input',
      },
      splat: {
        role: 'splat-candidate',
        status: 'real',
        path: '/tmp/kaminos-route/artifacts/sharp-output.ply',
        bytes: 66060836,
        sha256: 'sha256:splat',
      },
      depthMap: {
        role: 'depth-map',
        status: 'real',
        path: '/tmp/kaminos-route/artifacts/depth.png',
        bytes: 507322,
        sha256: 'sha256:depth',
      },
    },
    stages: [
      {
        id: 'run-sharp-image-to-splat',
        label: 'Run SHARP image to splat',
        status: 'real',
        requestedRoute: 'adapter.sharp-image-to-splat.v0',
        inputArtifact: 'input',
        outputArtifact: 'splat',
        outputPath: '/tmp/kaminos-route/artifacts/sharp-output.ply',
        outputBytes: 66060836,
        outputSha256: 'sha256:splat',
        effectiveRoute: {
          id: 'adapter.sharp-image-to-splat.v0',
          tool: 'SHARP-WebGPU',
          effectiveBackend: 'browser-webgpu',
          realModel: true,
          requestedRealModel: true,
          executesModel: true,
          commandEnv: 'KAMINOS_SHARP_COMMAND',
          adapterReportPath: '/tmp/kaminos-route/artifacts/run-sharp.adapter-report.json',
          exitCode: 0,
          signal: null,
          stdoutTail: 'adapter ok\n',
          stderrTail: '',
          outputBytes: 66060836,
          outputSha256: 'sha256:splat',
          truthBoundary: 'live SHARP adapter output',
        },
      },
      {
        id: 'write-live-sharp-sidecar',
        label: 'Write sidecar',
        status: 'real',
        requestedRoute: 'local.kaminos-import-sidecar.v0',
        inputArtifact: 'splat',
        outputArtifact: 'sidecar',
        outputPath: '/tmp/kaminos-route/artifacts/sharp-output.kaminos-pipeline.json',
        outputBytes: 4096,
        outputSha256: 'sha256:sidecar',
        effectiveRoute: {
          id: 'local.kaminos-import-sidecar.v0',
          effectiveBackend: 'local-sidecar-writer',
          realModel: false,
        },
      },
    ],
  },
};

const witness = buildComputeRouteContentionWitnessFromReport(telemetryReport, {
  witnessId: 'route-telemetry-contract',
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});

assert.equal(witness.routeTelemetry.schema, 'kaminos.compute-route-telemetry.v0');
assert.equal(witness.routeTelemetry.evidenceSource, 'compute-route-fire-visual-report.pipeline-report');
assert.equal(witness.routeTelemetry.pipelineExit.status, 0);
assert.equal(witness.routeTelemetry.pipelineExit.durationMs, 44250);
assert.equal(witness.routeTelemetry.pipelineExit.stdoutTailBytes, 'sharp route complete\n'.length);
assert.equal(witness.routeTelemetry.stageCount, 2);
assert.equal(witness.routeTelemetry.stages[0].id, 'run-sharp-image-to-splat');
assert.equal(witness.routeTelemetry.stages[0].effectiveRoute, 'adapter.sharp-image-to-splat.v0');
assert.equal(witness.routeTelemetry.stages[0].effectiveBackend, 'browser-webgpu');
assert.equal(witness.routeTelemetry.stages[0].adapterReportPath, '/tmp/kaminos-route/artifacts/run-sharp.adapter-report.json');
assert.equal(witness.routeTelemetry.stages[0].exitCode, 0);
assert.equal(witness.routeTelemetry.stages[0].stdoutTailBytes, 'adapter ok\n'.length);
assert.equal(witness.routeTelemetry.stages[0].outputBytes, 66060836);
assert.equal(witness.routeTelemetry.artifactBytes.realOutputBytes, 66060836 + 507322);
assert.deepEqual(witness.routeTelemetry.telemetryWarnings, []);
assert.equal(witness.falseClosureChecks.missingRouteTelemetry, false);

const missingStages = buildComputeRouteContentionWitnessFromReport({
  ...telemetryReport,
  pipelineReport: {
    ...telemetryReport.pipelineReport,
    stages: [],
  },
}, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.ok(missingStages.routeTelemetry.telemetryWarnings.includes('pipeline_report_stages_missing'));
assert.ok(missingStages.witnessWarnings.includes('pipeline_report_stages_missing'));
assert.equal(missingStages.falseClosureChecks.missingRouteTelemetry, true);

const nonzeroStageExit = buildComputeRouteContentionWitnessFromReport({
  ...telemetryReport,
  pipelineReport: {
    ...telemetryReport.pipelineReport,
    stages: [
      {
        ...telemetryReport.pipelineReport.stages[0],
        effectiveRoute: {
          ...telemetryReport.pipelineReport.stages[0].effectiveRoute,
          exitCode: 1,
        },
      },
      telemetryReport.pipelineReport.stages[1],
    ],
  },
}, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.ok(nonzeroStageExit.routeTelemetry.telemetryWarnings.includes('pipeline_stage_exit_nonzero:run-sharp-image-to-splat'));
assert.ok(nonzeroStageExit.witnessWarnings.includes('pipeline_stage_exit_nonzero:run-sharp-image-to-splat'));

const signaledStage = buildComputeRouteContentionWitnessFromReport({
  ...telemetryReport,
  pipelineReport: {
    ...telemetryReport.pipelineReport,
    stages: [
      {
        ...telemetryReport.pipelineReport.stages[0],
        effectiveRoute: {
          ...telemetryReport.pipelineReport.stages[0].effectiveRoute,
          signal: 'SIGTERM',
        },
      },
      telemetryReport.pipelineReport.stages[1],
    ],
  },
}, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.ok(signaledStage.routeTelemetry.telemetryWarnings.includes('pipeline_stage_signal:run-sharp-image-to-splat'));
assert.ok(signaledStage.witnessWarnings.includes('pipeline_stage_signal:run-sharp-image-to-splat'));

const stageCountMismatch = buildComputeRouteContentionWitnessFromReport({
  ...telemetryReport,
  pipelineReport: {
    ...telemetryReport.pipelineReport,
    effectiveRouteConfig: {
      ...telemetryReport.pipelineReport.effectiveRouteConfig,
      stageCount: 2,
    },
    stages: [telemetryReport.pipelineReport.stages[0]],
  },
}, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.ok(stageCountMismatch.routeTelemetry.telemetryWarnings.includes('pipeline_report_stage_count_mismatch'));
assert.ok(stageCountMismatch.witnessWarnings.includes('pipeline_report_stage_count_mismatch'));
assert.equal(stageCountMismatch.falseClosureChecks.missingRouteTelemetry, true);

const failedStatusWithoutExit = buildComputeRouteContentionWitnessFromReport({
  ...telemetryReport,
  phase: 'failed:adapter',
  pipelineReport: {
    ...telemetryReport.pipelineReport,
    ok: false,
    phase: 'failed:adapter',
    effectiveRouteConfig: {
      ...telemetryReport.pipelineReport.effectiveRouteConfig,
      stageCount: 1,
    },
    artifacts: {
      input: telemetryReport.pipelineReport.artifacts.input,
    },
    stages: [
      {
        ...telemetryReport.pipelineReport.stages[0],
        status: 'failed',
        effectiveRoute: {
          ...telemetryReport.pipelineReport.stages[0].effectiveRoute,
          exitCode: undefined,
          signal: null,
        },
      },
    ],
  },
}, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.ok(failedStatusWithoutExit.routeTelemetry.telemetryWarnings.includes('pipeline_report_failed'));
assert.ok(failedStatusWithoutExit.routeTelemetry.telemetryWarnings.includes('pipeline_stage_status_failed:run-sharp-image-to-splat'));
assert.ok(failedStatusWithoutExit.witnessWarnings.includes('pipeline_report_failed'));
assert.ok(failedStatusWithoutExit.witnessWarnings.includes('pipeline_stage_status_failed:run-sharp-image-to-splat'));
