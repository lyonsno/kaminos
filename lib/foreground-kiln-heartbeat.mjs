import {
  FIRE_EPISODE_HOOK_AUTHORITY,
  FIRE_EPISODE_HOOK_EVIDENCE_SOURCE,
} from '../fire-episode-hooks.mjs';

export const FOREGROUND_KILN_HEARTBEAT_SCHEMA = 'kaminos.foreground-kiln-heartbeat.v0';
export const KILN_FIRE_PRESENTATION_SCHEMA = 'kaminos.kiln-fire-presentation.v0';
export const FOREGROUND_SHARP_DUTY_CORRELATION_SCHEMA = 'kaminos.foreground-sharp-duty-correlation.v0';

const CROSS_PAGE_CLOCK_SCHEMA = 'kaminos.browser-epoch-monotonic-clock.v0';
const SHARP_GPU_DUTY_INTERVALS_SCHEMA = 'sharp-webgpu.submitted-work-drain-intervals.v0';

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

function rounded(value) {
  return Number(value.toFixed(3));
}

function pushFailure(failures, failure) {
  if (!failures.includes(failure)) failures.push(failure);
}

function mergedIntervalDuration(intervals) {
  const ordered = intervals
    .filter(interval => Number.isFinite(interval?.startEpochMs)
      && Number.isFinite(interval?.endEpochMs)
      && interval.endEpochMs > interval.startEpochMs)
    .map(interval => ({ startEpochMs: interval.startEpochMs, endEpochMs: interval.endEpochMs }))
    .sort((a, b) => a.startEpochMs - b.startEpochMs || a.endEpochMs - b.endEpochMs);
  if (!ordered.length) return 0;
  let total = 0;
  let start = ordered[0].startEpochMs;
  let end = ordered[0].endEpochMs;
  for (const interval of ordered.slice(1)) {
    if (interval.startEpochMs <= end) {
      end = Math.max(end, interval.endEpochMs);
      continue;
    }
    total += end - start;
    start = interval.startEpochMs;
    end = interval.endEpochMs;
  }
  return total + (end - start);
}

function rankedOverlap(foregroundGaps, field) {
  const grouped = new Map();
  for (const gap of foregroundGaps) {
    const perGap = new Map();
    for (const overlap of gap.overlaps) {
      const key = overlap[field] || 'unknown';
      const intervals = perGap.get(key) || [];
      intervals.push(overlap);
      perGap.set(key, intervals);
    }
    for (const [key, intervals] of perGap) {
      grouped.set(key, (grouped.get(key) || 0) + mergedIntervalDuration(intervals));
    }
  }
  return [...grouped.entries()]
    .map(([key, overlapDurationMs]) => ({ [field]: key, overlapDurationMs: rounded(overlapDurationMs) }))
    .sort((a, b) => b.overlapDurationMs - a.overlapDurationMs || String(a[field]).localeCompare(String(b[field])));
}

