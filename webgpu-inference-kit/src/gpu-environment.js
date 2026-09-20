const LIMIT_KEYS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
];

function featureList(features) {
  if (!features) return [];
  return Array.from(features).map(String).sort();
}

function hasFeature(features, name) {
  return featureList(features).includes(name);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function copyLimits(limits = {}) {
  const out = {};
  for (const key of LIMIT_KEYS) {
    if (Number.isFinite(limits[key])) out[key] = limits[key];
  }
  return out;
}

// WebGPU limit classes: maximum limits improve upward; alignment limits improve
// downward. https://gpuweb.github.io/gpuweb/#limits
const ALIGNMENT_LIMITS = new Set(['minUniformBufferOffsetAlignment', 'minStorageBufferOffsetAlignment']);

export function composeWebGpuDeviceRequirements(requirements = []) {
  if (!Array.isArray(requirements)) throw new Error('device requirements must be an array of descriptors');
  const features = new Set();
  const limits = {};
  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new Error('each device requirement must be a descriptor');
    }
    const requiredFeatures = requirement.requiredFeatures ?? [];
    if (typeof requiredFeatures === 'string' || typeof requiredFeatures[Symbol.iterator] !== 'function') {
      throw new Error('requiredFeatures must be an iterable of feature names');
    }
    for (const feature of requiredFeatures) {
      if (!isNonEmptyString(feature)) throw new Error('requiredFeatures must contain non-empty feature names');
      features.add(feature);
    }
    const requiredLimits = requirement.requiredLimits ?? {};
    if (typeof requiredLimits !== 'object' || Array.isArray(requiredLimits)) throw new Error('requiredLimits must be an object');
    for (const [name, value] of Object.entries(requiredLimits)) {
      if (!name.startsWith('max') && !ALIGNMENT_LIMITS.has(name)) throw new Error(`unknown limit class: ${name}`);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
      if (ALIGNMENT_LIMITS.has(name) && (value === 0 || value >= 2 ** 32 || (BigInt(value) & (BigInt(value) - 1n)) !== 0n)) {
        throw new Error(`${name} must be a positive power of two below 2^32`);
      }
      const combine = ALIGNMENT_LIMITS.has(name) ? Math.min : Math.max;
      limits[name] = Object.hasOwn(limits, name) ? combine(limits[name], value) : value;
    }
  }
  return Object.freeze({ requiredFeatures: Object.freeze([...features].sort()), requiredLimits: Object.freeze(limits) });
}

