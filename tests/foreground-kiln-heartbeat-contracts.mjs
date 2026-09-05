import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FOREGROUND_KILN_HEARTBEAT_SCHEMA,
  createForegroundKilnHeartbeatEpisode,
  firePresentationMismatchReasons,
  foregroundKilnStartAllowsPipeline,
} from '../lib/foreground-kiln-heartbeat.mjs';

const budget = {
  identity: 'kaminos.kiln-contention-fire-budget.v0',
  resolution: 90,
  renderScale: 0.4,
  adaptiveRays: 1,
};

// The foreground heartbeat must preserve host/browser intervals that are not
// SHARP submitted-work duties, so cadence gaps can be attributed honestly.
{
  let nowMs = 100;
  const observers = [];
  class TestPerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }

    observe(options) {
      this.options = options;
    }

    disconnect() {
      this.disconnected = true;
    }
  }
  const episode = createForegroundKilnHeartbeatEpisode({
    routeId: 'sharp-image-to-splat-live-v0',
    profileId: 'cooperative-spn-gaussian',
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'firing-host-authority-a',
    expectedVolumeRouteIdentity: 'native-3d-compute-fluid-raymarch-v0',
    requestedFireBudget: budget,
    timeOriginEpochMs: 1_700_000_000_000,
    readVolumeState: () => ({
      active: true,
      routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      frameCount: 1,
      simStepCount: 1,
      resolution: 90,
      renderScale: 0.4,
      adaptiveRaymarch: 1,
    }),
    now: () => nowMs,
    requestFrame: () => 1,
    cancelFrame: () => {},
    PerformanceObserverClass: TestPerformanceObserver,
  });
  episode.start();
  assert.deepEqual(observers[0].options, { type: 'longtask', buffered: true });
  assert.equal(episode.report().hostTelemetry.status, 'recording');
  assert.equal(episode.report().hostTelemetry.longTaskSource.status, 'recording');
  observers[0].callback({
    getEntries: () => [{
      entryType: 'longtask',
      name: 'self',
      startTime: 104,
      duration: 4,
    }],
  });
  nowMs = 120;
  episode.recordEvent({ kind: 'browser-host', phase: 'present', startMs: 110, endMs: 118, detail: 'test' });
  const report = episode.finish();
  assert.equal(typeof episode.recordEvent, 'function');
  assert.equal(observers[0].disconnected, true);
  assert.equal(report.hostTelemetry.schema, 'kaminos.foreground-host-telemetry.v0');
  assert.equal(report.hostTelemetry.status, 'complete');
  assert.equal(report.hostTelemetry.longTaskSource.status, 'complete');
  assert.equal(report.hostTelemetry.longTaskSource.identity, 'performance-observer-longtask');
  assert.equal(report.hostTelemetry.explicitEventSource.identity, 'explicit-record-event');
  assert.equal(report.hostTelemetry.explicitEventSource.status, 'available');
  assert.equal(report.hostTelemetry.firingId, 'firing-host-authority-a');
  assert.equal(report.hostEvents.length, 2);
  assert.deepEqual(report.hostEvents[1], {
    kind: 'browser-host',
    phase: 'present',
    source: 'explicit-record-event',
    firingId: 'firing-host-authority-a',
    episodeId: report.hostTelemetry.episodeId,
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    timeOriginEpochMs: 1_700_000_000_000,
    startMs: 110,
    endMs: 118,
    startEpochMs: 1_700_000_000_110,
    endEpochMs: 1_700_000_000_118,
    durationMs: 8,
    detail: 'test',
  });
}

// Unsupported or failed browser long-task observation must be explicit rather
// than masquerading as a complete zero-event capture.
for (const [PerformanceObserverClass, expectedReason] of [
  [null, 'performance-observer-unavailable'],
  [class ThrowingPerformanceObserver {
    observe() { throw new Error('longtask denied'); }
    disconnect() {}
  }, 'longtask-observe-failed'],
]) {
  const episode = createForegroundKilnHeartbeatEpisode({
    firingId: 'firing-host-unavailable',
    expectedVolumeRouteIdentity: 'native-3d-compute-fluid-raymarch-v0',
    requestedFireBudget: budget,
    timeOriginEpochMs: 1_700_000_000_000,
    readVolumeState: () => ({
      active: true,
      routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
      frameCount: 1,
      simStepCount: 1,
      resolution: 90,
      renderScale: 0.4,
      adaptiveRaymarch: 1,
    }),
    now: () => 100,
    requestFrame: () => 1,
    cancelFrame: () => {},
    PerformanceObserverClass,
  });
  episode.start();
  const report = episode.finish();
  assert.equal(report.hostTelemetry.status, 'unavailable');
  assert.equal(report.hostTelemetry.longTaskSource.status, 'unavailable');
  assert.equal(report.hostTelemetry.longTaskSource.reason, expectedReason);
}