export function createForegroundSharpDutyCorrelation({ foregroundHeartbeat, sharpHeartbeat } = {}) {
  const failures = [];
  const samples = Array.isArray(foregroundHeartbeat?.samples) ? foregroundHeartbeat.samples : [];
  const foregroundClock = foregroundHeartbeat?.clock;
  if (foregroundHeartbeat?.schema !== FOREGROUND_KILN_HEARTBEAT_SCHEMA) pushFailure(failures, 'foreground-heartbeat-missing');
  if (!foregroundHeartbeat?.firingId) pushFailure(failures, 'foreground-firing-id-missing');
  if (foregroundHeartbeat?.sampleRetention !== 'uncapped'
    || foregroundHeartbeat?.sampleCount !== samples.length) {
    pushFailure(failures, 'foreground-samples-capped-or-partial');
  }
  if (foregroundClock?.schema !== CROSS_PAGE_CLOCK_SCHEMA
    || foregroundClock?.timingAuthority !== 'performance-time-origin-plus-now'
    || !Number.isFinite(foregroundClock?.timeOriginEpochMs)) {
    pushFailure(failures, 'foreground-cross-page-clock-missing');
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample?.timestampMs) || !Number.isFinite(sample?.epochMs)) {
      pushFailure(failures, 'foreground-sample-epoch-missing');
      continue;
    }
    if (index > 0 && sample.epochMs < samples[index - 1].epochMs) {
      pushFailure(failures, 'foreground-sample-order-invalid');
    }
    if (Number.isFinite(foregroundClock?.timeOriginEpochMs)
      && Math.abs((foregroundClock.timeOriginEpochMs + sample.timestampMs) - sample.epochMs) > 1) {
      pushFailure(failures, 'foreground-sample-clock-mismatch');
    }
  }

  if (sharpHeartbeat?.schema !== 'sharp-webgpu.background-heartbeat.v0') {
    pushFailure(failures, 'sharp-heartbeat-missing');
  }
  const sharpClock = sharpHeartbeat?.crossPageClock;
  if (sharpClock?.schema !== CROSS_PAGE_CLOCK_SCHEMA
    || sharpClock?.timingAuthority !== 'performance-time-origin-plus-now'
    || !sharpClock?.runId
    || !Number.isFinite(sharpClock?.timeOriginEpochMs)
    || !Number.isFinite(sharpClock?.inferenceWindowStartEpochMs)
    || !Number.isFinite(sharpClock?.inferenceWindowEndEpochMs)
    || sharpClock?.inferenceWindowEndEpochMs <= sharpClock?.inferenceWindowStartEpochMs) {
    pushFailure(failures, 'sharp-cross-page-clock-missing');
  }
  const runId = sharpClock?.runId || null;
  const inferenceWindow = sharpHeartbeat?.inferenceWindow;
  if (!inferenceWindow?.runId || inferenceWindow.runId !== runId) {
    pushFailure(failures, 'sharp-inference-window-run-mismatch');
  }
  if (Number.isFinite(sharpClock?.timeOriginEpochMs)
    && Number.isFinite(inferenceWindow?.startMs)
    && Number.isFinite(inferenceWindow?.endMs)) {
    if (Math.abs((sharpClock.timeOriginEpochMs + inferenceWindow.startMs) - sharpClock.inferenceWindowStartEpochMs) > 1
      || Math.abs((sharpClock.timeOriginEpochMs + inferenceWindow.endMs) - sharpClock.inferenceWindowEndEpochMs) > 1) {
      pushFailure(failures, 'sharp-inference-window-clock-mismatch');
    }
  } else {
    pushFailure(failures, 'sharp-inference-window-missing');
  }

  const dutyEnvelope = sharpHeartbeat?.gpuDutyIntervals;
  const duties = Array.isArray(dutyEnvelope?.intervals) ? dutyEnvelope.intervals : [];
  if (dutyEnvelope?.schema !== SHARP_GPU_DUTY_INTERVALS_SCHEMA
    || dutyEnvelope?.timingAuthority !== 'queue-on-submitted-work-done-host-await-not-gpu-exclusive'
    || !dutyEnvelope?.runId
    || dutyEnvelope.runId !== runId) {
    pushFailure(failures, 'sharp-duty-envelope-missing-or-mixed');
  }
  if (dutyEnvelope?.count !== duties.length || duties.length === 0) {
    pushFailure(failures, 'sharp-duty-intervals-missing-or-partial');
  }
  if (Array.isArray(dutyEnvelope?.pairingFailures) && dutyEnvelope.pairingFailures.length) {
    pushFailure(failures, 'sharp-duty-pairing-failure');
  }
  for (const duty of duties) {
    if (!duty?.runId || duty.runId !== runId) pushFailure(failures, 'sharp-duty-interval-run-mismatch');
    if (!duty?.dutyId || !duty?.phase || !duty?.boundary
      || !Number.isFinite(duty?.startMs) || !Number.isFinite(duty?.endMs)
      || !Number.isFinite(duty?.startEpochMs) || !Number.isFinite(duty?.endEpochMs)
      || duty.endMs < duty.startMs || duty.endEpochMs < duty.startEpochMs) {
      pushFailure(failures, 'sharp-duty-interval-invalid');
      continue;
    }
    if (Number.isFinite(sharpClock?.timeOriginEpochMs)
      && (Math.abs((sharpClock.timeOriginEpochMs + duty.startMs) - duty.startEpochMs) > 1
        || Math.abs((sharpClock.timeOriginEpochMs + duty.endMs) - duty.endEpochMs) > 1)) {
      pushFailure(failures, 'sharp-duty-interval-clock-mismatch');
    }
  }

  const windowStartEpochMs = sharpClock?.inferenceWindowStartEpochMs;
  const windowEndEpochMs = sharpClock?.inferenceWindowEndEpochMs;
  const foregroundGaps = [];
  if (Number.isFinite(windowStartEpochMs) && Number.isFinite(windowEndEpochMs)) {
    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
      const previous = samples[sampleIndex - 1];
      const current = samples[sampleIndex];
      if (!Number.isFinite(previous?.epochMs) || !Number.isFinite(current?.epochMs)) continue;
      const startEpochMs = Math.max(previous.epochMs, windowStartEpochMs);
      const endEpochMs = Math.min(current.epochMs, windowEndEpochMs);
      if (endEpochMs <= startEpochMs) continue;
      const overlaps = duties
        .map(duty => {
          const overlapStartEpochMs = Math.max(startEpochMs, duty.startEpochMs);
          const overlapEndEpochMs = Math.min(endEpochMs, duty.endEpochMs);
          if (overlapEndEpochMs <= overlapStartEpochMs) return null;
          return {
            runId: duty.runId,
            dutyId: duty.dutyId,
            phase: duty.phase,
            boundary: duty.boundary,
            startEpochMs: rounded(overlapStartEpochMs),
            endEpochMs: rounded(overlapEndEpochMs),
            overlapDurationMs: rounded(overlapEndEpochMs - overlapStartEpochMs),
          };
        })
        .filter(Boolean);
      const durationMs = endEpochMs - startEpochMs;
      const attributedDurationMs = mergedIntervalDuration(overlaps);
      foregroundGaps.push({
        sampleIndex,
        startEpochMs: rounded(startEpochMs),
        endEpochMs: rounded(endEpochMs),
        durationMs: rounded(durationMs),
        attributedDurationMs: rounded(attributedDurationMs),
        unattributedDurationMs: rounded(Math.max(0, durationMs - attributedDurationMs)),
        overlaps,
      });
    }
  }
  if (!foregroundGaps.length) pushFailure(failures, 'foreground-inference-window-gaps-missing');

  const foregroundGapDurationMs = foregroundGaps.reduce((sum, gap) => sum + gap.durationMs, 0);
  const attributedDurationMs = foregroundGaps.reduce((sum, gap) => sum + gap.attributedDurationMs, 0);
  const unattributedDurationMs = foregroundGaps.reduce((sum, gap) => sum + gap.unattributedDurationMs, 0);
  return {
    schema: FOREGROUND_SHARP_DUTY_CORRELATION_SCHEMA,
    status: failures.length ? 'invalid' : 'verified',
    evidenceSource: 'epoch-intersection-of-foreground-kaminos-raf-and-sharp-submitted-work-drain-intervals',
    timingAuthority: 'performance-time-origin-plus-now-cross-page-join',
    disclaimer: 'submitted-work-drain-host-await-overlap-not-gpu-exclusive-compositor-or-display-present-latency',
    firingId: foregroundHeartbeat?.firingId || null,
    runId,
    foregroundClock: foregroundClock || null,
    sharpClock: sharpClock || null,
    sharpDutyAuthority: dutyEnvelope?.timingAuthority || null,
    foregroundGapCount: foregroundGaps.length,
    foregroundGaps,
    phaseRankings: rankedOverlap(foregroundGaps, 'phase'),
    boundaryRankings: rankedOverlap(foregroundGaps, 'boundary'),
    totals: {
      foregroundGapDurationMs: rounded(foregroundGapDurationMs),
      attributedDurationMs: rounded(attributedDurationMs),
      unattributedDurationMs: rounded(unattributedDurationMs),
      attributedFraction: foregroundGapDurationMs > 0 ? rounded(attributedDurationMs / foregroundGapDurationMs) : null,
    },
    failures,
  };
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
  const routeIdentity = value.routeIdentity && typeof value.routeIdentity === 'object'
    ? {
        effectiveRoute: value.routeIdentity.effectiveRoute || null,
        prototypeIdentity: value.routeIdentity.prototypeIdentity || null,
        volumeScene: value.routeIdentity.volumeScene || null,
        flameRendererIdentity: value.routeIdentity.flameRendererIdentity || null,
        learnedModelIdentity: value.routeIdentity.learnedModelIdentity || null,
        fallbackReason: value.routeIdentity.fallbackReason || null,
        compositionRequested: value.routeIdentity.compositionRequested || null,
        compositionEffective: value.routeIdentity.compositionEffective || null,
        compositionFallbackReason: value.routeIdentity.compositionFallbackReason || null,
      }
    : null;
  return {
    identity: value.identity || null,
    schema: value.schema || null,
    firingId: value.firingId || null,
    generation: nullableFinite(value.generation),
    phase: value.phase || value.window?.phase || null,
    status: value.status || null,
    evidenceSource: value.evidenceSource || null,
    authority: value.authority || null,
    routeIdentity,
    disclaimer: value.disclaimer || null,
    sampleCount: nullableFinite(value.sampleCount ?? value.rawRafGapSamplesMs?.length),
    frameAdvanceCount: nullableFinite(value.frameAdvanceCount),
    simStepAdvanceCount: nullableFinite(value.simStepAdvanceCount),
    startedAtMs: nullableFinite(value.startedAtMs ?? value.window?.startedAtMs),
    finishedAtMs: nullableFinite(value.finishedAtMs ?? value.endedAtMs ?? value.window?.finishedAtMs),
    evidenceRef: value.evidenceRef || null,
    evidenceDigest: value.evidenceDigest || null,
  };
}

