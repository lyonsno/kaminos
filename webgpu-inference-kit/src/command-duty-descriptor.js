export const WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA = 'kaminos.webgpu-command-duty-descriptor.v0';
export const WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA = 'kaminos.webgpu-command-duty-observation.v0';
export const WEBGPU_COMMAND_DUTY_REPORT_SCHEMA = 'kaminos.webgpu-command-duty-report.v0';

const COMMAND_DUTY_KINDS = new Set(['compute', 'copy', 'render', 'mixed']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireIdentity(name, value) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function normalizeClock(clock) {
  if (!isPlainObject(clock)) {
    throw new TypeError('clock must provide clockId, source, and timeOriginEpochMs');
  }
  const clockId = requireIdentity('clock.clockId', clock.clockId);
  const source = requireIdentity('clock.source', clock.source);
  if (!Number.isFinite(clock.timeOriginEpochMs)) {
    throw new TypeError('clock.timeOriginEpochMs must be finite');
  }
  return { clockId, source, timeOriginEpochMs: clock.timeOriginEpochMs };
}

function normalizeError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function readNow(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('command duty clock returned a non-finite timestamp');
  return timestamp;
}

function normalizeChunkControl(input) {
  if (input == null) return null;
  if (!isPlainObject(input)) throw new TypeError('chunkControl must be null or an object');
  const controlId = requireIdentity('chunkControl.controlId', input.controlId);
  const unit = requireIdentity('chunkControl.unit', input.unit);
  const bounds = input.bounds;
  if (!isPlainObject(bounds)) throw new TypeError('chunkControl.bounds must be an object');
  if (!Number.isInteger(bounds.min) || bounds.min < 1
    || !Number.isInteger(bounds.max) || bounds.max < bounds.min) {
    throw new TypeError('chunkControl.bounds must declare ordered positive integer min and max');
  }
  if (!Number.isFinite(bounds.stepFactor) || bounds.stepFactor <= 1) {
    throw new TypeError('chunkControl.bounds.stepFactor must be greater than 1');
  }
  if (!Number.isInteger(input.current) || input.current < bounds.min || input.current > bounds.max) {
    throw new TypeError('chunkControl.current is outside caller-declared bounds');
  }
  return {
    controlId,
    unit,
    current: input.current,
    bounds: {
      min: bounds.min,
      max: bounds.max,
      stepFactor: bounds.stepFactor,
    },
  };
}

export function createWebGpuCommandDutyDescriptor(input = {}) {
  if (input.interruptible === true || input.submissionBoundary?.interruptible === true) {
    throw new TypeError('submitted command duty is non-preemptible; split work before submission');
  }
  const kind = requireIdentity('kind', input.kind);
  if (!COMMAND_DUTY_KINDS.has(kind)) {
    throw new TypeError(`kind must be one of: ${[...COMMAND_DUTY_KINDS].join(', ')}`);
  }
  if (input.metadata != null && !isPlainObject(input.metadata)) {
    throw new TypeError('metadata must be an object when provided');
  }
  return {
    schema: WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA,
    dutyId: requireIdentity('dutyId', input.dutyId),
    routeId: requireIdentity('routeId', input.routeId),
    runId: requireIdentity('runId', input.runId),
    clockId: requireIdentity('clockId', input.clockId),
    phase: requireIdentity('phase', input.phase),
    kind,
    submissionBoundary: {
      interruptible: false,
      canSplitBefore: true,
      canSplitAfter: true,
      authority: 'submitted-command-buffer-non-preemptible',
    },
    chunkControl: normalizeChunkControl(input.chunkControl),
    metadata: clone(input.metadata || {}),
  };
}

export function normalizeWebGpuCommandDutyDescriptor(input = {}) {
  if (input?.schema !== WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA) {
    throw new TypeError('command duty descriptor schema is invalid');
  }
  const normalized = createWebGpuCommandDutyDescriptor(input);
  const boundary = input.submissionBoundary;
  if (!isPlainObject(boundary)
    || boundary.interruptible !== false
    || boundary.canSplitBefore !== true
    || boundary.canSplitAfter !== true
    || boundary.authority !== 'submitted-command-buffer-non-preemptible') {
    throw new TypeError('command duty submission boundary is invalid');
  }
  return normalized;
}

function normalizeObservedDuty(row, identity, dutyIds) {
  if (!isPlainObject(row)) throw new TypeError('observed duty rows must be objects');
  const normalizedDescriptor = normalizeWebGpuCommandDutyDescriptor(row.descriptor);
  if (normalizedDescriptor.routeId !== identity.routeId) throw new Error('command duty route identity mismatch');
  if (normalizedDescriptor.runId !== identity.runId) throw new Error('command duty run identity mismatch');
  if (normalizedDescriptor.clockId !== identity.clockId) throw new Error('command duty clock identity mismatch');
  if (dutyIds.has(normalizedDescriptor.dutyId)) {
    throw new Error(`duplicate dutyId: ${normalizedDescriptor.dutyId}`);
  }
  dutyIds.add(normalizedDescriptor.dutyId);
  if (!isFiniteNonNegative(row.observedDurationMs)) {
    throw new TypeError('observedDurationMs must be finite and non-negative');
  }
  if (!isFiniteNonNegative(row.foregroundOverlapDurationMs)
    || row.foregroundOverlapDurationMs > row.observedDurationMs) {
    throw new TypeError('foreground overlap duration must be finite, non-negative, and no greater than observed duration');
  }
  return {
    descriptor: normalizedDescriptor,
    observedDurationMs: row.observedDurationMs,
    foregroundOverlapDurationMs: row.foregroundOverlapDurationMs,
  };
}

export function createWebGpuCommandDutyObservation(input = {}) {
  if (input.maxDuties != null || input.retention != null && input.retention !== 'uncapped') {
    throw new TypeError('command duty observation retention is uncapped; capped retention is not supported');
  }
  const identity = {
    routeId: requireIdentity('routeId', input.routeId),
    runId: requireIdentity('runId', input.runId),
    clockId: requireIdentity('clockId', input.clockId),
    firingId: requireIdentity('firingId', input.firingId),
  };
  if (!Array.isArray(input.duties)) throw new TypeError('duties must be an array');
  const dutyIds = new Set();
  const duties = input.duties.map(row => normalizeObservedDuty(row, identity, dutyIds));
  return {
    schema: WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA,
    status: 'observed',
    identity,
    retention: 'uncapped',
    dutyCount: duties.length,
    duties,
    totals: {
      observedDurationMs: duties.reduce((sum, row) => sum + row.observedDurationMs, 0),
      foregroundOverlapDurationMs: duties.reduce(
        (sum, row) => sum + row.foregroundOverlapDurationMs,
        0,
      ),
    },
  };
}

export function createWebGpuCommandDutyRecorder(input = {}) {
  if (input.maxSubmissions != null || input.retention != null && input.retention !== 'uncapped') {
    throw new TypeError('command duty recorder retention is uncapped; capped retention is not supported');
  }
  const routeId = requireIdentity('routeId', input.routeId);
  const runId = requireIdentity('runId', input.runId);
  const clock = normalizeClock(input.clock);
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now() - clock.timeOriginEpochMs);
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const submissions = [];
  const active = new Set();
  let sequence = 0;
  let closed = false;
  let failure = null;

  function assertOpen() {
    if (closed) throw new Error('command duty recorder is already finished');
  }

  function snapshot() {
    return {
      schema: WEBGPU_COMMAND_DUTY_REPORT_SCHEMA,
      status: closed ? (failure ? 'failed' : 'succeeded') : 'recording',
      routeId,
      runId,
      clock: clone(clock),
      retention: 'uncapped',
      timingAuthority: 'host-submit-call-only-not-gpu-completion',
      submissionCount: submissions.length,
      activeSubmissionCount: active.size,
      submissions: clone(submissions),
      failure: clone(failure),
      lastTrustworthySubmission: clone(submissions.at(-1) || null),
    };
  }

  return {
    schema: WEBGPU_COMMAND_DUTY_REPORT_SCHEMA,
    routeId,
    runId,
    clock: clone(clock),

    async measureSubmission(descriptorInput = {}, submit) {
      assertOpen();
      if (typeof submit !== 'function') throw new TypeError('command duty submission requires a function');
      const dutyId = descriptorInput.dutyId || `${runId}:command-duty:${sequence}`;
      sequence += 1;
      const descriptor = createWebGpuCommandDutyDescriptor({
        ...descriptorInput,
        dutyId,
        routeId,
        runId,
        clockId: clock.clockId,
      });
      const token = Object.freeze({ dutyId, sequence });
      const submitStartMs = readNow(now);
      active.add(token);
      let result;
      try {
        result = await submit();
      } catch (error) {
        active.delete(token);
        let recordingError = null;
        try {
          const submitEndMs = readNow(now);
          if (submitEndMs < submitStartMs) throw new Error('command duty clock moved backwards');
          submissions.push({
            descriptor,
            outcome: 'failed',
            submitStartMs,
            submitEndMs,
            submitStartEpochMs: clock.timeOriginEpochMs + submitStartMs,
            submitEndEpochMs: clock.timeOriginEpochMs + submitEndMs,
            submitCallDurationMs: submitEndMs - submitStartMs,
            error: normalizeError(error),
          });
        } catch (innerError) {
          recordingError = normalizeError(innerError);
        }
        if (failure === null) {
          failure = {
            dutyId,
            phase: descriptor.phase,
            error: normalizeError(error),
            ...(recordingError ? { recordingError } : {}),
          };
        }
        throw error;
      }

      try {
        const submitEndMs = readNow(now);
        if (submitEndMs < submitStartMs) throw new Error('command duty clock moved backwards');
        submissions.push({
          descriptor,
          outcome: 'succeeded',
          submitStartMs,
          submitEndMs,
          submitStartEpochMs: clock.timeOriginEpochMs + submitStartMs,
          submitEndEpochMs: clock.timeOriginEpochMs + submitEndMs,
          submitCallDurationMs: submitEndMs - submitStartMs,
        });
        active.delete(token);
        return result;
      } catch (recordingError) {
        active.delete(token);
        if (failure === null) {
          failure = {
            dutyId,
            phase: descriptor.phase,
            recordingError: normalizeError(recordingError),
          };
        }
        return result;
      }
    },

    snapshot,

    finish() {
      assertOpen();
      if (active.size > 0) {
        throw new Error(`cannot finish with ${active.size} active command duty submission(s)`);
      }
      closed = true;
      return snapshot();
    },
  };
}