const learnedHybridPresentation = {
  schema: 'kaminos.kiln-fire-presentation.v0',
  firingId: 'firing-0713-a',
  requestedMode: 'auto',
  effectiveMode: 'learned-splat-flame-raymarched-smoke',
  simulatorAuthority: 'live-fluid-simulation-v0',
  flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
  sourceSidecarIdentity: 'baked-boundary-sidecar-v1',
  sourceSidecarAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  learnedModelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  candidateCount: 111898,
  candidateCapacity: 262144,
  candidateOverflow: 0,
  candidateCopyBytes: 0,
  fallbackReason: null,
  hybridSplatSmokeCompositorIdentity: 'splat-depth-conditioned-front-back-smoke-compositor-v1',
  hybridSplatSmokeApproximation: 'splat-depth-conditioned-raymarched-front-back-smoke-intervals',
  splatDepthConditionedSmokeSplit: 'per-pixel-transformed-splat-depth-raymarch-split-v1',
  hybridSmokePhaseAuthority: 'shared-current-single-simulator-no-instance-smoke-history',
  hybridSplatLayer: {
    identity: 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0',
  },
  hybridSmokeLayer: {
    identity: 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1',
    intervals: ['front-of-splat-depth', 'back-of-splat-depth'],
    opticalComposition: 'front-smoke>splat>back-smoke',
  },
  raster: {
    radius: 0.8,
    sharpness: 6.5,
    energyCompensation: 'sqrt-integrated-energy-v0',
  },
  timing: {
    authority: 'gpu-pass-descriptor-timestamp-query-v0',
    compactionMs: 2.49,
    decodeMs: null,
    decodeResolution: 'below-timer-quantization',
  },
  fireEpisodeHooks: {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    disclaimer: 'not-gpu-exclusive-or-present-latency',
    firingId: 'firing-0713-a',
    generation: 7,
    phase: 'recording',
    status: 'recording',
    evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
    authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
    sampleCount: 3,
    frameAdvanceCount: 2,
    simStepAdvanceCount: 2,
    startedAtMs: 90,
    rawRafGapSamplesMs: [16, 17, 52],
    routeIdentity: {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      compositionRequested: 'hybrid-smoke',
      compositionEffective: 'hybrid-smoke',
      compositionFallbackReason: null,
    },
  },
};

const boundedHoldoverPresentation = {
  ...learnedHybridPresentation,
  flameContinuityRequested: 'bounded-history-holdover',
  flameContinuityEffective: 'bounded-history-holdover',
  flameContinuityEffectiveReason: 'same-firing-alternate-hybrid-frames',
  flameContinuityEvidence: {
    schema: 'kaminos.single-flame-continuity-runtime.v0',
    firingId: learnedHybridPresentation.firingId,
    requested: 'bounded-history-holdover',
    effective: 'bounded-history-holdover',
    mode: 'holdover',
    presentationOrdinal: 8,
    selectedHistorySlot: {
      slotIndex: 2,
      historyAllocationGeneration: 4,
      archiveWriteSequence: 32,
      sourceCandidateGeneration: 32,
    },
    counts: { live: 4, holdover: 4, fallback: 0 },
    renderFrameAdvanced: true,
    sourceRenderFrameAdvanced: false,
    simulatorStepAdvanced: false,
  },
};
const boundedHoldoverExpectation = {
  firingId: learnedHybridPresentation.firingId,
  flameContinuityRequested: 'bounded-history-holdover',
  requireFlameContinuityEvidence: true,
};
assert.deepEqual(
  firePresentationMismatchReasons(boundedHoldoverExpectation, boundedHoldoverPresentation),
  [],
  'a complete same-firing held-frame receipt must survive foreground validation',
);
assert.ok(
  firePresentationMismatchReasons(boundedHoldoverExpectation, {
    ...boundedHoldoverPresentation,
    flameContinuityEvidence: {
      ...boundedHoldoverPresentation.flameContinuityEvidence,
      sourceRenderFrameAdvanced: true,
    },
  }).includes('holdover-evidence-incomplete'),
  'foreground validation must reject a held frame that advanced the source render clock',
);
const boundedFallbackPresentation = {
  ...boundedHoldoverPresentation,
  flameContinuityEvidence: {
    ...boundedHoldoverPresentation.flameContinuityEvidence,
    mode: 'live',
    selectedHistorySlot: null,
    counts: { live: 5, holdover: 4, fallback: 1 },
    fallbackReason: 'holdover-exhausted',
    renderFrameAdvanced: true,
    sourceRenderFrameAdvanced: true,
    simulatorStepAdvanced: true,
  },
};
assert.deepEqual(
  firePresentationMismatchReasons(boundedHoldoverExpectation, boundedFallbackPresentation),
  [],
  'a fail-closed live frame must remain valid when its fallback and actual clock movement are explicit',
);
assert.ok(
  firePresentationMismatchReasons(boundedHoldoverExpectation, {
    ...boundedFallbackPresentation,
    flameContinuityEvidence: {
      ...boundedFallbackPresentation.flameContinuityEvidence,
      simulatorStepAdvanced: false,
    },
  }).includes('live-continuity-evidence-incomplete'),
  'foreground validation must reject a purported live simulation frame that did not advance the simulator',
);
assert.ok(
  firePresentationMismatchReasons(boundedHoldoverExpectation, {
    ...boundedFallbackPresentation,
    flameContinuityEvidence: {
      ...boundedFallbackPresentation.flameContinuityEvidence,
      fallbackReason: null,
    },
  }).includes('fallback-evidence-incomplete'),
  'foreground validation must reject a nonzero fallback count without a named failure reason',
);

