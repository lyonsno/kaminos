import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FOREGROUND_KILN_HEARTBEAT_SCHEMA,
  createForegroundKilnHeartbeatEpisode,
  foregroundKilnStartAllowsPipeline,
} from '../lib/foreground-kiln-heartbeat.mjs';

const budget = {
  identity: 'kaminos.kiln-contention-fire-budget.v0',
  resolution: 90,
  renderScale: 0.4,
  adaptiveRays: 1,
};

const learnedHybridPresentation = {
  schema: 'kaminos.kiln-fire-presentation.v0',
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
    rawRafGapSamplesMs: [16, 17, 52],
  },
};

function episodeHarness({
  effectiveBudget = budget,
  routeIdentity = 'native-3d-compute-fluid-raymarch-v0',
  firePresentation = null,
  expectedFirePresentation = null,
} = {}) {
  let nowMs = 100;
  let nextFrameId = 0;
  let scheduled = null;
  let volume = {
    active: true,
    routeIdentity,
    frameCount: 10,
    simStepCount: 20,
    resolution: effectiveBudget.resolution,
    renderScale: effectiveBudget.renderScale,
    adaptiveRaymarch: effectiveBudget.adaptiveRays,
    firePresentation,
  };
  const episode = createForegroundKilnHeartbeatEpisode({
    routeId: 'sharp-image-to-splat-live-v0',
    profileId: 'cooperative-spn-gaussian',
    pipelineId: 'sharp-image-to-splat-live-v0',
    expectedVolumeRouteIdentity: 'native-3d-compute-fluid-raymarch-v0',
    requestedFireBudget: budget,
    expectedFirePresentation,
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

const hybrid = episodeHarness({
  firePresentation: learnedHybridPresentation,
  expectedFirePresentation: {
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
assert.equal(hybridReport.effectiveFirePresentation.fireEpisodeHooks.rawRafGapSamplesMs, undefined, 'per-frame presentation samples retain only the episode join, not repeated raw gap arrays');
assert.deepEqual(hybridReport.firePresentationMismatchSamples, []);

const hiddenFallback = episodeHarness({
  firePresentation: {
    ...learnedHybridPresentation,
    effectiveMode: 'full-raymarch',
    flameRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: null,
    fallbackReason: null,
  },
  expectedFirePresentation: {
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

console.log('foreground kiln heartbeat contracts passed');
