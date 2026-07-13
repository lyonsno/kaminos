export const FOREGROUND_KILN_HEARTBEAT_SCHEMA = 'kaminos.foreground-kiln-heartbeat.v0';
export const KILN_FIRE_PRESENTATION_SCHEMA = 'kaminos.kiln-fire-presentation.v0';

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  return finite(value);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function normalizedFireBudget(value = {}) {
  return {
    identity: value.identity || 'kaminos.kiln-contention-fire-budget.v0',
    resolution: finite(value.resolution ?? value.simGrid),
    renderScale: finite(value.renderScale),
    adaptiveRays: finite(value.adaptiveRays ?? value.adaptiveRaymarch),
  };
}

function budgetsMatch(requested, effective) {
  return requested.resolution === effective.resolution
    && Math.abs(requested.renderScale - effective.renderScale) < 1e-6
    && Math.abs(requested.adaptiveRays - effective.adaptiveRays) < 1e-6;
}

function normalizedFireEpisodeHookJoin(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    identity: value.identity || null,
    schema: value.schema || null,
    firingId: value.firingId || null,
    generation: nullableFinite(value.generation),
    phase: value.phase || value.window?.phase || null,
    status: value.status || null,
    evidenceSource: value.evidenceSource || null,
    authority: value.authority || null,
    disclaimer: value.disclaimer || null,
    sampleCount: nullableFinite(value.sampleCount ?? value.rawRafGapSamplesMs?.length),
    frameAdvanceCount: nullableFinite(value.frameAdvanceCount),
    simStepAdvanceCount: nullableFinite(value.simStepAdvanceCount),
    startedAtMs: nullableFinite(value.startedAtMs ?? value.window?.startedAtMs),
    finishedAtMs: nullableFinite(value.finishedAtMs ?? value.window?.finishedAtMs),
    evidenceRef: value.evidenceRef || null,
    evidenceDigest: value.evidenceDigest || null,
  };
}

function normalizedFirePresentation(value) {
  if (!value || typeof value !== 'object') return null;
  const raster = value.raster && typeof value.raster === 'object' ? value.raster : {};
  const timing = value.timing && typeof value.timing === 'object' ? value.timing : {};
  const fireEpisodeHooks = normalizedFireEpisodeHookJoin(value.fireEpisodeHooks);
  return {
    schema: value.schema || null,
    requestedMode: value.requestedMode || null,
    effectiveMode: value.effectiveMode || null,
    simulatorAuthority: value.simulatorAuthority || null,
    flameRendererIdentity: value.flameRendererIdentity || null,
    smokeRendererIdentity: value.smokeRendererIdentity || null,
    sourceSidecarIdentity: value.sourceSidecarIdentity || null,
    sourceSidecarAuthority: value.sourceSidecarAuthority || null,
    learnedModelIdentity: value.learnedModelIdentity || null,
    candidateCount: nullableFinite(value.candidateCount),
    candidateCapacity: nullableFinite(value.candidateCapacity),
    candidateOverflow: nullableFinite(value.candidateOverflow),
    candidateCopyBytes: nullableFinite(value.candidateCopyBytes),
    fallbackReason: value.fallbackReason || null,
    raster: {
      radius: nullableFinite(raster.radius),
      sharpness: nullableFinite(raster.sharpness),
      energyCompensation: raster.energyCompensation || null,
    },
    timing: {
      authority: timing.authority || null,
      compactionMs: nullableFinite(timing.compactionMs),
      decodeMs: nullableFinite(timing.decodeMs),
      decodeResolution: timing.decodeResolution || null,
    },
    fireEpisodeHooks,
  };
}

