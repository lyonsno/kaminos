import {
  WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
  WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
} from './cooperative-execution.js';

export const WEBGPU_COOPERATIVE_REPORT_VALIDATION_SCHEMA =
  'kaminos.webgpu-cooperative-report-validation.v0';

const STATUS_VALUES = new Set(['succeeded', 'failed', 'cancelled']);
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

function validateTerminalProgress(errors, report) {
  const progress = report.progress;
  if (!isPlainObject(progress)) {
    errors.push('progress must be an object');
    return;
  }
  if (progress.schema !== WEBGPU_COOPERATIVE_PROGRESS_SCHEMA) {
    errors.push(`progress.schema must be ${WEBGPU_COOPERATIVE_PROGRESS_SCHEMA}`);
  }
  if (progress.routeId !== report.routeId) errors.push('progress.routeId must match routeId');
  if (progress.invocationId !== report.invocationId) {
    errors.push('progress.invocationId must match invocationId');
  }
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
  if (!Array.isArray(progress.phases)) {
    errors.push('progress.phases must be an array');
    return;
  }
  if (report.status === 'succeeded') {
    for (const [index, phase] of progress.phases.entries()) {
      if (
        !isPlainObject(phase)
        || phase.status !== 'complete'
        || !isNonnegativeSafeInteger(phase.totalItems)
        || phase.completedItems !== phase.totalItems
        || phase.progress !== 1
        || phase.percent !== 100
      ) {
        errors.push(`progress.phases[${index}] must prove terminal completion`);
      }
    }
  }
}

function validateBoundaryRanges(errors, boundary, index) {
  const label = `boundaries[${index}]`;
  if (!Array.isArray(boundary.ranges)) {
    errors.push(`${label}.ranges must be an array`);
    return;
  }
  if (boundary.rangeCount !== boundary.ranges.length) {
    errors.push(`${label}.rangeCount must equal ranges length`);
  }
  if (boundary.actualRangeCount !== boundary.ranges.length) {
    errors.push(`${label}.actualRangeCount must equal ranges length`);
  }
  if (boundary.rangeCountAuthority !== 'actual') {
    errors.push(`${label}.rangeCountAuthority must be actual`);
  }
  const rangeIds = new Set();
  let coveredItems = 0;
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
    if (range.rangeIndex !== rangeIndex) {
      errors.push(`${rangeLabel}.rangeIndex must equal ${rangeIndex}`);
    }
    if (
      !isNonnegativeSafeInteger(range.itemStart)
      || !Number.isSafeInteger(range.itemCount)
      || range.itemCount <= 0
      || range.itemEnd !== range.itemStart + range.itemCount
      || range.itemStart !== coveredItems
    ) {
      errors.push(`${rangeLabel} must provide contiguous positive item coverage`);
    }
    if (Number.isSafeInteger(range.itemEnd)) coveredItems = range.itemEnd;
  }
  if (isNonnegativeSafeInteger(boundary.totalItems) && coveredItems !== boundary.totalItems) {
    errors.push(`${label}.ranges must cover totalItems exactly`);
  }
}

function validateBoundaries(errors, report) {
  if (!Array.isArray(report.boundaries) || report.boundaries.length === 0) {
    errors.push('boundaries must be a non-empty array');
    return;
  }
  if (report.status !== 'succeeded') return;
  for (const [index, boundary] of report.boundaries.entries()) {
    const label = `boundaries[${index}]`;
    if (!isPlainObject(boundary)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (
      boundary.status !== 'complete'
      || !isNonnegativeSafeInteger(boundary.totalItems)
      || boundary.completedItems !== boundary.totalItems
      || boundary.progress !== 1
    ) {
      errors.push(`${label} must prove terminal completion`);
    }
    if (boundary.failure != null) errors.push(`${label}.failure must be null on success`);
    if (
      boundary.planner != null
      && (
        boundary.planner.pendingRangeId != null
        || (
          boundary.planner.pendingRangeCount != null
          && boundary.planner.pendingRangeCount !== 0
        )
      )
    ) {
      errors.push(`${label}.planner must have no pending ranges`);
    }
    validateBoundaryRanges(errors, boundary, index);
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
  if (!Array.isArray(report.gpuDuties)) return;
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
  if (report.status === 'succeeded' && report.failure != null) {
    errors.push('failure must be null on success');
  }

  validateCounts(errors, report, expected.expectedGpuDutyCount);
  validateTerminalProgress(errors, report);
  validateBoundaries(errors, report);
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
