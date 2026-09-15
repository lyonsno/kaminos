export const WEBGPU_WORKER_PHASE_REQUEST_SCHEMA = 'kaminos.webgpu-worker-phase-request.v0';
export const WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA = 'kaminos.webgpu-worker-phase-progress.v0';
export const WEBGPU_WORKER_PHASE_RESULT_SCHEMA = 'kaminos.webgpu-worker-phase-result.v0';
export const WEBGPU_WORKER_PHASE_REPORT_SCHEMA = 'kaminos.webgpu-worker-phase-report.v0';

const PLATFORM_TIMER_CEILING_MS = 2_147_483_647;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneJson(value, label, path = label, ancestors = new Set()) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} must be JSON-compatible; invalid number at ${path}`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} must be JSON-compatible; unsupported ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must be JSON-compatible; cycle at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new Error(`${label} must be JSON-compatible; invalid array element at ${path}[${index}]`);
        }
        clone[index] = cloneJson(descriptor.value, label, `${path}[${index}]`, ancestors);
      }
      const namedKeys = Reflect.ownKeys(value).filter(key => (
        key !== 'length' && (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key))
      ));
      if (namedKeys.length > 0) {
        throw new Error(`${label} must be JSON-compatible; named array property at ${path}`);
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must be JSON-compatible; non-plain object at ${path}`);
    }
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw new Error(`${label} must be JSON-compatible; symbol key at ${path}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} must be JSON-compatible; invalid property at ${path}.${key}`);
      }
      clone[key] = cloneJson(descriptor.value, label, `${path}.${key}`, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function describeError(error) {
  return deepFreeze({
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  });
}

function errorWithReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'workerPhaseReport')) {
    try {
      error.workerPhaseReport = report;
      if (error.workerPhaseReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.workerPhaseReport = report;
  return wrapped;
}

function phaseError(message, { name = 'WorkerPhaseError', cause = null } = {}) {
  const error = new Error(message);
  error.name = name;
  if (cause) error.cause = cause;
  return error;
}

function abortError(signal) {
  return phaseError(String(signal?.reason || 'worker phase aborted'), {
    name: 'AbortError',
  });
}

function captureCapability(target, key) {
  try {
    const value = target?.[key];
    return {
      key,
      value: typeof value === 'function' ? value : null,
      error: null,
    };
  } catch (error) {
    return { key, value: null, error };
  }
}

function captureProperty(target, key) {
  try {
    return { key, value: target?.[key] ?? null, error: null };
  } catch (error) {
    return { key, value: null, error };
  }
}

function normalizeTransferList(transfer) {
  if (transfer == null) return Object.freeze([]);
  if (!Array.isArray(transfer)) throw new Error('worker phase transfer must be an array');
  const normalized = new Array(transfer.length);
  for (let index = 0; index < transfer.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(transfer, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`worker phase transfer[${index}] must be present`);
    }
    normalized[index] = descriptor.value;
  }
  return Object.freeze(normalized);
}

function normalizeTimeout(timeoutMs) {
  if (timeoutMs == null) return null;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('worker phase timeoutMs must be a positive finite number when provided');
  }
  if (timeoutMs > PLATFORM_TIMER_CEILING_MS) {
    throw new Error(
      `worker phase timeoutMs exceeds the ${PLATFORM_TIMER_CEILING_MS}ms platform timer ceiling`,
    );
  }
  return timeoutMs;
}

function requireSynchronousResult(value, label) {
  if (value == null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  const thenCapability = captureProperty(value, 'then');
  if (thenCapability.error) throw thenCapability.error;
  if (typeof thenCapability.value !== 'function') return value;

  const catchCapability = captureCapability(value, 'catch');
  if (catchCapability.value) {
    try {
      Reflect.apply(catchCapability.value, value, [() => {}]);
    } catch {}
  }
  throw new Error(`${label} must complete synchronously`);
}

function normalizeSignal(signal) {
  if (signal == null) return null;
  if (typeof signal !== 'object') throw new Error('worker phase signal must be an AbortSignal');
  const add = captureCapability(signal, 'addEventListener');
  const remove = captureCapability(signal, 'removeEventListener');
  if (add.error || remove.error || !add.value || !remove.value || typeof signal.aborted !== 'boolean') {
    throw new Error('worker phase signal must be an AbortSignal');
  }
  return {
    signal,
    add: add.value,
    remove: remove.value,
  };
}

function normalizeIdentity(identity, expectedModuleId) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('worker factory must return an identity object');
  }
  const normalized = deepFreeze(cloneJson(identity, 'worker identity'));
  if (!isNonEmptyString(normalized.moduleId)) {
    throw new Error('worker identity moduleId must be a non-empty string');
  }
  if (normalized.moduleId !== expectedModuleId) {
    throw new Error(
      `worker module identity mismatch: expected ${expectedModuleId}, received ${normalized.moduleId}`,
    );
  }
  return normalized;
}