function fireEpisodeMismatchReasons({
  firingId,
  effective,
  expectedVolumeRouteIdentity,
  volumeRouteIdentity,
  volumePrototypeIdentity,
  expectedFirePresentation,
}) {
  if (!effective || effective.identity !== 'foreground-kiln-fire-episode-hooks-v0') {
    return ['fire-episode-hooks-missing'];
  }
  const reasons = [];
  const usableWindow = !!effective.firingId
    && effective.generation !== null
    && !!effective.phase
    && !!effective.status
    && !!effective.evidenceSource
    && !!effective.authority
    && Number.isFinite(effective.sampleCount)
    && effective.sampleCount >= 0
    && Number.isFinite(effective.frameAdvanceCount)
    && effective.frameAdvanceCount >= 0
    && Number.isFinite(effective.simStepAdvanceCount)
    && effective.simStepAdvanceCount >= 0
    && Number.isFinite(effective.startedAtMs);
  if (!usableWindow) reasons.push('fire-episode-window-missing');
  if (!firingId || effective.firingId !== firingId) reasons.push('fire-episode-firing-id-mismatch');
  if (effective.evidenceSource !== FIRE_EPISODE_HOOK_EVIDENCE_SOURCE) {
    reasons.push('fire-episode-evidence-source-mismatch');
  }
  if (effective.authority !== FIRE_EPISODE_HOOK_AUTHORITY) {
    reasons.push('fire-episode-authority-mismatch');
  }
  if (!effective.routeIdentity
    || effective.routeIdentity.effectiveRoute !== expectedVolumeRouteIdentity
    || effective.routeIdentity.effectiveRoute !== volumeRouteIdentity) {
    reasons.push('fire-episode-route-identity-mismatch');
  }
  if (!effective.routeIdentity?.prototypeIdentity
    || (volumePrototypeIdentity
      && effective.routeIdentity.prototypeIdentity !== volumePrototypeIdentity)) {
    reasons.push('fire-episode-prototype-identity-mismatch');
  }
  if (expectedFirePresentation?.effectiveMode === 'learned-splat-flame-raymarched-smoke') {
    if (effective.routeIdentity?.compositionRequested !== 'hybrid-smoke') {
      reasons.push('fire-episode-composition-request-mismatch');
    }
    if (effective.routeIdentity?.compositionEffective !== 'hybrid-smoke') {
      reasons.push('fire-episode-composition-effective-mismatch');
    }
    if (effective.routeIdentity?.compositionFallbackReason) {
      reasons.push('fire-episode-composition-fallback-present');
    }
  }
  return reasons;
}