function firePresentationMismatchReasons(expected, effective) {
  if (!expected) return [];
  if (!effective) return ['fire-presentation-missing'];
  const reasons = [];
  if (effective.schema !== KILN_FIRE_PRESENTATION_SCHEMA) reasons.push('fire-presentation-schema-mismatch');
  for (const field of [
    'effectiveMode',
    'flameRendererIdentity',
    'smokeRendererIdentity',
    'learnedModelIdentity',
    'sourceSidecarIdentity',
    'sourceSidecarAuthority',
  ]) {
    if (expected[field] !== undefined && expected[field] !== effective[field]) {
      reasons.push(`${field.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-mismatch`);
    }
  }
  if (expected.requireNoFallback && effective.fallbackReason !== null) reasons.push('fallback-present');
  if (expected.requireZeroOverflow && effective.candidateOverflow !== 0) reasons.push('candidate-overflow-present');
  if (expected.requireCandidateEvidence) {
    if (!Number.isFinite(effective.candidateCount)
      || !Number.isFinite(effective.candidateCapacity)
      || !Number.isFinite(effective.candidateOverflow)
      || effective.candidateCount < 0
      || effective.candidateCapacity < effective.candidateCount) {
      reasons.push('candidate-evidence-missing');
    }
  }
  if (expected.requireTimingAuthority && !effective.timing?.authority) reasons.push('timing-authority-missing');
  if (expected.requireFireEpisodeHooks) {
    if (effective.fireEpisodeHooks?.identity !== 'foreground-kiln-fire-episode-hooks-v0') {
      reasons.push('fire-episode-hooks-missing');
    }
  }
  return reasons;
}

function volumeSample(state, timestampMs) {
  return {
    timestampMs,
    active: state?.active === true,
    routeIdentity: state?.routeIdentity || null,
    frameCount: finite(state?.frameCount),
    simStepCount: finite(state?.simStepCount),
    fireBudget: normalizedFireBudget(state),
    firePresentation: normalizedFirePresentation(state?.firePresentation),
  };
}

export function foregroundKilnStartAllowsPipeline(fireState) {
  return fireState?.phase === 'burning'
    && fireState?.foregroundHeartbeat?.status === 'recording'
    && !(fireState.foregroundHeartbeat.failures?.length > 0);
}