function episodeHarness({
  effectiveBudget = budget,
  routeIdentity = 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity = 'kaminos-volume-prototype-v0',
  firePresentation = null,
  fireEpisodeHooks = null,
  expectedFirePresentation = null,
  firingId = null,
  requireExactFireEpisode = false,
  requireSharpDutyCorrelation = false,
  timeOriginEpochMs = 1_700_000_000_000,
} = {}) {
  let nowMs = 100;
  let nextFrameId = 0;
  let scheduled = null;
  let volume = {
    active: true,
    routeIdentity,
    prototypeIdentity,
    frameCount: 10,
    simStepCount: 20,
    resolution: effectiveBudget.resolution,
    renderScale: effectiveBudget.renderScale,
    adaptiveRaymarch: effectiveBudget.adaptiveRays,
    firePresentation,
    fireEpisodeHooks,
  };
  const episode = createForegroundKilnHeartbeatEpisode({
    routeId: 'sharp-image-to-splat-live-v0',
    profileId: 'cooperative-spn-gaussian',
    pipelineId: 'sharp-image-to-splat-live-v0',
    expectedVolumeRouteIdentity: 'native-3d-compute-fluid-raymarch-v0',
    requestedFireBudget: budget,
    expectedFirePresentation,
    firingId,
    requireExactFireEpisode,
    requireSharpDutyCorrelation,
    timeOriginEpochMs,
    readVolumeState: () => ({ ...volume }),
    now: () => nowMs,
    requestFrame: callback => {
      scheduled = callback;
      nextFrameId += 1;
      return nextFrameId;
    },
    cancelFrame: () => {
      scheduled = null;
    },
  });
  return {
    episode,
    advance({ gapMs = 16, frameDelta = 1, simDelta = 1, nextVolume = null, frameTimestampMs = null } = {}) {
      nowMs += gapMs;
      volume = nextVolume || {
        ...volume,
        frameCount: volume.frameCount + frameDelta,
        simStepCount: volume.simStepCount + simDelta,
      };
      const callback = scheduled;
      scheduled = null;
      callback?.(Number.isFinite(frameTimestampMs) ? frameTimestampMs : nowMs);
    },
    setVolume(nextVolume) {
      volume = { ...volume, ...nextVolume };
    },
  };
}

function sharpDutyHeartbeat({
  runId = 'sharp-run-0713-a',
  intervalRunId = runId,
  includeClock = true,
} = {}) {
  const timeOriginEpochMs = 1_699_999_995_000;
  return {
    schema: 'sharp-webgpu.background-heartbeat.v0',
    inferenceWindow: {
      runId,
      startMs: 5110,
      endMs: 5200,
      durationMs: 90,
      startEpochMs: 1_700_000_000_110,
      endEpochMs: 1_700_000_000_200,
    },
    crossPageClock: includeClock ? {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      runId,
      timeOriginEpochMs,
      inferenceWindowStartEpochMs: 1_700_000_000_110,
      inferenceWindowEndEpochMs: 1_700_000_000_200,
    } : null,
    gpuDutyIntervals: {
      schema: 'sharp-webgpu.submitted-work-drain-intervals.v0',
      timingAuthority: 'queue-on-submitted-work-done-host-await-not-gpu-exclusive',
      runId,
      count: 2,
      intervals: [
        {
          runId: intervalRunId,
          dutyId: 'spn-fusion:0',
          sourceOnlyMarker: 'uncapped-source-duty-row',
          phase: 'spn-fusion',
          boundary: 'readback-lowres',
          kind: 'submitted-work-drain-interval',
          startMs: 5135,
          endMs: 5155,
          durationMs: 20,
          startEpochMs: 1_700_000_000_135,
          endEpochMs: 1_700_000_000_155,
        },
        {
          runId: intervalRunId,
          dutyId: 'monodepth:0',
          phase: 'monodepth',
          boundary: 'vit-block-chunk',
          kind: 'submitted-work-drain-interval',
          startMs: 5170,
          endMs: 5180,
          durationMs: 10,
          startEpochMs: 1_700_000_000_170,
          endEpochMs: 1_700_000_000_180,
        },
      ],
    },
  };
}

const hybrid = episodeHarness({
  firePresentation: learnedHybridPresentation,
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    hybridSplatSmokeCompositorIdentity: learnedHybridPresentation.hybridSplatSmokeCompositorIdentity,
    hybridSplatSmokeApproximation: learnedHybridPresentation.hybridSplatSmokeApproximation,
    splatDepthConditionedSmokeSplit: learnedHybridPresentation.splatDepthConditionedSmokeSplit,
    hybridSmokePhaseAuthority: learnedHybridPresentation.hybridSmokePhaseAuthority,
    hybridSplatLayer: learnedHybridPresentation.hybridSplatLayer,
    hybridSmokeLayer: learnedHybridPresentation.hybridSmokeLayer,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
hybrid.episode.start();
hybrid.advance();
const hybridReport = hybrid.episode.finish({ phase: 'complete' });
assert.equal(hybridReport.status, 'verified');
assert.equal(hybridReport.effectiveFirePresentation.schema, 'kaminos.kiln-fire-presentation.v0');
assert.equal(hybridReport.effectiveFirePresentation.effectiveMode, 'learned-splat-flame-raymarched-smoke');
assert.equal(hybridReport.effectiveFirePresentation.candidateOverflow, 0);
assert.equal(hybridReport.effectiveFirePresentation.hybridSplatSmokeCompositorIdentity, learnedHybridPresentation.hybridSplatSmokeCompositorIdentity);
assert.equal(hybridReport.effectiveFirePresentation.hybridSplatSmokeApproximation, learnedHybridPresentation.hybridSplatSmokeApproximation);
assert.equal(hybridReport.effectiveFirePresentation.splatDepthConditionedSmokeSplit, learnedHybridPresentation.splatDepthConditionedSmokeSplit);
assert.equal(hybridReport.effectiveFirePresentation.hybridSmokePhaseAuthority, learnedHybridPresentation.hybridSmokePhaseAuthority);
assert.deepEqual(hybridReport.effectiveFirePresentation.hybridSplatLayer, learnedHybridPresentation.hybridSplatLayer);
assert.deepEqual(hybridReport.effectiveFirePresentation.hybridSmokeLayer, learnedHybridPresentation.hybridSmokeLayer);
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.identity, 'foreground-kiln-fire-episode-hooks-v0');
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.firingId, 'firing-0713-a');
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.routeIdentity.compositionRequested, 'hybrid-smoke');
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.routeIdentity.compositionEffective, 'hybrid-smoke');
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.routeIdentity.compositionFallbackReason, null);
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.rawRafGapSamplesMs, undefined, 'per-frame presentation samples retain only the episode join, not repeated raw gap arrays');
assert.deepEqual(hybridReport.firePresentationMismatchSamples, []);

