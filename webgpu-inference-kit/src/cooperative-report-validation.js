import {
  WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
  WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
} from './cooperative-execution.js';

export const WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA =
  'kaminos.webgpu-cooperative-report-validation.v0';

const STATUS_VALUES = new Set(['succeeded', 'failed', 'cancelled']);
const PHASE_STATUS_VALUES = new Set(['complete', 'failed', 'cancelled', 'active', 'pending']);
const SCHEDULING_MODES = new Set(['cooperative', 'disabled']);
const COMPLETION_POLICIES = new Set(['strict-prefix', 'bounded-prefix']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function semanticEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => semanticEqual(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && semanticEqual(left[key], right[key])
    ));
}

function requireOptionalIdentity(name, value) {
  if (value == null) return null;
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function normalizeExpectations(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('expectations must be an object');
  const expectedStatus = input.expectedStatus ?? 'succeeded';
  if (!STATUS_VALUES.has(expectedStatus)) {
    throw new TypeError('expectedStatus must be succeeded, failed, or cancelled');
  }
  const expectedSchedulingMode = input.expectedSchedulingMode ?? null;
  if (expectedSchedulingMode != null && !SCHEDULING_MODES.has(expectedSchedulingMode)) {
    throw new TypeError('expectedSchedulingMode must be cooperative or disabled');
  }
  const expectedCompletionPolicy = input.expectedCompletionPolicy ?? null;
  if (expectedCompletionPolicy != null && !COMPLETION_POLICIES.has(expectedCompletionPolicy)) {
    throw new TypeError('expectedCompletionPolicy must be strict-prefix or bounded-prefix');
  }
  const expectedGpuDutyCount = input.expectedGpuDutyCount ?? null;
  if (
    expectedGpuDutyCount != null
    && (!Number.isSafeInteger(expectedGpuDutyCount) || expectedGpuDutyCount < 0)
  ) {
    throw new TypeError('expectedGpuDutyCount must be a nonnegative safe integer');
  }
  const expectedMaxInFlightGpuDuties = input.expectedMaxInFlightGpuDuties ?? null;
  if (
    expectedMaxInFlightGpuDuties != null
    && (!Number.isSafeInteger(expectedMaxInFlightGpuDuties)
      || expectedMaxInFlightGpuDuties <= 0)
  ) {
    throw new TypeError('expectedMaxInFlightGpuDuties must be a positive safe integer');
  }
  const requireConfiguredDepthObserved = input.requireConfiguredDepthObserved ?? false;
  if (typeof requireConfiguredDepthObserved !== 'boolean') {
    throw new TypeError('requireConfiguredDepthObserved must be a boolean');
  }
  return Object.freeze({
    expectedStatus,
    expectedRouteId: requireOptionalIdentity('expectedRouteId', input.expectedRouteId),
    expectedManifestId: requireOptionalIdentity('expectedManifestId', input.expectedManifestId),
    expectedInvocationId: requireOptionalIdentity('expectedInvocationId', input.expectedInvocationId),
    expectedSchedulingMode,
    expectedCompletionPolicy,
    expectedGpuDutyCount,
    expectedMaxInFlightGpuDuties,
    requireConfiguredDepthObserved,
  });
}

function sameDuration(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 4;
  return Math.abs(actual - expected) <= tolerance;
}

function validateExpectedIdentity(errors, report, expected, field) {
  if (expected != null && report[field] !== expected) {
    errors.push(`${field} must match expected ${expected}`);
  }
}

function validateProgressMeasure(errors, value, label) {
  if (!isNonnegativeSafeInteger(value.completedItems)) {
    errors.push(`${label}.completedItems must be a nonnegative safe integer`);
  }
  if (!Number.isFinite(value.totalWeight) || value.totalWeight <= 0) {
    errors.push(`${label}.totalWeight must be finite and positive`);
  }
  if (value.totalItems == null) {
    if (value.progress != null || value.percent != null || value.completedWeight != null) {
      errors.push(`${label} must not claim numeric progress without a totalItems denominator`);
    }
    return;
  }
  if (!isNonnegativeSafeInteger(value.totalItems)) {
    errors.push(`${label}.totalItems must be null or a nonnegative safe integer`);
    return;
  }
  if (
    isNonnegativeSafeInteger(value.completedItems)
    && value.completedItems > value.totalItems
  ) {
    errors.push(`${label}.completedItems must not exceed totalItems`);
  }
  if (!isFiniteNonnegative(value.completedWeight)) {
    errors.push(`${label}.completedWeight must be finite nonnegative`);
  } else if (
    Number.isFinite(value.totalWeight)
    && value.completedWeight > value.totalWeight
  ) {
    errors.push(`${label}.completedWeight must not exceed totalWeight`);
  }
  if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1) {
    errors.push(`${label}.progress must be finite and between 0 and 1`);
  } else if (
    isFiniteNonnegative(value.completedWeight)
    && Number.isFinite(value.totalWeight)
    && value.totalWeight > 0
    && !sameDuration(value.progress, value.completedWeight / value.totalWeight)
  ) {
    errors.push(`${label}.progress must equal completedWeight / totalWeight`);
  }
  if (!Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100) {
    errors.push(`${label}.percent must be finite and between 0 and 100`);
  } else if (
    Number.isFinite(value.progress)
    && !sameDuration(value.percent, value.progress * 100)
  ) {
    errors.push(`${label}.percent must equal progress * 100`);
  }
}