function normalizedFirePresentation(value) {
  if (!value || typeof value !== 'object') return null;
  const raster = value.raster && typeof value.raster === 'object' ? value.raster : {};
  const timing = value.timing && typeof value.timing === 'object' ? value.timing : {};
  const fireEpisodeHooks = normalizedFireEpisodeHookJoin(value.fireEpisodeHooks);
  return {
    schema: value.schema || null,
    firingId: value.firingId || null,
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
    'firingId',
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
    const hooks = effective.fireEpisodeHooks;
    if (hooks?.identity !== 'foreground-kiln-fire-episode-hooks-v0') {
      reasons.push('fire-episode-hooks-missing');
    } else {
      const usableWindow = !!hooks.firingId
        && hooks.generation !== null
        && !!hooks.phase
        && !!hooks.status
        && !!hooks.evidenceSource
        && !!hooks.authority
        && Number.isFinite(hooks.sampleCount)
        && hooks.sampleCount >= 0
        && Number.isFinite(hooks.frameAdvanceCount)
        && hooks.frameAdvanceCount >= 0
        && Number.isFinite(hooks.simStepAdvanceCount)
        && hooks.simStepAdvanceCount >= 0
        && Number.isFinite(hooks.startedAtMs);
      if (!usableWindow) reasons.push('fire-episode-window-missing');
      if (!effective.firingId || hooks.firingId !== effective.firingId) {
        reasons.push('fire-episode-firing-id-mismatch');
      }
      if (expected.effectiveMode === 'learned-splat-flame-raymarched-smoke') {
        if (hooks.routeIdentity?.compositionRequested !== 'hybrid-smoke') {
          reasons.push('fire-episode-composition-request-mismatch');
        }
        if (hooks.routeIdentity?.compositionEffective !== 'hybrid-smoke') {
          reasons.push('fire-episode-composition-effective-mismatch');
        }
        if (hooks.routeIdentity?.compositionFallbackReason) {
          reasons.push('fire-episode-composition-fallback-present');
        }
      }
    }
  }
  return reasons;
}