function normalizeInput(input) {
  if (input.maxProgressEvents != null || input.maxHistory != null || input.retentionLimit != null) {
    throw new Error(
      'worker phase reports are uncapped; maxProgressEvents, maxHistory, and retentionLimit are not supported',
    );
  }
  for (const key of ['executionId', 'operationId', 'moduleId']) {
    if (!isNonEmptyString(input[key])) {
      throw new Error(`worker phase ${key} must be a non-empty string`);
    }
  }
  if (typeof input.createWorker !== 'function') {
    throw new Error('worker phase createWorker must be a function');
  }
  if (typeof input.validateOutput !== 'function') {
    throw new Error('worker phase validateOutput must be a function');
  }
  if (input.onProgress != null && typeof input.onProgress !== 'function') {
    throw new Error('worker phase onProgress must be a function');
  }
  const now = input.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('worker phase now must be a function');
  return {
    executionId: input.executionId,
    operationId: input.operationId,
    moduleId: input.moduleId,
    createWorker: input.createWorker,
    validateOutput: input.validateOutput,
    onProgress: input.onProgress ?? null,
    payload: input.payload,
    transfer: normalizeTransferList(input.transfer),
    timeoutMs: normalizeTimeout(input.timeoutMs),
    signal: normalizeSignal(input.signal),
    metadata: deepFreeze(cloneJson(input.metadata ?? null, 'worker phase metadata')),
    now,
  };
}

function createState(input) {
  const clockFailures = [];
  function stamp(label) {
    try {
      const value = input.now();
      if (!Number.isFinite(value)) throw new Error('clock returned a non-finite value');
      return value;
    } catch (error) {
      clockFailures.push({
        label,
        ...describeError(error),
      });
      return null;
    }
  }
  const state = {
    status: 'starting',
    phase: 'admission',
    workerIdentity: null,
    transferOwnership: 'retained',
    history: [],
    progress: [],
    startedAtMs: stamp('started'),
    endedAtMs: null,
    cleanup: deepFreeze({
      status: 'pending',
      removedListeners: [],
      failures: [],
    }),
    clockFailures,
  };
  function record(kind, details = {}) {
    state.history.push(deepFreeze({
      sequence: state.history.length,
      kind,
      atMs: stamp(`history:${kind}`),
      ...cloneJson(details, `worker phase ${kind} history`),
    }));
  }
  return { state, stamp, record };
}

function createReport(input, state) {
  const endedAtMs = state.endedAtMs;
  const durationMs = Number.isFinite(state.startedAtMs) && Number.isFinite(endedAtMs)
    ? endedAtMs - state.startedAtMs
    : null;
  return deepFreeze({
    schema: WEBGPU_WORKER_PHASE_REPORT_SCHEMA,
    executionId: input.executionId,
    operationId: input.operationId,
    moduleId: input.moduleId,
    status: state.status,
    phase: state.phase,
    metadata: input.metadata,
    workerIdentity: state.workerIdentity,
    workerIdentityAuthority: state.workerIdentity == null ? null : 'factory-returned',
    timeoutMs: input.timeoutMs,
    transferCount: input.transfer.length,
    transferOwnership: state.transferOwnership,
    startedAtMs: state.startedAtMs,
    endedAtMs,
    durationMs,
    progress: [...state.progress],
    history: [...state.history],
    cleanup: state.cleanup,
    clockFailures: [...state.clockFailures],
  });
}

function cleanupWorker(worker, capabilities, listeners, signalState, timer) {
  if (timer != null) clearTimeout(timer);
  const failures = [];
  const removedListeners = [];

  if (signalState?.listening) {
    try {
      Reflect.apply(signalState.remove, signalState.signal, ['abort', signalState.listener]);
      signalState.listening = false;
    } catch (error) {
      failures.push({ action: 'remove-abort-listener', ...describeError(error) });
    }
  }

  if (worker && capabilities?.removeEventListener?.value) {
    for (const { type, listener } of listeners) {
      try {
        Reflect.apply(capabilities.removeEventListener.value, worker, [type, listener]);
        removedListeners.push(type);
      } catch (error) {
        failures.push({ action: `remove-${type}-listener`, ...describeError(error) });
      }
    }
  }

  if (worker && capabilities?.terminate?.value) {
    try {
      Reflect.apply(capabilities.terminate.value, worker, []);
    } catch (error) {
      failures.push({ action: 'terminate', ...describeError(error) });
    }
  } else if (worker) {
    failures.push({
      action: 'terminate',
      name: 'WorkerCleanupUnavailable',
      message: 'worker termination capability is unavailable',
    });
  }

  return deepFreeze({
    status: worker == null
      ? 'not-created'
      : (failures.length > 0 ? 'cleanup-failed' : 'terminated'),
    removedListeners,
    failures,
  });
}

