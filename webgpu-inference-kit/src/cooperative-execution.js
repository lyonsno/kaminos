import { createWebGpuAdaptiveCommandDutyPlanner } from './adaptive-command-duty.js';
import { WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA } from './cooperative-boundary-manifest.js';

export const WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA =
  'kaminos.webgpu-cooperative-execution-report.v0';
export const WEBGPU_COOPERATIVE_PROGRESS_SCHEMA =
  'kaminos.webgpu-cooperative-progress.v0';
export const WEBGPU_COOPERATIVE_RANGE_SCHEMA =
  'kaminos.webgpu-cooperative-range.v0';

const SCHEDULING_MODES = new Set(['cooperative', 'disabled']);

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

function createFixedRangePlanner({ plannerId, unit, totalItems, chunkItems, metadata }) {
  const ranges = [];
  let status = 'active';
  let completedItems = 0;
  let pendingRange = null;
  let failure = null;

  function snapshot() {
    return clone({
      status,
      plannerId,
      unit,
      totalItems,
      completedItems,
      progress: completedItems / totalItems,
      pendingRangeId: pendingRange?.rangeId || null,
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
      if (pendingRange) throw new Error(`pending range ${pendingRange.rangeId} must be completed or failed first`);
      const itemStart = completedItems;
      const itemCount = Math.min(chunkItems, totalItems - itemStart);
      const rangeIndex = ranges.length;
      pendingRange = deepFreeze({
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
      ranges.push({ ...clone(pendingRange), status: 'pending-completion' });
      return pendingRange;
    },

    completeRange(rangeId, detail = {}) {
      if (status !== 'active' || !pendingRange) throw new Error('planner has no active range to complete');
      if (pendingRange.rangeId !== rangeId) throw new Error('range does not match the pending planner range');
      const range = pendingRange;
      completedItems = range.itemEnd;
      status = completedItems === totalItems ? 'complete' : 'active';
      pendingRange = null;
      ranges[range.rangeIndex] = {
        ...ranges[range.rangeIndex],
        ...clone(detail),
        status: 'completed',
      };
      return snapshot();
    },

    failRange(rangeId, phase, error) {
      if (status !== 'active' || !pendingRange) return snapshot();
      if (pendingRange.rangeId !== rangeId) throw new Error('range does not match the pending planner range');
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
      pendingRange = null;
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
      : schedulingMode === 'cooperative'
        ? 'per-gpu-duty-prefix-fence'
        : state.terminalQueueFenceObserved
          ? 'one-terminal-prefix-fence'
          : 'terminal-prefix-fence-pending';
    return deepFreeze({
      schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
      status: state.status,
      routeId: manifest.routeId,
      manifestId: manifest.manifestId,
      invocationId: input.invocationId,
      schedulingMode,
      schedulerRevision: state.schedulerRevision,
      invocationScheduler: clone(state.invocationScheduler),
      queueCompletionAuthority,
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
    const pendingRangeId = boundaryState.planner?.snapshot()?.pendingRangeId;
    if (pendingRangeId !== range.rangeId) {
      throw new Error(`range ${range.rangeId || '<missing>'} is not the pending range for ${boundaryState.boundaryId}`);
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
    if (plannerSnapshot?.pendingRangeId === range?.rangeId) {
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
      metadata: {
        manifestId: manifest.manifestId,
        routeId: manifest.routeId,
        phaseId: definition.phase.phaseId,
        boundaryId: definition.boundary.boundaryId,
      },
    });
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
      try {
        return await schedulerInvocation.yieldToBrowser({
          reason: 'cooperative-boundary-duty-complete',
          metadata: {
            manifestId: manifest.manifestId,
            phaseId: definition.phase.phaseId,
            boundaryId,
            rangeId: range.rangeId,
            rangeIndex: range.rangeIndex,
          },
        });
      } catch (error) {
        throw failExecution(error, 'browser-yield', boundaryState);
      }
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
        checkCancellation();
        if (definition.boundary.kind !== 'gpu-command') {
          throw new Error(`${boundaryId} is not a gpu-command boundary`);
        }
        if (typeof handlers.encode !== 'function') throw new TypeError('GPU duty encode must be a function');
        if (typeof handlers.submit !== 'function') throw new TypeError('GPU duty submit must be a function');
        requirePendingRange(boundaryState, range);

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

        const submitStartMs = readNow(now);
        let prefixFence = null;
        try {
          const submit = () => handlers.submit(encoded, {
            range,
            commandDuty: deepFreeze(clone(descriptor)),
            schedulerInvocation,
          });
          if (runtime.commandDuties?.measureSubmission) {
            await runtime.commandDuties.measureSubmission(descriptor, submit);
          } else {
            await submit();
          }
          if (schedulingMode === 'cooperative') {
            if (typeof runtime.queue.onSubmittedWorkDone !== 'function') {
              throw new Error('cooperative GPU duties require queue.onSubmittedWorkDone');
            }
            prefixFence = runtime.queue.onSubmittedWorkDone();
            await prefixFence;
          }
        } catch (error) {
          failRange(boundaryState, range, 'queue-submission', error);
          throw failExecution(error, 'queue-submission', boundaryState);
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
        await yieldAfterDuty(range);
        emitProgress(boundaryState);
        return {
          range,
          encoded,
          queueCompletionAuthority: prefixFence
            ? 'immediate-prefix-fence'
            : 'terminal-prefix-fence-pending',
        };
      },

      async runCpuDuty(range, handlers = {}) {
        checkCancellation();
        if (definition.boundary.kind !== 'cpu-work') {
          throw new Error(`${boundaryId} is not a cpu-work boundary`);
        }
        if (typeof handlers.work !== 'function') throw new TypeError('CPU duty work must be a function');
        requirePendingRange(boundaryState, range);
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
        await yieldAfterDuty(range);
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
        await terminalFence;
        state.terminalQueueFenceObserved = true;
      }
      state.status = 'succeeded';
      state.currentPhaseId = null;
      state.currentBoundaryId = null;
      state.endedAtMs = readNow(now);
      return output;
    } catch (error) {
      if (error?.cooperativeExecutionReport) throw error;
      throw failExecution(
        error,
        error?.name === 'AbortError' ? 'cancellation' : 'completion',
      );
    }
  }

  return Object.freeze({
    schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
    routeId: manifest.routeId,
    manifestId: manifest.manifestId,
    invocationId: input.invocationId,
    schedulingMode,
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
