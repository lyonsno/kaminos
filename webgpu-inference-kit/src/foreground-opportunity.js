export const WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA = 'kaminos.webgpu-foreground-opportunity-interlock.v0';
export const WEBGPU_FOREGROUND_OPPORTUNITY_PRESSURE_SCHEMA = 'kaminos.webgpu-foreground-opportunity-pressure.v0';
export const WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA = 'kaminos.webgpu-foreground-opportunity-receipt.v0';
export const WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA = 'kaminos.webgpu-foreground-opportunity-service.v0';

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

function validateBoundary(input) {
  if (!isPlainObject(input)) throw new Error('foreground opportunity boundary must be an object');
  for (const key of ['invocationId', 'boundaryId', 'dutyId', 'phase']) {
    if (!isNonEmptyString(input[key])) throw new Error(`${key} must be a non-empty string`);
  }
  if (input.position !== 'before-encode') {
    throw new Error('foreground opportunities are serviced only at position before-encode');
  }
  if (input.metadata != null && !isPlainObject(input.metadata)) {
    throw new Error('foreground opportunity boundary metadata must be an object when provided');
  }
  return deepFreeze({
    invocationId: input.invocationId,
    boundaryId: input.boundaryId,
    dutyId: input.dutyId,
    phase: input.phase,
    position: input.position,
    metadata: clone(input.metadata || {}),
  });
}

export function createWebGpuForegroundOpportunityInterlock(input = {}) {
  return createInterlock(input);
}