export function validateWebGpuDeviceRequirements(device, requirements = {}) {
  const composed = composeWebGpuDeviceRequirements([requirements]);
  const enabled = featureList(device?.features);
  const errors = [];
  for (const feature of composed.requiredFeatures) {
    if (!enabled.includes(feature)) errors.push(`required feature ${feature} is unavailable`);
  }
  for (const [name, required] of Object.entries(composed.requiredLimits)) {
    const effective = device?.limits?.[name];
    if (!Number.isFinite(effective)) errors.push(`required limit ${name} is unavailable`);
    else if (ALIGNMENT_LIMITS.has(name) ? effective > required : effective < required) {
      errors.push(`${name}: required ${required}, effective ${effective}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function createWebGpuDeviceRequest(adapter, options = {}) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('adapter must be an object');
  }

  const timestampPreference = options.timestampQuery || 'prefer';
  const requirements = composeWebGpuDeviceRequirements([options.requirements ?? {}]);
  const validation = validateWebGpuDeviceRequirements(adapter, requirements);
  if (!validation.ok) throw new Error(`adapter does not meet device requirements: ${validation.errors.join('; ')}`);
  const requiredFeatures = [...requirements.requiredFeatures];
  if (timestampPreference === 'disable' && requiredFeatures.includes('timestamp-query')) {
    throw new Error('timestamp-query is required but timestampQuery is disable');
  }
  let timestampQuery = 'disabled';

  if (timestampPreference !== 'disable') {
    if (hasFeature(adapter.features, 'timestamp-query')) {
      if (!requiredFeatures.includes('timestamp-query')) requiredFeatures.push('timestamp-query');
      timestampQuery = 'requested';
    } else if (timestampPreference === 'require') {
      throw new Error('timestamp-query required but not supported by adapter');
    } else {
      timestampQuery = 'unavailable';
    }
  }

  return {
    requiredFeatures: requiredFeatures.sort(),
    requiredLimits: { ...copyLimits(adapter.limits), ...requirements.requiredLimits },
    timestampQuery,
  };
}

export function requestBrowserWebGpuDevice(gpu, options = {}) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    throw new Error('gpu.requestAdapter must be available');
  }

  const requirements = options.requirements == null ? null : composeWebGpuDeviceRequirements([options.requirements]);
  return (async () => {
    const adapter = await gpu.requestAdapter(options.adapterOptions || {});
    if (!adapter) throw new Error('WebGPU adapter unavailable');

    const deviceRequest = createWebGpuDeviceRequest(adapter, { ...options, requirements });
    const descriptor = {
      requiredFeatures: deviceRequest.requiredFeatures,
      requiredLimits: deviceRequest.requiredLimits,
    };
    if (isNonEmptyString(options.label)) descriptor.label = options.label;

    const device = await adapter.requestDevice(descriptor);
    if (requirements) {
      const validation = validateWebGpuDeviceRequirements(device, requirements);
      if (!validation.ok) {
        device?.destroy?.();
        throw new Error(`effective device does not meet requirements: ${validation.errors.join('; ')}`);
      }
    }
    const backendIdentity = createWebGpuBackendIdentity({
      adapterName: options.adapterName || adapter.info?.description || adapter.info?.device || adapter.info?.vendor || 'unknown-webgpu-adapter',
      browser: options.browser || globalThis.navigator?.userAgent || null,
      requestedFeatures: deviceRequest.requiredFeatures,
      // Only the device's own feature capture is evidence of enabled
      // features. Requested features are what we asked for, not what we
      // got: substituting them (or []) converts a MISSING observation into
      // a false authoritative claim. Absent stays absent and fails loud.
      effectiveFeatures: device?.features ?? undefined,
      // Same law as features: adapter-supported limits are not evidence of
      // the device's effective limits. Absent capture stays absent — the
      // identity then fails validation loudly instead of presenting
      // support values as observed device state.
      limits: device?.limits ?? undefined,
      timestampQuery: deviceRequest.timestampQuery,
    });

    return {
      adapter,
      device,
      deviceRequest,
      backendIdentity,
    };
  })();
}

export function createWebGpuBackendIdentity(input) {
  return {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: input.adapterName || null,
    browser: input.browser || null,
    requestedFeatures: featureList(input.requestedFeatures),
    // Absent and empty are different observations: a zero-feature device
    // truthfully captures [], while forgetting to capture at all yields
    // undefined and fails validation downstream.
    features: (input.effectiveFeatures != null || input.features != null)
      ? featureList(input.effectiveFeatures || input.features)
      : undefined,
    limits: copyLimits(input.limits),
    timestampQuery: input.timestampQuery || 'unavailable',
  };
}

export function validateWebGpuBackendIdentity(identity) {
  const errors = [];

  if (!identity || typeof identity !== 'object') {
    return { ok: false, errors: ['identity must be an object'] };
  }
  if (identity.kind !== 'webgpu-local') errors.push('kind must be webgpu-local');
  if (identity.runtime !== 'browser') errors.push('runtime must be browser');
  if (!isNonEmptyString(identity.adapterName)) errors.push('adapterName must be a non-empty string');
  if (!Array.isArray(identity.features)) {
    errors.push('features must be an array (empty is lawful for a zero-feature device)');
  }
  if (!identity.limits || typeof identity.limits !== 'object' || Object.keys(identity.limits).length === 0) {
    errors.push('limits must be a non-empty object');
  }

  const timestampStates = new Set(['requested', 'available', 'unavailable', 'disabled']);
  if (!timestampStates.has(identity.timestampQuery)) {
    errors.push('timestampQuery has unsupported state');
  }

  if (identity.timestampQuery === 'requested') {
    const requested = featureList(identity.requestedFeatures);
    const effective = featureList(identity.features);
    if (!requested.includes('timestamp-query')) {
      errors.push('timestamp-query requested state must include timestamp-query in requestedFeatures');
    }
    if (!effective.includes('timestamp-query')) {
      errors.push('timestamp-query requested state must include timestamp-query in features');
    }
  }

  return { ok: errors.length === 0, errors };
}
