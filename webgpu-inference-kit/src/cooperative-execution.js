import { createWebGpuAdaptiveCommandDutyPlanner } from './adaptive-command-duty.js';
import { WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA } from './cooperative-boundary-manifest.js';

export const WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA =
  'kaminos.webgpu-cooperative-execution-report.v0';
export const WEBGPU_COOPERATIVE_PROGRESS_SCHEMA =
  'kaminos.webgpu-cooperative-progress.v0';
export const WEBGPU_COOPERATIVE_RANGE_SCHEMA =
  'kaminos.webgpu-cooperative-range.v0';

const SCHEDULING_MODES = new Set(['cooperative', 'disabled']);
const COMPLETION_POLICIES = new Set(['strict-prefix', 'bounded-prefix']);

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

function requirePositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function readNow(now) {
  const value = now();
  if (!Number.isFinite(value)) throw new TypeError('cooperative execution clock returned a non-finite value');
  return value;
}

function createAbortError(signal) {
  const reason = signal?.reason;
  const error = new Error(
    isNonEmptyString(reason?.message)
      ? reason.message
      : isNonEmptyString(reason)
        ? reason
        : 'cooperative execution was cancelled',
  );
  error.name = 'AbortError';
  return error;
}

function createFixedRangePlanner({
  plannerId,
  unit,
  totalItems,
  chunkItems,
  metadata,
  maxPendingRanges = 1,
}) {
  const ranges = [];
  let status = 'active';
  let issuedItems = 0;
  let completedItems = 0;
  let pendingRanges = [];
  let failure = null;

  function snapshot() {
    return clone({
      status,
      plannerId,
      unit,
      totalItems,
      issuedItems,
      completedItems,
      progress: completedItems / totalItems,
      maxPendingRanges,
      pendingRangeId: pendingRanges[0]?.rangeId || null,
      pendingRangeIds: pendingRanges.map(range => range.rangeId),
      pendingRangeCount: pendingRanges.length,
      rangeCount: ranges.length,
      actualRangeCount: status === 'complete' ? ranges.length : null,
      rangeCountAuthority: status === 'complete' ? 'actual' : 'open-until-completion',
      ranges,
      failure,
    });
  }

  return Object.freeze({
    nextRange() {
      if (status === 'failed') throw new Error('failed planner cannot produce another range');
      if (status === 'complete') return null;
      if (pendingRanges.length >= maxPendingRanges) {
        throw new Error(
          `pending range capacity ${maxPendingRanges} must retire before another range is issued`,
        );
      }
      if (issuedItems === totalItems) return null;
      const itemStart = issuedItems;
      const itemCount = Math.min(chunkItems, totalItems - itemStart);
      const rangeIndex = ranges.length;
      const pendingRange = deepFreeze({
        schema: WEBGPU_COOPERATIVE_RANGE_SCHEMA,
        plannerId,
        rangeId: `${plannerId}:${rangeIndex}`,
        rangeIndex,
        rangeTotal: null,
        rangeCountAuthority: 'actual-after-completion',
        unit,
        itemStart,
        itemEnd: itemStart + itemCount,
        itemCount,
        totalItems,
        completedItemsBefore: itemStart,
        completedItemsAfter: itemStart + itemCount,
        progressBefore: itemStart / totalItems,
        progressAfter: (itemStart + itemCount) / totalItems,
        plannedChunkItems: chunkItems,
        metadata: clone(metadata),
      });
      issuedItems = pendingRange.itemEnd;
      pendingRanges.push(pendingRange);
      ranges.push({ ...clone(pendingRange), status: 'pending-completion' });
      return pendingRange;
    },

    completeRange(rangeId, detail = {}) {
      if (status !== 'active' || pendingRanges.length === 0) {
        throw new Error('planner has no active range to complete');
      }
      const range = pendingRanges[0];
      if (range.rangeId !== rangeId) {
        throw new Error('range does not match the oldest pending planner range');
      }
      completedItems = range.itemEnd;
      status = completedItems === totalItems ? 'complete' : 'active';
      pendingRanges.shift();
      ranges[range.rangeIndex] = {
        ...ranges[range.rangeIndex],
        ...clone(detail),
        status: 'completed',
      };
      return snapshot();
    },

    failRange(rangeId, phase, error) {
      if (status !== 'active' || pendingRanges.length === 0) return snapshot();
      const pendingRange = pendingRanges.find(range => range.rangeId === rangeId);
      if (!pendingRange) throw new Error('range does not match a pending planner range');
      failure = {
        rangeId,
        rangeIndex: pendingRange.rangeIndex,
        phase,
        error: normalizeError(error),
      };
      ranges[pendingRange.rangeIndex] = {
        ...ranges[pendingRange.rangeIndex],
        status: 'failed',
        failure: clone(failure),
      };
      pendingRanges = [];
      status = 'failed';
      return snapshot();
    },

    snapshot,
  });
}

