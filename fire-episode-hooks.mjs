export const FIRE_EPISODE_HOOK_IDENTITY = 'foreground-kiln-fire-episode-hooks-v0';
export const FIRE_EPISODE_HOOK_EVIDENCE_SOURCE = 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0';
export const FIRE_EPISODE_HOOK_AUTHORITY = 'renderer-simulator-hooks-for-wake-foreground-heartbeat';

const DEFAULT_LONG_GAP_THRESHOLD_MS = 50;
const DISCLAIMERS = Object.freeze([
  'not-gpu-exclusive-or-present-latency',
  'not-displayed-frame-latency',
  'not-sharp-backend-heartbeat',
]);

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function histogramRafGaps(samples, longGapThresholdMs) {
  const buckets = [
    { label: '0-16ms', minMs: 0, maxMs: 16, count: 0 },
    { label: '16-33ms', minMs: 16, maxMs: 33, count: 0 },
    { label: '33-50ms', minMs: 33, maxMs: longGapThresholdMs, count: 0 },
    { label: '50-100ms', minMs: longGapThresholdMs, maxMs: 100, count: 0 },
    { label: '100-250ms', minMs: 100, maxMs: 250, count: 0 },
    { label: '250ms+', minMs: 250, maxMs: null, count: 0 },
  ];
  for (const gap of samples) {
    const bucket = buckets.find(candidate => (
      gap >= candidate.minMs && (candidate.maxMs === null || gap < candidate.maxMs)
    ));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function cloneEpisode(episode) {
  return {
    ...episode,
    disclaimers: [...episode.disclaimers],
    routeIdentity: episode.routeIdentity ? structuredClone(episode.routeIdentity) : null,
    rawRafGapSamplesMs: [...episode.rawRafGapSamplesMs],
    rafGapHistogramMs: episode.rafGapHistogramMs.map(bucket => ({ ...bucket })),
    queueCompletionProxy: { ...episode.queueCompletionProxy },
    mohelIndicator: { ...episode.mohelIndicator },
  };
}

function normalizedFiringId(value) {
  const firingId = String(value || '').trim();
  if (!firingId) throw new Error('fire episode firingId must be a non-empty string');
  return firingId;
}

function baseEpisode(longGapThresholdMs) {
  return {
    identity: FIRE_EPISODE_HOOK_IDENTITY,
    evidenceSource: FIRE_EPISODE_HOOK_EVIDENCE_SOURCE,
    authority: FIRE_EPISODE_HOOK_AUTHORITY,
    disclaimers: [...DISCLAIMERS],
    firingId: null,
    generation: 0,
    phase: 'idle',
    status: 'idle',
    startedAtMs: null,
    updatedAtMs: null,
    endedAtMs: null,
    durationMs: 0,
    routeIdentity: null,
    rawRafGapSamplesMs: [],
    rafGapHistogramMs: [],
    sampleCount: 0,
    maxRafGapMs: 0,
    p95RafGapMs: 0,
    lastRafGapMs: null,
    longGapThresholdMs,
    longGapCount: 0,
    longGapStreakCurrent: 0,
    longGapStreakMax: 0,
    frameStartCount: null,
    frameEndCount: null,
    frameAdvanceCount: 0,
    simStepStartCount: null,
    simStepEndCount: null,
    simStepAdvanceCount: 0,
    cpuFrameMs: null,
    queueCompletionProxy: {
      evidenceSource: 'webgpu-queue-onSubmittedWorkDone-proxy',
      disclaimer: 'queue-completion-proxy-not-present-latency',
      available: false,
      pending: false,
      samples: 0,
      lastDoneMs: null,
      p95DoneMs: null,
      error: null,
    },
    mohelIndicator: {
      uncappedRawGapSamples: true,
      sampleCount: 0,
      largeSampleSet: false,
      note: 'Raw firing-window gap samples are intentionally uncapped; use this diagnostic if the window is too broad.',
    },
  };
}

export function createFireEpisodeHooks({
  now = () => performance.now(),
  readCounters = () => ({ frameCount: 0, simStepCount: 0 }),
  readRouteIdentity = () => null,
  longGapThresholdMs = DEFAULT_LONG_GAP_THRESHOLD_MS,
} = {}) {
  const threshold = finite(longGapThresholdMs, DEFAULT_LONG_GAP_THRESHOLD_MS);
  let episode = baseEpisode(threshold);
  const usedFiringIds = new Set();

  function snapshot() {
    return cloneEpisode(episode);
  }

  function updateCounterDeltas() {
    const counters = readCounters?.() || {};
    const frameEndCount = finite(counters.frameCount, episode.frameEndCount);
    const simStepEndCount = finite(counters.simStepCount, episode.simStepEndCount);
    episode.frameEndCount = frameEndCount;
    episode.simStepEndCount = simStepEndCount;
    episode.frameAdvanceCount = Math.max(0, (frameEndCount ?? 0) - (episode.frameStartCount ?? 0));
    episode.simStepAdvanceCount = Math.max(0, (simStepEndCount ?? 0) - (episode.simStepStartCount ?? 0));
  }

  function begin({ firingId } = {}) {
    const nextFiringId = normalizedFiringId(firingId);
    if (episode.status === 'recording' && episode.firingId === nextFiringId) return snapshot();
    if (usedFiringIds.has(nextFiringId)) {
      throw new Error(`fire episode firingId ${nextFiringId} was already used by this tracker`);
    }
    const counters = readCounters?.() || {};
    const startedAtMs = finite(now(), 0);
    usedFiringIds.add(nextFiringId);
    episode = {
      ...baseEpisode(threshold),
      firingId: nextFiringId,
      generation: episode.generation + 1,
      phase: 'recording',
      status: 'recording',
      startedAtMs,
      updatedAtMs: startedAtMs,
      routeIdentity: structuredClone(readRouteIdentity?.() || null),
      frameStartCount: finite(counters.frameCount, 0),
      frameEndCount: finite(counters.frameCount, 0),
      simStepStartCount: finite(counters.simStepCount, 0),
      simStepEndCount: finite(counters.simStepCount, 0),
    };
    return snapshot();
  }

  function recordFrame({ rafGapMs = null, cpuFrameMs = null } = {}) {
    if (episode.status !== 'recording') return snapshot();
    const updatedAtMs = finite(now(), episode.updatedAtMs);
    const gap = finite(rafGapMs);
    if (gap !== null) episode.rawRafGapSamplesMs.push(Math.max(0, gap));
    const samples = episode.rawRafGapSamplesMs;
    let longGapStreakCurrent = 0;
    let longGapStreakMax = 0;
    for (const sample of samples) {
      if (sample >= threshold) {
        longGapStreakCurrent += 1;
        longGapStreakMax = Math.max(longGapStreakMax, longGapStreakCurrent);
      } else {
        longGapStreakCurrent = 0;
      }
    }
    episode.updatedAtMs = updatedAtMs;
    episode.durationMs = Math.max(0, updatedAtMs - episode.startedAtMs);
    episode.routeIdentity = structuredClone(readRouteIdentity?.() || episode.routeIdentity);
    episode.rafGapHistogramMs = histogramRafGaps(samples, threshold);
    episode.sampleCount = samples.length;
    episode.maxRafGapMs = samples.length ? Math.max(...samples) : 0;
    episode.p95RafGapMs = percentile(samples, 0.95);
    episode.lastRafGapMs = samples.at(-1) ?? null;
    episode.longGapCount = samples.filter(sample => sample >= threshold).length;
    episode.longGapStreakCurrent = longGapStreakCurrent;
    episode.longGapStreakMax = longGapStreakMax;
    episode.cpuFrameMs = finite(cpuFrameMs, episode.cpuFrameMs);
    episode.mohelIndicator = {
      ...episode.mohelIndicator,
      sampleCount: samples.length,
      largeSampleSet: samples.length > 10000,
    };
    updateCounterDeltas();
    return snapshot();
  }

  function recordQueueProxy(value = {}) {
    if (episode.status !== 'recording') return snapshot();
    episode.queueCompletionProxy = {
      ...episode.queueCompletionProxy,
      available: value.available === true,
      pending: value.pending === true,
      samples: Math.max(0, finite(value.samples, episode.queueCompletionProxy.samples)),
      lastDoneMs: finite(value.lastDoneMs),
      p95DoneMs: finite(value.p95DoneMs),
      error: value.error ? String(value.error) : null,
    };
    episode.updatedAtMs = finite(now(), episode.updatedAtMs);
    episode.durationMs = Math.max(0, episode.updatedAtMs - episode.startedAtMs);
    return snapshot();
  }

  function end({ firingId, status = 'complete' } = {}) {
    const endingFiringId = normalizedFiringId(firingId);
    const endingStatus = String(status || 'complete').trim() || 'complete';
    if (episode.firingId !== endingFiringId) {
      throw new Error(`fire episode ${endingFiringId} does not match active firing ${episode.firingId || '<none>'}`);
    }
    if (episode.status !== 'recording') return snapshot();
    const endedAtMs = finite(now(), episode.updatedAtMs ?? episode.startedAtMs ?? 0);
    updateCounterDeltas();
    episode.phase = endingStatus;
    episode.status = endingStatus;
    episode.updatedAtMs = endedAtMs;
    episode.endedAtMs = endedAtMs;
    episode.durationMs = Math.max(0, endedAtMs - episode.startedAtMs);
    return snapshot();
  }

  return { begin, end, recordFrame, recordQueueProxy, snapshot };
}
