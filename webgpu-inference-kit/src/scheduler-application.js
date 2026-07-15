import {
  FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
} from './foreground-budget-governor.js';

export const WEBGPU_SCHEDULER_APPLICATION_SCHEMA = 'kaminos.webgpu-scheduler-application.v0';
export const WEBGPU_SCHEDULER_INVOCATION_SCHEMA = 'kaminos.webgpu-scheduler-invocation.v0';
export const WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA = 'kaminos.webgpu-scheduler-decision-application.v0';

const SCHEDULER_KEYS = ['mode', 'phaseChunkSize', 'waitForSubmittedWorkDone', 'yieldMs'];

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

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function validateRange(range, name, { integer = false, multiplicative = false } = {}) {
  if (!isPlainObject(range)) throw new Error(`${name} must be a caller-declared bounds object`);
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min < 0 || range.max < range.min) {
    throw new Error(`${name} must declare ordered finite non-negative min and max bounds`);
  }
  if (integer && (!Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 1)) {
    throw new Error(`${name} min and max must be positive integers`);
  }
  if (multiplicative) {
    if (!Number.isFinite(range.stepFactor) || range.stepFactor <= 1) {
      throw new Error(`${name}.stepFactor must be greater than 1`);
    }
  } else if (!Number.isFinite(range.step) || range.step <= 0) {
    throw new Error(`${name}.step must be greater than 0`);
  }
}

function validateScheduler(scheduler, bounds, label) {
  if (!isPlainObject(scheduler)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(scheduler).sort();
  if (!sameValue(keys, SCHEDULER_KEYS)) {
    throw new Error(`${label} must contain only mode, yieldMs, waitForSubmittedWorkDone, and phaseChunkSize`);
  }
  if (scheduler.mode !== 'cooperative') throw new Error(`${label}.mode must be cooperative`);
  if (!Number.isFinite(scheduler.yieldMs) || scheduler.yieldMs < 0) {
    throw new Error(`${label}.yieldMs must be finite and non-negative`);
  }
  if (typeof scheduler.waitForSubmittedWorkDone !== 'boolean') {
    throw new Error(`${label}.waitForSubmittedWorkDone must be a boolean`);
  }
  if (!isPlainObject(scheduler.phaseChunkSize)) throw new Error(`${label}.phaseChunkSize must be an object`);
  const declaredControls = Object.keys(bounds.phaseChunkSize).sort();
  const effectiveControls = Object.keys(scheduler.phaseChunkSize).sort();
  for (const controlId of effectiveControls) {
    if (!Object.hasOwn(bounds.phaseChunkSize, controlId)) {
      throw new Error(`${label} contains undeclared scheduler control ${controlId}`);
    }
  }
  for (const controlId of declaredControls) {
    if (!Object.hasOwn(scheduler.phaseChunkSize, controlId)) {
      throw new Error(`${label} is missing declared scheduler control ${controlId}`);
    }
    const value = scheduler.phaseChunkSize[controlId];
    const range = bounds.phaseChunkSize[controlId];
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      throw new Error(`${label}.phaseChunkSize.${controlId} is outside its caller-declared bounds`);
    }
  }
  if (scheduler.yieldMs < bounds.yieldMs.min || scheduler.yieldMs > bounds.yieldMs.max) {
    throw new Error(`${label}.yieldMs is outside its caller-declared bounds`);
  }
}

function normalizeBounds(input) {
  if (!isPlainObject(input)) throw new Error('bounds must be a caller-declared bounds object');
  validateRange(input.yieldMs, 'bounds.yieldMs');
  if (!isPlainObject(input.phaseChunkSize)) {
    throw new Error('bounds.phaseChunkSize must be a caller-declared bounds object');
  }
  for (const [controlId, range] of Object.entries(input.phaseChunkSize)) {
    if (!isNonEmptyString(controlId)) throw new Error('scheduler control ids must be non-empty strings');
    validateRange(range, `bounds.phaseChunkSize.${controlId}`, { integer: true, multiplicative: true });
  }
  return clone(input);
}

function validateDecisionTransition(decision, scheduler) {
  if (decision.action === 'increase-yield-budget') {
    if (decision.target !== 'yieldMs' || decision.effectiveScheduler.yieldMs <= scheduler.yieldMs) {
      throw new Error('increase-yield-budget decision must increase target yieldMs');
    }
  } else if (decision.action === 'reduce-yield-budget') {
    if (decision.target !== 'yieldMs' || decision.effectiveScheduler.yieldMs >= scheduler.yieldMs) {
      throw new Error('reduce-yield-budget decision must reduce target yieldMs');
    }
  } else if (decision.action === 'reduce-phase-chunk') {
    if (!Object.hasOwn(scheduler.phaseChunkSize, decision.target)
      || decision.effectiveScheduler.phaseChunkSize[decision.target] >= scheduler.phaseChunkSize[decision.target]) {
      throw new Error('reduce-phase-chunk decision must reduce its declared target control');
    }
  } else if (decision.action === 'relax-phase-chunk') {
    if (!Object.hasOwn(scheduler.phaseChunkSize, decision.target)
      || decision.effectiveScheduler.phaseChunkSize[decision.target] <= scheduler.phaseChunkSize[decision.target]) {
      throw new Error('relax-phase-chunk decision must increase its declared target control');
    }
  } else {
    throw new Error(`decision action ${decision.action || '<missing>'} does not authorize a scheduler change`);
  }

  if (decision.effectiveScheduler.mode !== scheduler.mode
    || decision.effectiveScheduler.waitForSubmittedWorkDone !== scheduler.waitForSubmittedWorkDone) {
    throw new Error('decision cannot mutate undeclared scheduler posture fields');
  }
  const changedControls = Object.keys(scheduler.phaseChunkSize)
    .filter(controlId => decision.effectiveScheduler.phaseChunkSize[controlId] !== scheduler.phaseChunkSize[controlId]);
  const yieldChanged = decision.effectiveScheduler.yieldMs !== scheduler.yieldMs;
  if (decision.target === 'yieldMs') {
    if (!yieldChanged || changedControls.length > 0) {
      throw new Error('yield decision must change only yieldMs');
    }
  } else if (yieldChanged || changedControls.length !== 1 || changedControls[0] !== decision.target) {
    throw new Error('phase decision must change only its declared target control');
  }
}

