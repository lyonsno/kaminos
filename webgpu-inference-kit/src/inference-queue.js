export const WEBGPU_INFERENCE_QUEUE_SCHEMA = 'kaminos.webgpu-inference-queue.v0';
export const WEBGPU_INFERENCE_JOB_COMPLETION_SCHEMA = 'kaminos.webgpu-inference-job-completion.v0';
export const WEBGPU_INFERENCE_JOB_CANCELLATION_SCHEMA = 'kaminos.webgpu-inference-job-cancellation.v0';
export const WEBGPU_SCHEDULER_DECISION_QUEUE_RECEIPT_SCHEMA = 'kaminos.webgpu-scheduler-decision-queue-receipt.v0';

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

function serializeFailure(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function createWebGpuInferenceQueue(input = {}) {
  const runtime = input.runtime;
  if (!runtime || typeof runtime !== 'object') throw new Error('runtime must be an object');
  if (typeof runtime.runInvocation !== 'function') throw new Error('runtime.runInvocation must be available');
  if (!isNonEmptyString(runtime.routeId)) throw new Error('runtime.routeId must be a non-empty string');
  const routeId = input.routeId || runtime.routeId;
  if (!isNonEmptyString(routeId)) throw new Error('routeId must be a non-empty string');
  if (routeId !== runtime.routeId) throw new Error('queue route mismatch with runtime');
  if (input.maxJobs != null || input.maxPendingJobs != null || input.progressLimit != null) {
    throw new Error('the inference queue does not impose a hidden job cap; retention is uncapped until explicit forget');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('now must be a function');

  const state = {
    jobs: new Map(),
    pendingJobs: [],
    decisions: [],
    pendingDecisions: [],
    activeJob: null,
    pumping: false,
    pumpScheduled: false,
    decisionSequence: 0,
    drainWaiters: new Set(),
  };

  function isIdle() {
    return state.activeJob == null
      && state.pendingJobs.length === 0
      && state.pendingDecisions.length === 0
      && state.pumping === false
      && state.pumpScheduled === false;
  }

  function jobSnapshot(job) {
    return {
      jobId: job.jobId,
      status: job.status,
      metadata: clone(job.metadata),
      queuedAtMs: job.queuedAtMs,
      startedAtMs: job.startedAtMs,
      completedAtMs: job.completedAtMs,
      schedulerRevision: job.schedulerRevision,
      outputPresent: job.outputPresent,
      failure: clone(job.failure),
      cancellation: clone(job.cancellation),
      progress: clone(job.progress),
    };
  }

  function decisionSnapshot(decision) {
    return {
      sequence: decision.sequence,
      status: decision.status,
      revision: decision.decision?.revision ?? null,
      queuedAtMs: decision.queuedAtMs,
      completedAtMs: decision.completedAtMs,
      application: clone(decision.application),
      failure: clone(decision.failure),
    };
  }

  function snapshot() {
    return {
      schema: WEBGPU_INFERENCE_QUEUE_SCHEMA,
      routeId,
      status: state.activeJob
        ? 'running'
        : (isIdle() ? 'idle' : 'processing'),
      retention: 'uncapped-until-explicit-forget',
      cancellationAuthority: 'pending-jobs-only-no-active-work-preemption',
      activeJobId: state.activeJob?.jobId || null,
      pendingJobCount: state.pendingJobs.length,
      pendingDecisionCount: state.pendingDecisions.length,
      jobs: [...state.jobs.values()].map(jobSnapshot),
      decisions: state.decisions.map(decisionSnapshot),
    };
  }

  function settleDrainWaiters() {
    if (!isIdle()) return;
    const idleSnapshot = snapshot();
    for (const resolve of state.drainWaiters) resolve(idleSnapshot);
    state.drainWaiters.clear();
  }

  function cancellationReceipt(job, status, reason) {
    return deepFreeze({
      schema: WEBGPU_INFERENCE_JOB_CANCELLATION_SCHEMA,
      routeId,
      jobId: job.jobId,
      status,
      reason,
      cancellationAuthority: 'pending-jobs-only-no-active-work-preemption',
    });
  }

  function terminalCompletion(job, inputCompletion) {
    job.status = inputCompletion.status;
    job.completedAtMs = now();
    job.outputPresent = inputCompletion.outputPresent;
    job.failure = inputCompletion.failure || null;
    job.cancellation = inputCompletion.cancellation || null;
    const completion = Object.freeze({
      schema: WEBGPU_INFERENCE_JOB_COMPLETION_SCHEMA,
      routeId,
      jobId: job.jobId,
      status: job.status,
      metadata: deepFreeze(clone(job.metadata)),
      queuedAtMs: job.queuedAtMs,
      startedAtMs: job.startedAtMs,
      completedAtMs: job.completedAtMs,
      schedulerRevision: job.schedulerRevision,
      progress: deepFreeze(clone(job.progress)),
      outputPresent: job.outputPresent,
      ...(job.outputPresent ? { output: inputCompletion.output } : {}),
      ...(job.failure ? { failure: deepFreeze(clone(job.failure)) } : {}),
      ...(job.cancellation ? { cancellation: deepFreeze(clone(job.cancellation)) } : {}),
    });
    job.completion.resolve(completion);
    return completion;
  }

  async function applyDecision(control) {
    control.status = 'applying';
    try {
      if (typeof runtime.applySchedulerDecision !== 'function') {
        throw new Error('runtime.applySchedulerDecision must be available to schedule a decision');
      }
      const application = await runtime.applySchedulerDecision(control.decision);
      control.status = 'applied';
      control.completedAtMs = now();
      control.application = clone(application);
      const receipt = deepFreeze({
        schema: WEBGPU_SCHEDULER_DECISION_QUEUE_RECEIPT_SCHEMA,
        routeId,
        sequence: control.sequence,
        status: 'applied',
        queuedAtMs: control.queuedAtMs,
        completedAtMs: control.completedAtMs,
        application: clone(application),
        applicationAuthority: 'between-queued-invocations-only',
      });
      control.deferred.resolve(receipt);
    } catch (error) {
      control.status = 'failed';
      control.completedAtMs = now();
      control.failure = serializeFailure(error);
      control.deferred.reject(error);
    }
  }

  async function executeJob(job) {
    state.activeJob = job;
    job.status = 'running';
    job.startedAtMs = now();
    try {
      const output = await runtime.runInvocation({ invocationId: job.jobId }, invocation => {
        job.schedulerRevision = invocation.schedulerRevision ?? null;
        const context = Object.freeze({
          ...invocation,
          jobId: job.jobId,
          reportProgress(progress) {
            if (!isPlainObject(progress)) throw new Error('progress must be an object');
            if (state.activeJob !== job || job.status !== 'running') {
              throw new Error('progress can only be reported by the active job');
            }
            const row = deepFreeze({
              sequence: job.progress.length + 1,
              atMs: now(),
              value: clone(progress),
            });
            job.progress.push(row);
            return row;
          },
        });
        return job.execute(context);
      });
      terminalCompletion(job, {
        status: 'succeeded',
        outputPresent: true,
        output,
      });
    } catch (error) {
      terminalCompletion(job, {
        status: 'failed',
        outputPresent: false,
        failure: serializeFailure(error),
      });
    } finally {
      state.activeJob = null;
    }
  }

  async function pump() {
    if (state.pumping) return;
    state.pumpScheduled = false;
    state.pumping = true;
    try {
      while (state.pendingDecisions.length > 0 || state.pendingJobs.length > 0) {
        while (state.pendingDecisions.length > 0) {
          await applyDecision(state.pendingDecisions.shift());
        }
        const job = state.pendingJobs.shift();
        if (job) await executeJob(job);
      }
    } finally {
      state.pumping = false;
      if (state.pendingDecisions.length > 0 || state.pendingJobs.length > 0) schedulePump();
      else settleDrainWaiters();
    }
  }

  function schedulePump() {
    if (state.pumping || state.pumpScheduled) return;
    state.pumpScheduled = true;
    queueMicrotask(pump);
  }

  function enqueue(jobInput = {}) {
    if (!isNonEmptyString(jobInput.jobId)) throw new Error('jobId must be a non-empty string');
    if (state.jobs.has(jobInput.jobId)) throw new Error(`duplicate job ${jobInput.jobId}`);
    if (typeof jobInput.execute !== 'function') throw new Error('job execute must be a function');
    if (jobInput.metadata != null && !isPlainObject(jobInput.metadata)) {
      throw new Error('job metadata must be an object');
    }
    const job = {
      jobId: jobInput.jobId,
      execute: jobInput.execute,
      metadata: clone(jobInput.metadata || {}),
      status: 'pending',
      queuedAtMs: now(),
      startedAtMs: null,
      completedAtMs: null,
      schedulerRevision: null,
      outputPresent: false,
      failure: null,
      cancellation: null,
      progress: [],
      completion: createDeferred(),
    };
    state.jobs.set(job.jobId, job);
    state.pendingJobs.push(job);

    const handle = Object.freeze({
      jobId: job.jobId,
      completion: job.completion.promise,
      cancel(reason = 'cancelled') {
        const normalizedReason = isNonEmptyString(reason) ? reason : 'cancelled';
        if (job.status === 'running') {
          return cancellationReceipt(job, 'not-cancelled-active', normalizedReason);
        }
        if (job.status !== 'pending') {
          return cancellationReceipt(job, 'not-cancelled-terminal', normalizedReason);
        }
        const pendingIndex = state.pendingJobs.indexOf(job);
        if (pendingIndex === -1) {
          return cancellationReceipt(job, 'not-cancelled-active', normalizedReason);
        }
        state.pendingJobs.splice(pendingIndex, 1);
        const cancellation = cancellationReceipt(job, 'cancelled-before-start', normalizedReason);
        terminalCompletion(job, {
          status: 'cancelled-before-start',
          outputPresent: false,
          cancellation,
        });
        settleDrainWaiters();
        return cancellation;
      },
    });
    schedulePump();
    return handle;
  }

  function scheduleSchedulerDecision(decision) {
    if (!isPlainObject(decision)) throw new Error('scheduler decision must be an object');
    const deferredDecision = createDeferred();
    const control = {
      sequence: state.decisionSequence + 1,
      status: 'pending',
      decision: deepFreeze(clone(decision)),
      queuedAtMs: now(),
      completedAtMs: null,
      application: null,
      failure: null,
      deferred: deferredDecision,
    };
    state.decisionSequence = control.sequence;
    state.decisions.push(control);
    state.pendingDecisions.push(control);
    schedulePump();
    return deferredDecision.promise;
  }

  function drain() {
    if (isIdle()) return Promise.resolve(snapshot());
    return new Promise(resolve => state.drainWaiters.add(resolve));
  }

  function forgetJob(jobId) {
    const job = state.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'pending' || job.status === 'running') {
      throw new Error('cannot forget an active or pending job');
    }
    state.jobs.delete(jobId);
    return true;
  }

  return Object.freeze({
    enqueue,
    scheduleSchedulerDecision,
    drain,
    snapshot,
    forgetJob,
  });
}
