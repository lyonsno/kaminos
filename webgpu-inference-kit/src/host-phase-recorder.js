export const WEBGPU_HOST_PHASE_RECORDER_SCHEMA = 'kaminos.webgpu-host-phase-recorder.v0';
export const WEBGPU_HOST_PHASE_EVENT_BATCH_SCHEMA = 'kaminos.webgpu-host-phase-event-batch.v0';

export const WEBGPU_HOST_PHASE = Object.freeze({
  cpuPreprocess: 'cpu-preprocess',
  commandEncoding: 'command-encoding',
  queueSubmission: 'queue-submission',
  readback: 'readback',
  presentation: 'presentation',
  other: 'other',
});

const HOST_PHASES = new Set(Object.values(WEBGPU_HOST_PHASE));

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function validateIdentity(name, value) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function normalizeClock(clock) {
  if (!clock || typeof clock !== 'object') {
    throw new TypeError('clock must provide clockId, source, and timeOriginEpochMs');
  }
  const clockId = validateIdentity('clock.clockId', clock.clockId);
  const source = validateIdentity('clock.source', clock.source);
  if (!Number.isFinite(clock.timeOriginEpochMs)) {
    throw new TypeError('clock.timeOriginEpochMs must be finite');
  }
  return {
    clockId,
    source,
    timeOriginEpochMs: clock.timeOriginEpochMs,
  };
}

function normalizePhase(phase) {
  if (!HOST_PHASES.has(phase)) {
    throw new TypeError(`phase must be one of: ${[...HOST_PHASES].join(', ')}`);
  }
  return phase;
}

function normalizeDetail(detail) {
  if (detail == null) return {};
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    throw new TypeError('host phase detail must be an object when provided');
  }
  return clone(detail);
}

function normalizeError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function readNow(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('host phase clock returned a non-finite timestamp');
  return timestamp;
}

export function createWebGpuHostPhaseRecorder(input = {}) {
  if (input.maxIntervals != null || input.retention != null && input.retention !== 'uncapped') {
    throw new TypeError('host phase retention is uncapped; capped retention is not supported');
  }

  const routeId = validateIdentity('routeId', input.routeId);
  const runId = validateIdentity('runId', input.runId);
  const clock = normalizeClock(input.clock);
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now() - clock.timeOriginEpochMs);
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const intervals = [];
  const active = new Map();
  let sequence = 0;
  let closed = false;
  let failure = null;

  function assertOpen() {
    if (closed) throw new Error('host phase recorder is already finished');
  }

  function begin(phase, options = {}) {
    assertOpen();
    const normalizedPhase = normalizePhase(phase);
    const intervalId = `${runId}:host-phase:${sequence}`;
    sequence += 1;
    const token = Object.freeze({ intervalId, routeId, runId, clockId: clock.clockId });
    active.set(token, {
      intervalId,
      phase: normalizedPhase,
      startMs: readNow(now),
      detail: normalizeDetail(options.detail),
    });
    return token;
  }

  function closeInterval(token, outcome, options = {}) {
    assertOpen();
    const pending = active.get(token);
    if (!pending) throw new Error('host phase token is foreign, stale, or already closed');
    const endMs = readNow(now);
    if (endMs < pending.startMs) {
      throw new Error('host phase clock moved backwards; interval was not recorded');
    }

    const detail = {
      ...pending.detail,
      ...normalizeDetail(options.detail),
    };
    const interval = {
      intervalId: pending.intervalId,
      routeId,
      runId,
      clockId: clock.clockId,
      phase: pending.phase,
      outcome,
      startMs: pending.startMs,
      endMs,
      startEpochMs: clock.timeOriginEpochMs + pending.startMs,
      endEpochMs: clock.timeOriginEpochMs + endMs,
      durationMs: endMs - pending.startMs,
      detail,
    };
    if (outcome === 'failed') interval.error = normalizeError(options.error);

    active.delete(token);
    intervals.push(interval);
    if (outcome === 'failed' && failure === null) {
      failure = {
        intervalId: interval.intervalId,
        phase: interval.phase,
        error: clone(interval.error),
      };
    }
    return clone(interval);
  }

  function snapshot() {
    return {
      schema: WEBGPU_HOST_PHASE_RECORDER_SCHEMA,
      status: closed ? (failure ? 'failed' : 'succeeded') : 'recording',
      routeId,
      runId,
      clock: clone(clock),
      retention: 'uncapped',
      intervalCount: intervals.length,
      activeIntervalCount: active.size,
      intervals: clone(intervals),
      failure: clone(failure),
      lastTrustworthyInterval: clone(intervals.at(-1) || null),
    };
  }

  return {
    schema: WEBGPU_HOST_PHASE_RECORDER_SCHEMA,
    routeId,
    runId,
    clock: clone(clock),

    begin,

    end(token, options = {}) {
      return closeInterval(token, 'succeeded', options);
    },

    fail(token, error, options = {}) {
      return closeInterval(token, 'failed', { ...options, error });
    },

    async measure(phase, fn, options = {}) {
      if (typeof fn !== 'function') throw new TypeError('host phase measurement requires a function');
      const token = begin(phase, options);
      try {
        const result = await fn();
        closeInterval(token, 'succeeded', options.finish || {});
        return result;
      } catch (error) {
        closeInterval(token, 'failed', { ...(options.failure || {}), error });
        throw error;
      }
    },

    snapshot,

    finish() {
      assertOpen();
      if (active.size > 0) {
        throw new Error(`cannot finish with ${active.size} active host phase interval(s)`);
      }
      closed = true;
      return snapshot();
    },
  };
}