export function createForegroundKilnHeartbeatEpisode({
  routeId,
  profileId,
  pipelineId,
  expectedVolumeRouteIdentity,
  requestedFireBudget,
  expectedFirePresentation = null,
  readVolumeState,
  now = () => performance.now(),
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = handle => cancelAnimationFrame(handle),
} = {}) {
  const requestedBudget = normalizedFireBudget(requestedFireBudget);
  const samples = [];
  let started = false;
  let finished = false;
  let frameHandle = null;
  let startedAtMs = null;
  let finishedAtMs = null;

  function capture(timestampMs = now()) {
    const sample = volumeSample(readVolumeState?.() || null, timestampMs);
    const previous = samples.at(-1);
    sample.frameGapMs = previous ? Math.max(0, sample.timestampMs - previous.timestampMs) : null;
    samples.push(sample);
    return sample;
  }

  function schedule() {
    frameHandle = requestFrame(timestampMs => {
      frameHandle = null;
      if (finished) return;
      capture(finite(timestampMs, now()));
      schedule();
    });
  }

  function start() {
    if (started || finished) return api;
    started = true;
    startedAtMs = now();
    capture(startedAtMs);
    schedule();
    return api;
  }

  function finish({ phase = 'complete', sharpHeartbeat = null } = {}) {
    if (finished) return report({ phase, sharpHeartbeat });
    finished = true;
    finishedAtMs = now();
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    if (started && samples.at(-1)?.timestampMs !== finishedAtMs) capture(finishedAtMs);
    return report({ phase, sharpHeartbeat });
  }

  function report({ phase = finished ? 'complete' : 'running', sharpHeartbeat = null } = {}) {
    const first = samples[0] || null;
    const last = samples.at(-1) || null;
    const gaps = samples.map(sample => sample.frameGapMs).filter(Number.isFinite);
    const effectiveBudget = normalizedFireBudget(last?.fireBudget || first?.fireBudget || {});
    const budgetMismatchSamples = samples
      .map((sample, sampleIndex) => ({
        sampleIndex,
        timestampMs: sample.timestampMs,
        fireBudget: { ...sample.fireBudget },
      }))
      .filter(sample => !budgetsMatch(requestedBudget, sample.fireBudget));
    const firePresentationMismatchSamples = samples
      .map((sample, sampleIndex) => ({
        sampleIndex,
        timestampMs: sample.timestampMs,
        firePresentation: sample.firePresentation
          ? {
              ...sample.firePresentation,
              raster: { ...sample.firePresentation.raster },
              timing: { ...sample.firePresentation.timing },
              fireEpisodeHooks: sample.firePresentation.fireEpisodeHooks
                ? { ...sample.firePresentation.fireEpisodeHooks }
                : null,
            }
          : null,
        reasons: firePresentationMismatchReasons(expectedFirePresentation, sample.firePresentation),
      }))
      .filter(sample => sample.reasons.length > 0);
    const failures = [];
    if (!started) failures.push('foreground-heartbeat-not-started');
    if (samples.some(sample => sample.active !== true)) failures.push('foreground-volume-not-active-through-episode');
    if (samples.some(sample => sample.routeIdentity !== expectedVolumeRouteIdentity)) failures.push('effective-volume-route-mismatch');
    if (budgetMismatchSamples.length) failures.push('effective-fire-budget-mismatch');
    if (firePresentationMismatchSamples.length) failures.push('effective-fire-presentation-mismatch');
    if (finished) {
      if (samples.length < 2) failures.push('foreground-heartbeat-samples-missing');
      if (!first || !last || last.frameCount <= first.frameCount) failures.push('volume-frame-did-not-advance');
      if (!first || !last || last.simStepCount <= first.simStepCount) failures.push('volume-sim-step-did-not-advance');
    }
    return {
      schema: FOREGROUND_KILN_HEARTBEAT_SCHEMA,
      status: failures.length ? 'invalid' : (finished ? 'verified' : 'recording'),
      evidenceSource: 'foreground-kaminos-main-page-raf',
      disclaimer: 'main-page-raf-and-volume-counter-evidence-not-gpu-exclusive-or-display-present-latency',
      routeId: routeId || null,
      profileId: profileId || null,
      pipelineId: pipelineId || null,
      expectedVolumeRouteIdentity: expectedVolumeRouteIdentity || null,
      requestedFireBudget: requestedBudget,
      effectiveFireBudget: effectiveBudget,
      expectedFirePresentation: expectedFirePresentation ? { ...expectedFirePresentation } : null,
      effectiveFirePresentation: last?.firePresentation || first?.firePresentation || null,
      startedAtMs,
      finishedAtMs,
      durationMs: startedAtMs !== null && finishedAtMs !== null ? Math.max(0, finishedAtMs - startedAtMs) : null,
      phase,
      sampleCount: samples.length,
      frameGapCount: gaps.length,
      maxFrameGapMs: gaps.length ? Math.max(...gaps) : null,
      p95FrameGapMs: percentile(gaps, 0.95),
      p99FrameGapMs: percentile(gaps, 0.99),
      frameCountStart: first?.frameCount ?? null,
      frameCountEnd: last?.frameCount ?? null,
      frameCountDelta: first && last ? last.frameCount - first.frameCount : null,
      simStepCountStart: first?.simStepCount ?? null,
      simStepCountEnd: last?.simStepCount ?? null,
      simStepCountDelta: first && last ? last.simStepCount - first.simStepCount : null,
      samples: samples.map(sample => ({
        ...sample,
        fireBudget: { ...sample.fireBudget },
        firePresentation: sample.firePresentation
          ? {
              ...sample.firePresentation,
              raster: { ...sample.firePresentation.raster },
              timing: { ...sample.firePresentation.timing },
              fireEpisodeHooks: sample.firePresentation.fireEpisodeHooks
                ? { ...sample.firePresentation.fireEpisodeHooks }
                : null,
            }
          : null,
      })),
      budgetMismatchSamples,
      firePresentationMismatchSamples,
      sharpHeartbeat,
      failures,
    };
  }

  const api = { start, finish, report };
  return api;
}
