export const WEBGPU_INFERENCE_COORDINATOR_SCHEMA = 'kaminos.webgpu-inference-coordinator.v0';
export const WEBGPU_INFERENCE_ADMISSION_SCHEMA = 'kaminos.webgpu-inference-admission.v0';
export const WEBGPU_INFERENCE_ADMISSION_CANCELLATION_SCHEMA = 'kaminos.webgpu-inference-admission-cancellation.v0';
export const WEBGPU_INFERENCE_ADMISSION_RELEASE_SCHEMA = 'kaminos.webgpu-inference-admission-release.v0';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function createWebGpuInferenceCoordinator(input = {}) {
  if (input.maxAdmissions != null || input.maxPendingAdmissions != null || input.retentionLimit != null) {
    throw new Error('the inference coordinator does not impose a hidden admission cap; retention is uncapped until explicit forget');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('now must be a function');

  const state = {
    sequence: 0,
    admissions: [],
    pending: [],
    active: null,
    pumpScheduled: false,
    drainWaiters: new Set(),
  };

  function isIdle() {
    return state.active == null && state.pending.length === 0 && state.pumpScheduled === false;
  }

  function admissionSnapshot(record) {
    return {
      sequence: record.sequence,
      routeId: record.routeId,
      jobId: record.jobId,
      status: record.status,
      metadata: clone(record.metadata),
      requestedAtMs: record.requestedAtMs,
      grantedAtMs: record.grantedAtMs,
      startedAtMs: record.startedAtMs,
      completedAtMs: record.completedAtMs,
      cancellation: clone(record.cancellation),
      outcome: clone(record.outcome),
    };
  }

  function snapshot() {
    return {
      schema: WEBGPU_INFERENCE_COORDINATOR_SCHEMA,
      status: state.active == null ? (isIdle() ? 'idle' : 'processing') : 'running',
      schedulingPolicy: 'global-fifo-by-eligible-route-head',
      retention: 'uncapped-until-explicit-forget',
      cancellationAuthority: 'pending-admission-only-no-active-work-preemption',
      activeAdmissionSequence: state.active?.sequence ?? null,
      activeAdmission: state.active == null ? null : admissionSnapshot(state.active),
      pendingAdmissionCount: state.pending.length,
      pendingAdmissions: state.pending.map(admissionSnapshot),
      admissions: state.admissions.map(admissionSnapshot),
    };
  }

  function settleDrainWaiters() {
    if (!isIdle()) return;
    const idleSnapshot = snapshot();
    for (const resolve of state.drainWaiters) resolve(idleSnapshot);
    state.drainWaiters.clear();
  }

  function schedulePump() {
    if (state.active != null || state.pumpScheduled || state.pending.length === 0) {
      settleDrainWaiters();
      return;
    }
    state.pumpScheduled = true;
    queueMicrotask(() => {
      state.pumpScheduled = false;
      if (state.active != null) return;
      const record = state.pending.shift();
      if (!record) {
        settleDrainWaiters();
        return;
      }
      state.active = record;
      record.status = 'granted';
      record.grantedAtMs = now();
      record.deferred.resolve(deepFreeze({
        schema: WEBGPU_INFERENCE_ADMISSION_SCHEMA,
        status: 'granted',
        schedulingPolicy: 'global-fifo-by-eligible-route-head',
        sequence: record.sequence,
        routeId: record.routeId,
        jobId: record.jobId,
        requestedAtMs: record.requestedAtMs,
        grantedAtMs: record.grantedAtMs,
      }));
    });
  }

  function cancellationReceipt(record, status, reason) {
    return deepFreeze({
      schema: WEBGPU_INFERENCE_ADMISSION_CANCELLATION_SCHEMA,
      status,
      sequence: record.sequence,
      routeId: record.routeId,
      jobId: record.jobId,
      reason,
      cancellationAuthority: 'pending-admission-only-no-active-work-preemption',
    });
  }

  function requestAdmission(request = {}) {
    if (!isNonEmptyString(request.routeId)) throw new Error('routeId must be a non-empty string');
    if (!isNonEmptyString(request.jobId)) throw new Error('jobId must be a non-empty string');
    if (request.metadata != null && !isPlainObject(request.metadata)) {
      throw new Error('admission metadata must be an object');
    }
    const deferred = createDeferred();
    const record = {
      sequence: state.sequence + 1,
      routeId: request.routeId,
      jobId: request.jobId,
      metadata: clone(request.metadata || {}),
      status: 'pending',
      requestedAtMs: now(),
      grantedAtMs: null,
      startedAtMs: null,
      completedAtMs: null,
      cancellation: null,
      outcome: null,
      deferred,
    };
    state.sequence = record.sequence;
    state.admissions.push(record);
    state.pending.push(record);

    const handle = Object.freeze({
      sequence: record.sequence,
      routeId: record.routeId,
      jobId: record.jobId,
      admission: deferred.promise,
      begin() {
        if (record.status !== 'granted' || state.active !== record) {
          throw new Error('admission must be granted and active before begin');
        }
        record.status = 'running';
        record.startedAtMs = now();
        return deepFreeze(admissionSnapshot(record));
      },
      release(outcome = {}) {
        if (record.status !== 'granted' && record.status !== 'running') {
          throw new Error('only an active admission can be released');
        }
        if (state.active !== record) throw new Error('admission is not the active coordinator lease');
        if (!isPlainObject(outcome)) throw new Error('admission outcome must be an object');
        record.status = 'released';
        record.completedAtMs = now();
        record.outcome = clone(outcome);
        state.active = null;
        const receipt = deepFreeze({
          schema: WEBGPU_INFERENCE_ADMISSION_RELEASE_SCHEMA,
          status: 'released',
          sequence: record.sequence,
          routeId: record.routeId,
          jobId: record.jobId,
          completedAtMs: record.completedAtMs,
          outcome: clone(record.outcome),
        });
        schedulePump();
        return receipt;
      },
      cancel(reason = 'cancelled') {
        const normalizedReason = isNonEmptyString(reason) ? reason : 'cancelled';
        if (record.status === 'pending') {
          const pendingIndex = state.pending.indexOf(record);
          if (pendingIndex >= 0) state.pending.splice(pendingIndex, 1);
          record.status = 'cancelled-before-start';
          record.completedAtMs = now();
          record.cancellation = cancellationReceipt(record, 'cancelled-before-start', normalizedReason);
          record.deferred.resolve(record.cancellation);
          schedulePump();
          return record.cancellation;
        }
        if (record.status === 'granted' && state.active === record) {
          record.status = 'cancelled-before-start';
          record.completedAtMs = now();
          record.cancellation = cancellationReceipt(record, 'cancelled-before-start', normalizedReason);
          state.active = null;
          schedulePump();
          return record.cancellation;
        }
        if (record.status === 'running') {
          return cancellationReceipt(record, 'not-cancelled-active', normalizedReason);
        }
        return cancellationReceipt(record, 'not-cancelled-terminal', normalizedReason);
      },
    });
    schedulePump();
    return handle;
  }

  function drain() {
    if (isIdle()) return Promise.resolve(snapshot());
    return new Promise(resolve => state.drainWaiters.add(resolve));
  }

  function forgetAdmission(sequence) {
    const index = state.admissions.findIndex(record => record.sequence === sequence);
    if (index === -1) return false;
    const record = state.admissions[index];
    if (record.status === 'pending' || record.status === 'granted' || record.status === 'running') {
      throw new Error('cannot forget a pending or active admission');
    }
    state.admissions.splice(index, 1);
    return true;
  }

  return Object.freeze({
    requestAdmission,
    drain,
    snapshot,
    forgetAdmission,
  });
}