const hookCompositionFallback = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    fireEpisodeHooks: {
      ...learnedHybridPresentation.fireEpisodeHooks,
      routeIdentity: {
        effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
        prototypeIdentity: 'kaminos-volume-prototype-v0',
        compositionRequested: 'hybrid-smoke',
        compositionEffective: 'raymarch-fallback',
        compositionFallbackReason: 'hybrid-compositor-gpu-route-unavailable',
      },
    },
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    requireNoFallback: true,
    requireFireEpisodeHooks: true,
  },
});
hookCompositionFallback.episode.start();
hookCompositionFallback.advance();
const hookCompositionFallbackReport = hookCompositionFallback.episode.finish({ phase: 'complete' });
assert.equal(hookCompositionFallbackReport.status, 'invalid');
assert.ok(hookCompositionFallbackReport.failures.includes('effective-fire-presentation-mismatch'));
assert.ok(hookCompositionFallbackReport.firePresentationMismatchSamples[0].reasons.includes('fire-episode-composition-effective-mismatch'));
assert.ok(hookCompositionFallbackReport.firePresentationMismatchSamples[0].reasons.includes('fire-episode-composition-fallback-present'));

const exactFireEpisodeRecording = {
  identity: 'foreground-kiln-fire-episode-hooks-v0',
  firingId: 'firing-exact-0713',
  generation: 4,
  phase: 'recording',
  status: 'recording',
  evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
  authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
  routeIdentity: {
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
  },
  sampleCount: 2,
  frameAdvanceCount: 2,
  simStepAdvanceCount: 2,
  startedAtMs: 90,
  endedAtMs: null,
};
const exactFireEpisode = episodeHarness({
  firingId: exactFireEpisodeRecording.firingId,
  requireExactFireEpisode: true,
  fireEpisodeHooks: exactFireEpisodeRecording,
});
exactFireEpisode.episode.start();
exactFireEpisode.advance();
exactFireEpisode.setVolume({
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    phase: 'complete',
    status: 'complete',
    sampleCount: 3,
    frameAdvanceCount: 3,
    simStepAdvanceCount: 3,
    endedAtMs: 116,
  },
});
const exactFireEpisodeReport = exactFireEpisode.episode.finish({ phase: 'complete' });
assert.equal(exactFireEpisodeReport.status, 'verified');
assert.equal(exactFireEpisodeReport.effectiveFireEpisodeHooks.firingId, 'firing-exact-0713');
assert.equal(exactFireEpisodeReport.effectiveFireEpisodeHooks.status, 'complete');
assert.deepEqual(exactFireEpisodeReport.fireEpisodeMismatchSamples, []);

const forgedSourceExactEpisode = episodeHarness({
  firingId: 'firing-forged-source-0713',
  requireExactFireEpisode: true,
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-forged-source-0713',
    evidenceSource: 'fixture-or-stale-side-channel',
  },
});
forgedSourceExactEpisode.episode.start();
const forgedSourceReport = forgedSourceExactEpisode.episode.report({ phase: 'burning' });
assert.equal(forgedSourceReport.status, 'invalid');
assert.ok(forgedSourceReport.failures.includes('fire-episode-evidence-source-mismatch'));

const forgedAuthorityExactEpisode = episodeHarness({
  firingId: 'firing-forged-authority-0713',
  requireExactFireEpisode: true,
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-forged-authority-0713',
    authority: 'fixture-authority-not-renderer-simulator-hooks',
  },
});
forgedAuthorityExactEpisode.episode.start();
const forgedAuthorityReport = forgedAuthorityExactEpisode.episode.report({ phase: 'burning' });
assert.equal(forgedAuthorityReport.status, 'invalid');
assert.ok(forgedAuthorityReport.failures.includes('fire-episode-authority-mismatch'));

const staleRouteExactEpisode = episodeHarness({
  firingId: 'firing-stale-route-0713',
  requireExactFireEpisode: true,
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-stale-route-0713',
    routeIdentity: {
      effectiveRoute: 'fixture-volume-v0',
      prototypeIdentity: 'foreign-prototype',
    },
  },
});
staleRouteExactEpisode.episode.start();
const staleRouteReport = staleRouteExactEpisode.episode.report({ phase: 'burning' });
assert.equal(staleRouteReport.status, 'invalid');
assert.ok(staleRouteReport.failures.includes('fire-episode-route-identity-mismatch'));

const staleCompletedExactEpisode = episodeHarness({
  firingId: 'firing-stale-window-0713',
  requireExactFireEpisode: true,
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-stale-window-0713',
  },
});
staleCompletedExactEpisode.episode.start();
staleCompletedExactEpisode.advance();
staleCompletedExactEpisode.setVolume({
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-stale-window-0713',
    phase: 'complete',
    status: 'complete',
    frameAdvanceCount: 2,
    simStepAdvanceCount: 2,
    endedAtMs: 116,
  },
});
staleCompletedExactEpisode.advance({ gapMs: 400 });
const staleCompletedExactEpisodeReport = staleCompletedExactEpisode.episode.finish({ phase: 'complete' });
assert.equal(staleCompletedExactEpisodeReport.status, 'invalid');
assert.ok(staleCompletedExactEpisodeReport.failures.includes('fire-episode-window-ended-early'));

