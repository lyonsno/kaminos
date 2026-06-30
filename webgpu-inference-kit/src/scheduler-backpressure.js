export const WEBGPU_ROUTE_SCHEDULER_SCHEMA = 'kaminos.webgpu-route-scheduler.v0';
export const WEBGPU_ROUTE_BACKPRESSURE_SCHEMA = 'kaminos.webgpu-route-backpressure.v0';

const SCHEDULER_MODES = new Set(['throughput', 'cooperative']);
const VERIFICATION_STATES = new Set(['verified', 'scheduler-unverified', 'unsupported']);
const BUDGETS = new Set(['interactive', 'visible-wait', 'furnace', 'batch', 'unknown']);
const MEMORY_EXCLUSIVITY = new Set(['shared', 'exclusive', 'unknown']);
const WARM_CACHE_STATES = new Set(['cold', 'warm', 'hot', 'unknown']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizePhaseChunkSize(input = {}) {
  const out = {};
  if (!isPlainObject(input)) return out;
  for (const [phase, chunkSize] of Object.entries(input)) {
    out[phase] = chunkSize;
  }
  return out;
}

function normalizeScheduler(input = {}) {
  return {
    mode: input.mode || 'throughput',
    yieldMs: input.yieldMs ?? 0,
    waitForSubmittedWorkDone: Boolean(input.waitForSubmittedWorkDone),
    phaseChunkSize: normalizePhaseChunkSize(input.phaseChunkSize),
  };
}

function normalizeEffectiveScheduler(input = {}, requestedScheduler) {
  const base = normalizeScheduler({
    ...requestedScheduler,
    ...input,
    phaseChunkSize: input.phaseChunkSize ?? requestedScheduler.phaseChunkSize,
  });
  return {
    ...base,
    unsupportedFields: Array.isArray(input.unsupportedFields) ? [...input.unsupportedFields] : [],
  };
}

function validateSchedulerShape(errors, scheduler, label) {
  if (!isPlainObject(scheduler)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!SCHEDULER_MODES.has(scheduler.mode)) {
    errors.push(`${label}.mode must be throughput or cooperative`);
  }
  if (!isNonNegativeNumber(scheduler.yieldMs)) {
    errors.push(`${label}.yieldMs must be a non-negative number`);
  }
  if (typeof scheduler.waitForSubmittedWorkDone !== 'boolean') {
    errors.push(`${label}.waitForSubmittedWorkDone must be a boolean`);
  }
  if (!isPlainObject(scheduler.phaseChunkSize)) {
    errors.push(`${label}.phaseChunkSize must be an object`);
    return;
  }
  for (const [phase, chunkSize] of Object.entries(scheduler.phaseChunkSize)) {
    if (!isNonEmptyString(phase)) errors.push(`${label}.phaseChunkSize contains an empty phase name`);
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      errors.push(`${label}.phaseChunkSize.${phase} must be a positive integer`);
    }
  }
}

function missingUnsupportedField(effectiveScheduler, field) {
  return !effectiveScheduler.unsupportedFields.includes(field)
    && !effectiveScheduler.unsupportedFields.includes('phaseChunkSize');
}

export function createWebGpuRouteSchedulerProfile(input = {}) {
  const requestedScheduler = normalizeScheduler(input.requestedScheduler || input);
  const effectiveScheduler = normalizeEffectiveScheduler(
    input.effectiveScheduler || {},
    requestedScheduler,
  );
  const verificationState = input.verificationState
    || (requestedScheduler.mode === 'cooperative' ? 'scheduler-unverified' : 'unsupported');

  const profile = {
    schema: WEBGPU_ROUTE_SCHEDULER_SCHEMA,
    requestedScheduler,
    effectiveScheduler,
    verificationState,
  };

  const result = validateWebGpuRouteSchedulerProfile(profile);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return profile;
}

export function validateWebGpuRouteSchedulerProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['scheduler profile must be an object'] };
  }
  if (profile.schema !== WEBGPU_ROUTE_SCHEDULER_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_SCHEDULER_SCHEMA}`);
  }
  validateSchedulerShape(errors, profile.requestedScheduler, 'requestedScheduler');
  validateSchedulerShape(errors, profile.effectiveScheduler, 'effectiveScheduler');

  if (!Array.isArray(profile.effectiveScheduler?.unsupportedFields)) {
    errors.push('effectiveScheduler.unsupportedFields must be an array');
  } else {
    for (const field of profile.effectiveScheduler.unsupportedFields) {
      if (!isNonEmptyString(field)) errors.push('effectiveScheduler.unsupportedFields entries must be non-empty strings');
    }
  }

  if (!VERIFICATION_STATES.has(profile.verificationState)) {
    errors.push('verificationState must be verified, scheduler-unverified, or unsupported');
  }

  if (isPlainObject(profile.requestedScheduler) && isPlainObject(profile.effectiveScheduler)) {
    for (const [phase, requestedChunk] of Object.entries(profile.requestedScheduler.phaseChunkSize || {})) {
      const effectiveChunk = profile.effectiveScheduler.phaseChunkSize?.[phase];
      const field = `phaseChunkSize.${phase}`;
      if (effectiveChunk !== requestedChunk && missingUnsupportedField(profile.effectiveScheduler, field)) {
        if (profile.verificationState === 'verified') {
          errors.push(`verified scheduler cannot drop requested ${field}`);
        } else {
          errors.push(`effectiveScheduler must list unsupported ${field}`);
        }
      }
    }
  }

  if (profile.verificationState === 'verified') {
    if (profile.effectiveScheduler?.unsupportedFields?.length > 0) {
      errors.push('verified scheduler cannot include unsupportedFields');
    }
    if (profile.requestedScheduler?.mode === 'cooperative' && profile.effectiveScheduler?.mode !== 'cooperative') {
      errors.push('verified cooperative scheduler must have effectiveScheduler.mode cooperative');
    }
  }

  return { ok: errors.length === 0, errors };
}

function normalizeFrameTail(input = {}) {
  return {
    sampleWindowMs: input.sampleWindowMs ?? 0,
    longFrameCount: input.longFrameCount ?? 0,
    maxFrameGapMs: input.maxFrameGapMs ?? 0,
    p95FrameGapMs: input.p95FrameGapMs ?? null,
    p99FrameGapMs: input.p99FrameGapMs ?? null,
  };
}

export function createWebGpuRouteBackpressureProfile(input = {}) {
  const profile = {
    schema: WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
    requestedBudget: input.requestedBudget || 'unknown',
    effectiveBudget: input.effectiveBudget || input.requestedBudget || 'unknown',
    memoryExclusivity: input.memoryExclusivity || 'unknown',
    warmCacheState: input.warmCacheState || 'unknown',
    frameTail: normalizeFrameTail(input.frameTail),
  };
  const result = validateWebGpuRouteBackpressureProfile(profile);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return profile;
}

function validateOptionalFrameMs(errors, frameTail, field) {
  if (frameTail[field] != null && !isNonNegativeNumber(frameTail[field])) {
    errors.push(`frameTail.${field} must be null or a non-negative number`);
  }
}

export function validateWebGpuRouteBackpressureProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['backpressure profile must be an object'] };
  }
  if (profile.schema !== WEBGPU_ROUTE_BACKPRESSURE_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_BACKPRESSURE_SCHEMA}`);
  }
  if (!BUDGETS.has(profile.requestedBudget)) errors.push('requestedBudget has unsupported value');
  if (!BUDGETS.has(profile.effectiveBudget)) errors.push('effectiveBudget has unsupported value');
  if (!MEMORY_EXCLUSIVITY.has(profile.memoryExclusivity)) errors.push('memoryExclusivity has unsupported value');
  if (!WARM_CACHE_STATES.has(profile.warmCacheState)) errors.push('warmCacheState has unsupported value');

  if (!isPlainObject(profile.frameTail)) {
    errors.push('frameTail must be an object');
  } else {
    if (!isNonNegativeNumber(profile.frameTail.sampleWindowMs)) {
      errors.push('frameTail.sampleWindowMs must be a non-negative number');
    }
    if (!Number.isInteger(profile.frameTail.longFrameCount) || profile.frameTail.longFrameCount < 0) {
      errors.push('frameTail.longFrameCount must be a non-negative integer');
    }
    if (!isNonNegativeNumber(profile.frameTail.maxFrameGapMs)) {
      errors.push('frameTail.maxFrameGapMs must be a non-negative number');
    }
    validateOptionalFrameMs(errors, profile.frameTail, 'p95FrameGapMs');
    validateOptionalFrameMs(errors, profile.frameTail, 'p99FrameGapMs');
  }

  return { ok: errors.length === 0, errors };
}

export function cloneWebGpuRouteSchedulerProfile(profile) {
  return clone(profile);
}
