export const WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA = 'kaminos.webgpu-command-duty-descriptor.v0';
export const WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA = 'kaminos.webgpu-command-duty-observation.v0';

const COMMAND_DUTY_KINDS = new Set(['compute', 'copy', 'render', 'mixed']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireIdentity(name, value) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function normalizeChunkControl(input) {
  if (input == null) return null;
  if (!isPlainObject(input)) throw new TypeError('chunkControl must be null or an object');
  const controlId = requireIdentity('chunkControl.controlId', input.controlId);
  const unit = requireIdentity('chunkControl.unit', input.unit);
  const bounds = input.bounds;
  if (!isPlainObject(bounds)) throw new TypeError('chunkControl.bounds must be an object');
  if (!Number.isInteger(bounds.min) || bounds.min < 1
    || !Number.isInteger(bounds.max) || bounds.max < bounds.min) {
    throw new TypeError('chunkControl.bounds must declare ordered positive integer min and max');
  }
  if (!Number.isFinite(bounds.stepFactor) || bounds.stepFactor <= 1) {
    throw new TypeError('chunkControl.bounds.stepFactor must be greater than 1');
  }
  if (!Number.isInteger(input.current) || input.current < bounds.min || input.current > bounds.max) {
    throw new TypeError('chunkControl.current is outside caller-declared bounds');
  }
  return {
    controlId,
    unit,
    current: input.current,
    bounds: {
      min: bounds.min,
      max: bounds.max,
      stepFactor: bounds.stepFactor,
    },
  };
}

export function createWebGpuCommandDutyDescriptor(input = {}) {
  if (input.interruptible === true || input.submissionBoundary?.interruptible === true) {
    throw new TypeError('submitted command duty is non-preemptible; split work before submission');
  }
  const kind = requireIdentity('kind', input.kind);
  if (!COMMAND_DUTY_KINDS.has(kind)) {
    throw new TypeError(`kind must be one of: ${[...COMMAND_DUTY_KINDS].join(', ')}`);
  }
  if (input.metadata != null && !isPlainObject(input.metadata)) {
    throw new TypeError('metadata must be an object when provided');
  }
  return {
    schema: WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA,
    dutyId: requireIdentity('dutyId', input.dutyId),
    routeId: requireIdentity('routeId', input.routeId),
    runId: requireIdentity('runId', input.runId),
    clockId: requireIdentity('clockId', input.clockId),
    phase: requireIdentity('phase', input.phase),
    kind,
    submissionBoundary: {
      interruptible: false,
      canSplitBefore: true,
      canSplitAfter: true,
      authority: 'submitted-command-buffer-non-preemptible',
    },
    chunkControl: normalizeChunkControl(input.chunkControl),
    metadata: clone(input.metadata || {}),
  };
}

function normalizeObservedDuty(row, identity, dutyIds) {
  if (!isPlainObject(row)) throw new TypeError('observed duty rows must be objects');
  const descriptor = row.descriptor;
  if (descriptor?.schema !== WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA) {
    throw new TypeError('observed duty descriptor schema is invalid');
  }
  const normalizedDescriptor = createWebGpuCommandDutyDescriptor(descriptor);
  const boundary = descriptor.submissionBoundary;
  if (!isPlainObject(boundary)
    || boundary.interruptible !== false
    || boundary.canSplitBefore !== true
    || boundary.canSplitAfter !== true
    || boundary.authority !== 'submitted-command-buffer-non-preemptible') {
    throw new TypeError('observed duty submission boundary is invalid');
  }
  if (normalizedDescriptor.routeId !== identity.routeId) throw new Error('command duty route identity mismatch');
  if (normalizedDescriptor.runId !== identity.runId) throw new Error('command duty run identity mismatch');
  if (normalizedDescriptor.clockId !== identity.clockId) throw new Error('command duty clock identity mismatch');
  if (dutyIds.has(normalizedDescriptor.dutyId)) {
    throw new Error(`duplicate dutyId: ${normalizedDescriptor.dutyId}`);
  }
  dutyIds.add(normalizedDescriptor.dutyId);
  if (!isFiniteNonNegative(row.observedDurationMs)) {
    throw new TypeError('observedDurationMs must be finite and non-negative');
  }
  if (!isFiniteNonNegative(row.foregroundOverlapDurationMs)
    || row.foregroundOverlapDurationMs > row.observedDurationMs) {
    throw new TypeError('foreground overlap duration must be finite, non-negative, and no greater than observed duration');
  }
  return {
    descriptor: normalizedDescriptor,
    observedDurationMs: row.observedDurationMs,
    foregroundOverlapDurationMs: row.foregroundOverlapDurationMs,
  };
}

export function createWebGpuCommandDutyObservation(input = {}) {
  if (input.maxDuties != null || input.retention != null && input.retention !== 'uncapped') {
    throw new TypeError('command duty observation retention is uncapped; capped retention is not supported');
  }
  const identity = {
    routeId: requireIdentity('routeId', input.routeId),
    runId: requireIdentity('runId', input.runId),
    clockId: requireIdentity('clockId', input.clockId),
    firingId: requireIdentity('firingId', input.firingId),
  };
  if (!Array.isArray(input.duties)) throw new TypeError('duties must be an array');
  const dutyIds = new Set();
  const duties = input.duties.map(row => normalizeObservedDuty(row, identity, dutyIds));
  return {
    schema: WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA,
    status: 'observed',
    identity,
    retention: 'uncapped',
    dutyCount: duties.length,
    duties,
    totals: {
      observedDurationMs: duties.reduce((sum, row) => sum + row.observedDurationMs, 0),
      foregroundOverlapDurationMs: duties.reduce(
        (sum, row) => sum + row.foregroundOverlapDurationMs,
        0,
      ),
    },
  };
}