const missingExactFireEpisode = episodeHarness({
  firingId: 'firing-missing-0713',
  requireExactFireEpisode: true,
});
missingExactFireEpisode.episode.start();
missingExactFireEpisode.advance();
const missingExactFireEpisodeReport = missingExactFireEpisode.episode.finish({ phase: 'complete' });
assert.equal(missingExactFireEpisodeReport.status, 'invalid');
assert.ok(missingExactFireEpisodeReport.failures.includes('fire-episode-hooks-missing'));

const crossFiringExactEpisode = episodeHarness({
  firingId: 'firing-requested-0713',
  requireExactFireEpisode: true,
  fireEpisodeHooks: {
    ...exactFireEpisodeRecording,
    firingId: 'firing-from-another-run',
  },
});
crossFiringExactEpisode.episode.start();
crossFiringExactEpisode.advance();
const crossFiringExactEpisodeReport = crossFiringExactEpisode.episode.finish({ phase: 'complete' });
assert.equal(crossFiringExactEpisodeReport.status, 'invalid');
assert.ok(crossFiringExactEpisodeReport.failures.includes('fire-episode-firing-id-mismatch'));

const hiddenFallback = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    effectiveMode: 'full-raymarch',
    flameRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: null,
    fallbackReason: null,
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
hiddenFallback.episode.start();
hiddenFallback.advance();
const hiddenFallbackReport = hiddenFallback.episode.finish({ phase: 'complete' });
assert.equal(hiddenFallbackReport.status, 'invalid');
assert.ok(hiddenFallbackReport.failures.includes('effective-fire-presentation-mismatch'));
assert.equal(hiddenFallbackReport.firePresentationMismatchSamples[0].reasons.includes('effective-mode-mismatch'), true);
assert.equal(hiddenFallbackReport.firePresentationMismatchSamples[0].reasons.includes('learned-model-identity-mismatch'), true);

const transientRendererSubstitution = episodeHarness({
  firePresentation: learnedHybridPresentation,
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
transientRendererSubstitution.episode.start();
transientRendererSubstitution.setVolume({
  firePresentation: {
    ...learnedHybridPresentation,
    effectiveMode: 'analytic-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
    learnedModelIdentity: null,
    fallbackReason: 'learned-model-unavailable',
  },
});
transientRendererSubstitution.advance();
transientRendererSubstitution.setVolume({ firePresentation: learnedHybridPresentation });
transientRendererSubstitution.advance();
const transientRendererReport = transientRendererSubstitution.episode.finish({ phase: 'complete' });
assert.equal(transientRendererReport.status, 'invalid');
assert.ok(transientRendererReport.failures.includes('effective-fire-presentation-mismatch'));
assert.equal(transientRendererReport.firePresentationMismatchSamples.length, 1);
assert.equal(transientRendererReport.firePresentationMismatchSamples[0].firePresentation.fallbackReason, 'learned-model-unavailable');

const partialCandidateEvidence = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    candidateCount: null,
    candidateCapacity: null,
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
partialCandidateEvidence.episode.start();
partialCandidateEvidence.advance();
const partialCandidateReport = partialCandidateEvidence.episode.finish({ phase: 'complete' });
assert.equal(partialCandidateReport.status, 'invalid');
assert.ok(partialCandidateReport.failures.includes('effective-fire-presentation-mismatch'));
assert.equal(partialCandidateReport.firePresentationMismatchSamples[0].reasons.includes('candidate-evidence-missing'), true);

const callerOwnedExpectedPresentation = {
  ...learnedHybridPresentation,
  hybridSplatLayer: { ...learnedHybridPresentation.hybridSplatLayer },
  hybridSmokeLayer: {
    ...learnedHybridPresentation.hybridSmokeLayer,
    intervals: [...learnedHybridPresentation.hybridSmokeLayer.intervals],
  },
  requireNoFallback: true,
  requireZeroOverflow: true,
  requireCandidateEvidence: true,
  requireTimingAuthority: true,
  requireFireEpisodeHooks: true,
};
const legacyCompositorPresentation = {
  ...learnedHybridPresentation,
  hybridSplatSmokeCompositorIdentity: 'single-representative-depth-splat-smoke-compositor-v0',
  hybridSmokeLayer: {
    ...learnedHybridPresentation.hybridSmokeLayer,
    intervals: ['front-of-splat-depth'],
  },
};
const mutableExpectationEpisode = episodeHarness({
  firePresentation: legacyCompositorPresentation,
  expectedFirePresentation: callerOwnedExpectedPresentation,
});
mutableExpectationEpisode.episode.start();
callerOwnedExpectedPresentation.hybridSplatSmokeCompositorIdentity = legacyCompositorPresentation.hybridSplatSmokeCompositorIdentity;
callerOwnedExpectedPresentation.hybridSmokeLayer.intervals.splice(1, 1);
mutableExpectationEpisode.advance();
const mutableExpectationReport = mutableExpectationEpisode.episode.finish({ phase: 'complete' });
assert.equal(mutableExpectationReport.status, 'invalid');
assert.ok(mutableExpectationReport.failures.includes('effective-fire-presentation-mismatch'));
assert.ok(mutableExpectationReport.firePresentationMismatchSamples.some(sample => (
  sample.reasons.includes('hybrid-splat-smoke-compositor-identity-mismatch')
  && sample.reasons.includes('hybrid-smoke-intervals-mismatch')
)));
assert.equal(
  mutableExpectationReport.expectedFirePresentation.hybridSplatSmokeCompositorIdentity,
  learnedHybridPresentation.hybridSplatSmokeCompositorIdentity,
);
assert.deepEqual(
  mutableExpectationReport.expectedFirePresentation.hybridSmokeLayer.intervals,
  learnedHybridPresentation.hybridSmokeLayer.intervals,
);

const returnedMismatchAliasEpisode = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    hybridSmokeLayer: {
      ...learnedHybridPresentation.hybridSmokeLayer,
      intervals: ['front-of-splat-depth'],
    },
  },
  expectedFirePresentation: {
    ...learnedHybridPresentation,
    hybridSplatLayer: { ...learnedHybridPresentation.hybridSplatLayer },
    hybridSmokeLayer: {
      ...learnedHybridPresentation.hybridSmokeLayer,
      intervals: [...learnedHybridPresentation.hybridSmokeLayer.intervals],
    },
  },
});
returnedMismatchAliasEpisode.episode.start();
returnedMismatchAliasEpisode.advance();
const firstMismatchAliasReport = returnedMismatchAliasEpisode.episode.finish({ phase: 'complete' });
assert.equal(firstMismatchAliasReport.status, 'invalid');
assert.ok(firstMismatchAliasReport.firePresentationMismatchSamples.every(sample => (
  sample.reasons.includes('hybrid-smoke-intervals-mismatch')
)));
for (const sample of firstMismatchAliasReport.firePresentationMismatchSamples) {
  sample.firePresentation.hybridSmokeLayer.intervals.push('back-of-splat-depth');
}
const secondMismatchAliasReport = returnedMismatchAliasEpisode.episode.report({ phase: 'complete' });
assert.equal(secondMismatchAliasReport.status, 'invalid');
assert.ok(secondMismatchAliasReport.failures.includes('effective-fire-presentation-mismatch'));
assert.ok(secondMismatchAliasReport.firePresentationMismatchSamples.every(sample => (
  sample.reasons.includes('hybrid-smoke-intervals-mismatch')
)));

