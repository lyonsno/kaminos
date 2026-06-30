import assert from 'node:assert/strict';

import {
  buildComputeRouteContentionWitness,
  buildComputeRouteContentionWitnessFromReport,
} from '../compute-route-contention-witness.mjs';

const routeIdentity = {
  pipelineId: 'sharp-image-to-splat-live-v0',
  requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
  effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
  backendClass: 'browser-webgpu',
};

const routePhase = {
  active: {
    routePhase: 'running',
    statusBadge: 'real',
    visualAuthority: 'live-compute',
    truthMode: 'live',
    visualPhase: 'burn',
    allowsFullBurn: true,
  },
  final: {
    routePhase: 'completed',
    statusBadge: 'real',
    visualAuthority: 'settled-output',
    truthMode: 'live',
    visualPhase: 'cooled',
    allowsFullBurn: false,
  },
};

const visualBudget = {
  requested: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
  effective: {
    budgetId: 'live',
    evidenceMode: 'performance',
    liveSimulation: true,
    prerecorded: false,
  },
};

const timing = {
  evidenceSource: 'raf-and-queue-proxy',
  disclaimer: 'not-gpu-exclusive-or-present-latency',
  frameP95Ms: 72,
  queueDoneP95Ms: 140,
};

function witnessForScheduler(scheduler, extra = {}) {
  return buildComputeRouteContentionWitness({
    routeIdentity,
    routePhase,
    visualBudget,
    timing,
    scheduler,
    ...extra,
  });
}

const verified = witnessForScheduler({
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
  adapterEvidence: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
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
    verificationState: 'verified',
  },
});
assert.equal(verified.scheduler.verificationState, 'verified');
assert.deepEqual(verified.scheduler.validationWarnings, []);
assert.deepEqual(verified.scheduler.falseAuthorityViolations, []);
assert.equal(verified.falseClosureChecks.schedulerUnverified, false);

const verifiedWithoutEffective = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
    yieldMs: 2,
  },
  verificationState: 'verified',
});
assert.equal(verifiedWithoutEffective.scheduler.verificationState, 'scheduler-unverified');
assert.ok(verifiedWithoutEffective.scheduler.validationWarnings.includes('scheduler_verified_without_effective_scheduler'));
assert.ok(verifiedWithoutEffective.scheduler.falseAuthorityViolations.includes('scheduler_verified_without_effective_scheduler'));
assert.ok(verifiedWithoutEffective.witnessWarnings.includes('scheduler_verified_without_effective_scheduler'));

const nestedFieldDisappeared = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
      vitBlock: 6,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
    },
    unsupportedFields: [],
  },
  verificationState: 'verified',
});
assert.ok(
  nestedFieldDisappeared.scheduler.falseAuthorityViolations.includes(
    'requested_effective_scheduler_drift_without_unsupported_fields:phaseChunkSize.vitBlock',
  ),
);
assert.ok(
  nestedFieldDisappeared.witnessWarnings.includes(
    'requested_effective_scheduler_drift_without_unsupported_fields:phaseChunkSize.vitBlock',
  ),
);

const unsupportedFieldDeclared = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
      vitBlock: 6,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
    },
    unsupportedFields: ['phaseChunkSize.vitBlock'],
  },
  verificationState: 'verified',
});
assert.ok(
  !unsupportedFieldDeclared.scheduler.falseAuthorityViolations.includes(
    'requested_effective_scheduler_drift_without_unsupported_fields:phaseChunkSize.vitBlock',
  ),
);

const adapterDisagreesWithKit = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
      vitBlock: 6,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      spnPatch: 1,
      vitBlock: 6,
    },
    unsupportedFields: [],
  },
  verificationState: 'verified',
  adapterEvidence: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    requestedScheduler: {
      mode: 'cooperative',
      spnPatchChunkSize: 1,
      vitBlockChunkSize: 6,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      spnPatchChunkSize: 1,
      vitBlockChunkSize: 4,
      unsupportedFields: [],
    },
    verificationState: 'verified',
  },
});
assert.ok(
  adapterDisagreesWithKit.scheduler.falseAuthorityViolations.includes(
    'adapter_scheduler_disagrees_with_kit_scheduler:effectiveScheduler.phaseChunkSize.vitBlock',
  ),
);
assert.ok(
  adapterDisagreesWithKit.witnessWarnings.includes(
    'adapter_scheduler_disagrees_with_kit_scheduler:effectiveScheduler.phaseChunkSize.vitBlock',
  ),
);

