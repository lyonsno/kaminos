export const KILN_FRAME_STAGE_LEDGER_SCHEMA = 'kaminos.kiln-frame-stage-ledger.v0';
export const KILN_FRAME_STAGE_FRAME_SCHEMA = 'kaminos.kiln-frame-stage-frame.v0';

const FRAME_PATHS = new Set(['live', 'holdover', 'fallback']);
const FRAME_STAGES = new Set([
  'volume-raf',
  'live-source-encode',
  'history-metadata-readback',
  'holdover-pre-render-drain',
  'hybrid-splat-encode',
  'hybrid-smoke-encode',
  'hybrid-resolve-encode',
  'queue-submit',
  'queue-drain',
  'draw-state-readback',
  'main-page-raf',
  'presentation-opportunity',
]);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return number;
}

function normalizedFiringId(value) {
  const firingId = String(value || '').trim();
  if (!firingId) throw new TypeError('kiln frame stage ledger requires firingId');
  return firingId;
}

function roundedDuration(startMs, endMs) {
  return Number((endMs - startMs).toFixed(6));
}

function clone(value) {
  return structuredClone(value);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

export function createKilnFrameStageLedger({
  now = () => performance.now(),
  timeOriginEpochMs = globalThis.performance?.timeOrigin ?? Date.now() - now(),
} = {}) {
  const effectiveTimeOriginEpochMs = finite(timeOriginEpochMs, 'timeOriginEpochMs');
  let firingId = null;
  let status = 'idle';
  let generation = 0;
  let startedAtMs = null;
  let endedAtMs = null;
  let previousRafTimestampMs = null;
  let frames = [];
  let events = [];
  const openFrames = new Map();
  const frameIndex = new Map();

  function frameById(frameId) {
    const frame = frameIndex.get(frameId);
    if (!frame) throw new Error(`unknown kiln frame ${frameId}`);
    return frame;
  }

  function summary({ includeRows = true } = {}) {
    if (!includeRows) {
      return {
        schema: KILN_FRAME_STAGE_LEDGER_SCHEMA,
        status,
        evidenceStatus: status === 'complete' ? 'unexpanded' : status,
        sampleRetention: 'uncapped',
        firingId,
        generation,
        clock: {
          schema: 'kaminos.browser-epoch-monotonic-clock.v0',
          timingAuthority: 'performance-time-origin-plus-now',
          timeOriginEpochMs: effectiveTimeOriginEpochMs,
        },
        startedAtMs,
        endedAtMs,
        durationMs: startedAtMs === null ? 0 : Math.max(0, (endedAtMs ?? now()) - startedAtMs),
        frameCount: frames.length,
        eventCount: events.length,
        mohelIndicator: {
          uncappedFrames: true,
          frameCount: frames.length,
          eventCount: events.length,
          compactSnapshot: true,
          note: 'Rows and aggregate scans are omitted while recording to avoid observer-induced cadence cost.',
        },
      };
    }
    const pathCounts = { live: 0, holdover: 0, fallback: 0 };
    const stageDurations = new Map();
    const eventDurations = new Map();
    for (const frame of frames) {
      pathCounts[frame.path] += 1;
      for (const stage of frame.stages) {
        const values = stageDurations.get(stage.stage) || [];
        values.push(stage.durationMs);
        stageDurations.set(stage.stage, values);
      }
    }
    for (const event of events) {
      const values = eventDurations.get(event.stage) || [];
      values.push(event.durationMs);
      eventDurations.set(event.stage, values);
    }
    const stageSummary = Object.fromEntries([...stageDurations.entries()].map(([stage, values]) => [stage, {
      count: values.length,
      totalMs: Number(values.reduce((total, value) => total + value, 0).toFixed(6)),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
    }]));
    const eventSummary = Object.fromEntries([...eventDurations.entries()].map(([stage, values]) => [stage, {
      count: values.length,
      totalMs: Number(values.reduce((total, value) => total + value, 0).toFixed(6)),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
    }]));
    const failures = [];
    for (const frame of frames) {
      if (frame.status !== 'complete') failures.push(`frame ordinal ${frame.presentationOrdinal} is incomplete`);
      if (frame.presentationOpportunity.status !== 'observed'
        && frame.presentationOpportunity.expectedTerminalTail !== true) {
        failures.push(`presentation opportunity unavailable for frame ordinal ${frame.presentationOrdinal}`);
      }
    }
    return {
      schema: KILN_FRAME_STAGE_LEDGER_SCHEMA,
      status,
      evidenceStatus: failures.length ? 'partial' : (status === 'complete' ? 'verified' : 'recording'),
      sampleRetention: 'uncapped',
      firingId,
      generation,
      clock: {
        schema: 'kaminos.browser-epoch-monotonic-clock.v0',
        timingAuthority: 'performance-time-origin-plus-now',
        timeOriginEpochMs: effectiveTimeOriginEpochMs,
      },
      startedAtMs,
      endedAtMs,
      durationMs: startedAtMs === null ? 0 : Math.max(0, (endedAtMs ?? now()) - startedAtMs),
      frameCount: frames.length,
      eventCount: events.length,
      ...(includeRows ? { frames: clone(frames), events: clone(events) } : {}),
      pathCounts,
      stageSummary,
      eventSummary,
      failures,
      mohelIndicator: {
        uncappedFrames: true,
        frameCount: frames.length,
        eventCount: events.length,
        note: 'Per-frame and cross-loop causal evidence is intentionally uncapped for the exact firing window.',
      },
    };
  }

  function begin({ firingId: requestedFiringId } = {}) {
    const nextFiringId = normalizedFiringId(requestedFiringId);
    if (status === 'recording' && firingId === nextFiringId) return summary();
    generation += 1;
    firingId = nextFiringId;
    status = 'recording';
    startedAtMs = finite(now(), 'ledger start time');
    endedAtMs = null;
    previousRafTimestampMs = null;
    frames = [];
    events = [];
    openFrames.clear();
    frameIndex.clear();
    return summary();
  }

  function beginFrame({
    path,
    presentationOrdinal,
    continuityMode,
    rafTimestampMs = now(),
    sourceGeneration = null,
    simulatorStep = null,
  } = {}) {
    if (status !== 'recording' || !firingId) throw new Error('kiln frame stage ledger is not recording');
    if (!FRAME_PATHS.has(path)) throw new TypeError(`unsupported frame path ${path}`);
    const ordinal = nonNegativeInteger(presentationOrdinal, 'presentationOrdinal');
    const startMs = finite(rafTimestampMs, 'rafTimestampMs');
    const frameId = `${firingId}:${ordinal}`;
    if (frameIndex.has(frameId)) throw new Error(`duplicate kiln frame ${frameId}`);
    const frame = {
      schema: KILN_FRAME_STAGE_FRAME_SCHEMA,
      frameId,
      firingId,
      path,
      pathTransitions: [],
      continuityMode: String(continuityMode || ''),
      presentationOrdinal: ordinal,
      status: 'recording',
      startMs,
      startEpochMs: effectiveTimeOriginEpochMs + startMs,
      endMs: null,
      durationMs: null,
      volumeRafGapMs: previousRafTimestampMs === null ? null : roundedDuration(previousRafTimestampMs, startMs),
      sourceGeneration: sourceGeneration === null ? null : nonNegativeInteger(sourceGeneration, 'sourceGeneration'),
      simulatorStep: simulatorStep === null ? null : nonNegativeInteger(simulatorStep, 'simulatorStep'),
      compositorFrame: null,
      stages: [],
      presentationOpportunity: {
        status: 'unavailable',
        reason: 'presentation opportunity not observed',
        timestampMs: null,
        timestampEpochMs: null,
        latencyFromFrameStartMs: null,
        authority: null,
        displayPresentAuthority: false,
        expectedTerminalTail: false,
      },
    };
    previousRafTimestampMs = startMs;
    frames.push(frame);
    frameIndex.set(frameId, frame);
    openFrames.set(frameId, frame);
    return frameId;
  }

  function setFramePath(frameId, path, { reason } = {}) {
    if (!FRAME_PATHS.has(path)) throw new TypeError(`unsupported frame path ${path}`);
    const frame = frameById(frameId);
    const transitionReason = String(reason || '').trim();
    if (!transitionReason) throw new TypeError('frame path transition reason is required');
    if (frame.path === path) return clone(frame);
    frame.pathTransitions.push({
      from: frame.path,
      to: path,
      reason: transitionReason,
    });
    frame.path = path;
    return clone(frame);
  }

  function recordStage(frameId, {
    stage,
    startMs,
    endMs,
    authority,
    detail = null,
  } = {}) {
    if (!FRAME_STAGES.has(stage)) throw new TypeError(`unsupported stage ${stage}`);
    const start = finite(startMs, 'stage startMs');
    const end = finite(endMs, 'stage endMs');
    if (end < start) throw new TypeError('stage interval must be ordered');
    const frame = frameById(frameId);
    if (!openFrames.has(frameId)) throw new Error(`kiln frame ${frameId} is already complete`);
    const authorityIdentity = String(authority || '').trim();
    if (!authorityIdentity) throw new TypeError('stage authority is required');
    frame.stages.push({
      stage,
      startMs: start,
      endMs: end,
      startEpochMs: effectiveTimeOriginEpochMs + start,
      endEpochMs: effectiveTimeOriginEpochMs + end,
      durationMs: roundedDuration(start, end),
      authority: authorityIdentity,
      detail: detail === null ? null : clone(detail),
    });
    return clone(frame.stages.at(-1));
  }

  function recordEvent({
    stage,
    startMs,
    endMs,
    authority,
    detail = null,
  } = {}) {
    if (status !== 'recording' || !firingId) throw new Error('kiln frame stage ledger is not recording');
    if (!FRAME_STAGES.has(stage)) throw new TypeError(`unsupported stage ${stage}`);
    const start = finite(startMs, 'event startMs');
    const end = finite(endMs, 'event endMs');
    if (end < start) throw new TypeError('event interval must be ordered');
    const authorityIdentity = String(authority || '').trim();
    if (!authorityIdentity) throw new TypeError('event authority is required');
    events.push({
      stage,
      startMs: start,
      endMs: end,
      startEpochMs: effectiveTimeOriginEpochMs + start,
      endEpochMs: effectiveTimeOriginEpochMs + end,
      durationMs: roundedDuration(start, end),
      authority: authorityIdentity,
      detail: detail === null ? null : clone(detail),
    });
    return clone(events.at(-1));
  }

  function finishFrame(frameId, {
    sourceGeneration = null,
    simulatorStep = null,
    compositorFrame = null,
    endMs = now(),
  } = {}) {
    const frame = frameById(frameId);
    if (!openFrames.has(frameId)) return clone(frame);
    const finishedAtMs = finite(endMs, 'frame endMs');
    if (finishedAtMs < frame.startMs) throw new TypeError('frame interval must be ordered');
    frame.status = 'complete';
    frame.endMs = finishedAtMs;
    frame.durationMs = roundedDuration(frame.startMs, finishedAtMs);
    if (sourceGeneration !== null) frame.sourceGeneration = nonNegativeInteger(sourceGeneration, 'sourceGeneration');
    if (simulatorStep !== null) frame.simulatorStep = nonNegativeInteger(simulatorStep, 'simulatorStep');
    if (compositorFrame !== null) frame.compositorFrame = nonNegativeInteger(compositorFrame, 'compositorFrame');
    openFrames.delete(frameId);
    return clone(frame);
  }

  function recordPresentationOpportunity(frameId, {
    timestampMs,
    authority,
  } = {}) {
    const frame = frameById(frameId);
    const observedAtMs = finite(timestampMs, 'presentation opportunity timestampMs');
    const authorityIdentity = String(authority || '').trim();
    if (!authorityIdentity) throw new TypeError('presentation opportunity authority is required');
    frame.presentationOpportunity = {
      status: 'observed',
      reason: null,
      timestampMs: observedAtMs,
      timestampEpochMs: effectiveTimeOriginEpochMs + observedAtMs,
      latencyFromFrameStartMs: roundedDuration(frame.startMs, observedAtMs),
      authority: authorityIdentity,
      displayPresentAuthority: false,
      expectedTerminalTail: false,
    };
    return clone(frame.presentationOpportunity);
  }

  function markTerminalPresentationUnavailable(frameId, { reason } = {}) {
    const frame = frameById(frameId);
    const unavailableReason = String(reason || '').trim();
    if (!unavailableReason) throw new TypeError('terminal presentation reason is required');
    if (frame.presentationOpportunity.status === 'observed') return clone(frame.presentationOpportunity);
    frame.presentationOpportunity = {
      ...frame.presentationOpportunity,
      reason: unavailableReason,
      expectedTerminalTail: true,
    };
    return clone(frame.presentationOpportunity);
  }

  function end({ firingId: endingFiringId, status: endingStatus = 'complete' } = {}) {
    const exactFiringId = normalizedFiringId(endingFiringId);
    if (exactFiringId !== firingId) throw new Error(`ending firing ${exactFiringId} does not match ledger firing ${firingId}`);
    if (status !== 'recording') return summary();
    status = String(endingStatus || 'complete');
    endedAtMs = finite(now(), 'ledger end time');
    return summary();
  }

  return {
    begin,
    beginFrame,
    setFramePath,
    recordStage,
    recordEvent,
    finishFrame,
    recordPresentationOpportunity,
    markTerminalPresentationUnavailable,
    end,
    snapshot: summary,
  };
}