for (const [effectiveCandidateEvidence, expectedReason] of [
  [{ candidateCopyBytes: 4096 }, 'candidate-copy-present'],
  [{ candidateCount: 0 }, 'candidate-set-empty'],
]) {
  const candidateAuthorityEpisode = episodeHarness({
    firePresentation: {
      ...learnedHybridPresentation,
      ...effectiveCandidateEvidence,
    },
    expectedFirePresentation: {
      ...learnedHybridPresentation,
      hybridSplatLayer: { ...learnedHybridPresentation.hybridSplatLayer },
      hybridSmokeLayer: {
        ...learnedHybridPresentation.hybridSmokeLayer,
        intervals: [...learnedHybridPresentation.hybridSmokeLayer.intervals],
      },
      requireNoFallback: true,
      requireZeroOverflow: true,
      requireCandidateEvidence: true,
      requireZeroCandidateCopy: true,
      requireNonEmptyCandidateSet: true,
    },
  });
  candidateAuthorityEpisode.episode.start();
  candidateAuthorityEpisode.advance();
  const candidateAuthorityReport = candidateAuthorityEpisode.episode.finish({ phase: 'complete' });
  assert.equal(candidateAuthorityReport.status, 'invalid');
  assert.ok(candidateAuthorityReport.failures.includes('effective-fire-presentation-mismatch'));
  assert.ok(candidateAuthorityReport.firePresentationMismatchSamples.every(sample => (
    sample.reasons.includes(expectedReason)
  )));
}

const identityOnlyHooks = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    fireEpisodeHooks: { identity: 'foreground-kiln-fire-episode-hooks-v0' },
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
identityOnlyHooks.episode.start();
identityOnlyHooks.advance();
const identityOnlyHooksReport = identityOnlyHooks.episode.finish({ phase: 'complete' });
assert.equal(identityOnlyHooksReport.status, 'invalid');
assert.equal(identityOnlyHooksReport.firePresentationMismatchSamples[0].reasons.includes('fire-episode-window-missing'), true);

const crossFiringHooks = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    fireEpisodeHooks: {
      ...learnedHybridPresentation.fireEpisodeHooks,
      firingId: 'firing-from-another-run',
    },
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
crossFiringHooks.episode.start();
crossFiringHooks.advance();
const crossFiringHooksReport = crossFiringHooks.episode.finish({ phase: 'complete' });
assert.equal(crossFiringHooksReport.status, 'invalid');
assert.equal(crossFiringHooksReport.firePresentationMismatchSamples[0].reasons.includes('fire-episode-firing-id-mismatch'), true);

const staleHookCounters = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    fireEpisodeHooks: {
      ...learnedHybridPresentation.fireEpisodeHooks,
      frameAdvanceCount: 0,
      simStepAdvanceCount: 0,
    },
  },
  expectedFirePresentation: {
    firingId: learnedHybridPresentation.firingId,
    effectiveMode: 'learned-splat-flame-raymarched-smoke',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedHybridPresentation.learnedModelIdentity,
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireTimingAuthority: true,
    requireFireEpisodeHooks: true,
  },
});
staleHookCounters.episode.start();
staleHookCounters.advance();
const staleHookCountersReport = staleHookCounters.episode.finish({ phase: 'complete' });
assert.equal(staleHookCountersReport.status, 'invalid');
assert.ok(staleHookCountersReport.failures.includes('fire-episode-did-not-advance'));