function volumeSample(state, timestampMs) {
  return {
    timestampMs,
    active: state?.active === true,
    routeIdentity: state?.routeIdentity || null,
    prototypeIdentity: state?.prototypeIdentity || null,
    frameCount: finite(state?.frameCount),
    simStepCount: finite(state?.simStepCount),
    fireBudget: normalizedFireBudget(state),
    firePresentation: normalizedFirePresentation(state?.firePresentation),
    fireEpisodeHooks: normalizedFireEpisodeHookJoin(state?.fireEpisodeHooks),
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
  firingId,
  expectedVolumeRouteIdentity,
  requestedFireBudget,
  expectedFirePresentation = null,
  requireExactFireEpisode = false,
  requireSharpDutyCorrelation = false,
  timeOriginEpochMs = null,
  readVolumeState,
  now = () => performance.now(),
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = handle => cancelAnimationFrame(handle),
} = {}) {
  const requestedBudget = normalizedFireBudget(requestedFireBudget);
  const effectiveTimeOriginEpochMs = Number.isFinite(timeOriginEpochMs)
    ? timeOriginEpochMs
    : (Number.isFinite(globalThis.performance?.timeOrigin)
        ? globalThis.performance.timeOrigin
        : Date.now() - now());
  const samples = [];
  let started = false;
  let finished = false;
  let frameHandle = null;
  let startedAtMs = null;
  let finishedAtMs = null;

  function capture(timestampMs = now()) {
    const sample = volumeSample(readVolumeState?.() || null, timestampMs);
    sample.epochMs = effectiveTimeOriginEpochMs + sample.timestampMs;
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
    if (started) capture(finishedAtMs);
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
    const fireEpisodeMismatchSamples = requireExactFireEpisode
      ? samples
          .map((sample, sampleIndex) => ({
            sampleIndex,
            timestampMs: sample.timestampMs,
            fireEpisodeHooks: sample.fireEpisodeHooks
              ? {
                  ...sample.fireEpisodeHooks,
                  routeIdentity: sample.fireEpisodeHooks.routeIdentity
                    ? { ...sample.fireEpisodeHooks.routeIdentity }
                    : null,
                }
              : null,
            reasons: fireEpisodeMismatchReasons({
              firingId,
              effective: sample.fireEpisodeHooks,
              expectedVolumeRouteIdentity,
              volumeRouteIdentity: sample.routeIdentity,
              volumePrototypeIdentity: sample.prototypeIdentity,
              expectedFirePresentation,
            }),
          }))
          .filter(sample => sample.reasons.length > 0)
      : [];
    const failures = [];
    if (!started) failures.push('foreground-heartbeat-not-started');
    if (samples.some(sample => sample.active !== true)) failures.push('foreground-volume-not-active-through-episode');
    if (samples.some(sample => sample.routeIdentity !== expectedVolumeRouteIdentity)) failures.push('effective-volume-route-mismatch');
    if (budgetMismatchSamples.length) failures.push('effective-fire-budget-mismatch');
    if (firePresentationMismatchSamples.length) failures.push('effective-fire-presentation-mismatch');
    for (const reason of new Set(fireEpisodeMismatchSamples.flatMap(sample => sample.reasons))) {
      failures.push(reason);
    }
    if (finished) {
      if (samples.length < 2) failures.push('foreground-heartbeat-samples-missing');
      if (!first || !last || last.frameCount <= first.frameCount) failures.push('volume-frame-did-not-advance');
      if (!first || !last || last.simStepCount <= first.simStepCount) failures.push('volume-sim-step-did-not-advance');
      if (expectedFirePresentation?.requireFireEpisodeHooks) {
        const hooks = last?.firePresentation?.fireEpisodeHooks;
        if (!(hooks?.frameAdvanceCount > 0) || !(hooks?.simStepAdvanceCount > 0)) {
          failures.push('fire-episode-did-not-advance');
        }
      }
      if (requireExactFireEpisode) {
        const hooks = last?.fireEpisodeHooks;
        if (hooks?.status !== phase || hooks?.phase !== phase || !Number.isFinite(hooks?.finishedAtMs)) {
          failures.push('fire-episode-did-not-complete');
        }
        const preFinalSamples = samples.slice(0, -1);
        const previousSample = preFinalSamples.at(-1) || null;
        const endedBeforeFinalCapture = preFinalSamples.some(sample => sample.fireEpisodeHooks?.status !== 'recording')
          || !Number.isFinite(hooks?.finishedAtMs)
          || !previousSample
          || hooks.finishedAtMs < previousSample.timestampMs
          || hooks.finishedAtMs > finishedAtMs;
        if (endedBeforeFinalCapture) failures.push('fire-episode-window-ended-early');
        if (!(hooks?.frameAdvanceCount > 0) || !(hooks?.simStepAdvanceCount > 0)) {
          failures.push('fire-episode-did-not-advance');
        }
      }
    }
    const heartbeat = {
      schema: FOREGROUND_KILN_HEARTBEAT_SCHEMA,
      status: 'recording',
      evidenceSource: 'foreground-kaminos-main-page-raf',
      disclaimer: 'main-page-raf-and-volume-counter-evidence-not-gpu-exclusive-or-display-present-latency',
      firingId: firingId || null,
      routeId: routeId || null,
      profileId: profileId || null,
      pipelineId: pipelineId || null,
      expectedVolumeRouteIdentity: expectedVolumeRouteIdentity || null,
      requestedFireBudget: requestedBudget,
      effectiveFireBudget: effectiveBudget,
      expectedFirePresentation: expectedFirePresentation ? { ...expectedFirePresentation } : null,
      requireExactFireEpisode: requireExactFireEpisode === true,
      effectiveFirePresentation: last?.firePresentation || first?.firePresentation || null,
      effectiveFireEpisodeHooks: last?.fireEpisodeHooks || first?.fireEpisodeHooks || null,
      startedAtMs,
      finishedAtMs,
      startedAtEpochMs: startedAtMs === null ? null : effectiveTimeOriginEpochMs + startedAtMs,
      finishedAtEpochMs: finishedAtMs === null ? null : effectiveTimeOriginEpochMs + finishedAtMs,
      clock: {
        schema: CROSS_PAGE_CLOCK_SCHEMA,
        timingAuthority: 'performance-time-origin-plus-now',
        timeOriginEpochMs: effectiveTimeOriginEpochMs,
      },
      durationMs: startedAtMs !== null && finishedAtMs !== null ? Math.max(0, finishedAtMs - startedAtMs) : null,
      phase,
      sampleRetention: 'uncapped',
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
        fireEpisodeHooks: sample.fireEpisodeHooks
          ? {
              ...sample.fireEpisodeHooks,
              routeIdentity: sample.fireEpisodeHooks.routeIdentity
                ? { ...sample.fireEpisodeHooks.routeIdentity }
                : null,
            }
          : null,
      })),
      budgetMismatchSamples,
      firePresentationMismatchSamples,
      fireEpisodeMismatchSamples,
      sharpHeartbeat,
      failures,
    };
    if (requireSharpDutyCorrelation && finished) {
      heartbeat.sharpDutyCorrelation = createForegroundSharpDutyCorrelation({
        foregroundHeartbeat: heartbeat,
        sharpHeartbeat,
      });
      if (heartbeat.sharpDutyCorrelation.status !== 'verified') {
        pushFailure(failures, 'sharp-duty-correlation-invalid');
      }
    } else {
      heartbeat.sharpDutyCorrelation = null;
    }
    heartbeat.status = failures.length ? 'invalid' : (finished ? 'verified' : 'recording');
    return heartbeat;
  }

  const api = { start, finish, report };
  return api;
}