const adapterOnlyInsideKitWrapper = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  adapterEvidence: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    requestedScheduler: {
      mode: 'cooperative',
      vitBlockChunkSize: 6,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      vitBlockChunkSize: 6,
      unsupportedFields: [],
    },
    verificationState: 'verified',
  },
});
assert.equal(adapterOnlyInsideKitWrapper.scheduler.verificationState, 'scheduler-unverified');
assert.equal(adapterOnlyInsideKitWrapper.scheduler.requestedScheduler, null);
assert.equal(adapterOnlyInsideKitWrapper.scheduler.effectiveScheduler, null);
assert.ok(adapterOnlyInsideKitWrapper.scheduler.validationWarnings.includes('route_specific_scheduler_without_kit_mapping'));
assert.ok(adapterOnlyInsideKitWrapper.witnessWarnings.includes('route_specific_scheduler_without_kit_mapping'));

const requestedAdapterDisagreementNotWaivedByEffectiveUnsupported = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      vitBlock: 6,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    phaseChunkSize: {
      vitBlock: 6,
    },
    unsupportedFields: ['phaseChunkSize.vitBlock'],
  },
  verificationState: 'verified',
  adapterEvidence: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    requestedScheduler: {
      mode: 'cooperative',
      vitBlockChunkSize: 4,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      vitBlockChunkSize: 6,
      unsupportedFields: [],
    },
    verificationState: 'verified',
  },
});
assert.ok(
  requestedAdapterDisagreementNotWaivedByEffectiveUnsupported.scheduler.falseAuthorityViolations.includes(
    'adapter_scheduler_disagrees_with_kit_scheduler:requestedScheduler.phaseChunkSize.vitBlock',
  ),
);
assert.ok(
  requestedAdapterDisagreementNotWaivedByEffectiveUnsupported.witnessWarnings.includes(
    'adapter_scheduler_disagrees_with_kit_scheduler:requestedScheduler.phaseChunkSize.vitBlock',
  ),
);

const staleTelemetry = witnessForScheduler({
  schema: 'kaminos.webgpu-route-scheduler.v0',
  requestedScheduler: {
    mode: 'cooperative',
  },
  effectiveScheduler: {
    mode: 'cooperative',
    unsupportedFields: [],
  },
  verificationState: 'verified',
  telemetryAgeMs: 60000,
  maxTelemetryAgeMs: 30000,
});
assert.ok(staleTelemetry.scheduler.validationWarnings.includes('scheduler_telemetry_stale'));
assert.ok(staleTelemetry.witnessWarnings.includes('scheduler_telemetry_stale'));

const adapterOnlyReport = {
  schema: 'kaminos.compute-route-fire-visual-report.v0',
  phase: 'complete',
  runPipeline: true,
  pipelineId: 'sharp-image-to-splat-live-v0',
  routeId: 'adapter.sharp-image-to-splat-live.v0',
  activeWitness: {
    schema: 'kaminos.compute-route-fire-witness.v0',
    routeRun: {
      runId: 'active',
      requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      statusBadge: 'real',
      routePhase: 'running',
      sourceTruthWarnings: [],
    },
  },
  finalWitness: {
    schema: 'kaminos.compute-route-fire-witness.v0',
    routeRun: {
      runId: 'final',
      requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      statusBadge: 'real',
      routePhase: 'completed',
      sourceTruthWarnings: [],
    },
  },
  visualWitnessReport: {
    schema: 'kaminos.volume-witness.v0',
    evidenceMode: 'performance',
    timingEvidenceSource: 'raf-and-queue-proxy',
    timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
    frameCount: 120,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      frameP95Ms: 72,
      queueDoneP95Ms: 140,
    },
    controls: {
      rayBudgetPreset: 'live',
    },
  },
  pipelineReport: {
    schema: 'kaminos.pipeline-witness.v0',
    ok: true,
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectivePipelineId: 'sharp-image-to-splat-live-v0',
    artifacts: {},
    stages: [
      {
        id: 'run-sharp-image-to-splat',
        status: 'real',
        effectiveRoute: {
          id: 'adapter.sharp-image-to-splat.v0',
          breathingRoom: {
            schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
            requestedScheduler: {
              mode: 'cooperative',
              vitBlockChunkSize: 6,
            },
            effectiveScheduler: {
              mode: 'cooperative',
              vitBlockChunkSize: 6,
              unsupportedFields: [],
            },
            verificationState: 'verified',
          },
        },
      },
    ],
  },
};

const adapterOnly = buildComputeRouteContentionWitnessFromReport(adapterOnlyReport, {
  requestedVisualBudget: {
    budgetId: 'live',
    liveSimulation: true,
    prerecorded: false,
  },
});
assert.equal(adapterOnly.scheduler.verificationState, 'scheduler-unverified');
assert.ok(adapterOnly.scheduler.validationWarnings.includes('route_specific_scheduler_without_kit_mapping'));
assert.ok(adapterOnly.scheduler.adapterEvidence);