function createInterlock(input, outsideRun = false) {
  if (!isNonEmptyString(input.routeId)) throw new Error('routeId must be a non-empty string');
  if (!outsideRun && !isNonEmptyString(input.runId)) throw new Error('runId must be a non-empty caller-owned identity');
  if (!input.device || typeof input.device !== 'object') throw new Error('device must be an object');
  if (!input.queue || typeof input.queue !== 'object') throw new Error('queue must be an object');
  if (input.maxRequests != null || input.maxReceipts != null || input.retention != null && input.retention !== 'uncapped') {
    throw new Error('foreground opportunity retention is uncapped; capped retention is not supported');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const state = {
    routeId: input.routeId,
    runId: outsideRun ? null : input.runId,
    sequence: 0,
    serviceSequence: 0,
    pending: [],
    requests: new Map(),
    receipts: [],
    services: [],
    activeRequestCount: 0,
    activeServiceCount: 0,
    queuedServiceCount: 0,
    serviceTail: Promise.resolve(),
    noDemandBoundaryCount: 0,
  };

  function finishRequest(requestState, receiptInput) {
    if (requestState.receipt) return requestState.receipt;
    const receipt = deepFreeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      requestId: requestState.requestId,
      requestSequence: requestState.sequence,
      status: receiptInput.status,
      requestedAtMs: requestState.requestedAtMs,
      startedAtMs: receiptInput.startedAtMs ?? null,
      settledAtMs: receiptInput.settledAtMs,
      elapsedMs: receiptInput.startedAtMs == null
        ? 0
        : (receiptInput.settledAtMs == null
          ? null
          : Math.max(0, receiptInput.settledAtMs - receiptInput.startedAtMs)),
      boundary: clone(receiptInput.boundary || null),
      metadata: clone(requestState.metadata),
      result: clone(receiptInput.result ?? null),
      submissionCount: receiptInput.submissions?.filter(row => row.submissionStatus === 'queue-submit-returned').length || 0,
      submissions: clone(receiptInput.submissions || []),
      cancellation: clone(receiptInput.cancellation || null),
      failure: clone(receiptInput.failure || null),
      authority: 'foreground-callback-and-queue-submission-observed-no-gpu-completion-or-presentation-claim',
    });
    requestState.status = receipt.status;
    requestState.receipt = receipt;
    state.receipts.push(clone(receipt));
    requestState.resolveCompletion(receipt);
    return receipt;
  }

  function request(requestInput = {}) {
    if (!isPlainObject(requestInput)) throw new Error('foreground opportunity request must be an object');
    if (!isNonEmptyString(requestInput.requestId)) throw new Error('requestId must be a non-empty string');
    if (state.requests.has(requestInput.requestId)) {
      throw new Error(`duplicate foreground opportunity request ${requestInput.requestId}`);
    }
    if (typeof requestInput.run !== 'function') throw new Error('foreground opportunity run must be a function');
    if (requestInput.metadata != null && !isPlainObject(requestInput.metadata)) {
      throw new Error('foreground opportunity metadata must be an object when provided');
    }
    state.sequence += 1;
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const abortController = new AbortController();
    const requestState = {
      requestId: requestInput.requestId,
      sequence: state.sequence,
      requestedAtMs: now(),
      metadata: clone(requestInput.metadata || {}),
      run: requestInput.run,
      status: 'pending',
      receipt: null,
      resolveCompletion,
      abortController,
      cancellationReason: null,
    };
    state.requests.set(requestState.requestId, requestState);
    state.pending.push(requestState);

    return Object.freeze({
      requestId: requestState.requestId,
      completion,
      cancel(reason = 'foreground-opportunity-canceled') {
        if (requestState.status === 'active') {
          requestState.cancellationReason = String(reason);
          requestState.abortController.abort(requestState.cancellationReason);
          return deepFreeze({
            status: 'cancellation-requested',
            requestId: requestState.requestId,
            reason: requestState.cancellationReason,
          });
        }
        if (requestState.status !== 'pending') {
          return requestState.receipt || deepFreeze({
            status: requestState.status,
            requestId: requestState.requestId,
          });
        }
        requestState.abortController.abort(reason);
        const receipt = finishRequest(requestState, {
          status: 'canceled-before-service',
          settledAtMs: now(),
          cancellation: { reason: String(reason) },
        });
        state.pending = state.pending.filter(candidate => candidate !== requestState);
        return receipt;
      },
    });
  }

  async function serviceBoundaryTurn(boundary) {
    const captured = state.pending.filter(requestState => requestState.status === 'pending');
    if (captured.length === 0) {
      state.noDemandBoundaryCount += 1;
      return deepFreeze({
        schema: WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA,
        status: 'no-demand',
        routeId: state.routeId,
        runId: state.runId,
        boundary,
        capturedRequestCount: 0,
        servicedRequestCount: 0,
        failures: [],
        authority: 'no-foreground-demand-observed-at-safe-boundary',
      });
    }
    const capturedSet = new Set(captured);
    state.pending = state.pending.filter(requestState => !capturedSet.has(requestState));
    state.serviceSequence += 1;
    const serviceStartedAtMs = now();
    const receipts = [];
    const failures = [];
    let receiptTimingError = null;

    for (const requestState of captured) {
      if (requestState.status !== 'pending') continue;
      requestState.status = 'active';
      state.activeRequestCount += 1;
      const startedAtMs = now();
      const submissions = [];
      let result = null;
      let failure = null;
      try {
        result = await requestState.run(Object.freeze({
          schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
          routeId: state.routeId,
          runId: state.runId,
          requestId: requestState.requestId,
          boundary,
          device: input.device,
          queue: input.queue,
          signal: requestState.abortController.signal,
          submit(commandBuffers, submissionInput = {}) {
            if (requestState.status !== 'active') {
              throw new Error('foreground opportunity submission lease is not active');
            }
            if (requestState.abortController.signal.aborted) {
              throw new Error('foreground opportunity was canceled before submission');
            }
            if (!Array.isArray(commandBuffers) || commandBuffers.length === 0) {
              throw new Error('foreground opportunity submit requires a non-empty command buffer array');
            }
            if (!isPlainObject(submissionInput)) throw new Error('foreground submission input must be an object');
            const submissionId = submissionInput.submissionId
              || `${requestState.requestId}:submission:${submissions.length + 1}`;
            if (!isNonEmptyString(submissionId)) throw new Error('submissionId must be a non-empty string');
            if (submissions.some(row => row.submissionId === submissionId)) {
              throw new Error(`duplicate foreground submission ${submissionId}`);
            }
            if (typeof input.queue.submit !== 'function') throw new Error('queue.submit must be available');
            let submissionMetadata;
            try {
              submissionMetadata = clone(submissionInput.metadata || {});
            } catch (error) {
              throw new Error(`foreground submission metadata must be JSON-serializable: ${error.message}`);
            }
            const submittedAtMs = now();
            try {
              input.queue.submit(commandBuffers);
              const row = deepFreeze({
                submissionId,
                submissionSequence: submissions.length + 1,
                commandBufferCount: commandBuffers.length,
                submittedAtMs,
                returnedAtMs: now(),
                submissionStatus: 'queue-submit-returned',
                metadata: submissionMetadata,
                authority: 'queue-submit-call-returned-no-gpu-completion-or-presentation-claim',
              });
              submissions.push(row);
              return row;
            } catch (error) {
              submissions.push(deepFreeze({
                submissionId,
                submissionSequence: submissions.length + 1,
                commandBufferCount: commandBuffers.length,
                submittedAtMs,
                returnedAtMs: now(),
                submissionStatus: 'queue-submit-threw',
                metadata: submissionMetadata,
                failure: normalizeError(error),
                authority: 'queue-submit-call-failed-no-gpu-submission-claim',
              }));
              throw error;
            }
          },
        }));
      } catch (error) {
        failure = {
          phase: 'foreground-callback',
          error: normalizeError(error),
        };
      } finally {
        state.activeRequestCount -= 1;
      }
      const successfulSubmissionCount = submissions
        .filter(row => row.submissionStatus === 'queue-submit-returned').length;
      const canceledDuringService = requestState.abortController.signal.aborted;
      let receiptResult = null;
      if (!failure && !canceledDuringService) {
        try {
          receiptResult = clone(result ?? null);
        } catch (error) {
          failure = {
            phase: 'foreground-result-serialization',
            error: normalizeError(error),
          };
        }
      }
      let settledAtMs = null;
      let receiptTimingFailure = null;
      try {
        settledAtMs = now();
      } catch (error) {
        receiptTimingError ||= error;
        receiptTimingFailure = {
          phase: 'foreground-receipt-timing',
          error: normalizeError(error),
        };
      }
      const receiptFailure = failure || receiptTimingFailure;
      const receipt = finishRequest(requestState, {
        status: canceledDuringService
          ? 'canceled-during-service'
          : (receiptFailure
            ? (successfulSubmissionCount > 0 ? 'failed-after-submission' : 'failed-before-submission')
            : 'completed'),
        startedAtMs,
        settledAtMs,
        boundary,
        result: receiptResult,
        submissions,
        cancellation: canceledDuringService
          ? {
              reason: requestState.cancellationReason
                || String(requestState.abortController.signal.reason || 'foreground-opportunity-canceled'),
              callbackError: failure ? clone(failure.error) : null,
            }
          : null,
        failure: canceledDuringService ? receiptTimingFailure : receiptFailure,
      });
      receipts.push(receipt);
      if (receiptFailure && (!canceledDuringService || receiptTimingFailure)) failures.push({
        requestId: requestState.requestId,
        status: receipt.status,
        failure: clone(receiptFailure),
      });
    }

    const service = deepFreeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA,
      status: failures.length > 0 ? 'failed' : 'serviced',
      routeId: state.routeId,
      runId: state.runId,
      serviceSequence: state.serviceSequence,
      boundary,
      startedAtMs: serviceStartedAtMs,
      settledAtMs: now(),
      capturedRequestCount: captured.length,
      servicedRequestCount: receipts.length,
      receiptIds: receipts.map(receipt => receipt.requestId),
      failures,
      authority: 'foreground-callbacks-settled-before-next-inference-encode-no-gpu-completion-or-presentation-claim',
    });
    state.services.push(clone(service));
    if (receiptTimingError) throw receiptTimingError;
    return service;
  }

  async function serviceAtBoundary(boundaryInput = {}) {
    const boundary = validateBoundary(boundaryInput);
    const precedingTurn = state.serviceTail;
    let releaseTurn;
    state.serviceTail = new Promise(resolve => { releaseTurn = resolve; });
    state.queuedServiceCount += 1;
    await precedingTurn;
    state.queuedServiceCount -= 1;
    state.activeServiceCount += 1;
    try {
      return await serviceBoundaryTurn(boundary);
    } finally {
      state.activeServiceCount -= 1;
      releaseTurn();
    }
  }

  function pressureSnapshot() {
    return Object.freeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_PRESSURE_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      pendingRequestCount: state.pending.length,
      activeRequestCount: state.activeRequestCount,
      activeServiceCount: state.activeServiceCount,
      queuedServiceCount: state.queuedServiceCount,
      authority: 'live-foreground-opportunity-counters-no-history-clone',
    });
  }

  function snapshot() {
    const pressure = pressureSnapshot();
    return deepFreeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      retention: 'uncapped',
      requestCount: state.requests.size,
      pendingRequestCount: pressure.pendingRequestCount,
      activeRequestCount: pressure.activeRequestCount,
      activeServiceCount: pressure.activeServiceCount,
      queuedServiceCount: pressure.queuedServiceCount,
      receiptCount: state.receipts.length,
      receipts: clone(state.receipts),
      serviceCount: state.services.length,
      services: clone(state.services),
      noDemandBoundaryCount: state.noDemandBoundaryCount,
      authority: 'foreground-opportunity-request-and-queue-submit-observation-no-presentation-claim',
    });
  }

  function finish() {
    const report = snapshot();
    return deepFreeze({
      ...report,
      status: report.pendingRequestCount === 0
          && report.activeRequestCount === 0
          && report.activeServiceCount === 0
          && report.queuedServiceCount === 0
        ? 'succeeded'
        : 'incomplete',
    });
  }

  return Object.freeze({
    schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
    request,
    serviceAtBoundary,
    pressureSnapshot,
    snapshot,
    finish,
  });
}