function compareProgressValue(errors, actual, expected, label) {
  if (actual == null || expected == null) {
    if (actual !== expected) errors.push(`${label} must match completed boundary work`);
    return;
  }
  if (typeof actual === 'number' || typeof expected === 'number') {
    if (!sameDuration(actual, expected)) {
      errors.push(`${label} must match completed boundary work`);
    }
    return;
  }
  if (actual !== expected) errors.push(`${label} must match completed boundary work`);
}

function summarizeBoundaryProgress(boundaries) {
  const phaseOrder = [];
  const phases = new Map();
  for (const boundary of boundaries) {
    if (!isPlainObject(boundary) || !isNonEmptyString(boundary.phaseId)) return null;
    if (!phases.has(boundary.phaseId)) {
      phaseOrder.push(boundary.phaseId);
      phases.set(boundary.phaseId, []);
    }
    phases.get(boundary.phaseId).push(boundary);
  }

  const phaseSummaries = phaseOrder.map(phaseId => {
    const phaseBoundaries = phases.get(phaseId);
    const allTotalsKnown = phaseBoundaries.every(boundary => (
      isNonnegativeSafeInteger(boundary.totalItems)
    ));
    const completedItems = phaseBoundaries.reduce(
      (sum, boundary) => sum + (isNonnegativeSafeInteger(boundary.completedItems)
        ? boundary.completedItems
        : 0),
      0,
    );
    const totalItems = allTotalsKnown
      ? phaseBoundaries.reduce((sum, boundary) => sum + boundary.totalItems, 0)
      : null;
    const totalWeight = phaseBoundaries.reduce(
      (sum, boundary) => sum + (Number.isFinite(boundary.progressWeight)
        ? boundary.progressWeight
        : 0),
      0,
    );
    const completedWeight = allTotalsKnown
      ? phaseBoundaries.reduce((sum, boundary) => {
          const fraction = boundary.totalItems === 0
            ? 1
            : boundary.completedItems / boundary.totalItems;
          return sum + boundary.progressWeight * fraction;
        }, 0)
      : null;
    const progress = completedWeight == null ? null : completedWeight / totalWeight;
    const statuses = new Set(phaseBoundaries.map(boundary => boundary.status));
    const status = statuses.has('failed')
      ? 'failed'
      : statuses.has('cancelled')
        ? 'cancelled'
        : phaseBoundaries.every(boundary => boundary.status === 'complete')
          ? 'complete'
          : phaseBoundaries.some(boundary => boundary.status === 'active')
            ? 'active'
            : 'pending';
    return {
      phaseId,
      status,
      completedItems,
      totalItems,
      progress,
      percent: progress == null ? null : progress * 100,
      completedWeight,
      totalWeight,
    };
  });
  const allTotalsKnown = phaseSummaries.every(phase => phase.totalItems != null);
  const completedItems = phaseSummaries.reduce((sum, phase) => sum + phase.completedItems, 0);
  const totalItems = allTotalsKnown
    ? phaseSummaries.reduce((sum, phase) => sum + phase.totalItems, 0)
    : null;
  const totalWeight = phaseSummaries.reduce((sum, phase) => sum + phase.totalWeight, 0);
  const completedWeight = allTotalsKnown
    ? phaseSummaries.reduce((sum, phase) => sum + phase.completedWeight, 0)
    : null;
  const progress = completedWeight == null ? null : completedWeight / totalWeight;
  return {
    completedItems,
    totalItems,
    progress,
    percent: progress == null ? null : progress * 100,
    completedWeight,
    totalWeight,
    phases: phaseSummaries,
  };
}

function reconcileProgressWithBoundaries(errors, progress, boundaries, label = 'progress') {
  if (!isPlainObject(progress) || !Array.isArray(boundaries)) return;
  const expected = summarizeBoundaryProgress(boundaries);
  if (!expected) return;
  for (const field of [
    'completedItems',
    'totalItems',
    'progress',
    'percent',
    'completedWeight',
    'totalWeight',
  ]) {
    compareProgressValue(errors, progress[field], expected[field], `${label}.${field}`);
  }
  if (!Array.isArray(progress.phases)) return;
  if (progress.phases.length !== expected.phases.length) {
    errors.push(`${label}.phases must match completed boundary work`);
    return;
  }
  for (const [index, expectedPhase] of expected.phases.entries()) {
    const actualPhase = progress.phases[index];
    const phaseLabel = `${label}.phases[${index}]`;
    if (!isPlainObject(actualPhase)) continue;
    for (const field of [
      'phaseId',
      'status',
      'completedItems',
      'totalItems',
      'progress',
      'percent',
      'completedWeight',
      'totalWeight',
    ]) {
      compareProgressValue(errors, actualPhase[field], expectedPhase[field], `${phaseLabel}.${field}`);
    }
  }
}

function completedRangesForProgress(boundary) {
  const completedStatuses = new Set(['complete', 'completed', 'observed']);
  return (Array.isArray(boundary?.ranges) ? boundary.ranges : []).filter(range => (
    isPlainObject(range)
    && completedStatuses.has(range.status)
    && Number.isSafeInteger(range.itemEnd)
    && isNonnegativeSafeInteger(boundary.completedItems)
    && range.itemEnd <= boundary.completedItems
  ));
}

