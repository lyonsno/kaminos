import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FOREGROUND_KILN_HEARTBEAT_SCHEMA,
  createForegroundKilnHeartbeatEpisode,
  createForegroundHostEventCorrelation,
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
  const events = [];
  const episode = createForegroundKilnHeartbeatEpisode({
    firingId: 'firing-host-event-a',
    routeId: 'sharp-image-to-splat-live-v0',
    profileId: 'cooperative-spn-gaussian',
    pipelineId: 'sharp-image-to-splat-live-v0',
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
  });
  episode.start();
  nowMs = 120;
  episode.recordEvent({ kind: 'browser-host', phase: 'present', startMs: 110, endMs: 118, detail: 'test' });
  const report = episode.finish();
  assert.equal(typeof episode.recordEvent, 'function');
  assert.deepEqual(report.hostEvents, [{
    eventId: 'firing-host-event-a:host:0',
    firingId: 'firing-host-event-a',
    kind: 'browser-host',
    source: 'runtime-explicit',
    phase: 'present',
    startMs: 110,
    endMs: 118,
    startEpochMs: 1_700_000_000_110,
    endEpochMs: 1_700_000_000_118,
    durationMs: 8,
    detail: 'test',
  }]);
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
    advance({ gapMs = 16, frameDelta = 1, simDelta = 1, nextVolume = null } = {}) {
      nowMs += gapMs;
      volume = nextVolume || {
        ...volume,
        frameCount: volume.frameCount + frameDelta,
        simStepCount: volume.simStepCount + simDelta,
      };
      const callback = scheduled;
      scheduled = null;
      callback?.(nowMs);
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
correlatedReport.hostEvents = [{
  eventId: 'firing-correlation-a:host:manual',
  firingId: 'firing-correlation-a',
  kind: 'browser-performance',
  source: 'performance-observer-longtask',
  phase: 'longtask',
  startMs: 120,
  endMs: 140,
  startEpochMs: 1_700_000_000_120,
  endEpochMs: 1_700_000_000_140,
  durationMs: 20,
}];
correlatedReport.hostEventCount = 1;
const hostCorrelation = createForegroundHostEventCorrelation({
  foregroundHeartbeat: correlatedReport,
  foregroundGaps: correlatedReport.sharpDutyCorrelation.foregroundGaps,
});
assert.equal(hostCorrelation.schema, 'kaminos.foreground-host-event-correlation.v0');
assert.equal(hostCorrelation.hostEventCount, 1);
assert.equal(hostCorrelation.totals.hostCoveredDurationMs, 20);
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