function assertReportIdentity(report, options) {
  const expectedRouteId = requireIdentity('expectedRouteId', options.expectedRouteId);
  const expectedRunId = requireIdentity('expectedRunId', options.expectedRunId);
  const expectedClockId = requireIdentity('expectedClockId', options.expectedClockId);
  if (report.routeId !== expectedRouteId) throw new Error('command duty report route identity mismatch');
  if (report.runId !== expectedRunId) throw new Error('command duty report run identity mismatch');
  if (report.clock?.clockId !== expectedClockId) throw new Error('command duty report clock identity mismatch');
}

export function createWebGpuCommandDutyObservationFromReport(report, options = {}) {
  if (report?.schema !== WEBGPU_COMMAND_DUTY_REPORT_SCHEMA) {
    throw new TypeError('command duty report schema is required');
  }
  if (report.status !== 'succeeded') {
    throw new Error('a succeeded command duty report is required; failed reports are not complete duty evidence');
  }
  if (report.failure != null) {
    throw new Error('command duty report carries failure state and cannot project as succeeded');
  }
  assertReportIdentity(report, options);
  if (report.retention !== 'uncapped'
    || report.submissionCount !== report.submissions?.length
    || report.activeSubmissionCount !== 0) {
    throw new Error('command duty report is capped, partial, or still active');
  }
  if (report.timingAuthority !== 'host-submit-call-only-not-gpu-completion') {
    throw new Error('command duty report timing authority is invalid');
  }
  if (!Array.isArray(options.measurements)) throw new TypeError('measurements must be an array');

  const descriptors = new Map();
  for (const submission of report.submissions) {
    const descriptor = normalizeWebGpuCommandDutyDescriptor(submission?.descriptor);
    if (descriptor.routeId !== report.routeId
      || descriptor.runId !== report.runId
      || descriptor.clockId !== report.clock.clockId) {
      throw new Error('command duty report descriptor identity mismatch');
    }
    if (descriptors.has(descriptor.dutyId)) throw new Error(`duplicate dutyId: ${descriptor.dutyId}`);
    if (submission.outcome !== 'succeeded') throw new Error('failed command duty submission cannot project as observed duty');
    if (!isFiniteNonNegative(submission.submitStartMs)
      || !isFiniteNonNegative(submission.submitEndMs)
      || submission.submitEndMs < submission.submitStartMs
      || submission.submitCallDurationMs !== submission.submitEndMs - submission.submitStartMs
      || submission.submitStartEpochMs !== report.clock.timeOriginEpochMs + submission.submitStartMs
      || submission.submitEndEpochMs !== report.clock.timeOriginEpochMs + submission.submitEndMs) {
      throw new Error('command duty report submission timing is invalid');
    }
    descriptors.set(descriptor.dutyId, descriptor);
  }

  const measurements = new Map();
  for (const measurement of options.measurements) {
    const dutyId = requireIdentity('measurement.dutyId', measurement?.dutyId);
    if (!descriptors.has(dutyId)) throw new Error(`foreign or extra command duty measurement: ${dutyId}`);
    if (measurements.has(dutyId)) throw new Error(`duplicate command duty measurement: ${dutyId}`);
    measurements.set(dutyId, measurement);
  }
  if (measurements.size !== descriptors.size) {
    throw new Error('complete command duty measurements are required for every submitted duty');
  }

  return createWebGpuCommandDutyObservation({
    routeId: report.routeId,
    runId: report.runId,
    clockId: report.clock.clockId,
    firingId: options.firingId,
    duties: report.submissions.map(submission => {
      const descriptor = descriptors.get(submission.descriptor.dutyId);
      const measurement = measurements.get(descriptor.dutyId);
      return {
        descriptor,
        observedDurationMs: measurement.observedDurationMs,
        foregroundOverlapDurationMs: measurement.foregroundOverlapDurationMs,
      };
    }),
  });
}
