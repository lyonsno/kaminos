export const WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA = 'kaminos.webgpu-foreground-opportunity-interlock.v0';
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
  if (!isNonEmptyString(input.routeId)) throw new Error('routeId must be a non-empty string');
  if (!isNonEmptyString(input.runId)) throw new Error('runId must be a non-empty caller-owned identity');
  if (!input.device || typeof input.device !== 'object') throw new Error('device must be an object');
  if (!input.queue || typeof input.queue !== 'object') throw new Error('queue must be an object');
  if (input.maxRequests != null || input.maxReceipts != null || input.retention != null && input.retention !== 'uncapped') {
    throw new Error('foreground opportunity retention is uncapped; capped retention is not supported');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const state = {
    routeId: input.routeId,
    runId: input.runId,
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
        : Math.max(0, receiptInput.settledAtMs - receiptInput.startedAtMs),
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
      const receipt = finishRequest(requestState, {
        status: canceledDuringService
          ? 'canceled-during-service'
          : (failure
            ? (successfulSubmissionCount > 0 ? 'failed-after-submission' : 'failed-before-submission')
            : 'completed'),
        startedAtMs,
        settledAtMs: now(),
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
        failure: canceledDuringService ? null : failure,
      });
      receipts.push(receipt);
      if (failure && !canceledDuringService) failures.push({
        requestId: requestState.requestId,
        status: receipt.status,
        failure: clone(failure),
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

  function snapshot() {
    return deepFreeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      retention: 'uncapped',
      requestCount: state.requests.size,
      pendingRequestCount: state.pending.filter(requestState => requestState.status === 'pending').length,
      activeRequestCount: state.activeRequestCount,
      activeServiceCount: state.activeServiceCount,
      queuedServiceCount: state.queuedServiceCount,
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
    snapshot,
    finish,
  });
}
