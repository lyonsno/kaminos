export const WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-planner.v0';
export const WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-range.v0';
export const WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-observation.v0';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requirePositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
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

function normalizeInput(input) {
  if (!isPlainObject(input)) throw new Error('adaptive command duty planner input must be an object');
  if (!isNonEmptyString(input.plannerId)) throw new Error('plannerId must be a non-empty string');
  if (!isNonEmptyString(input.unit)) throw new Error('unit must be a non-empty string');
  requirePositiveSafeInteger(input.totalItems, 'totalItems');
  requirePositiveSafeInteger(input.initialChunkItems, 'initialChunkItems');
  if (!Number.isFinite(input.targetDurationMs) || input.targetDurationMs <= 0) {
    throw new Error('targetDurationMs must be finite and greater than zero');
  }
  if (!isPlainObject(input.bounds)) throw new Error('bounds must be a caller-declared object');
  const { minChunkItems, maxChunkItems } = input.bounds;
  requirePositiveSafeInteger(minChunkItems, 'bounds.minChunkItems');
  requirePositiveSafeInteger(maxChunkItems, 'bounds.maxChunkItems');
  if (maxChunkItems < minChunkItems) {
    throw new Error('bounds.maxChunkItems must be greater than or equal to bounds.minChunkItems');
  }
  if (input.initialChunkItems < minChunkItems || input.initialChunkItems > maxChunkItems) {
    throw new Error('initialChunkItems must be within caller-declared bounds');
  }
  if (input.metadata != null && !isPlainObject(input.metadata)) {
    throw new Error('metadata must be an object when provided');
  }
  if (input.retention != null && input.retention !== 'uncapped') {
    throw new Error('adaptive command duty history retention is uncapped');
  }
  return {
    plannerId: input.plannerId,
    unit: input.unit,
    totalItems: input.totalItems,
    initialChunkItems: input.initialChunkItems,
    targetDurationMs: input.targetDurationMs,
    bounds: { minChunkItems, maxChunkItems },
    metadata: clone(input.metadata || {}),
  };
}

function nextChunkFromObservation({ range, observedDurationMs, targetDurationMs, bounds }) {
  let rawChunkItems;
  if (observedDurationMs === 0) {
    rawChunkItems = Number.POSITIVE_INFINITY;
  } else {
    rawChunkItems = range.itemCount * targetDurationMs / observedDurationMs;
  }

  let nextChunkItems;
  let boundApplication = null;
  if (rawChunkItems < bounds.minChunkItems) {
    nextChunkItems = bounds.minChunkItems;
    boundApplication = 'minChunkItems';
  } else if (rawChunkItems > bounds.maxChunkItems) {
    nextChunkItems = bounds.maxChunkItems;
    boundApplication = 'maxChunkItems';
  } else {
    nextChunkItems = Math.max(bounds.minChunkItems, Math.min(bounds.maxChunkItems, Math.round(rawChunkItems)));
  }

  return {
    rawChunkItems: Number.isFinite(rawChunkItems) ? rawChunkItems : null,
    nextChunkItems,
    boundApplication,
    adjustment: nextChunkItems < range.plannedChunkItems
      ? 'decrease'
      : nextChunkItems > range.plannedChunkItems
        ? 'increase'
        : 'maintain',
  };
}

