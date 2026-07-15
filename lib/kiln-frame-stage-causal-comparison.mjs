export const KILN_FRAME_STAGE_CAUSAL_COMPARISON_SCHEMA = 'kaminos.kiln-frame-stage-causal-comparison.v0';

const LIVE_MODE = 'live-every-frame';
const HOLDOVER_MODE = 'bounded-history-holdover';
const FRAME_SCHEMA = 'kaminos.kiln-frame-stage-frame.v0';
const FRAME_PATHS = new Set(['live', 'holdover', 'fallback']);
const HOLDOVER_SYNC_STAGES = new Set([
  'history-metadata-readback',
  'holdover-pre-render-drain',
  'draw-state-readback',
]);
const SHARED_COMPOSITOR_STAGES = new Set([
  'hybrid-splat-encode',
  'hybrid-smoke-encode',
  'hybrid-resolve-encode',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function median(values) {
  return percentile(values, 0.5);
}

function addFailure(failures, failure) {
  if (!failures.includes(failure)) failures.push(failure);
}

function intersect(interval, candidate) {
  const startEpochMs = Math.max(interval.startEpochMs, candidate.startEpochMs);
  const endEpochMs = Math.min(interval.endEpochMs, candidate.endEpochMs);
  if (endEpochMs <= startEpochMs) return null;
  return { startEpochMs, endEpochMs };
}

function mergedDuration(intervals) {
  const ordered = intervals
    .filter(interval => Number.isFinite(interval?.startEpochMs)
      && Number.isFinite(interval?.endEpochMs)
      && interval.endEpochMs > interval.startEpochMs)
    .sort((left, right) => left.startEpochMs - right.startEpochMs || left.endEpochMs - right.endEpochMs);
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
  return total + end - start;
}

function overlapsForOrderedIntervals(intervals, candidates, project) {
  const orderedCandidates = [...candidates]
    .filter(candidate => Number.isFinite(candidate?.startEpochMs)
      && Number.isFinite(candidate?.endEpochMs)
      && candidate.endEpochMs >= candidate.startEpochMs)
    .sort((left, right) => left.startEpochMs - right.startEpochMs || left.endEpochMs - right.endEpochMs);
  let cursor = 0;
  let active = [];
  return intervals.map(interval => {
    active = active.filter(candidate => candidate.endEpochMs > interval.startEpochMs);
    while (cursor < orderedCandidates.length
      && orderedCandidates[cursor].startEpochMs < interval.endEpochMs) {
      const candidate = orderedCandidates[cursor];
      if (candidate.endEpochMs > interval.startEpochMs) active.push(candidate);
      cursor += 1;
    }
    return active
      .map(candidate => {
        const overlap = intersect(interval, candidate);
        return overlap ? project(candidate, overlap) : null;
      })
      .filter(Boolean);
  });
}

function stageFamily(stage, { framePath = null, detail = null } = {}) {
  if (HOLDOVER_SYNC_STAGES.has(stage)) return 'holdover-sync';
  if (stage === 'queue-drain') {
    if (detail?.sampledEveryTwelveFrames === true) return 'sampled-shared-queue-drain';
    return framePath === 'holdover' || framePath === 'fallback'
      ? 'holdover-sync'
      : 'other-observed-stage';
  }
  if (SHARED_COMPOSITOR_STAGES.has(stage)) return 'shared-compositor-cpu-encode';
  if (stage === 'live-source-encode') return 'live-source-cpu-encode';
  if (stage === 'queue-submit') return 'queue-submit-call';
  return 'other-observed-stage';
}

function disruptionThreshold(gaps) {
  if (!gaps.length) return null;
  const center = median(gaps);
  const deviations = gaps.map(value => Math.abs(value - center));
  const mad = median(deviations);
  return rounded(mad > 0 ? center + 3 * mad : center * 1.5);
}

function validatedLedger(route, role, failures) {
  const ledger = route?.kilnFrameStageLedger;
  if (ledger?.schema !== 'kaminos.kiln-frame-stage-ledger.v0'
    || ledger?.status !== 'complete'
    || ledger?.evidenceStatus !== 'verified'
    || ledger?.sampleRetention !== 'uncapped') {
    addFailure(failures, `${role}-ledger-invalid`);
  }
  const frames = Array.isArray(ledger?.frames) ? ledger.frames : [];
  const events = Array.isArray(ledger?.events) ? ledger.events : [];
  const frameCount = ledger?.frameCount ?? ledger?.mohelIndicator?.frameCount;
  const eventCount = ledger?.eventCount ?? ledger?.mohelIndicator?.eventCount;
  if (!Number.isInteger(frameCount) || frameCount <= 0 || frameCount !== frames.length) {
    addFailure(failures, `${role}-ledger-frames-partial`);
  }
  if (!Number.isInteger(eventCount) || eventCount <= 1 || eventCount !== events.length) {
    addFailure(failures, `${role}-ledger-events-partial`);
  }
  if (ledger?.firingId !== route?.foregroundKilnHeartbeat?.firingId) {
    addFailure(failures, `${role}-ledger-firing-mismatch`);
  }
  const expectedFiringId = route?.foregroundKilnHeartbeat?.firingId;
  const frameIds = new Set();
  const derivedPathCounts = { live: 0, holdover: 0, fallback: 0 };
  for (const frame of frames) {
    const expectedFrameId = Number.isInteger(frame?.presentationOrdinal)
      ? `${expectedFiringId}:${frame.presentationOrdinal}`
      : null;
    if (frame?.schema !== FRAME_SCHEMA || frame?.status !== 'complete') {
      addFailure(failures, `${role}-ledger-frame-invalid`);
    }
    if (!expectedFiringId || frame?.firingId !== expectedFiringId) {
      addFailure(failures, `${role}-ledger-frame-firing-mismatch`);
    }
    if (!expectedFrameId || frame?.frameId !== expectedFrameId || frameIds.has(frame.frameId)) {
      addFailure(failures, `${role}-ledger-frame-identity-invalid`);
    }
    if (typeof frame?.frameId === 'string') frameIds.add(frame.frameId);
    if (FRAME_PATHS.has(frame?.path)) derivedPathCounts[frame.path] += 1;
    else addFailure(failures, `${role}-ledger-frame-path-invalid`);
  }
  for (const event of events) {
    const eventFrameId = event?.detail?.frameId;
    if (eventFrameId !== undefined && eventFrameId !== null && !frameIds.has(eventFrameId)) {
      addFailure(failures, `${role}-ledger-event-frame-unresolved`);
    }
  }
  if (!sameValue(ledger?.pathCounts, derivedPathCounts)) {
    addFailure(failures, `${role}-ledger-path-count-mismatch`);
  }
  if (ledger?.clock?.schema !== 'kaminos.browser-epoch-monotonic-clock.v0'
    || ledger?.clock?.timingAuthority !== 'performance-time-origin-plus-now') {
    addFailure(failures, `${role}-ledger-clock-invalid`);
  }
  return { ...(ledger || {}), frames, events, pathCounts: derivedPathCounts };
}

function summarizeRun(route, role, failures) {
  const ledger = validatedLedger(route, role, failures);
  const frames = Array.isArray(ledger.frames) ? ledger.frames : [];
  const framePathById = new Map(frames.map(frame => [frame.frameId, frame.path]));
  const frameStages = frames.flatMap(frame => (Array.isArray(frame?.stages) ? frame.stages : [])
    .filter(stage => Number.isFinite(stage?.startEpochMs) && Number.isFinite(stage?.endEpochMs))
    .map(stage => ({
      ...stage,
      frameId: frame.frameId,
      framePath: frame.path,
      family: stageFamily(stage.stage, { framePath: frame.path, detail: stage.detail }),
    })));
  const eventStages = (Array.isArray(ledger.events) ? ledger.events : [])
    .filter(event => event?.stage !== 'main-page-raf'
      && Number.isFinite(event?.startEpochMs)
      && Number.isFinite(event?.endEpochMs))
    .map(event => {
      const frameId = event.detail?.frameId || null;
      const framePath = framePathById.get(frameId) || null;
      return {
        ...event,
        frameId,
        framePath,
        family: stageFamily(event.stage, { framePath, detail: event.detail }),
      };
    });
  const stages = [...frameStages, ...eventStages];
  const duties = Array.isArray(route?.backgroundHeartbeat?.gpuDutyIntervals?.intervals)
    ? route.backgroundHeartbeat.gpuDutyIntervals.intervals.filter(duty =>
        Number.isFinite(duty?.startEpochMs) && Number.isFinite(duty?.endEpochMs))
    : [];
  const mainPageEvents = (Array.isArray(ledger.events) ? ledger.events : [])
    .filter(event => event?.stage === 'main-page-raf' && Number.isFinite(event?.startEpochMs))
    .sort((left, right) => left.startEpochMs - right.startEpochMs);
  const rawGapDurations = mainPageEvents.slice(1).map((event, index) =>
    event.startEpochMs - mainPageEvents[index].startEpochMs);
  const thresholdMs = disruptionThreshold(rawGapDurations);
  const gapIntervals = mainPageEvents.slice(1).map((event, index) => ({
    startEpochMs: mainPageEvents[index].startEpochMs,
    endEpochMs: event.startEpochMs,
  }));
  const stageOverlapsByGap = overlapsForOrderedIntervals(gapIntervals, stages, (stage, overlap) => ({
    ...overlap,
    stage: stage.stage,
    family: stage.family,
    frameId: stage.frameId,
    framePath: stage.framePath,
  }));
  const sharpDutyOverlapsByGap = overlapsForOrderedIntervals(gapIntervals, duties, (duty, overlap) => ({
    ...overlap,
    dutyId: duty.dutyId || null,
    phase: duty.phase || null,
    boundary: duty.boundary || null,
  }));
  const mainPageGaps = gapIntervals.map((interval, index) => {
    const durationMs = interval.endEpochMs - interval.startEpochMs;
    const stageOverlaps = stageOverlapsByGap[index];
    const sharpDutyOverlaps = sharpDutyOverlapsByGap[index];
    const familyDurations = {};
    for (const family of new Set(stageOverlaps.map(overlap => overlap.family))) {
      familyDurations[family] = rounded(mergedDuration(stageOverlaps.filter(overlap => overlap.family === family)));
    }
    const representedIntervals = [...stageOverlaps, ...sharpDutyOverlaps];
    return {
      gapIndex: index,
      startEpochMs: rounded(interval.startEpochMs),
      endEpochMs: rounded(interval.endEpochMs),
      durationMs: rounded(durationMs),
      disrupted: Number.isFinite(thresholdMs) && durationMs > thresholdMs,
      stageOverlaps,
      sharpDutyOverlaps,
      familyDurations,
      sharpDutyDurationMs: rounded(mergedDuration(sharpDutyOverlaps)),
      representedDurationMs: rounded(mergedDuration(representedIntervals)),
      unrepresentedDurationMs: rounded(Math.max(0, durationMs - mergedDuration(representedIntervals))),
    };
  });
  const disruptions = mainPageGaps.filter(gap => gap.disrupted);
  const disruptionDurationMs = disruptions.reduce((total, gap) => total + gap.durationMs, 0);
  const sharpDutyDurationMs = disruptions.reduce((total, gap) => total + gap.sharpDutyDurationMs, 0);
  const holdoverSyncDurationMs = disruptions.reduce((total, gap) => total + (gap.familyDurations['holdover-sync'] || 0), 0);
  const sharedCompositorCpuEncodeDurationMs = disruptions.reduce(
    (total, gap) => total + (gap.familyDurations['shared-compositor-cpu-encode'] || 0),
    0,
  );
  const liveSourceCpuEncodeDurationMs = disruptions.reduce(
    (total, gap) => total + (gap.familyDurations['live-source-cpu-encode'] || 0),
    0,
  );
  const unrepresentedDurationMs = disruptions.reduce((total, gap) => total + gap.unrepresentedDurationMs, 0);
  const fraction = value => disruptionDurationMs > 0 ? rounded(value / disruptionDurationMs) : null;
  return {
    firingId: ledger.firingId || null,
    pathCounts: ledger.pathCounts || null,
    mainPageRafAuthority: 'foreground-main-page-request-animation-frame',
    disruptionRule: {
      identity: 'median-plus-three-mad-or-one-point-five-median-v0',
      medianMs: median(rawGapDurations),
      madMs: median(rawGapDurations.map(value => Math.abs(value - median(rawGapDurations)))),
      thresholdMs,
      comparison: 'strictly-greater-than',
    },
    mainPageGaps,
    disruptions,
    cadence: {
      sampleCount: mainPageEvents.length,
      gapCount: mainPageGaps.length,
      disruptionCount: disruptions.length,
      p50GapMs: percentile(rawGapDurations, 0.5),
      p95GapMs: percentile(rawGapDurations, 0.95),
      p99GapMs: percentile(rawGapDurations, 0.99),
      maxGapMs: rawGapDurations.length ? Math.max(...rawGapDurations) : null,
    },
    disruptionOverlap: {
      disruptionDurationMs: rounded(disruptionDurationMs),
      sharpDutyDurationMs: rounded(sharpDutyDurationMs),
      sharpDutyFraction: fraction(sharpDutyDurationMs),
      holdoverSyncDurationMs: rounded(holdoverSyncDurationMs),
      holdoverSyncFraction: fraction(holdoverSyncDurationMs),
      sharedCompositorCpuEncodeDurationMs: rounded(sharedCompositorCpuEncodeDurationMs),
      sharedCompositorCpuEncodeFraction: fraction(sharedCompositorCpuEncodeDurationMs),
      liveSourceCpuEncodeDurationMs: rounded(liveSourceCpuEncodeDurationMs),
      liveSourceCpuEncodeFraction: fraction(liveSourceCpuEncodeDurationMs),
      unrepresentedDurationMs: rounded(unrepresentedDurationMs),
      unrepresentedFraction: fraction(unrepresentedDurationMs),
      overlapAccounting: 'family overlaps are non-exclusive; represented remainder uses merged interval union',
    },
  };
}

export function createKilnFrameStageCausalComparison({ liveReport, holdoverReport } = {}) {
  const failures = [];
  const liveRoute = liveReport?.state?.fullRoute || {};
  const holdoverRoute = holdoverReport?.state?.fullRoute || {};
  if (liveReport?.schema !== 'crucible-viewport-witness.v0' || liveReport?.ok !== true || liveRoute.status !== 'complete') {
    addFailure(failures, 'live-witness-invalid');
  }
  if (holdoverReport?.schema !== 'crucible-viewport-witness.v0' || holdoverReport?.ok !== true || holdoverRoute.status !== 'complete') {
    addFailure(failures, 'holdover-witness-invalid');
  }
  const liveSource = liveReport?.state?.sourceSelectionExercise || {};
  const holdoverSource = holdoverReport?.state?.sourceSelectionExercise || {};
  if (!liveSource.requestedAssetId
    || liveSource.requestedAssetId !== liveSource.effectiveAssetId
    || !sameValue(liveSource, holdoverSource)) addFailure(failures, 'source-identity-mismatch');
  if (!liveRoute.requestedPipelineId
    || liveRoute.requestedPipelineId !== holdoverRoute.requestedPipelineId
    || !liveRoute.effectiveRouteId
    || liveRoute.effectiveRouteId !== holdoverRoute.effectiveRouteId) addFailure(failures, 'route-identity-mismatch');
  if (!sameValue(liveRoute.requestedScheduler, liveRoute.effectiveScheduler)
    || !sameValue(holdoverRoute.requestedScheduler, holdoverRoute.effectiveScheduler)
    || !sameValue(liveRoute.effectiveScheduler, holdoverRoute.effectiveScheduler)) addFailure(failures, 'scheduler-identity-mismatch');
  const liveHeartbeat = liveRoute.foregroundKilnHeartbeat || {};
  const holdoverHeartbeat = holdoverRoute.foregroundKilnHeartbeat || {};
  if (!sameValue(liveHeartbeat.requestedFireBudget, liveHeartbeat.effectiveFireBudget)
    || !sameValue(holdoverHeartbeat.requestedFireBudget, holdoverHeartbeat.effectiveFireBudget)
    || !sameValue(liveHeartbeat.effectiveFireBudget, holdoverHeartbeat.effectiveFireBudget)) addFailure(failures, 'fire-budget-mismatch');
  if (!liveRoute.output?.sha256
    || liveRoute.output.sha256 !== holdoverRoute.output?.sha256
    || liveRoute.output.status !== 'real'
    || holdoverRoute.output?.status !== 'real') addFailure(failures, 'output-hash-mismatch');
  if (liveRoute.requestedFlameContinuity !== LIVE_MODE
    || liveRoute.selectedFlameContinuity !== LIVE_MODE
    || liveRoute.effectiveFlameContinuity !== LIVE_MODE) addFailure(failures, 'live-effective-route-mismatch');
  if (holdoverRoute.requestedFlameContinuity !== HOLDOVER_MODE
    || holdoverRoute.selectedFlameContinuity !== HOLDOVER_MODE
    || holdoverRoute.effectiveFlameContinuity !== HOLDOVER_MODE) addFailure(failures, 'holdover-effective-route-mismatch');

  const live = summarizeRun(liveRoute, 'live', failures);
  const holdover = summarizeRun(holdoverRoute, 'holdover', failures);
  if ((live.pathCounts?.holdover || 0) > 0) addFailure(failures, 'live-ledger-holdover-path-present');
  if ((holdover.pathCounts?.holdover || 0) <= 0) addFailure(failures, 'holdover-ledger-holdover-path-missing');
  if (!live.disruptions.length) addFailure(failures, 'live-disruption-episodes-missing');
  if (!holdover.disruptions.length) addFailure(failures, 'holdover-disruption-episodes-missing');

  const sharedSharpSupported = live.disruptionOverlap.sharpDutyFraction >= 0.5
    && holdover.disruptionOverlap.sharpDutyFraction >= 0.5;
  const holdoverSyncAdditive = holdover.disruptionOverlap.holdoverSyncFraction >= 0.2
    && holdover.disruptionOverlap.holdoverSyncFraction
      > (live.disruptionOverlap.holdoverSyncFraction || 0) + 0.1;
  const sharedUnrepresented = live.disruptionOverlap.unrepresentedFraction >= 0.5
    && holdover.disruptionOverlap.unrepresentedFraction >= 0.5;
  const status = failures.length ? 'invalid' : 'verified';
  let conclusion = 'mixed-represented-pressure';
  if (status === 'invalid') conclusion = 'invalid';
  else if (sharedSharpSupported) conclusion = 'shared-sharp-duty-dominant';
  else if (sharedUnrepresented) conclusion = 'shared-unrepresented-or-downstream';
  else if (holdover.disruptionOverlap.holdoverSyncFraction >= 0.5) conclusion = 'holdover-sync-dominant';

  return {
    schema: KILN_FRAME_STAGE_CAUSAL_COMPARISON_SCHEMA,
    status,
    conclusion,
    claimBoundary: 'Epoch-aligned host intervals classify overlap only; queue drains are not GPU-exclusive, compositor timings are CPU encode proxies, and RAF opportunity is not display present.',
    identityAgreement: {
      source: failures.includes('source-identity-mismatch') ? 'mismatch' : 'matched',
      route: failures.includes('route-identity-mismatch') ? 'mismatch' : 'matched',
      scheduler: failures.includes('scheduler-identity-mismatch') ? 'mismatch' : 'matched',
      fireBudget: failures.includes('fire-budget-mismatch') ? 'mismatch' : 'matched',
      outputHash: failures.includes('output-hash-mismatch') ? 'mismatch' : 'matched',
    },
    findings: {
      sharedSharpDuty: {
        status: sharedSharpSupported ? 'supported' : 'not-supported',
        criterion: 'at least half of disruption duration overlaps SHARP submitted-work drain duty in both routes',
      },
      holdoverSync: {
        status: holdoverSyncAdditive ? 'additive' : 'not-additive',
        criterion: 'holdover-only synchronization overlaps at least one fifth of held disruption duration and exceeds live by one tenth',
      },
      downstreamOrUnrepresented: {
        status: sharedUnrepresented ? 'supported' : 'not-supported',
        criterion: 'at least half of disruption duration in both routes lacks any represented stage or SHARP duty overlap',
      },
    },
    runs: { live, holdover },
    failures,
    mohelIndicator: {
      gapsUncapped: true,
      liveGapCount: live.mainPageGaps.length,
      holdoverGapCount: holdover.mainPageGaps.length,
      note: 'Every main-page RAF gap and every statistically selected disruption is retained.',
    },
  };
}