const live = episodeHarness();
live.episode.start();
live.advance({ gapMs: 17 });
live.advance({ gapMs: 42 });
live.advance({ gapMs: 18 });
const liveReport = live.episode.finish({
  phase: 'complete',
  sharpHeartbeat: { schema: 'sharp-webgpu.background-heartbeat.v0', status: 'verified' },
});
assert.equal(liveReport.schema, FOREGROUND_KILN_HEARTBEAT_SCHEMA);
assert.equal(liveReport.status, 'verified');
assert.equal(liveReport.evidenceSource, 'foreground-kaminos-main-page-raf');
assert.equal(liveReport.sampleCount >= 4, true);
assert.equal(liveReport.maxFrameGapMs, 42);
assert.equal(liveReport.frameCountDelta > 0, true);
assert.equal(liveReport.simStepCountDelta > 0, true);
assert.deepEqual(liveReport.requestedFireBudget, budget);
assert.deepEqual(liveReport.effectiveFireBudget, budget);
assert.equal(liveReport.sharpHeartbeat.schema, 'sharp-webgpu.background-heartbeat.v0');

const uncappedLive = episodeHarness({ firingId: 'firing-production-cardinality' });
uncappedLive.episode.start();
for (let index = 0; index < 140_000; index += 1) {
  uncappedLive.advance({ gapMs: index === 139_999 ? 47 : 16 });
}
const uncappedLiveReport = uncappedLive.episode.report({ phase: 'burning' });
assert.equal(uncappedLiveReport.sampleCount, 140_001);
assert.equal(uncappedLiveReport.frameGapCount, 140_000);
assert.equal(uncappedLiveReport.maxFrameGapMs, 47);

const preEpisodeFrame = episodeHarness();
preEpisodeFrame.episode.start();
preEpisodeFrame.advance({ gapMs: 16, frameTimestampMs: 99 });
preEpisodeFrame.advance({ gapMs: 16 });
const preEpisodeFrameReport = preEpisodeFrame.episode.finish({ phase: 'complete' });
assert.equal(
  preEpisodeFrameReport.preEpisodeFrameCallbackCount,
  1,
  'a callback timestamped before the episode must be discarded and reported',
);
assert.equal(preEpisodeFrameReport.samples.every((sample, index, samples) => (
  index === 0 || sample.timestampMs >= samples[index - 1].timestampMs
)), true, 'discarding the already-started frame must preserve sample ordering');

const laterOutOfOrderFrame = episodeHarness({
  firingId: 'firing-later-out-of-order',
  requireSharpDutyCorrelation: true,
});
laterOutOfOrderFrame.episode.start();
laterOutOfOrderFrame.advance({ gapMs: 16 });
laterOutOfOrderFrame.advance({ gapMs: 16, frameTimestampMs: 110 });
const laterOutOfOrderReport = laterOutOfOrderFrame.episode.finish({
  phase: 'complete',
  sharpHeartbeat: sharpDutyHeartbeat(),
});
assert.ok(
  laterOutOfOrderReport.sharpDutyCorrelation.failures.includes('foreground-sample-order-invalid'),
  'only the already-started first frame may be discarded; later ordering corruption must still fail loud',
);

const correlated = episodeHarness({
  firingId: 'firing-correlation-a',
  requireSharpDutyCorrelation: true,
});
correlated.episode.start();
correlated.advance({ gapMs: 16 });
correlated.advance({ gapMs: 40 });
correlated.advance({ gapMs: 30 });
const correlatedReport = correlated.episode.finish({
  phase: 'complete',
  sharpHeartbeat: sharpDutyHeartbeat(),
});
assert.equal(correlatedReport.status, 'verified');
assert.equal(correlatedReport.firingId, 'firing-correlation-a');
assert.equal(correlatedReport.sampleRetention, 'uncapped');
assert.equal(correlatedReport.samples.length, correlatedReport.sampleCount);
assert.equal(correlatedReport.samples[0].epochMs, 1_700_000_000_100);
assert.equal(correlatedReport.sharpDutyCorrelation.schema, 'kaminos.foreground-sharp-duty-correlation.v0');
assert.equal(correlatedReport.sharpDutyCorrelation.status, 'verified');
assert.equal(correlatedReport.sharpDutyCorrelation.runId, 'sharp-run-0713-a');
assert.equal(correlatedReport.sharpDutyCorrelation.foregroundGaps.length, 3, 'all inference-window foreground gaps remain uncapped');
assert.equal(correlatedReport.sharpDutyCorrelation.totals.foregroundGapDurationMs, 76);
assert.equal(correlatedReport.sharpDutyCorrelation.totals.attributedDurationMs, 30);
assert.equal(correlatedReport.sharpDutyCorrelation.totals.unattributedDurationMs, 46);
assert.equal(correlatedReport.sharpHeartbeat.gpuDutyIntervals.count, 2);
assert.equal(correlatedReport.sharpHeartbeat.gpuDutyIntervals.intervals, undefined);
assert.equal(
  JSON.stringify(correlatedReport).includes('uncapped-source-duty-row'),
  false,
  'the foreground report must retain derived correlation without republishing source duty rows',
);
assert.deepEqual(
  correlatedReport.sharpDutyCorrelation.phaseRankings.map(row => [row.phase, row.overlapDurationMs]),
  [['spn-fusion', 20], ['monodepth', 10]],
);

const mixedRunCorrelation = episodeHarness({
  firingId: 'firing-correlation-mixed',
  requireSharpDutyCorrelation: true,
});
mixedRunCorrelation.episode.start();
mixedRunCorrelation.advance({ gapMs: 40 });
const mixedRunReport = mixedRunCorrelation.episode.finish({
  phase: 'complete',
  sharpHeartbeat: sharpDutyHeartbeat({ intervalRunId: 'stale-sharp-run' }),
});
assert.equal(mixedRunReport.status, 'invalid');
assert.ok(mixedRunReport.failures.includes('sharp-duty-correlation-invalid'));
assert.ok(mixedRunReport.sharpDutyCorrelation.failures.includes('sharp-duty-interval-run-mismatch'));