function decorateError(error, report) {
  const decorated = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(decorated, 'cooperativeExecutionReport', {
      value: report,
      configurable: true,
      enumerable: false,
    });
  } catch {
    decorated.cooperativeExecutionReport = report;
  }
  return decorated;
}

export function createWebGpuCooperativeExecution(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('cooperative execution input must be an object');
  const runtime = input.runtime;
  const manifest = input.manifest;
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be an object');
  if (manifest?.schema !== WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA) {
    throw new TypeError('a cooperative boundary manifest is required');
  }
  if (runtime.routeId !== manifest.routeId) throw new Error('cooperative execution runtime route mismatch');
  if (typeof runtime.runInvocation !== 'function') {
    throw new TypeError('runtime.runInvocation must be available');
  }
  if (!runtime.queue || typeof runtime.queue !== 'object') {
    throw new TypeError('runtime.queue must be available');
  }
  if (!isNonEmptyString(input.invocationId)) {
    throw new TypeError('invocationId must be a non-empty caller-owned identity');
  }
  const schedulingMode = input.schedulingMode || 'cooperative';
  if (!SCHEDULING_MODES.has(schedulingMode)) {
    throw new TypeError('schedulingMode must be cooperative or disabled');
  }
  const completionPolicy = input.completionPolicy || 'strict-prefix';
  if (!COMPLETION_POLICIES.has(completionPolicy)) {
    throw new TypeError('completionPolicy must be strict-prefix or bounded-prefix');
  }
  if (completionPolicy === 'bounded-prefix' && schedulingMode !== 'cooperative') {
    throw new TypeError('bounded-prefix completion requires cooperative scheduling');
  }
  if (completionPolicy === 'bounded-prefix') {
    requirePositiveSafeInteger('maxInFlightGpuDuties', input.maxInFlightGpuDuties);
    const adaptiveGpuBoundary = manifest.phases
      .flatMap(phase => phase.boundaries)
      .find(boundary => boundary.kind === 'gpu-command' && boundary.chunking.mode === 'adaptive');
    if (adaptiveGpuBoundary) {
      throw new TypeError(
        `bounded-prefix completion supports fixed GPU boundaries only; ${adaptiveGpuBoundary.boundaryId} is adaptive`,
      );
    }
  } else if (input.maxInFlightGpuDuties != null) {
    throw new TypeError('maxInFlightGpuDuties is available only with bounded-prefix completion');
  }
  const maxInFlightGpuDuties = completionPolicy === 'bounded-prefix'
    ? input.maxInFlightGpuDuties
    : 1;
  if (input.onProgress != null && typeof input.onProgress !== 'function') {
    throw new TypeError('onProgress must be a function when provided');
  }
  if (input.now != null && typeof input.now !== 'function') {
    throw new TypeError('now must be a function when provided');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const signal = input.signal || null;
  if (signal != null && typeof signal.aborted !== 'boolean') {
    throw new TypeError('signal must be an AbortSignal when provided');
  }

  const definitions = new Map();
  const boundaryStates = new Map();
  for (const phase of manifest.phases) {
    for (const boundary of phase.boundaries) {
      definitions.set(boundary.boundaryId, { phase, boundary });
      boundaryStates.set(boundary.boundaryId, {
        phaseId: phase.phaseId,
        boundaryId: boundary.boundaryId,
        kind: boundary.kind,
        unit: boundary.unit,
        status: 'pending',
        totalItems: boundary.totalItems,
        completedItems: 0,
        progressWeight: boundary.progressWeight,
        planner: null,
        controller: null,
        ranges: [],
        failure: null,
      });
    }
  }

  const state = {
    status: 'pending',
    startedAtMs: null,
    endedAtMs: null,
    failure: null,
    currentPhaseId: null,
    currentBoundaryId: null,
    schedulerRevision: null,
    invocationScheduler: null,
    runCalled: false,
    terminalQueueFenceObserved: false,
    submittedGpuDutyCount: 0,
    observedPrefixFenceCount: 0,
    unfencedSubmittedGpuDutyCount: 0,
    gpuDuties: [],
    inFlightGpuDuties: [],
    maxObservedInFlightGpuDuties: 0,
  };

  function checkCancellation() {
    if (signal?.aborted) throw createAbortError(signal);
  }

  function boundaryProgress(boundaryState) {
    if (boundaryState.totalItems == null) return null;
    return boundaryState.completedItems / boundaryState.totalItems;
  }

  function createProgress() {
    const phases = manifest.phases.map(phase => {
      const states = phase.boundaries.map(boundary => boundaryStates.get(boundary.boundaryId));
      const allTotalsKnown = states.every(boundary => boundary.totalItems != null);
      const totalItems = allTotalsKnown
        ? states.reduce((sum, boundary) => sum + boundary.totalItems, 0)
        : null;
      const completedItems = states.reduce((sum, boundary) => sum + boundary.completedItems, 0);
      const completedWeight = allTotalsKnown
        ? states.reduce(
            (sum, boundary) => sum + boundary.progressWeight * boundaryProgress(boundary),
            0,
          )
        : null;
      const progress = completedWeight == null ? null : completedWeight / phase.progressWeight;
      const statuses = new Set(states.map(boundary => boundary.status));
      const phaseStatus = statuses.has('failed')
        ? 'failed'
        : statuses.has('cancelled')
          ? 'cancelled'
          : states.every(boundary => boundary.status === 'complete')
            ? 'complete'
            : states.some(boundary => boundary.status === 'active')
              ? 'active'
              : 'pending';
      return {
        phaseId: phase.phaseId,
        status: phaseStatus,
        completedItems,
        totalItems,
        progress,
        percent: progress == null ? null : progress * 100,
        completedWeight,
        totalWeight: phase.progressWeight,
      };
    });
    const allTotalsKnown = [...boundaryStates.values()].every(boundary => boundary.totalItems != null);
    const completedItems = [...boundaryStates.values()]
      .reduce((sum, boundary) => sum + boundary.completedItems, 0);
    const totalItems = allTotalsKnown
      ? [...boundaryStates.values()].reduce((sum, boundary) => sum + boundary.totalItems, 0)
      : null;
    const completedWeight = allTotalsKnown
      ? [...boundaryStates.values()].reduce(
          (sum, boundary) => sum + boundary.progressWeight * boundaryProgress(boundary),
          0,
        )
      : null;
    const progress = completedWeight == null ? null : completedWeight / manifest.progressWeight;
    return deepFreeze({
      schema: WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
      routeId: manifest.routeId,
      invocationId: input.invocationId,
      status: state.status,
      completedItems,
      totalItems,
      progress,
      percent: progress == null ? null : progress * 100,
      completedWeight,
      totalWeight: manifest.progressWeight,
      currentPhaseId: state.currentPhaseId,
      currentBoundaryId: state.currentBoundaryId,
      phases,
    });
  }

  function emitProgress(boundaryState) {
    const progress = createProgress();
    if (input.onProgress) {
      try {
        input.onProgress(progress);
      } catch (error) {
        throw failExecution(error, 'progress-callback', boundaryState);
      }
    }
    return progress;
  }

  function createReport() {
    const gpuBoundaryCount = [...definitions.values()]
      .filter(definition => definition.boundary.kind === 'gpu-command').length;
    const queueCompletionAuthority = gpuBoundaryCount === 0
      ? 'not-applicable'
      : state.submittedGpuDutyCount === 0
        ? 'no-gpu-duty-submitted'
        : state.unfencedSubmittedGpuDutyCount > 0
          ? 'incomplete-prefix-fence-authority'
          : schedulingMode === 'cooperative'
        ? completionPolicy === 'bounded-prefix'
          ? 'bounded-per-gpu-duty-prefix-fence'
          : 'per-gpu-duty-prefix-fence'
        : state.terminalQueueFenceObserved
          ? 'one-terminal-prefix-fence'
          : state.observedPrefixFenceCount === state.submittedGpuDutyCount
            ? 'exceptional-per-duty-prefix-fence'
            : 'terminal-prefix-fence-pending';
    return deepFreeze({
      schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
      status: state.status,
      routeId: manifest.routeId,
      manifestId: manifest.manifestId,
      invocationId: input.invocationId,
      schedulingMode,
      completionPolicy,
      maxInFlightGpuDuties,
      maxObservedInFlightGpuDuties: state.maxObservedInFlightGpuDuties,
      issuedGpuDutyCount: state.gpuDuties.length,
      retiredGpuDutyCount: state.gpuDuties.filter(duty => duty.status === 'retired').length,
      inFlightGpuDutyCount: state.inFlightGpuDuties.length,
      inFlightGpuDutyIds: state.inFlightGpuDuties.map(entry => entry.dutyId),
      gpuDuties: clone(state.gpuDuties),
      schedulerRevision: state.schedulerRevision,
      invocationScheduler: clone(state.invocationScheduler),
      queueCompletionAuthority,
      submittedGpuDutyCount: state.submittedGpuDutyCount,
      observedPrefixFenceCount: state.observedPrefixFenceCount,
      unfencedSubmittedGpuDutyCount: state.unfencedSubmittedGpuDutyCount,
      retention: 'uncapped',
      startedAtMs: state.startedAtMs,
      endedAtMs: state.endedAtMs,
      durationMs: state.startedAtMs == null || state.endedAtMs == null
        ? null
        : state.endedAtMs - state.startedAtMs,
      progress: createProgress(),
      boundaries: manifest.phases.flatMap(phase => phase.boundaries.map(boundary => {
        const boundaryState = boundaryStates.get(boundary.boundaryId);
        const plannerSnapshot = boundaryState.planner?.snapshot() || null;
        return {
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          kind: boundary.kind,
          unit: boundary.unit,
          status: boundaryState.status,
          completedItems: boundaryState.completedItems,
          totalItems: boundaryState.totalItems,
          progress: boundaryProgress(boundaryState),
          progressWeight: boundary.progressWeight,
          rangeCount: boundaryState.ranges.length,
          actualRangeCount: boundaryState.status === 'complete'
            ? boundaryState.ranges.length
            : null,
          rangeCountAuthority: boundaryState.status === 'complete'
            ? 'actual'
            : 'open-until-completion',
          ranges: clone(boundaryState.ranges),
          planner: clone(plannerSnapshot),
          resources: clone(boundary.resources),
          failure: clone(boundaryState.failure),
        };
      })),
      runtimeTelemetry: {
        commandDuties: runtime.commandDuties?.snapshot?.() || null,
        hostPhases: runtime.hostPhases?.snapshot?.() || null,
      },
      failure: clone(state.failure),
      lastTrustworthyBoundary: clone(
        [...boundaryStates.values()].findLast(boundary => boundary.ranges.length > 0) || null,
      ),
    });
  }

  function failExecution(error, phase, boundaryState = null, diagnostics = {}) {
    const cancelled = error?.name === 'AbortError';
    const status = cancelled ? 'cancelled' : 'failed';
    const secondaryFailures = clone(diagnostics.secondaryFailures || []);
    if (boundaryState) {
      boundaryState.status = status;
      boundaryState.failure = {
        phase: cancelled ? 'cancellation' : phase,
        error: normalizeError(error),
        secondaryFailures,
      };
    }
    state.status = status;
    state.failure = {
      phase: cancelled ? 'cancellation' : phase,
      boundaryId: boundaryState?.boundaryId || null,
      error: normalizeError(error),
      secondaryFailures,
    };
    state.endedAtMs = readNow(now);
    return decorateError(error, createReport());
  }

  function requirePendingRange(boundaryState, range) {
    if (!range || typeof range !== 'object') throw new TypeError('range must be an object');
    const plannerSnapshot = boundaryState.planner?.snapshot();
    const pendingRangeIds = plannerSnapshot?.pendingRangeIds
      || (plannerSnapshot?.pendingRangeId ? [plannerSnapshot.pendingRangeId] : []);
    if (!pendingRangeIds.includes(range.rangeId)) {
      throw new Error(`range ${range.rangeId || '<missing>'} is not pending for ${boundaryState.boundaryId}`);
    }
  }

  function completeFixedRange(boundaryState, range, detail) {
    boundaryState.planner.completeRange(range.rangeId, detail);
    const plannerSnapshot = boundaryState.planner.snapshot();
    boundaryState.completedItems = plannerSnapshot.completedItems;
    boundaryState.ranges = plannerSnapshot.ranges;
    boundaryState.status = plannerSnapshot.status === 'complete' ? 'complete' : 'active';
  }

  function completeAdaptiveRange(boundaryState, range, observedDurationMs) {
    boundaryState.planner.observeRange({
      rangeId: range.rangeId,
      timingAuthority: 'queue-work-done',
      observedDurationMs,
    });
    const plannerSnapshot = boundaryState.planner.snapshot();
    boundaryState.completedItems = plannerSnapshot.completedItems;
    boundaryState.ranges = plannerSnapshot.ranges;
    boundaryState.status = plannerSnapshot.status === 'complete' ? 'complete' : 'active';
  }

  function failRange(boundaryState, range, phase, error) {
    const plannerSnapshot = boundaryState.planner?.snapshot();
    const pendingRangeIds = plannerSnapshot?.pendingRangeIds
      || (plannerSnapshot?.pendingRangeId ? [plannerSnapshot.pendingRangeId] : []);
    if (pendingRangeIds.includes(range?.rangeId)) {
      if (boundaryState.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
        boundaryState.planner.failRange({ rangeId: range.rangeId, phase, error });
      } else {
        boundaryState.planner.failRange(range.rangeId, phase, error);
      }
      boundaryState.ranges = boundaryState.planner.snapshot().ranges;
    }
  }

  function createPlanner(definition, boundaryState, totalItems) {
    const plannerId = `${input.invocationId}:${definition.boundary.boundaryId}:range`;
    if (definition.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
      return createWebGpuAdaptiveCommandDutyPlanner({
        plannerId,
        unit: definition.boundary.unit,
        totalItems,
        initialChunkItems: definition.boundary.chunking.initialItems,
        targetDurationMs: definition.boundary.chunking.targetDurationMs,
        adjustmentGain: definition.boundary.chunking.adjustmentGain,
        bounds: {
          minChunkItems: definition.boundary.chunking.minItems,
          maxChunkItems: definition.boundary.chunking.maxItems,
        },
        metadata: {
          manifestId: manifest.manifestId,
          routeId: manifest.routeId,
          phaseId: definition.phase.phaseId,
          boundaryId: definition.boundary.boundaryId,
        },
      });
    }
    const chunkItems = definition.boundary.chunking.mode === 'adaptive'
      ? definition.boundary.chunking.initialItems
      : definition.boundary.chunking.chunkItems;
    return createFixedRangePlanner({
      plannerId,
      unit: definition.boundary.unit,
      totalItems,
      chunkItems,
      maxPendingRanges: completionPolicy === 'bounded-prefix'
        && definition.boundary.kind === 'gpu-command'
        ? maxInFlightGpuDuties
        : 1,
      metadata: {
        manifestId: manifest.manifestId,
        routeId: manifest.routeId,
        phaseId: definition.phase.phaseId,
        boundaryId: definition.boundary.boundaryId,
      },
    });
  }

  function updateGpuDuty(entry, detail) {
    state.gpuDuties[entry.dutyIndex] = {
      ...state.gpuDuties[entry.dutyIndex],
      ...clone(detail),
    };
  }

  function registerBoundedGpuDuty({
    boundaryId,
    boundaryState,
    range,
    encoded,
    submittedAtMs,
    prefixFence,
  }) {
    const dutyIndex = state.gpuDuties.length;
    const entry = {
      dutyId: range.rangeId,
      dutyIndex,
      boundaryState,
      range,
      encoded,
      submittedAtMs,
      fenceOutcome: Promise.resolve(prefixFence).then(
        () => ({ ok: true, completedAtMs: readNow(now) }),
        error => ({ ok: false, error, completedAtMs: readNow(now) }),
      ),
    };
    state.gpuDuties.push({
      dutyId: entry.dutyId,
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      boundaryId,
      status: 'issued',
      submittedAtMs,
      retiredAtMs: null,
      rawQueueDurationMs: null,
      timingAuthority: 'queue-work-done-prefix-fence-pending',
      failure: null,
    });
    state.inFlightGpuDuties.push(entry);
    state.maxObservedInFlightGpuDuties = Math.max(
      state.maxObservedInFlightGpuDuties,
      state.inFlightGpuDuties.length,
    );
    return entry;
  }

  async function drainGpuDutiesAfterFailure() {
    const secondaryFailures = [];
    while (state.inFlightGpuDuties.length > 0) {
      const entry = state.inFlightGpuDuties[0];
      const outcome = await entry.fenceOutcome;
      state.inFlightGpuDuties.shift();
      if (outcome.ok) {
        updateGpuDuty(entry, {
          status: 'retired-after-failure',
          retiredAtMs: outcome.completedAtMs,
          rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
          timingAuthority: 'queue-work-done',
        });
      } else {
        updateGpuDuty(entry, {
          status: 'failed',
          retiredAtMs: outcome.completedAtMs,
          rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
          timingAuthority: 'queue-work-done-prefix-fence-rejected',
          failure: normalizeError(outcome.error),
        });
        secondaryFailures.push({
          phase: 'queue-completion',
          dutyId: entry.dutyId,
          error: normalizeError(outcome.error),
        });
      }
    }
    return secondaryFailures;
  }

  async function retireOldestGpuDuty() {
    const entry = state.inFlightGpuDuties[0];
    if (!entry) return null;
    const outcome = await entry.fenceOutcome;
    state.inFlightGpuDuties.shift();
    if (!outcome.ok) {
      updateGpuDuty(entry, {
        status: 'failed',
        retiredAtMs: outcome.completedAtMs,
        rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
        timingAuthority: 'queue-work-done-prefix-fence-rejected',
        failure: normalizeError(outcome.error),
      });
      failRange(entry.boundaryState, entry.range, 'queue-completion', outcome.error);
      const secondaryFailures = await drainGpuDutiesAfterFailure();
      throw failExecution(
        outcome.error,
        'queue-completion',
        entry.boundaryState,
        { secondaryFailures },
      );
    }
    completeFixedRange(entry.boundaryState, entry.range, {
      timingAuthority: 'queue-work-done',
      observedDurationMs: outcome.completedAtMs - entry.submittedAtMs,
    });
    updateGpuDuty(entry, {
      status: 'retired',
      retiredAtMs: outcome.completedAtMs,
      rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
      timingAuthority: 'queue-work-done',
    });
    emitProgress(entry.boundaryState);
    return entry;
  }

  async function drainGpuDuties() {
    while (state.inFlightGpuDuties.length > 0) {
      await retireOldestGpuDuty();
    }
  }

  function startBoundary(boundaryId, options = {}, schedulerInvocation) {
    checkCancellation();
    const definition = definitions.get(boundaryId);
    if (!definition) throw new Error(`unknown cooperative boundary: ${boundaryId}`);
    const boundaryState = boundaryStates.get(boundaryId);
    if (boundaryState.controller) throw new Error(`cooperative boundary ${boundaryId} was already started`);
    const declaredTotal = definition.boundary.totalItems;
    const totalItems = options.totalItems ?? declaredTotal;
    requirePositiveSafeInteger(`${boundaryId}.totalItems`, totalItems);
    if (declaredTotal != null && options.totalItems != null && options.totalItems !== declaredTotal) {
      throw new Error(`${boundaryId}.totalItems does not match the boundary manifest`);
    }
    boundaryState.totalItems = totalItems;
    boundaryState.status = 'active';
    boundaryState.boundary = definition.boundary;
    boundaryState.planner = createPlanner(definition, boundaryState, totalItems);

    async function yieldAfterDuty(range) {
      if (schedulingMode !== 'cooperative' || definition.boundary.yieldPolicy !== 'after-duty') return null;
      return schedulerInvocation.yieldToBrowser({
        reason: completionPolicy === 'bounded-prefix'
          && definition.boundary.kind === 'gpu-command'
          ? 'cooperative-boundary-duty-issued'
          : 'cooperative-boundary-duty-complete',
        metadata: {
          manifestId: manifest.manifestId,
          phaseId: definition.phase.phaseId,
          boundaryId,
          rangeId: range.rangeId,
          rangeIndex: range.rangeIndex,
        },
      });
    }

    let gpuDutyAdmissionTail = Promise.resolve();
    async function acquireGpuDutyAdmission() {
      const predecessor = gpuDutyAdmissionTail;
      let release;
      gpuDutyAdmissionTail = new Promise(resolve => {
        release = resolve;
      });
      await predecessor;
      return release;
    }

    const controller = Object.freeze({
      boundaryId,
      kind: definition.boundary.kind,
      unit: definition.boundary.unit,

      nextRange() {
        checkCancellation();
        const range = boundaryState.planner.nextRange();
        if (range) {
          boundaryState.ranges = boundaryState.planner.snapshot().ranges;
          state.currentPhaseId = definition.phase.phaseId;
          state.currentBoundaryId = boundaryId;
        }
        return range;
      },

      async runGpuDuty(range, handlers = {}) {
        const releaseAdmission = await acquireGpuDutyAdmission();
        try {
          checkCancellation();
          if (completionPolicy === 'bounded-prefix'
              && state.inFlightGpuDuties.some(entry => entry.boundaryState !== boundaryState)) {
            await drainGpuDuties();
          }
          if (definition.boundary.kind !== 'gpu-command') {
            throw new Error(`${boundaryId} is not a gpu-command boundary`);
          }
          requirePendingRange(boundaryState, range);
          if (typeof handlers.encode !== 'function') {
            const error = new TypeError('GPU duty encode must be a function');
            failRange(boundaryState, range, 'command-encoding', error);
            throw failExecution(error, 'command-encoding', boundaryState);
          }
          if (handlers.submit != null) {
            const error = new TypeError(
              'GPU duty submit callbacks are unsupported; encode must return command buffers',
            );
            failRange(boundaryState, range, 'command-encoding', error);
            throw failExecution(error, 'command-encoding', boundaryState);
          }

        let descriptor = {
          phase: definition.phase.phaseId,
          kind: definition.boundary.commandDutyKind,
          metadata: {
            ...clone(definition.boundary.metadata),
            manifestId: manifest.manifestId,
            boundaryId,
            rangeId: range.rangeId,
            rangeIndex: range.rangeIndex,
            itemStart: range.itemStart,
            itemEnd: range.itemEnd,
            itemCount: range.itemCount,
            totalItems: range.totalItems,
            unit: range.unit,
          },
        };
        let prepared = false;
        let encoded;
        try {
          if (schedulingMode === 'cooperative') {
            if (typeof runtime.prepareCommandDutyAtBoundary !== 'function') {
              throw new Error('cooperative GPU duties require runtime.prepareCommandDutyAtBoundary');
            }
            descriptor = await runtime.prepareCommandDutyAtBoundary(descriptor, schedulerInvocation);
            prepared = true;
            checkCancellation();
          }
          encoded = await handlers.encode({
            range,
            commandDuty: deepFreeze(clone(descriptor)),
            schedulerInvocation,
          });
        } catch (error) {
          const secondaryFailures = [];
          if (prepared && typeof runtime.settleCommandDuty === 'function') {
            try {
              runtime.settleCommandDuty(descriptor, {
                status: 'failed-before-encode',
                phase: 'command-encoding',
                error,
              });
            } catch (settlementError) {
              secondaryFailures.push({
                phase: 'scheduler-settlement',
                error: normalizeError(settlementError),
              });
            }
          }
          failRange(boundaryState, range, 'command-encoding', error);
          throw failExecution(error, 'command-encoding', boundaryState, { secondaryFailures });
        }

        if (prepared && typeof runtime.settleCommandDuty === 'function') {
          try {
            runtime.settleCommandDuty(descriptor, { status: 'encoded' });
          } catch (error) {
            failRange(boundaryState, range, 'scheduler-settlement', error);
            throw failExecution(error, 'scheduler-settlement', boundaryState);
          }
        }

        const commandBuffers = Array.isArray(encoded) ? [...encoded] : [encoded];
        if (commandBuffers.length === 0 || commandBuffers.some(buffer => buffer == null)) {
          const error = new TypeError('GPU duty encode must return command buffers');
          failRange(boundaryState, range, 'command-encoding', error);
          throw failExecution(error, 'command-encoding', boundaryState);
        }

        const submitStartMs = readNow(now);
        let prefixFence = null;
        let submitted = false;
        let queueSubmittedAtMs = null;
        let boundedEntry = null;
        const capturePrefixFence = () => {
          if (typeof runtime.queue.onSubmittedWorkDone !== 'function') {
            throw new Error('GPU duties require queue.onSubmittedWorkDone');
          }
          const fence = runtime.queue.onSubmittedWorkDone();
          if (fence == null || typeof fence.then !== 'function') {
            throw new TypeError('queue onSubmittedWorkDone must return a Promise');
          }
          state.observedPrefixFenceCount += 1;
          return fence;
        };
        try {
          const submit = () => {
            if (submitted) {
              throw new Error('command duty recorder attempted duplicate GPU submission');
            }
            queueSubmittedAtMs = submitStartMs;
            runtime.queue.submit(commandBuffers);
            submitted = true;
            state.submittedGpuDutyCount += 1;
            queueSubmittedAtMs = readNow(now);
            if (schedulingMode === 'cooperative') {
              prefixFence = capturePrefixFence();
            }
            if (completionPolicy === 'bounded-prefix') {
              boundedEntry = registerBoundedGpuDuty({
                boundaryId,
                boundaryState,
                range,
                encoded,
                submittedAtMs: queueSubmittedAtMs,
                prefixFence,
              });
            }
          };
          if (runtime.commandDuties?.measureSubmission) {
            await runtime.commandDuties.measureSubmission(descriptor, submit);
          } else {
            submit();
          }
          if (!submitted) throw new Error('command duty recorder did not submit GPU work');
          if (schedulingMode === 'cooperative' && completionPolicy === 'strict-prefix') {
            await prefixFence;
          }
        } catch (error) {
          const secondaryFailures = [];
          if (submitted && completionPolicy === 'bounded-prefix') {
            if (!boundedEntry) {
              try {
                if (!prefixFence) prefixFence = capturePrefixFence();
                boundedEntry = registerBoundedGpuDuty({
                  boundaryId,
                  boundaryState,
                  range,
                  encoded,
                  submittedAtMs: queueSubmittedAtMs,
                  prefixFence,
                });
              } catch (fenceError) {
                state.unfencedSubmittedGpuDutyCount += 1;
                secondaryFailures.push({
                  phase: 'queue-prefix-drain',
                  error: normalizeError(fenceError),
                });
              }
            }
            failRange(boundaryState, range, 'queue-submission', error);
            if (boundedEntry) {
              secondaryFailures.push(...await drainGpuDutiesAfterFailure());
            }
            throw failExecution(error, 'queue-submission', boundaryState, { secondaryFailures });
          }
          if (submitted) {
            try {
              if (!prefixFence) prefixFence = capturePrefixFence();
              await prefixFence;
            } catch (fenceError) {
              state.unfencedSubmittedGpuDutyCount += 1;
              secondaryFailures.push({
                phase: 'queue-prefix-drain',
                error: normalizeError(fenceError),
              });
            }
          }
          failRange(boundaryState, range, 'queue-submission', error);
          throw failExecution(error, 'queue-submission', boundaryState, { secondaryFailures });
        }

        if (completionPolicy === 'bounded-prefix') {
          try {
            await yieldAfterDuty(range);
          } catch (error) {
            failRange(boundaryState, range, 'browser-yield', error);
            const secondaryFailures = await drainGpuDutiesAfterFailure();
            throw failExecution(error, 'browser-yield', boundaryState, { secondaryFailures });
          }
          const retired = state.inFlightGpuDuties.length >= maxInFlightGpuDuties
            ? await retireOldestGpuDuty()
            : null;
          return {
            range,
            encoded,
            queueCompletionAuthority: 'bounded-prefix-fence',
            settledRangeId: retired?.range.rangeId || null,
          };
        }

        const completedAtMs = readNow(now);

        if (definition.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
          completeAdaptiveRange(boundaryState, range, completedAtMs - submitStartMs);
        } else {
          completeFixedRange(boundaryState, range, {
            timingAuthority: schedulingMode === 'cooperative'
              ? 'queue-work-done'
              : 'host-submit-call-only',
            observedDurationMs: completedAtMs - submitStartMs,
          });
        }
        try {
          await yieldAfterDuty(range);
        } catch (error) {
          throw failExecution(error, 'browser-yield', boundaryState);
        }
        emitProgress(boundaryState);
          return {
            range,
            encoded,
            queueCompletionAuthority: prefixFence
              ? 'immediate-prefix-fence'
              : 'terminal-prefix-fence-pending',
          };
        } finally {
          releaseAdmission();
        }
      },

      async runCpuDuty(range, handlers = {}) {
        checkCancellation();
        if (definition.boundary.kind !== 'cpu-work') {
          throw new Error(`${boundaryId} is not a cpu-work boundary`);
        }
        if (typeof handlers.work !== 'function') throw new TypeError('CPU duty work must be a function');
        requirePendingRange(boundaryState, range);
        if (completionPolicy === 'bounded-prefix') {
          await drainGpuDuties();
          checkCancellation();
        }
        const startedAtMs = readNow(now);
        try {
          const work = () => handlers.work({ range, schedulerInvocation });
          if (runtime.hostPhases && typeof runtime.runHostPhase === 'function') {
            await runtime.runHostPhase(definition.boundary.hostPhase, work, {
              detail: {
                manifestId: manifest.manifestId,
                boundaryId,
                rangeId: range.rangeId,
                rangeIndex: range.rangeIndex,
                itemStart: range.itemStart,
                itemEnd: range.itemEnd,
                totalItems: range.totalItems,
                unit: range.unit,
              },
            });
          } else {
            await work();
          }
        } catch (error) {
          failRange(boundaryState, range, 'cpu-work', error);
          throw failExecution(error, 'cpu-work', boundaryState);
        }
        completeFixedRange(boundaryState, range, {
          timingAuthority: 'host-work-call',
          observedDurationMs: readNow(now) - startedAtMs,
        });
        try {
          await yieldAfterDuty(range);
        } catch (error) {
          throw failExecution(error, 'browser-yield', boundaryState);
        }
        emitProgress(boundaryState);
        return { range };
      },

      snapshot() {
        return deepFreeze(clone({
          phaseId: definition.phase.phaseId,
          boundaryId,
          status: boundaryState.status,
          totalItems: boundaryState.totalItems,
          completedItems: boundaryState.completedItems,
          progress: boundaryProgress(boundaryState),
          ranges: boundaryState.ranges,
        }));
      },
    });
    boundaryState.controller = controller;
    return controller;
  }

  async function run(fn) {
    if (typeof fn !== 'function') throw new TypeError('cooperative execution run requires a function');
    if (state.runCalled) throw new Error('cooperative execution can run only once');
    state.runCalled = true;
    state.status = 'running';
    state.startedAtMs = readNow(now);
    try {
      checkCancellation();
      const output = await runtime.runInvocation({ invocationId: input.invocationId }, async invocation => {
        state.schedulerRevision = invocation.schedulerRevision ?? null;
        state.invocationScheduler = clone(invocation.scheduler || null);
        return fn(Object.freeze({
          invocationId: input.invocationId,
          schedulingMode,
          schedulerInvocation: invocation,
          startBoundary(boundaryId, options = {}) {
            return startBoundary(boundaryId, options, invocation);
          },
          progress: createProgress,
          throwIfCancelled: checkCancellation,
        }));
      });
      if (completionPolicy === 'bounded-prefix') {
        await drainGpuDuties();
      }
      checkCancellation();
      const incomplete = [...boundaryStates.values()]
        .filter(boundary => boundary.status !== 'complete')
        .map(boundary => boundary.boundaryId);
      if (incomplete.length > 0) {
        throw new Error(`incomplete cooperative boundaries: ${incomplete.join(', ')}`);
      }
      if (schedulingMode === 'disabled'
        && [...definitions.values()].some(definition => definition.boundary.kind === 'gpu-command')) {
        if (typeof runtime.queue.onSubmittedWorkDone !== 'function') {
          throw new Error('disabled scheduling A/B requires a terminal queue.onSubmittedWorkDone fence');
        }
        const terminalFence = runtime.queue.onSubmittedWorkDone();
        if (terminalFence == null || typeof terminalFence.then !== 'function') {
          throw new TypeError('queue onSubmittedWorkDone must return a Promise');
        }
        await terminalFence;
        state.terminalQueueFenceObserved = true;
      }
      state.status = 'succeeded';
      state.currentPhaseId = null;
      state.currentBoundaryId = null;
      state.endedAtMs = readNow(now);
      return output;
    } catch (error) {
      if (completionPolicy === 'bounded-prefix' && state.inFlightGpuDuties.length > 0) {
        const priorReport = error?.cooperativeExecutionReport || null;
        const phase = priorReport?.failure?.phase
          || (error?.name === 'AbortError' ? 'cancellation' : 'completion');
        const boundaryState = boundaryStates.get(priorReport?.failure?.boundaryId)
          || state.inFlightGpuDuties[0]?.boundaryState
          || null;
        const oldestPending = state.inFlightGpuDuties[0];
        if (boundaryState && oldestPending) {
          failRange(boundaryState, oldestPending.range, phase, error);
        }
        const secondaryFailures = [
          ...(priorReport?.failure?.secondaryFailures || []),
          ...await drainGpuDutiesAfterFailure(),
        ];
        throw failExecution(error, phase, boundaryState, { secondaryFailures });
      }
      if (error?.cooperativeExecutionReport) throw error;
      const activeBoundary = boundaryStates.get(state.currentBoundaryId) || null;
      throw failExecution(
        error,
        error?.name === 'AbortError' ? 'cancellation' : 'completion',
        activeBoundary,
      );
    }
  }

  return Object.freeze({
    schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
    routeId: manifest.routeId,
    manifestId: manifest.manifestId,
    invocationId: input.invocationId,
    schedulingMode,
    completionPolicy,
    maxInFlightGpuDuties,
    run,
    progress: createProgress,
    snapshot: createReport,
    finish() {
      if (state.status !== 'succeeded' && state.status !== 'failed' && state.status !== 'cancelled') {
        throw new Error('cooperative execution cannot finish before run settles');
      }
      return createReport();
    },
  });
}
