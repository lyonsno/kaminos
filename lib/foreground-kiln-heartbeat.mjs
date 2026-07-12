export const FOREGROUND_KILN_HEARTBEAT_SCHEMA = 'kaminos.foreground-kiln-heartbeat.v0';

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function volumeSample(state, timestampMs) {
  return {
    timestampMs,
    active: state?.active === true,
    routeIdentity: state?.routeIdentity || null,
    frameCount: finite(state?.frameCount),
    simStepCount: finite(state?.simStepCount),
    fireBudget: normalizedFireBudget(state),
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
    const failures = [];
    if (!started) failures.push('foreground-heartbeat-not-started');
    if (samples.some(sample => sample.active !== true)) failures.push('foreground-volume-not-active-through-episode');
    if (samples.some(sample => sample.routeIdentity !== expectedVolumeRouteIdentity)) failures.push('effective-volume-route-mismatch');
    if (budgetMismatchSamples.length) failures.push('effective-fire-budget-mismatch');
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
      samples: samples.map(sample => ({ ...sample, fireBudget: { ...sample.fireBudget } })),
      budgetMismatchSamples,
      sharpHeartbeat,
      failures,
    };
  }

  const api = { start, finish, report };
  return api;
}