function assertProjectionIdentity(report, options) {
  const expectedRouteId = validateIdentity('expectedRouteId', options.expectedRouteId);
  const expectedRunId = validateIdentity('expectedRunId', options.expectedRunId);
  const expectedClockId = validateIdentity('expectedClockId', options.expectedClockId);
  if (report.routeId !== expectedRouteId) throw new Error('host phase route identity mismatch');
  if (report.runId !== expectedRunId) throw new Error('host phase run identity mismatch');
  if (report.clock?.clockId !== expectedClockId) throw new Error('host phase clock identity mismatch');
}

export function projectWebGpuHostPhaseEvents(report, options = {}) {
  if (!report || report.schema !== WEBGPU_HOST_PHASE_RECORDER_SCHEMA) {
    throw new TypeError('host phase recorder report schema is required');
  }
  const firingId = validateIdentity('firingId', options.firingId);
  assertProjectionIdentity(report, options);
  if (report.retention !== 'uncapped' || report.intervalCount !== report.intervals?.length) {
    throw new Error('host phase report is capped or partial');
  }
  if (report.activeIntervalCount !== 0) {
    throw new Error('host phase report has active host phase intervals');
  }

  const events = report.intervals.map(interval => {
    if (interval.routeId !== report.routeId) throw new Error('host phase interval route identity mismatch');
    if (interval.runId !== report.runId) throw new Error('host phase interval run identity mismatch');
    if (interval.clockId !== report.clock.clockId) throw new Error('host phase interval clock identity mismatch');
    if (!Number.isFinite(interval.startMs)
      || !Number.isFinite(interval.endMs)
      || interval.endMs < interval.startMs
      || interval.startEpochMs !== report.clock.timeOriginEpochMs + interval.startMs
      || interval.endEpochMs !== report.clock.timeOriginEpochMs + interval.endMs) {
      throw new Error('host phase interval timing is invalid');
    }
    return {
      eventId: interval.intervalId,
      firingId,
      routeId: report.routeId,
      runId: report.runId,
      clockId: report.clock.clockId,
      kind: 'webgpu-runtime-host-phase',
      source: 'runtime-explicit',
      phase: interval.phase,
      outcome: interval.outcome,
      startMs: interval.startMs,
      endMs: interval.endMs,
      startEpochMs: interval.startEpochMs,
      endEpochMs: interval.endEpochMs,
      durationMs: interval.durationMs,
      detail: clone(interval.detail),
      error: clone(interval.error || null),
    };
  });

  return {
    schema: WEBGPU_HOST_PHASE_EVENT_BATCH_SCHEMA,
    status: 'verified',
    routeId: report.routeId,
    runId: report.runId,
    clock: clone(report.clock),
    firingId,
    retention: 'uncapped',
    eventCount: events.length,
    events,
  };
}