const missingClockCorrelation = episodeHarness({
  firingId: 'firing-correlation-clockless',
  requireSharpDutyCorrelation: true,
});
missingClockCorrelation.episode.start();
missingClockCorrelation.advance({ gapMs: 40 });
const missingClockReport = missingClockCorrelation.episode.finish({
  phase: 'complete',
  sharpHeartbeat: sharpDutyHeartbeat({ includeClock: false }),
});
assert.equal(missingClockReport.status, 'invalid');
assert.ok(missingClockReport.sharpDutyCorrelation.failures.includes('sharp-cross-page-clock-missing'));

const wrongBudget = episodeHarness({ effectiveBudget: { ...budget, resolution: 160 } });
wrongBudget.episode.start();
wrongBudget.advance();
const wrongBudgetReport = wrongBudget.episode.finish({ phase: 'complete' });
assert.equal(wrongBudgetReport.status, 'invalid');
assert.ok(wrongBudgetReport.failures.includes('effective-fire-budget-mismatch'));

const transientBudgetDrift = episodeHarness();
transientBudgetDrift.setVolume({ resolution: 160, renderScale: 1, adaptiveRaymarch: 0.3 });
transientBudgetDrift.episode.start();
transientBudgetDrift.advance({
  nextVolume: {
    active: true,
    routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
    frameCount: 11,
    simStepCount: 21,
    resolution: 90,
    renderScale: 0.4,
    adaptiveRaymarch: 1,
  },
});
const transientBudgetReport = transientBudgetDrift.episode.finish({ phase: 'complete' });
assert.equal(transientBudgetReport.status, 'invalid');
assert.ok(transientBudgetReport.failures.includes('effective-fire-budget-mismatch'));
assert.equal(transientBudgetReport.budgetMismatchSamples.length, 1);
assert.equal(transientBudgetReport.budgetMismatchSamples[0].sampleIndex, 0);
assert.equal(transientBudgetReport.budgetMismatchSamples[0].fireBudget.resolution, 160);

const wrongRoute = episodeHarness({ routeIdentity: 'fixture-volume-v0' });
wrongRoute.episode.start();
wrongRoute.advance();
const wrongRouteReport = wrongRoute.episode.finish({ phase: 'complete' });
assert.equal(wrongRouteReport.status, 'invalid');
assert.ok(wrongRouteReport.failures.includes('effective-volume-route-mismatch'));

const stalled = episodeHarness();
stalled.episode.start();
stalled.advance({ gapMs: 30, frameDelta: 0, simDelta: 0 });
stalled.advance({ gapMs: 30, frameDelta: 0, simDelta: 0 });
const stalledReport = stalled.episode.finish({ phase: 'complete' });
assert.equal(stalledReport.status, 'invalid');
assert.ok(stalledReport.failures.includes('volume-frame-did-not-advance'));
assert.ok(stalledReport.failures.includes('volume-sim-step-did-not-advance'));

const inactive = episodeHarness();
inactive.episode.start();
inactive.setVolume({ active: false });
inactive.advance();
const inactiveReport = inactive.episode.finish({ phase: 'complete' });
assert.equal(inactiveReport.status, 'invalid');
assert.ok(inactiveReport.failures.includes('foreground-volume-not-active-through-episode'));

const noForeground = episodeHarness();
const noForegroundReport = noForeground.episode.finish({
  phase: 'complete',
  sharpHeartbeat: { schema: 'sharp-webgpu.background-heartbeat.v0', status: 'verified' },
});
assert.equal(noForegroundReport.status, 'invalid');
assert.ok(noForegroundReport.failures.includes('foreground-heartbeat-not-started'));
assert.equal(noForegroundReport.sharpHeartbeat.status, 'verified');

assert.equal(foregroundKilnStartAllowsPipeline({ phase: 'burning', foregroundHeartbeat: { status: 'recording' } }), true);
assert.equal(foregroundKilnStartAllowsPipeline({ phase: 'failed', foregroundHeartbeat: null }), false);
assert.equal(foregroundKilnStartAllowsPipeline({ phase: 'burning', foregroundHeartbeat: { status: 'invalid' } }), false);

const root = new URL('..', import.meta.url).pathname;
const witnessSource = readFileSync(join(root, 'scripts', 'foreground-kiln-heartbeat-witness.mjs'), 'utf8');
assert.match(witnessSource, /foreground\.status !== 'verified'/, 'browser witness fails when foreground evidence is absent or invalid');
assert.match(witnessSource, /effectiveFireBudget\?\.resolution !== 90/, 'browser witness rejects a stale or substituted fire budget');
assert.match(witnessSource, /primaryOutputWritten/, 'browser witness reports whether its visual output was actually written');
assert.match(witnessSource, /lastTrustworthyEvidence/, 'browser witness preserves the last trustworthy state when failure precedes closure');
assert.match(
  witnessSource,
  /kaminosSharpBreathingRoomKilnFireDebug\.begin\(\{[\s\S]*firingId:\s*exactFiringId,/,
  'browser witness must open an exact renderer episode instead of exercising the rejected anonymous path',
);
assert.match(
  witnessSource,
  /fireEpisodeHooks\?\.firingId !== firingId/,
  'browser witness rejects a renderer episode belonging to another firing',
);
assert.match(
  witnessSource,
  /volumeReleaseConfirmed !== true/,
  'browser witness must fail when the completed firing leaves the volume active',
);
assert.match(
  witnessSource,
  /requireSharpDutyCorrelation:\s*false/,
  'renderer lifecycle witness must not impersonate a real SHARP cross-page duty correlation smoke',
);

console.log('foreground kiln heartbeat contracts passed');
