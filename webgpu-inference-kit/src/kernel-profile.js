export const WEBGPU_INFERENCE_KIT_VERSION = '0.1.17';
const DEFAULT_KIT_VERSION = WEBGPU_INFERENCE_KIT_VERSION;
const DEFAULT_TIMING_SOURCE = 'queue-submit-wait';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSource(input) {
  return input && typeof input === 'object' ? input : {};
}

function stringOrDefault(value, fallback) {
  return isNonEmptyString(value) ? value : fallback;
}

export function validateKernelProfileMetadata(kernel) {
  const errors = [];

  if (!kernel || typeof kernel !== 'object') {
    return { ok: false, errors: ['kernel must be an object'] };
  }

  if (!isNonEmptyString(kernel.kitVersion)) errors.push('kernel.kitVersion must be a non-empty string');
  if (!isNonEmptyString(kernel.profile)) errors.push('kernel.profile must be a non-empty string');
  if (kernel.commit != null && typeof kernel.commit !== 'string') {
    errors.push('kernel.commit must be a string or null');
  }

  return { ok: errors.length === 0, errors };
}

export function createKernelProfileMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  const kernel = {
    kitVersion: stringOrDefault(source.kitVersion, options.defaultKitVersion || DEFAULT_KIT_VERSION),
    profile: stringOrDefault(source.profile, options.defaultProfile),
    commit: source.commit || null,
  };

  if (options.requireProfile === true || options.validate === true) {
    const result = validateKernelProfileMetadata(kernel);
    if (!result.ok) throw new Error(result.errors.join('; '));
  }

  return kernel;
}

export function validateRouteTimingMetadata(timing) {
  const errors = [];

  if (!timing || typeof timing !== 'object') {
    return { ok: false, errors: ['timing metadata must be an object'] };
  }

  if (!Array.isArray(timing.requiredStages) || timing.requiredStages.length === 0) {
    errors.push('requiredStages must be a non-empty array');
  } else {
    timing.requiredStages.forEach((stage, index) => {
      if (!isNonEmptyString(stage)) errors.push(`requiredStages[${index}] must be a non-empty string`);
    });
  }
  if (!isNonEmptyString(timing.timingSource)) errors.push('timingSource must be a non-empty string');

  return { ok: errors.length === 0, errors };
}

export function createRouteTimingMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  const requiredStages = Array.isArray(source.requiredStages)
    ? source.requiredStages
    : (Array.isArray(options.requiredStages) ? options.requiredStages : []);

  const timing = {
    requiredStages: [...requiredStages],
    timingSource: stringOrDefault(source.timingSource, options.timingSource || DEFAULT_TIMING_SOURCE),
  };

  if (options.validate === true) {
    const result = validateRouteTimingMetadata(timing);
    if (!result.ok) throw new Error(result.errors.join('; '));
  }

  return timing;
}

export function createRouteKernelProfileMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  return {
    kernel: createKernelProfileMetadata(source.kernel, {
      defaultKitVersion: options.defaultKitVersion,
      defaultProfile: options.defaultProfile,
      requireProfile: options.requireProfile,
      validate: options.validateKernel,
    }),
    ...createRouteTimingMetadata(source, {
      requiredStages: options.requiredStages,
      timingSource: options.timingSource,
      validate: options.validateTiming,
    }),
  };
}