export function createWebGpuAdaptiveCommandDutyPlanner(input = {}) {
  const config = normalizeInput(input);
  const state = {
    status: 'active',
    completedItems: 0,
    currentChunkItems: config.initialChunkItems,
    pendingRange: null,
    ranges: [],
    observations: [],
    failure: null,
  };

  function snapshot() {
    return clone({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
      plannerId: config.plannerId,
      unit: config.unit,
      status: state.status,
      totalItems: config.totalItems,
      completedItems: state.completedItems,
      progress: state.completedItems / config.totalItems,
      initialChunkItems: config.initialChunkItems,
      currentChunkItems: state.currentChunkItems,
      targetDurationMs: config.targetDurationMs,
      bounds: config.bounds,
      metadata: config.metadata,
      retention: 'uncapped',
      pendingRangeId: state.pendingRange?.rangeId || null,
      rangeCount: state.ranges.length,
      actualRangeCount: state.status === 'complete' ? state.ranges.length : null,
      rangeCountAuthority: state.status === 'complete' ? 'actual' : 'open-until-completion',
      ranges: state.ranges,
      observations: state.observations,
      failure: state.failure,
    });
  }

  function nextRange() {
    if (state.status === 'failed') throw new Error('failed planner cannot produce another range');
    if (state.status === 'complete') return null;
    if (state.pendingRange) throw new Error(`pending range ${state.pendingRange.rangeId} must be observed or failed first`);

    const itemStart = state.completedItems;
    const itemCount = Math.min(state.currentChunkItems, config.totalItems - itemStart);
    const itemEnd = itemStart + itemCount;
    const rangeIndex = state.ranges.length;
    const range = deepFreeze({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA,
      plannerId: config.plannerId,
      rangeId: `${config.plannerId}:${rangeIndex}`,
      rangeIndex,
      rangeTotal: null,
      rangeCountAuthority: 'actual-after-completion',
      unit: config.unit,
      itemStart,
      itemEnd,
      itemCount,
      totalItems: config.totalItems,
      completedItemsBefore: itemStart,
      completedItemsAfter: itemEnd,
      progressBefore: itemStart / config.totalItems,
      progressAfter: itemEnd / config.totalItems,
      plannedChunkItems: state.currentChunkItems,
      targetDurationMs: config.targetDurationMs,
      bounds: clone(config.bounds),
      metadata: clone(config.metadata),
    });
    state.pendingRange = range;
    state.ranges.push({ ...clone(range), status: 'pending-observation' });
    return range;
  }

  function requirePendingRange(rangeId) {
    if (!state.pendingRange) throw new Error('adaptive command duty planner has no pending range');
    if (rangeId !== state.pendingRange.rangeId) {
      throw new Error(`rangeId ${rangeId || '<missing>'} does not match pending range ${state.pendingRange.rangeId}`);
    }
    return state.pendingRange;
  }

  function observeRange(observation = {}) {
    if (state.status !== 'active') throw new Error(`${state.status} planner cannot accept range observations`);
    if (!isPlainObject(observation)) throw new Error('range observation must be an object');
    const range = requirePendingRange(observation.rangeId);
    if (observation.timingAuthority !== 'queue-work-done') {
      throw new Error('timingAuthority must be queue-work-done');
    }
    if (!Number.isFinite(observation.observedDurationMs) || observation.observedDurationMs < 0) {
      throw new Error('observedDurationMs must be finite and non-negative');
    }

    state.completedItems = range.itemEnd;
    const complete = state.completedItems === config.totalItems;
    const adjustment = complete
      ? {
          rawChunkItems: null,
          nextChunkItems: null,
          boundApplication: null,
          adjustment: 'complete',
        }
      : nextChunkFromObservation({
          range,
          observedDurationMs: observation.observedDurationMs,
          targetDurationMs: config.targetDurationMs,
          bounds: config.bounds,
        });
    if (!complete) state.currentChunkItems = adjustment.nextChunkItems;
    state.status = complete ? 'complete' : 'active';
    state.pendingRange = null;

    const receipt = deepFreeze({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA,
      plannerId: config.plannerId,
      status: complete ? 'planner-complete' : 'range-observed',
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      timingAuthority: observation.timingAuthority,
      observedDurationMs: observation.observedDurationMs,
      targetDurationMs: config.targetDurationMs,
      observedChunkItems: range.itemCount,
      rawNextChunkItems: adjustment.rawChunkItems,
      nextChunkItems: adjustment.nextChunkItems,
      adjustment: adjustment.adjustment,
      boundApplication: adjustment.boundApplication,
      completedItems: state.completedItems,
      totalItems: config.totalItems,
      progress: state.completedItems / config.totalItems,
      actualRangeCount: complete ? state.ranges.length : null,
      rangeCountAuthority: complete ? 'actual' : 'open-until-completion',
      metadata: clone(config.metadata),
    });
    state.ranges[range.rangeIndex] = {
      ...state.ranges[range.rangeIndex],
      status: 'observed',
      observedDurationMs: observation.observedDurationMs,
      timingAuthority: observation.timingAuthority,
    };
    state.observations.push(clone(receipt));
    return receipt;
  }

  function failRange(failureInput = {}) {
    if (state.status !== 'active') throw new Error(`${state.status} planner cannot fail a range`);
    if (!isPlainObject(failureInput)) throw new Error('range failure must be an object');
    const range = requirePendingRange(failureInput.rangeId);
    if (!isNonEmptyString(failureInput.phase)) throw new Error('range failure phase must be a non-empty string');
    const failure = deepFreeze({
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      phase: failureInput.phase,
      error: normalizeError(failureInput.error),
    });
    state.status = 'failed';
    state.failure = clone(failure);
    state.pendingRange = null;
    state.ranges[range.rangeIndex] = {
      ...state.ranges[range.rangeIndex],
      status: 'failed',
      failure: clone(failure),
    };
    return deepFreeze({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA,
      plannerId: config.plannerId,
      status: 'failed',
      completedItems: state.completedItems,
      totalItems: config.totalItems,
      rangeCountAuthority: 'open-at-failure',
      actualRangeCount: null,
      failure,
      metadata: clone(config.metadata),
    });
  }

  return Object.freeze({
    schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
    plannerId: config.plannerId,
    unit: config.unit,
    nextRange,
    observeRange,
    failRange,
    snapshot,
  });
}