export function validateWebGpuCooperativeProgressEvents(report, progressEvents) {
  const errors = [];
  if (!isPlainObject(report)) {
    errors.push('executionReport must be an object');
  }
  if (!Array.isArray(progressEvents)) {
    errors.push('progressEvents must be an array');
  }
  if (isPlainObject(report) && !Array.isArray(report.boundaries)) {
    errors.push('executionReport.boundaries must be an array');
  }
  if (errors.length > 0) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  const boundaryStates = report.boundaries.map(boundary => ({
    ...boundary,
    status: 'pending',
    completedItems: 0,
  }));
  const stateByBoundaryId = new Map(boundaryStates.map(boundary => [
    boundary.boundaryId,
    boundary,
  ]));
  const completedRanges = new Map(report.boundaries.map(boundary => [
    boundary.boundaryId,
    completedRangesForProgress(boundary),
  ]));
  const consumedByBoundary = new Map();
  const expectedEventCount = [...completedRanges.values()].reduce(
    (sum, ranges) => sum + ranges.length,
    0,
  );

  for (const [index, event] of progressEvents.entries()) {
    const label = `progressEvents[${index}]`;
    validateProgressSnapshot(errors, event, {
      label,
      routeId: report.routeId,
      invocationId: report.invocationId,
      expectedStatus: 'running',
      terminal: false,
    });
    if (!isPlainObject(event)) continue;
    const boundaryState = stateByBoundaryId.get(event.currentBoundaryId);
    if (!boundaryState) {
      errors.push(`${label}.currentBoundaryId must identify completed boundary work`);
      continue;
    }
    if (event.currentPhaseId !== boundaryState.phaseId) {
      errors.push(`${label}.currentPhaseId must match currentBoundaryId`);
    }
    const consumed = consumedByBoundary.get(boundaryState.boundaryId) || 0;
    const range = completedRanges.get(boundaryState.boundaryId)?.[consumed];
    if (!range) {
      errors.push(`${label} must correspond to one unclaimed completed range`);
      continue;
    }
    consumedByBoundary.set(boundaryState.boundaryId, consumed + 1);
    boundaryState.completedItems = range.itemEnd;
    boundaryState.status = boundaryState.totalItems === range.itemEnd ? 'complete' : 'active';
    reconcileProgressWithBoundaries(errors, event, boundaryStates, label);
  }
  if (progressEvents.length !== expectedEventCount) {
    errors.push(
      `progressEvents length must equal completed range count ${expectedEventCount}`,
    );
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function validateProgressSnapshot(errors, progress, {
  label,
  routeId,
  invocationId,
  expectedStatus,
  terminal,
}) {
  if (!isPlainObject(progress)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (progress.schema !== WEBGPU_COOPERATIVE_PROGRESS_SCHEMA) {
    errors.push(`${label}.schema must be ${WEBGPU_COOPERATIVE_PROGRESS_SCHEMA}`);
  }
  if (progress.routeId !== routeId) errors.push(`${label}.routeId must match routeId`);
  if (progress.invocationId !== invocationId) {
    errors.push(`${label}.invocationId must match invocationId`);
  }
  if (progress.status !== expectedStatus) {
    errors.push(`${label}.status must match ${terminal ? 'terminal report status' : 'retained event status'} ${expectedStatus}`);
  }
  validateProgressMeasure(errors, progress, label);
  if (!Array.isArray(progress.phases)) {
    errors.push(`${label}.phases must be an array`);
    return;
  }
  const phaseIds = new Set();
  for (const [index, phase] of progress.phases.entries()) {
    const phaseLabel = `${label}.phases[${index}]`;
    if (!isPlainObject(phase)) {
      errors.push(`${phaseLabel} must be an object`);
      continue;
    }
    if (!isNonEmptyString(phase.phaseId) || phaseIds.has(phase.phaseId)) {
      errors.push(`${phaseLabel}.phaseId must be unique and non-empty`);
    } else {
      phaseIds.add(phase.phaseId);
    }
    const statusAllowed = PHASE_STATUS_VALUES.has(phase.status)
      && (terminal || !new Set(['failed', 'cancelled']).has(phase.status));
    if (!statusAllowed || terminal && phase.status === 'active') {
      errors.push(`${phaseLabel}.status must be ${terminal ? 'terminal or untouched pending' : 'active, complete, or untouched pending'}`);
    }
    validateProgressMeasure(errors, phase, phaseLabel);
    if (
      phase.status === 'complete'
      && (
        !isNonnegativeSafeInteger(phase.totalItems)
        || phase.completedItems !== phase.totalItems
        || phase.progress !== 1
        || phase.percent !== 100
      )
    ) {
      errors.push(`${phaseLabel} must prove phase completion`);
    }
  }
}

function validateTerminalProgress(errors, report) {
  const progress = report.progress;
  validateProgressSnapshot(errors, progress, {
    label: 'progress',
    routeId: report.routeId,
    invocationId: report.invocationId,
    expectedStatus: report.status,
    terminal: true,
  });
  if (!isPlainObject(progress)) return;
  if (
    report.status === 'succeeded'
    && (
      progress.status !== 'succeeded'
      || !isNonnegativeSafeInteger(progress.totalItems)
      || progress.completedItems !== progress.totalItems
      || progress.progress !== 1
      || progress.percent !== 100
    )
  ) {
    errors.push('progress must prove terminal completion');
  }
  if (report.status === 'succeeded' && Array.isArray(progress.phases)) {
    for (const [index, phase] of progress.phases.entries()) {
      if (phase?.status !== 'complete') {
        errors.push(`progress.phases[${index}] must prove terminal completion`);
      }
    }
  }
}

function validateBoundaryRanges(errors, boundary, index, { requireComplete }) {
  const label = `boundaries[${index}]`;
  if (!Array.isArray(boundary.ranges)) {
    errors.push(`${label}.ranges must be an array`);
    return;
  }
  if (boundary.rangeCount !== boundary.ranges.length) {
    errors.push(`${label}.rangeCount must equal ranges length`);
  }
  if (requireComplete) {
    if (boundary.actualRangeCount !== boundary.ranges.length) {
      errors.push(`${label}.actualRangeCount must equal ranges length`);
    }
    if (boundary.rangeCountAuthority !== 'actual') {
      errors.push(`${label}.rangeCountAuthority must be actual`);
    }
  }
  const rangeIds = new Set();
  let coveredItems = 0;
  let completedItems = 0;
  let incompleteRangeSeen = false;
  const completedStatuses = new Set(['complete', 'completed', 'observed']);
  const allowedStatuses = new Set([
    ...completedStatuses,
    'pending-completion',
    'pending-observation',
    'failed',
  ]);
  for (const [rangeIndex, range] of boundary.ranges.entries()) {
    const rangeLabel = `${label}.ranges[${rangeIndex}]`;
    if (!isPlainObject(range)) {
      errors.push(`${rangeLabel} must be an object`);
      continue;
    }
    if (!isNonEmptyString(range.rangeId) || rangeIds.has(range.rangeId)) {
      errors.push(`${rangeLabel}.rangeId must be unique and non-empty`);
    } else {
      rangeIds.add(range.rangeId);
    }
    if (!allowedStatuses.has(range.status)) {
      errors.push(`${rangeLabel}.status must preserve planner range state`);
    }
    if (range.rangeIndex !== rangeIndex) {
      errors.push(`${rangeLabel}.rangeIndex must equal ${rangeIndex}`);
    }
    const rangeShapeValid = (
      !isNonnegativeSafeInteger(range.itemStart)
      || !Number.isSafeInteger(range.itemCount)
      || range.itemCount <= 0
      || range.itemEnd !== range.itemStart + range.itemCount
      || range.itemStart !== coveredItems
    );
    if (rangeShapeValid) {
      errors.push(`${rangeLabel} must provide contiguous positive item coverage`);
    }
    if (Number.isSafeInteger(range.itemEnd)) coveredItems = range.itemEnd;
    const completed = completedStatuses.has(range.status);
    if (completed) {
      if (incompleteRangeSeen || range.itemStart !== completedItems) {
        errors.push(`${rangeLabel} completed evidence must form one contiguous prefix`);
      } else if (Number.isSafeInteger(range.itemEnd)) {
        completedItems = range.itemEnd;
      }
    } else {
      incompleteRangeSeen = true;
      if (requireComplete) errors.push(`${rangeLabel}.status must prove range completion`);
    }
  }
  if (
    isNonnegativeSafeInteger(boundary.completedItems)
    && boundary.completedItems !== completedItems
  ) {
    errors.push(`${label}.completedItems must equal completed range coverage`);
  }
  if (
    requireComplete
    && isNonnegativeSafeInteger(boundary.totalItems)
    && coveredItems !== boundary.totalItems
  ) {
    errors.push(`${label}.ranges must cover totalItems exactly`);
  }
}

function hasPendingPlannerWork(planner) {
  if (!isPlainObject(planner)) return false;
  return planner.pendingRangeId != null
    || (planner.pendingRangeCount != null && planner.pendingRangeCount !== 0)
    || (Array.isArray(planner.pendingRangeIds) && planner.pendingRangeIds.length !== 0);
}

function validateNormalizedFailure(errors, failure, label, { requireSecondaryFailures = true } = {}) {
  if (!isPlainObject(failure)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!isNonEmptyString(failure.phase)) errors.push(`${label}.phase must be a non-empty string`);
  if (!isPlainObject(failure.error)) {
    errors.push(`${label}.error must be an object`);
  } else {
    if (!isNonEmptyString(failure.error.name)) {
      errors.push(`${label}.error.name must be a non-empty string`);
    }
    if (!isNonEmptyString(failure.error.message)) {
      errors.push(`${label}.error.message must be a non-empty string`);
    }
  }
  if (requireSecondaryFailures && !Array.isArray(failure.secondaryFailures)) {
    errors.push(`${label}.secondaryFailures must be an array`);
  } else if (Array.isArray(failure.secondaryFailures)) {
    for (const [index, secondaryFailure] of failure.secondaryFailures.entries()) {
      validateNormalizedFailure(
        errors,
        secondaryFailure,
        `${label}.secondaryFailures[${index}]`,
        { requireSecondaryFailures: false },
      );
    }
  }
}

function validateBoundaryProgress(errors, boundary, label) {
  if (!isNonnegativeSafeInteger(boundary.completedItems)) {
    errors.push(`${label}.completedItems must be a nonnegative safe integer`);
  }
  if (boundary.totalItems == null) {
    if (boundary.progress != null) {
      errors.push(`${label}.progress must be null without a totalItems denominator`);
    }
    return;
  }
  if (!isNonnegativeSafeInteger(boundary.totalItems)) {
    errors.push(`${label}.totalItems must be null or a nonnegative safe integer`);
    return;
  }
  if (
    isNonnegativeSafeInteger(boundary.completedItems)
    && boundary.completedItems > boundary.totalItems
  ) {
    errors.push(`${label}.completedItems must not exceed totalItems`);
  }
  const expectedProgress = boundary.totalItems === 0
    ? 1
    : boundary.completedItems / boundary.totalItems;
  if (
    !Number.isFinite(boundary.progress)
    || boundary.progress < 0
    || boundary.progress > 1
    || !sameDuration(boundary.progress, expectedProgress)
  ) {
    errors.push(`${label}.progress must equal completedItems / totalItems`);
  }
}

function validateBoundaries(errors, report) {
  if (!Array.isArray(report.boundaries) || report.boundaries.length === 0) {
    errors.push('boundaries must be a non-empty array');
    return;
  }
  let terminalFailureBoundary = null;
  for (const [index, boundary] of report.boundaries.entries()) {
    const label = `boundaries[${index}]`;
    if (!isPlainObject(boundary)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyString(boundary.boundaryId)) {
      errors.push(`${label}.boundaryId must be a non-empty string`);
    }
    if (!isNonEmptyString(boundary.kind)) errors.push(`${label}.kind must be a non-empty string`);
    validateBoundaryProgress(errors, boundary, label);
    const requireComplete = boundary.status === 'complete';
    if (report.status === 'succeeded') {
      if (
        !requireComplete
        || !isNonnegativeSafeInteger(boundary.totalItems)
        || boundary.completedItems !== boundary.totalItems
        || boundary.progress !== 1
      ) {
        errors.push(`${label} must prove terminal completion`);
      }
      if (boundary.failure != null) errors.push(`${label}.failure must be null on success`);
    } else {
      if (!new Set(['complete', 'failed', 'cancelled', 'pending']).has(boundary.status)) {
        errors.push(`${label}.status must be terminal or untouched pending`);
      }
      if (boundary.status === 'failed' || boundary.status === 'cancelled') {
        validateNormalizedFailure(errors, boundary.failure, `${label}.failure`);
        if (boundary.boundaryId === report.failure?.boundaryId) {
          terminalFailureBoundary = boundary;
        }
      } else if (boundary.failure != null) {
        errors.push(`${label}.failure must be null unless the boundary failed or was cancelled`);
      }
      if (boundary.status === 'pending' && Array.isArray(boundary.ranges) && boundary.ranges.length) {
        errors.push(`${label}.pending boundary must not contain ranges`);
      }
    }
    if (
      requireComplete
      && (
        !isNonnegativeSafeInteger(boundary.totalItems)
        || boundary.completedItems !== boundary.totalItems
        || boundary.progress !== 1
      )
    ) {
      errors.push(`${label} must prove boundary completion`);
    }
    if (hasPendingPlannerWork(boundary.planner)) {
      errors.push(`${label}.planner must have no pending ranges`);
    }
    validateBoundaryRanges(errors, boundary, index, { requireComplete });
  }
  if (
    report.status !== 'succeeded'
    && report.failure?.boundaryId != null
    && terminalFailureBoundary == null
  ) {
    errors.push('failure.boundaryId must identify the failed or cancelled boundary');
  }
  if (report.status !== 'succeeded') {
    const lastBoundaryWithRanges = report.boundaries.findLast(
      boundary => isPlainObject(boundary)
        && Array.isArray(boundary.ranges)
        && boundary.ranges.length > 0,
    );
    if (lastBoundaryWithRanges) {
      if (!isPlainObject(report.lastTrustworthyBoundary)) {
        errors.push('lastTrustworthyBoundary must preserve the last boundary with range evidence');
      } else if (
        report.lastTrustworthyBoundary.boundaryId !== lastBoundaryWithRanges.boundaryId
      ) {
        errors.push('lastTrustworthyBoundary must match the last boundary with range evidence');
      } else {
        for (const field of [
          'phaseId',
          'kind',
          'unit',
          'status',
          'totalItems',
          'completedItems',
          'progressWeight',
        ]) {
          if (report.lastTrustworthyBoundary[field] !== lastBoundaryWithRanges[field]) {
            errors.push(`lastTrustworthyBoundary.${field} must match the last ranged boundary`);
          }
        }
        if (
          !semanticEqual(report.lastTrustworthyBoundary.ranges, lastBoundaryWithRanges.ranges)
        ) {
          errors.push('lastTrustworthyBoundary.ranges must preserve the last ranged boundary');
        }
        if (
          !semanticEqual(report.lastTrustworthyBoundary.failure, lastBoundaryWithRanges.failure)
        ) {
          errors.push('lastTrustworthyBoundary.failure must preserve the last ranged boundary');
        }
      }
    } else if (report.lastTrustworthyBoundary != null) {
      errors.push('lastTrustworthyBoundary must be null without ranged boundary evidence');
    }
  }
}

function validateCounts(errors, report, expectedGpuDutyCount) {
  const countFields = [
    'issuedGpuDutyCount',
    'retiredGpuDutyCount',
    'inFlightGpuDutyCount',
    'submittedGpuDutyCount',
    'observedPrefixFenceCount',
    'unfencedSubmittedGpuDutyCount',
    'maxObservedInFlightGpuDuties',
  ];
  for (const field of countFields) {
    if (!isNonnegativeSafeInteger(report[field])) {
      errors.push(`${field} must be a nonnegative safe integer`);
    }
  }
  if (!Array.isArray(report.inFlightGpuDutyIds)) {
    errors.push('inFlightGpuDutyIds must be an array');
  }
  if (!Array.isArray(report.gpuDuties)) errors.push('gpuDuties must be an array');
  if (Array.isArray(report.gpuDuties) && report.gpuDuties.length !== report.issuedGpuDutyCount) {
    errors.push('gpuDuties length must equal issuedGpuDutyCount');
  }
  if (
    isNonnegativeSafeInteger(report.retiredGpuDutyCount)
    && isNonnegativeSafeInteger(report.issuedGpuDutyCount)
    && report.retiredGpuDutyCount > report.issuedGpuDutyCount
  ) {
    errors.push('retiredGpuDutyCount must not exceed issuedGpuDutyCount');
  }
  if (expectedGpuDutyCount != null) {
    const expectedCountFields = report.completionPolicy === 'bounded-prefix'
      ? report.status === 'succeeded'
        ? ['issuedGpuDutyCount', 'retiredGpuDutyCount', 'submittedGpuDutyCount']
        : ['issuedGpuDutyCount', 'submittedGpuDutyCount']
      : ['submittedGpuDutyCount'];
    for (const field of expectedCountFields) {
      if (report[field] !== expectedGpuDutyCount) {
        errors.push(`${field} must match expectedGpuDutyCount ${expectedGpuDutyCount}`);
      }
    }
  }
  if (report.inFlightGpuDutyCount !== 0) errors.push('inFlightGpuDutyCount must be zero');
  if (Array.isArray(report.inFlightGpuDutyIds) && report.inFlightGpuDutyIds.length !== 0) {
    errors.push('inFlightGpuDutyIds must be empty');
  }
  if (report.unfencedSubmittedGpuDutyCount !== 0) {
    errors.push('unfencedSubmittedGpuDutyCount must be zero');
  }
}

function validateRuntimeTelemetry(errors, report) {
  if (report.runtimeTelemetry == null) return;
  if (!isPlainObject(report.runtimeTelemetry)) {
    errors.push('runtimeTelemetry must be an object when present');
    return;
  }
  for (const [field, entriesFields] of [
    ['commandDuties', ['duties', 'submissions']],
    ['hostPhases', ['phases', 'intervals']],
  ]) {
    const snapshot = report.runtimeTelemetry[field];
    if (snapshot == null) continue;
    const label = `runtimeTelemetry.${field}`;
    if (!isPlainObject(snapshot)) {
      errors.push(`${label} must be an object when present`);
      continue;
    }
    const claimedEntriesField = entriesFields.find(candidate => candidate in snapshot);
    const claimsRecorderAuthority = 'schema' in snapshot
      || 'retention' in snapshot
      || claimedEntriesField != null;
    if (!claimsRecorderAuthority) continue;
    if (snapshot.retention !== 'uncapped') errors.push(`${label}.retention must be uncapped`);
    if (claimedEntriesField == null) {
      errors.push(`${label} must expose an uncapped telemetry entry array`);
      continue;
    }
    if (!Array.isArray(snapshot[claimedEntriesField])) {
      errors.push(`${label}.${claimedEntriesField} must be an array`);
      continue;
    }
    if (
      field === 'commandDuties'
      && snapshot[claimedEntriesField].length !== report.submittedGpuDutyCount
    ) {
      errors.push(`${label}.${claimedEntriesField} length must equal submittedGpuDutyCount`);
    }
    if (field === 'commandDuties') {
      const gpuRanges = collectGpuRangeEntries(report);
      const rangeByIdentity = new Map(gpuRanges.map(range => [
        JSON.stringify([range.boundaryId, range.rangeId]),
        range,
      ]));
      const observed = new Set();
      for (const [index, entry] of snapshot[claimedEntriesField].entries()) {
        const entryLabel = `${label}.${claimedEntriesField}[${index}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${entryLabel} must be an object`);
          continue;
        }
        const identity = isPlainObject(entry.descriptor?.metadata)
          ? entry.descriptor.metadata
          : entry;
        const key = JSON.stringify([identity.boundaryId, identity.rangeId]);
        const range = rangeByIdentity.get(key);
        if (!range) {
          errors.push(`${entryLabel} must match a retained GPU-command range`);
          continue;
        }
        if (observed.has(key)) {
          errors.push(`${entryLabel} must not duplicate a GPU-command range`);
        }
        observed.add(key);
        if (identity.rangeIndex != null && identity.rangeIndex !== range.rangeIndex) {
          errors.push(`${entryLabel}.rangeIndex must match retained GPU-command range`);
        }
      }
    }
  }
}

function collectGpuRangeEntries(report) {
  const entries = [];
  for (const boundary of Array.isArray(report.boundaries) ? report.boundaries : []) {
    if (!isPlainObject(boundary) || boundary.kind !== 'gpu-command') continue;
    for (const range of Array.isArray(boundary.ranges) ? boundary.ranges : []) {
      if (!isPlainObject(range)) continue;
      entries.push({
        boundaryId: boundary.boundaryId,
        rangeId: range.rangeId,
        rangeIndex: range.rangeIndex,
      });
    }
  }
  return entries;
}

function gpuRangeKey(value) {
  return JSON.stringify([value.boundaryId, value.rangeId, value.rangeIndex]);
}

function validateGpuDutyEvidence(errors, report) {
  const gpuRangeEntries = collectGpuRangeEntries(report);
  const gpuRangesByKey = new Map(gpuRangeEntries.map(entry => [gpuRangeKey(entry), entry]));
  if (
    report.status === 'succeeded'
    && report.submittedGpuDutyCount !== gpuRangeEntries.length
  ) {
    errors.push('submittedGpuDutyCount must equal completed GPU-command ranges');
  } else if (
    report.status !== 'succeeded'
    && isNonnegativeSafeInteger(report.submittedGpuDutyCount)
    && report.submittedGpuDutyCount > gpuRangeEntries.length
  ) {
    errors.push('submittedGpuDutyCount must not exceed retained GPU-command ranges');
  }
  if (!Array.isArray(report.gpuDuties)) return;
  const retiredRows = report.gpuDuties.filter(duty => duty?.status === 'retired').length;
  if (report.retiredGpuDutyCount !== retiredRows) {
    errors.push('retiredGpuDutyCount must equal retired gpuDuties rows');
  }
  const dutyCountByRangeKey = new Map();
  const dutyIds = new Set();
  for (const [index, duty] of report.gpuDuties.entries()) {
    const label = `gpuDuties[${index}]`;
    if (!isPlainObject(duty)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyString(duty.dutyId) || dutyIds.has(duty.dutyId)) {
      errors.push(`${label}.dutyId must be unique and non-empty`);
    } else {
      dutyIds.add(duty.dutyId);
    }
    const rangeKey = gpuRangeKey(duty);
    if (!gpuRangesByKey.has(rangeKey)) {
      errors.push(`${label} must match a retained GPU-command range`);
    } else {
      dutyCountByRangeKey.set(rangeKey, (dutyCountByRangeKey.get(rangeKey) || 0) + 1);
    }
    const allowedStatuses = report.status === 'succeeded'
      ? new Set(['retired'])
      : new Set(['retired', 'retired-after-failure', 'failed']);
    if (!allowedStatuses.has(duty.status)) {
      errors.push(`${label}.status must be terminal for report status ${report.status}`);
    }
    if (!Number.isFinite(duty.submittedAtMs)) {
      errors.push(`${label}.submittedAtMs must be finite`);
    }
    if (!Number.isFinite(duty.retiredAtMs) || duty.retiredAtMs < duty.submittedAtMs) {
      errors.push(`${label}.retiredAtMs must be finite and not precede submittedAtMs`);
    }
    if (!isFiniteNonnegative(duty.rawQueueDurationMs)) {
      errors.push(`${label}.rawQueueDurationMs must be finite nonnegative`);
    } else if (
      Number.isFinite(duty.submittedAtMs)
      && Number.isFinite(duty.retiredAtMs)
      && !sameDuration(duty.rawQueueDurationMs, duty.retiredAtMs - duty.submittedAtMs)
    ) {
      errors.push(`${label}.rawQueueDurationMs must equal retiredAtMs - submittedAtMs`);
    }
    const allowedTimingAuthorities = duty.status === 'failed'
      ? new Set(['queue-work-done-prefix-fence-rejected'])
      : new Set(['queue-work-done']);
    if (!allowedTimingAuthorities.has(duty.timingAuthority)) {
      errors.push(`${label}.timingAuthority must be queue-work-done terminal authority`);
    }
    if (report.status === 'succeeded' && duty.failure != null) {
      errors.push(`${label}.failure must be null on success`);
    }
  }
  if (report.completionPolicy === 'bounded-prefix' && report.status === 'succeeded') {
    if (report.gpuDuties.length !== gpuRangeEntries.length) {
      errors.push('gpuDuties length must equal completed GPU-command ranges');
    }
    for (const entry of gpuRangeEntries) {
      if (dutyCountByRangeKey.get(gpuRangeKey(entry)) !== 1) {
        errors.push(
          `completed GPU-command range ${entry.boundaryId}/${entry.rangeId} `
          + 'must have exactly one gpuDuty',
        );
      }
    }
  }
}

function validateBoundedDuties(errors, report, expected) {
  if (report.schedulingMode !== 'cooperative') {
    errors.push('bounded-prefix completion requires cooperative schedulingMode');
  }
  if (!Number.isSafeInteger(report.maxInFlightGpuDuties) || report.maxInFlightGpuDuties <= 0) {
    errors.push('maxInFlightGpuDuties must be a positive safe integer for bounded-prefix');
  }
  if (
    !isNonnegativeSafeInteger(report.maxObservedInFlightGpuDuties)
    || report.maxObservedInFlightGpuDuties > report.maxInFlightGpuDuties
  ) {
    errors.push('maxObservedInFlightGpuDuties must not exceed maxInFlightGpuDuties');
  }
  if (
    report.submittedGpuDutyCount > 0
    && report.maxObservedInFlightGpuDuties === 0
  ) {
    errors.push('maxObservedInFlightGpuDuties must observe submitted bounded work');
  }
  if (
    expected.expectedMaxInFlightGpuDuties != null
    && report.maxInFlightGpuDuties !== expected.expectedMaxInFlightGpuDuties
  ) {
    errors.push(
      `maxInFlightGpuDuties must match expected ${expected.expectedMaxInFlightGpuDuties}`,
    );
  }
  if (
    expected.requireConfiguredDepthObserved
    && report.maxObservedInFlightGpuDuties !== report.maxInFlightGpuDuties
  ) {
    errors.push('maxObservedInFlightGpuDuties must equal configured maxInFlightGpuDuties');
  }
  if (report.queueCompletionAuthority !== 'bounded-per-gpu-duty-prefix-fence') {
    errors.push(
      'queueCompletionAuthority must be bounded-per-gpu-duty-prefix-fence for bounded-prefix',
    );
  }
  if (report.observedPrefixFenceCount !== report.submittedGpuDutyCount) {
    errors.push('observedPrefixFenceCount must equal submittedGpuDutyCount');
  }
  if (Array.isArray(report.gpuDuties) && report.gpuDuties.length !== report.issuedGpuDutyCount) {
    errors.push('gpuDuties length must equal issuedGpuDutyCount');
  }
  if (report.status === 'succeeded') {
    if (report.issuedGpuDutyCount !== report.submittedGpuDutyCount) {
      errors.push('issuedGpuDutyCount must equal submittedGpuDutyCount');
    }
    if (report.retiredGpuDutyCount !== report.issuedGpuDutyCount) {
      errors.push('retiredGpuDutyCount must equal issuedGpuDutyCount');
    }
  }
}

function validateStrictCompletion(errors, report) {
  if (report.completionPolicy !== 'strict-prefix' || report.submittedGpuDutyCount === 0) return;
  const expectedAuthority = report.schedulingMode === 'cooperative'
    ? 'per-gpu-duty-prefix-fence'
    : 'one-terminal-prefix-fence';
  if (report.queueCompletionAuthority !== expectedAuthority) {
    errors.push(`queueCompletionAuthority must be ${expectedAuthority} for strict-prefix`);
  }
  if (
    report.schedulingMode === 'cooperative'
    && report.observedPrefixFenceCount !== report.submittedGpuDutyCount
  ) {
    errors.push('observedPrefixFenceCount must equal submittedGpuDutyCount');
  }
}

export function validateWebGpuCooperativeExecutionReport(report, expectationInput = {}) {
  const expected = normalizeExpectations(expectationInput);
  const errors = [];
  if (!isPlainObject(report)) {
    errors.push('report must be an object');
    return Object.freeze({
      schema: WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA,
      ok: false,
      errors: Object.freeze(errors),
      expected,
      effective: null,
    });
  }

  if (report.schema !== WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA}`);
  }
  for (const field of ['routeId', 'manifestId', 'invocationId']) {
    if (!isNonEmptyString(report[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!STATUS_VALUES.has(report.status)) errors.push('status has an unsupported value');
  if (report.status !== expected.expectedStatus) {
    errors.push(`status must match expected ${expected.expectedStatus}`);
  }
  if (!SCHEDULING_MODES.has(report.schedulingMode)) {
    errors.push('schedulingMode must be cooperative or disabled');
  }
  if (!COMPLETION_POLICIES.has(report.completionPolicy)) {
    errors.push('completionPolicy must be strict-prefix or bounded-prefix');
  }
  validateExpectedIdentity(errors, report, expected.expectedRouteId, 'routeId');
  validateExpectedIdentity(errors, report, expected.expectedManifestId, 'manifestId');
  validateExpectedIdentity(errors, report, expected.expectedInvocationId, 'invocationId');
  if (
    expected.expectedSchedulingMode != null
    && report.schedulingMode !== expected.expectedSchedulingMode
  ) {
    errors.push(`schedulingMode must match expected ${expected.expectedSchedulingMode}`);
  }
  if (
    expected.expectedCompletionPolicy != null
    && report.completionPolicy !== expected.expectedCompletionPolicy
  ) {
    errors.push(`completionPolicy must match expected ${expected.expectedCompletionPolicy}`);
  }
  if (report.retention !== 'uncapped') errors.push('retention must be uncapped');
  if (!Number.isFinite(report.startedAtMs) || !Number.isFinite(report.endedAtMs)) {
    errors.push('startedAtMs and endedAtMs must be finite');
  } else if (report.endedAtMs < report.startedAtMs) {
    errors.push('endedAtMs must not precede startedAtMs');
  } else if (!sameDuration(report.durationMs, report.endedAtMs - report.startedAtMs)) {
    errors.push('durationMs must equal endedAtMs - startedAtMs');
  }
  if (report.status === 'succeeded') {
    if (report.failure != null) errors.push('failure must be null on success');
  } else {
    validateNormalizedFailure(errors, report.failure, `failure for ${report.status}`);
  }

  validateCounts(errors, report, expected.expectedGpuDutyCount);
  validateRuntimeTelemetry(errors, report);
  validateTerminalProgress(errors, report);
  validateBoundaries(errors, report);
  reconcileProgressWithBoundaries(errors, report.progress, report.boundaries);
  validateGpuDutyEvidence(errors, report);
  if (report.completionPolicy === 'bounded-prefix') {
    validateBoundedDuties(errors, report, expected);
  }
  validateStrictCompletion(errors, report);

  const effective = Object.freeze({
    status: report.status ?? null,
    routeId: report.routeId ?? null,
    manifestId: report.manifestId ?? null,
    invocationId: report.invocationId ?? null,
    schedulingMode: report.schedulingMode ?? null,
    completionPolicy: report.completionPolicy ?? null,
    gpuDutyCount: report.submittedGpuDutyCount ?? null,
    queueCompletionAuthority: report.queueCompletionAuthority ?? null,
  });
  return Object.freeze({
    schema: WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA,
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    expected,
    effective,
  });
}