export const WEBGPU_FOREGROUND_SERVICE_SCHEMA = 'kaminos.webgpu-foreground-service.v0';

/**
 * One foreground requester across sequential model runs on a borrowed device.
 * Await beginRun before model work, use the returned foregroundOpportunities
 * at cooperative GPU boundaries, and wrap CPU/worker-only waits in
 * withForeground(phase, work). That scope settles foreground callbacks before
 * returning to the model; it does not fence GPU execution or preempt a duty.
 * Await finish when model encoding ends, including on failure. A rejected
 * finish leaves the run latched and does not certify queue completion; retain
 * model-owned resources. Idle renderer callbacks continue after that failure.
 * dispose drains idle callbacks after the last run; device/resource ownership
 * stays external.
 */
export function createWebGpuForegroundService(input = {}) {
  const options = { ...input, queue: input.queue ?? input.device?.queue };
  if (typeof options.queue?.submit !== 'function') throw new Error('queue.submit must be a function');
  if (options.now != null && typeof options.now !== 'function') throw new Error('now must be a function');
  createInterlock(options, true); // Validate before accepting any lifecycle state.
  const outside = new Map();
  let current = null;
  let idleTail = Promise.resolve();
  let disposal = null;
  let sequence = 0;
  let runCount = 0;
  let outsideRunReceiptCount = 0;
  let lastOutsideRunReceipt = null;

  function assertOpen() {
    if (disposal) throw new Error('foreground service is disposed');
  }

  function serviceBoundary(runId, phase) {
    const id = `${options.routeId}:foreground-service:${++sequence}`;
    return { invocationId: runId ?? id, boundaryId: id, dutyId: id, phase, position: 'before-encode' };
  }

  function request(requestInput) {
    assertOpen();
    if (current && !current.finishing) {
      const handle = current.interlock.request(requestInput);
      if (current.window?.accepting) current.service(current.window.phase);
      return handle;
    }
    if (outside.has(requestInput?.requestId)) {
      throw new Error(`duplicate foreground opportunity request ${requestInput.requestId}`);
    }
    // A one-request interlock gives idle frames the same contract without
    // retaining an application's lifetime of frames in an internal history.
    const interlock = createInterlock(options, true);
    const handle = interlock.request(requestInput);
    outside.set(handle.requestId, handle);
    handle.completion.then(receipt => {
      outside.delete(handle.requestId);
      outsideRunReceiptCount += 1;
      lastOutsideRunReceipt = receipt;
    });
    const finishing = current?.finishing;
    // The model caller observes finish failure; it must not poison idle rendering.
    idleTail = idleTail.then(() => finishing?.catch(() => undefined)).then(() =>
      interlock.serviceAtBoundary(serviceBoundary(null, 'foreground-idle')));
    return handle;
  }

  function beginRun(runId) {
    assertOpen();
    if (current) throw new Error(`foreground service already has an active run (${current.runId})`);
    const interlock = createInterlock({ ...options, runId });
    const run = { runId, interlock, window: null, finishing: null, tail: Promise.resolve() };
    current = run;
    runCount += 1;

    function assertRunning() {
      if (current !== run || run.finishing) throw new Error(`foreground run ${runId} is finishing or finished`);
      if (run.window) throw new Error('model GPU boundary is unavailable during a CPU foreground window');
    }

    function serviceAtBoundary(boundary) {
      assertRunning();
      run.tail = interlock.serviceAtBoundary(boundary);
      return run.tail;
    }
    run.service = phase => {
      run.tail = interlock.serviceAtBoundary(serviceBoundary(runId, phase));
      return run.tail;
    };

    async function withForeground(phase, work) {
      assertRunning();
      if (!isNonEmptyString(phase)) throw new Error('foreground window phase must be a non-empty string');
      if (typeof work !== 'function') throw new Error('foreground window work must be a function');
      run.window = { phase, accepting: true };
      run.service(phase);
      try {
        return await work();
      } finally {
        run.window.accepting = false;
        try { await run.tail; } finally { run.window = null; }
      }
    }

    function finish() {
      if (run.finishing) return run.finishing;
      assertRunning();
      // Seal admission synchronously. New requests join idleTail behind this
      // finish, while the interlock serializes the final drain after all turns.
      let resolveFinish;
      let rejectFinish;
      run.finishing = new Promise((resolve, reject) => { resolveFinish = resolve; rejectFinish = reject; });
      run.service('foreground-run-finish').then(() => {
        const report = interlock.finish();
        current = null;
        resolveFinish(report);
      }, rejectFinish);
      return run.finishing;
    }

    const foregroundOpportunities = Object.freeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
      request(requestInput) {
        if (current !== run || run.finishing) throw new Error(`foreground run ${runId} is finishing or finished`);
        return request(requestInput);
      },
      serviceAtBoundary,
      pressureSnapshot: interlock.pressureSnapshot,
      snapshot: interlock.snapshot,
      finish: interlock.finish,
    });
    // Reservation occurs before awaiting idle work: newly arriving frames join
    // the new run instead of prolonging startup indefinitely.
    return idleTail.then(() => Object.freeze({ runId, foregroundOpportunities, withForeground, finish }));
  }

  function snapshot() {
    return Object.freeze({
      schema: WEBGPU_FOREGROUND_SERVICE_SCHEMA,
      routeId: options.routeId,
      disposed: disposal !== null,
      runCount,
      activeRun: current ? Object.freeze({
        runId: current.runId,
        finishing: current.finishing !== null,
        foregroundPhase: current.window?.phase ?? null,
        pressure: current.interlock.pressureSnapshot(),
      }) : null,
      outsideRunInFlightCount: outside.size,
      outsideRunReceiptCount,
      lastOutsideRunReceipt,
    });
  }

  function dispose() {
    if (disposal) return disposal;
    if (current) throw new Error('finish the active run before disposing foreground service');
    disposal = idleTail.then(() => undefined);
    return disposal;
  }

  return Object.freeze({ schema: WEBGPU_FOREGROUND_SERVICE_SCHEMA, routeId: options.routeId, request, beginRun, snapshot, dispose });
}