function normalizeCreatedWorker(created) {
  if (!created || typeof created !== 'object' || Array.isArray(created)) {
    throw new Error('worker factory must return { worker, identity }');
  }
  const workerCapture = captureProperty(created, 'worker');
  const identityCapture = captureProperty(created, 'identity');
  return {
    worker: workerCapture.value,
    identity: identityCapture.value,
    workerError: workerCapture.error,
    identityError: identityCapture.error,
  };
}

function validateMessageIdentity(message, input) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('worker response must be an object');
  }
  if (message.executionId !== input.executionId) {
    throw new Error('worker response execution identity mismatch');
  }
  if (message.operationId !== input.operationId) {
    throw new Error('worker response operation identity mismatch');
  }
  if (message.moduleId !== input.moduleId) {
    throw new Error('worker response module identity mismatch');
  }
}

export async function runWebGpuWorkerPhase(rawInput = {}) {
  const input = normalizeInput(rawInput);
  const { state, stamp, record } = createState(input);
  let worker = null;
  let capabilities = null;
  const listeners = [];
  const signalState = input.signal ? {
    ...input.signal,
    listener: null,
    listening: false,
  } : null;
  let timer = null;
  let settled = false;

  function finishWithoutWorker(cause, status, phase, kind) {
    state.status = status;
    state.phase = phase;
    record(kind, { error: describeError(cause) });
    state.endedAtMs = stamp('ended');
    state.cleanup = cleanupWorker(worker, capabilities, listeners, signalState, timer);
    return errorWithReport(cause, createReport(input, state));
  }

  if (signalState?.signal.aborted) {
    throw finishWithoutWorker(abortError(signalState.signal), 'canceled', 'admission', 'canceled');
  }

  state.phase = 'worker-create';
  record('worker-create-started');
  let created;
  try {
    created = input.createWorker({
      executionId: input.executionId,
      operationId: input.operationId,
      moduleId: input.moduleId,
    });
    const normalized = normalizeCreatedWorker(created);
    worker = normalized.worker;
    if (normalized.workerError) throw normalized.workerError;
    if (normalized.identityError) throw normalized.identityError;
    if (!worker || typeof worker !== 'object') {
      throw new Error('worker factory returned an invalid worker');
    }
    state.workerIdentity = normalizeIdentity(normalized.identity, input.moduleId);
  } catch (cause) {
    if (worker) {
      capabilities = {
        terminate: captureCapability(worker, 'terminate'),
      };
    }
    throw finishWithoutWorker(
      phaseError(cause?.message || String(cause), { cause }),
      'failed',
      'worker-create',
      'worker-create-failed',
    );
  }
  record('worker-created', { workerIdentity: state.workerIdentity });

  state.phase = 'worker-capabilities';
  capabilities = Object.fromEntries(
    ['addEventListener', 'removeEventListener', 'postMessage', 'terminate']
      .map(key => [key, captureCapability(worker, key)]),
  );
  const capabilityFailure = Object.values(capabilities).find(capability => (
    capability.error || !capability.value
  ));
  if (capabilityFailure) {
    const cause = capabilityFailure.error || new Error(
      `worker ${capabilityFailure.key} capability must be a function`,
    );
    throw finishWithoutWorker(
      phaseError(cause.message, { cause }),
      'failed',
      'worker-capabilities',
      'worker-capability-failed',
    );
  }
  record('worker-capabilities-captured');

  return await new Promise((resolve, reject) => {
    function finishFailure(cause, status, phase, kind) {
      if (settled) return;
      settled = true;
      state.status = status;
      state.phase = phase;
      record(kind, { error: describeError(cause) });
      state.endedAtMs = stamp('ended');
      state.cleanup = cleanupWorker(worker, capabilities, listeners, signalState, timer);
      reject(errorWithReport(cause, createReport(input, state)));
    }

    function finishSuccess(output) {
      if (settled) return;
      settled = true;
      state.status = 'completed';
      state.phase = 'completed';
      record('completed');
      state.endedAtMs = stamp('ended');
      state.cleanup = cleanupWorker(worker, capabilities, listeners, signalState, timer);
      resolve(Object.freeze({
        output,
        report: createReport(input, state),
      }));
    }

    function failResponse(cause, phase = 'response-validation') {
      finishFailure(
        phaseError(cause?.message || String(cause), { cause }),
        'failed',
        phase,
        'failed',
      );
    }

    function handleMessage(event) {
      if (settled) return;
      const message = event?.data;
      try {
        validateMessageIdentity(message, input);
      } catch (cause) {
        failResponse(cause);
        return;
      }

      if (message.schema === WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA) {
        try {
          if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) {
            throw new Error('worker progress sequence must be a non-negative safe integer');
          }
          const previous = state.progress.at(-1);
          if (previous && message.sequence <= previous.sequence) {
            throw new Error('worker progress sequence must increase');
          }
          const progress = deepFreeze({
            schema: WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
            executionId: input.executionId,
            operationId: input.operationId,
            moduleId: input.moduleId,
            sequence: message.sequence,
            progress: cloneJson(message.progress ?? null, 'worker progress'),
            atMs: stamp('progress'),
          });
          state.progress.push(progress);
          record('progress', { sequence: progress.sequence, progress: progress.progress });
          const callbackResult = input.onProgress?.(progress);
          requireSynchronousResult(callbackResult, 'worker phase onProgress');
        } catch (cause) {
          failResponse(cause, 'progress-validation');
        }
        return;
      }

      if (message.schema !== WEBGPU_WORKER_PHASE_RESULT_SCHEMA) {
        failResponse(new Error('worker response schema is invalid'));
        return;
      }
      if (message.status === 'failed') {
        const workerError = message.error;
        if (!workerError || typeof workerError !== 'object' || !isNonEmptyString(workerError.message)) {
          failResponse(new Error('worker failure result must include an error message'));
          return;
        }
        finishFailure(
          phaseError(workerError.message, {
            name: isNonEmptyString(workerError.name) ? workerError.name : 'WorkerOperationError',
          }),
          'failed',
          'worker-operation',
          'worker-reported-failure',
        );
        return;
      }
      if (message.status !== 'completed') {
        failResponse(new Error('worker result status must be completed or failed'));
        return;
      }

      let output;
      try {
        output = input.validateOutput(message.output, message);
        requireSynchronousResult(output, 'worker phase validateOutput');
      } catch (cause) {
        failResponse(cause, 'output-validation');
        return;
      }
      finishSuccess(output);
    }

    function handleError(event) {
      const cause = event?.error instanceof Error
        ? event.error
        : new Error(event?.message || 'worker execution failed');
      finishFailure(
        phaseError(cause.message, { cause }),
        'failed',
        'worker-execution',
        'worker-crashed',
      );
    }

    function handleMessageError() {
      finishFailure(
        phaseError('worker response could not be deserialized'),
        'failed',
        'response-deserialization',
        'response-deserialization-failed',
      );
    }

    state.phase = 'listener-setup';
    for (const [type, listener] of [
      ['message', handleMessage],
      ['error', handleError],
      ['messageerror', handleMessageError],
    ]) {
      try {
        Reflect.apply(capabilities.addEventListener.value, worker, [type, listener]);
        listeners.push({ type, listener });
      } catch (cause) {
        finishFailure(
          phaseError(cause?.message || String(cause), { cause }),
          'failed',
          'listener-setup',
          'listener-setup-failed',
        );
        return;
      }
    }

    if (signalState) {
      signalState.listener = () => {
        finishFailure(
          abortError(signalState.signal),
          'canceled',
          'worker-operation',
          'canceled',
        );
      };
      try {
        Reflect.apply(signalState.add, signalState.signal, [
          'abort',
          signalState.listener,
          { once: true },
        ]);
        signalState.listening = true;
      } catch (cause) {
        finishFailure(
          phaseError(cause?.message || String(cause), { cause }),
          'failed',
          'listener-setup',
          'abort-listener-setup-failed',
        );
        return;
      }
      if (signalState.signal.aborted) {
        signalState.listener();
        return;
      }
    }

    if (input.timeoutMs != null) {
      timer = setTimeout(() => {
        finishFailure(
          phaseError(`worker phase timed out after ${input.timeoutMs}ms`, {
            name: 'TimeoutError',
          }),
          'timed-out',
          'worker-operation',
          'timed-out',
        );
      }, input.timeoutMs);
    }

    const workerRequest = {
      schema: WEBGPU_WORKER_PHASE_REQUEST_SCHEMA,
      executionId: input.executionId,
      operationId: input.operationId,
      moduleId: input.moduleId,
      payload: input.payload,
    };
    state.phase = 'dispatch';
    try {
      Reflect.apply(capabilities.postMessage.value, worker, [workerRequest, input.transfer]);
      if (settled) return;
      state.transferOwnership = 'transferred';
      state.status = 'running';
      state.phase = 'worker-operation';
      record('dispatched', { transferCount: input.transfer.length });
    } catch (cause) {
      finishFailure(
        phaseError(cause?.message || String(cause), { cause }),
        'failed',
        'dispatch',
        'dispatch-failed',
      );
    }
  });
}