export function createWebGpuSchedulerApplication(input = {}) {
  if (!isNonEmptyString(input.routeId)) throw new Error('routeId must be a non-empty string');
  const revision = input.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) throw new Error('revision must be a non-negative integer');
  const bounds = normalizeBounds(input.bounds);
  validateScheduler(input.scheduler, bounds, 'scheduler');

  const state = {
    routeId: input.routeId,
    revision,
    scheduler: clone(input.scheduler),
    bounds,
    activeInvocations: new Set(),
    activeInvocationIds: new Set(),
  };

  function snapshot() {
    return {
      schema: WEBGPU_SCHEDULER_APPLICATION_SCHEMA,
      routeId: state.routeId,
      revision: state.revision,
      scheduler: clone(state.scheduler),
      bounds: clone(state.bounds),
      activeInvocationCount: state.activeInvocations.size,
      applicationAuthority: 'subsequent-invocations-only-no-submitted-work-preemption',
    };
  }

  function beginInvocation(invocationInput = {}) {
    if (!isNonEmptyString(invocationInput.invocationId)) {
      throw new Error('invocationId must be a non-empty caller-owned identity');
    }
    if (state.activeInvocationIds.has(invocationInput.invocationId)) {
      throw new Error(`invocationId ${invocationInput.invocationId} is already active`);
    }
    const scheduler = deepFreeze(clone(state.scheduler));
    const invocation = {
      schema: WEBGPU_SCHEDULER_INVOCATION_SCHEMA,
      routeId: state.routeId,
      invocationId: invocationInput.invocationId,
      schedulerRevision: state.revision,
      scheduler,
      bounds: deepFreeze(clone(state.bounds)),
      applicationAuthority: 'frozen-future-invocation-snapshot',
      getControl(controlId) {
        if (!isNonEmptyString(controlId) || !Object.hasOwn(scheduler.phaseChunkSize, controlId)) {
          throw new Error(`undeclared scheduler control ${controlId || '<missing>'}`);
        }
        return scheduler.phaseChunkSize[controlId];
      },
    };
    state.activeInvocations.add(invocation);
    state.activeInvocationIds.add(invocation.invocationId);
    return invocation;
  }

  function endInvocation(invocation) {
    if (!state.activeInvocations.has(invocation)) {
      throw new Error('unknown invocation or invocation already ended');
    }
    state.activeInvocations.delete(invocation);
    state.activeInvocationIds.delete(invocation.invocationId);
    return {
      invocationId: invocation.invocationId,
      schedulerRevision: invocation.schedulerRevision,
      activeInvocationCount: state.activeInvocations.size,
    };
  }

  function applyDecision(decision) {
    if (state.activeInvocations.size > 0) {
      throw new Error(`active invocation count ${state.activeInvocations.size}; cannot apply scheduler decision`);
    }
    if (!isPlainObject(decision) || decision.schema !== FOREGROUND_BUDGET_GOVERNOR_SCHEMA) {
      throw new Error('decision must be a foreground budget governor decision');
    }
    if (decision.routeId !== state.routeId) throw new Error('decision route mismatch');
    if (decision.applicationAuthority !== 'decision-state-only-not-runtime-application') {
      throw new Error('decision application authority is invalid');
    }
    if (decision.schedulerChanged !== true || !['adjusted', 'relaxed'].includes(decision.status)) {
      throw new Error('decision does not authorize a scheduler change');
    }
    if (!Array.isArray(decision.failures) || decision.failures.length > 0) {
      throw new Error('decision with failures cannot be applied');
    }
    if (!Number.isInteger(decision.revision) || decision.revision < 1) {
      throw new Error('decision revision must be a positive integer');
    }
    if (decision.revision <= state.revision) throw new Error('replayed or stale revision cannot be applied');
    if (decision.revision !== state.revision + 1) throw new Error('decision must be the next revision');
    if (!sameValue(decision.previousScheduler, state.scheduler)) {
      throw new Error('decision previous scheduler mismatch');
    }
    validateScheduler(decision.effectiveScheduler, state.bounds, 'decision effective scheduler');
    validateDecisionTransition(decision, state.scheduler);

    const previousScheduler = clone(state.scheduler);
    const previousRevision = state.revision;
    state.scheduler = clone(decision.effectiveScheduler);
    state.revision = decision.revision;
    return {
      schema: WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA,
      status: 'applied',
      routeId: state.routeId,
      decisionRevision: decision.revision,
      previousRevision,
      effectiveRevision: state.revision,
      action: decision.action,
      target: decision.target,
      previousScheduler,
      effectiveScheduler: clone(state.scheduler),
      applicationAuthority: 'subsequent-invocations-only',
    };
  }

  return {
    snapshot,
    beginInvocation,
    endInvocation,
    applyDecision,
  };
}
