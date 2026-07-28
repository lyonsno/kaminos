export const WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA =
  'kaminos.webgpu-bounded-gpu-submission-report.v0';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function createAbortError(signal) {
  const reason = signal?.reason;
  const error = new Error(
    isNonEmptyString(reason?.message)
      ? reason.message
      : isNonEmptyString(reason)
        ? reason
        : 'bounded GPU submission was cancelled',
  );
  error.name = 'AbortError';
  return error;
}

function requireNow(now) {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new TypeError('bounded GPU submission clock returned a non-finite value');
  }
  return value;
}

function decorateError(error, report) {
  const decorated = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(decorated, 'boundedGpuSubmissionReport', {
      value: report,
      configurable: true,
      enumerable: false,
    });
  } catch {
    decorated.boundedGpuSubmissionReport = report;
  }
  return decorated;
}

export function createWebGpuBoundedSubmissionQueue(input = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('bounded GPU submission input must be an object');
  }
  const queue = input.queue;
  if (!queue || typeof queue !== 'object'
      || typeof queue.submit !== 'function'
      || typeof queue.onSubmittedWorkDone !== 'function') {
    throw new TypeError('queue must provide submit and onSubmittedWorkDone');
  }
  if (!Number.isSafeInteger(input.maxInFlightDuties) || input.maxInFlightDuties <= 0) {
    throw new TypeError('maxInFlightDuties must be a positive safe integer');
  }
  if (input.retention != null && input.retention !== 'uncapped') {
    throw new TypeError('retention must be uncapped');
  }
  if (input.now != null && typeof input.now !== 'function') {
    throw new TypeError('now must be a function when provided');
  }
  if (input.yieldToBrowser != null && typeof input.yieldToBrowser !== 'function') {
    throw new TypeError('yieldToBrowser must be a function when provided');
  }
  if (input.signal != null && typeof input.signal.aborted !== 'boolean') {
    throw new TypeError('signal must be an AbortSignal when provided');
  }

  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const yieldToBrowser = input.yieldToBrowser || (async () => null);
  const signal = input.signal || null;
  const state = {
    status: 'active',
    startedAtMs: requireNow(now),
    endedAtMs: null,
    sequence: 0,
    inFlight: [],
    duties: [],
    dutyIds: new Set(),
    backpressure: [],
    maxObservedInFlightDuties: 0,
    failure: null,
  };
  let admissionTail = Promise.resolve();

  function snapshot() {
    return deepFreeze({
      schema: WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA,
      status: state.status,
      maxInFlightDuties: input.maxInFlightDuties,
      maxObservedInFlightDuties: state.maxObservedInFlightDuties,
      retention: 'uncapped',
      timingAuthority: {
        rawQueueDurationMs: 'queue-work-done-prefix-fence',
        controlWaitMs: 'host-backpressure-await',
        presentation: 'not-observed',
      },
      startedAtMs: state.startedAtMs,
      endedAtMs: state.endedAtMs,
      submittedDutyCount: state.duties.length,
      completedDutyCount: state.duties.filter(
        duty => duty.status === 'completed' || duty.status === 'completed-after-failure',
      ).length,
      failedDutyCount: state.duties.filter(duty => duty.status === 'failed').length,
      inFlightDutyCount: state.inFlight.length,
      inFlightDutyIds: state.inFlight.map(entry => entry.dutyId),
      duties: clone(state.duties),
      backpressure: clone(state.backpressure),
      failure: clone(state.failure),
    });
  }

  function fail(error, phase, dutyId, secondaryFailures = []) {
    state.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
    state.endedAtMs = requireNow(now);
    state.failure = {
      phase,
      dutyId,
      error: normalizeError(error),
      secondaryFailures: clone(secondaryFailures),
    };
    throw decorateError(error, snapshot());
  }

  function terminalStateError() {
    const error = new Error(
      state.failure?.error?.message || `bounded GPU submission queue is ${state.status}`,
    );
    error.name = state.failure?.error?.name || 'Error';
    return decorateError(error, snapshot());
  }

  function updateDuty(entry, detail) {
    state.duties[entry.sequence - 1] = {
      ...state.duties[entry.sequence - 1],
      ...clone(detail),
    };
  }

  async function settleEntry(entry, statusAfterFailure = false) {
    const first = state.inFlight[0];
    if (first !== entry) {
      throw new Error(`bounded GPU submission settlement order mismatch at ${entry.dutyId}`);
    }
    const outcome = await entry.fenceOutcome;
    state.inFlight.shift();
    if (!outcome.ok) {
      updateDuty(entry, {
        status: 'failed',
        completedAtMs: outcome.completedAtMs,
        rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
        timingAuthority: 'queue-work-done-prefix-fence-rejected',
        failure: normalizeError(outcome.error),
      });
      return outcome;
    }
    updateDuty(entry, {
      status: statusAfterFailure ? 'completed-after-failure' : 'completed',
      completedAtMs: outcome.completedAtMs,
      rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
      timingAuthority: 'queue-work-done',
    });
    return outcome;
  }

  async function drainAfterFailure() {
    const secondaryFailures = [];
    while (state.inFlight.length > 0) {
      const entry = state.inFlight[0];
      const outcome = await settleEntry(entry, true);
      if (!outcome.ok) {
        secondaryFailures.push({
          phase: 'queue-completion',
          dutyId: entry.dutyId,
          error: normalizeError(outcome.error),
        });
      }
    }
    return secondaryFailures;
  }

  async function settleOldestWithBackpressure(triggerDutyId) {
    const entry = state.inFlight[0];
    const waitStartedAtMs = requireNow(now);
    const outcome = await settleEntry(entry);
    const waitEndedAtMs = requireNow(now);
    state.backpressure.push({
      triggerDutyId,
      settledDutyId: entry.dutyId,
      inFlightDutyCountBeforeWait: input.maxInFlightDuties,
      waitStartedAtMs,
      waitEndedAtMs,
      controlWaitMs: waitEndedAtMs - waitStartedAtMs,
      timingAuthority: 'host-backpressure-await',
    });
    if (!outcome.ok) {
      const secondaryFailures = await drainAfterFailure();
      fail(outcome.error, 'queue-completion', entry.dutyId, secondaryFailures);
    }
    return entry;
  }

  async function submitDutyInternal(duty) {
    if (signal?.aborted) {
      const secondaryFailures = await drainAfterFailure();
      fail(createAbortError(signal), 'cancellation', duty.dutyId, secondaryFailures);
    }
    const sequence = ++state.sequence;
    const submitStartedAtMs = requireNow(now);
    try {
      await duty.submit();
    } catch (error) {
      state.duties.push({
        dutyId: duty.dutyId,
        sequence,
        metadata: clone(duty.metadata || {}),
        status: 'failed',
        submitStartedAtMs,
        submitReturnedAtMs: requireNow(now),
        submittedAtMs: null,
        completedAtMs: null,
        submitDurationMs: null,
        rawQueueDurationMs: null,
        timingAuthority: 'queue-submit-call-failed',
        failure: normalizeError(error),
      });
      const secondaryFailures = await drainAfterFailure();
      fail(error, 'queue-submission', duty.dutyId, secondaryFailures);
    }
    const submitReturnedAtMs = requireNow(now);
    let fence;
    try {
      fence = queue.onSubmittedWorkDone();
      if (fence == null || typeof fence.then !== 'function') {
        throw new TypeError('queue onSubmittedWorkDone must return a Promise');
      }
    } catch (error) {
      state.duties.push({
        dutyId: duty.dutyId,
        sequence,
        metadata: clone(duty.metadata || {}),
        status: 'failed',
        submitStartedAtMs,
        submitReturnedAtMs,
        submittedAtMs: submitReturnedAtMs,
        completedAtMs: null,
        submitDurationMs: submitReturnedAtMs - submitStartedAtMs,
        rawQueueDurationMs: null,
        timingAuthority: 'queue-work-done-fence-creation-failed',
        failure: normalizeError(error),
      });
      const secondaryFailures = await drainAfterFailure();
      fail(error, 'queue-fence-creation', duty.dutyId, secondaryFailures);
    }

    const entry = {
      dutyId: duty.dutyId,
      sequence,
      submittedAtMs: submitReturnedAtMs,
      fenceOutcome: Promise.resolve(fence).then(
        () => ({ ok: true, completedAtMs: requireNow(now) }),
        error => ({ ok: false, error, completedAtMs: requireNow(now) }),
      ),
    };
    state.duties.push({
      dutyId: duty.dutyId,
      sequence,
      metadata: clone(duty.metadata || {}),
      status: 'in-flight',
      submitStartedAtMs,
      submitReturnedAtMs,
      submittedAtMs: submitReturnedAtMs,
      completedAtMs: null,
      submitDurationMs: submitReturnedAtMs - submitStartedAtMs,
      rawQueueDurationMs: null,
      timingAuthority: 'queue-work-done-prefix-fence-pending',
      failure: null,
    });
    state.inFlight.push(entry);
    state.maxObservedInFlightDuties = Math.max(
      state.maxObservedInFlightDuties,
      state.inFlight.length,
    );

    try {
      await yieldToBrowser({
        dutyId: duty.dutyId,
        sequence,
        metadata: deepFreeze(clone(duty.metadata || {})),
        inFlightDutyCount: state.inFlight.length,
        maxInFlightDuties: input.maxInFlightDuties,
      });
    } catch (error) {
      const secondaryFailures = await drainAfterFailure();
      fail(error, 'browser-yield', duty.dutyId, secondaryFailures);
    }
    if (signal?.aborted) {
      const secondaryFailures = await drainAfterFailure();
      fail(createAbortError(signal), 'cancellation', duty.dutyId, secondaryFailures);
    }

    let settledEntry = null;
    if (state.inFlight.length >= input.maxInFlightDuties) {
      settledEntry = await settleOldestWithBackpressure(duty.dutyId);
    }
    if (signal?.aborted) {
      const secondaryFailures = await drainAfterFailure();
      fail(createAbortError(signal), 'cancellation', duty.dutyId, secondaryFailures);
    }
    return deepFreeze({
      status: 'admitted',
      dutyId: duty.dutyId,
      sequence,
      backpressureApplied: settledEntry != null,
      settledDutyId: settledEntry?.dutyId || null,
      inFlightDutyCount: state.inFlight.length,
      maxInFlightDuties: input.maxInFlightDuties,
      authority: 'queue-submitted-with-bounded-prefix-completion',
    });
  }

  function submitDuty(duty = {}) {
    if (state.status !== 'active') {
      throw new Error(`bounded GPU submission queue is ${state.status}`);
    }
    if (!isPlainObject(duty)) throw new TypeError('GPU duty must be an object');
    if (!isNonEmptyString(duty.dutyId)) {
      throw new TypeError('dutyId must be a non-empty caller-owned identity');
    }
    if (state.dutyIds.has(duty.dutyId)) {
      throw new Error(`duplicate GPU duty ${duty.dutyId}`);
    }
    if (typeof duty.submit !== 'function') throw new TypeError('GPU duty submit must be a function');
    if (duty.metadata != null && !isPlainObject(duty.metadata)) {
      throw new TypeError('GPU duty metadata must be an object when provided');
    }
    let metadata;
    try {
      metadata = clone(duty.metadata || {});
    } catch {
      throw new TypeError('GPU duty metadata must be JSON-serializable');
    }
    state.dutyIds.add(duty.dutyId);
    const operation = admissionTail.then(() => {
      if (state.status !== 'active') throw terminalStateError();
      return submitDutyInternal({ ...duty, metadata });
    });
    admissionTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async function drain() {
    if (state.status === 'drained') return snapshot();
    if (state.status === 'failed' || state.status === 'cancelled') {
      throw terminalStateError();
    }
    await admissionTail;
    if (state.status === 'drained') return snapshot();
    if (state.status === 'failed' || state.status === 'cancelled') {
      throw terminalStateError();
    }
    while (state.inFlight.length > 0) {
      const entry = state.inFlight[0];
      const outcome = await settleEntry(entry);
      if (!outcome.ok) {
        const secondaryFailures = await drainAfterFailure();
        fail(outcome.error, 'queue-completion', entry.dutyId, secondaryFailures);
      }
    }
    if (signal?.aborted) {
      fail(createAbortError(signal), 'cancellation', null);
    }
    state.status = 'drained';
    state.endedAtMs = requireNow(now);
    return snapshot();
  }

  return Object.freeze({
    schema: WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA,
    queue,
    maxInFlightDuties: input.maxInFlightDuties,
    submitDuty,
    drain,
    snapshot,
  });
}
