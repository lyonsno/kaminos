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

export function createWebGpuDeviceRequest(adapter, options = {}) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('adapter must be an object');
  }

  const timestampPreference = options.timestampQuery || 'prefer';
  const requiredFeatures = [];
  let timestampQuery = 'disabled';

  if (timestampPreference !== 'disable') {
    if (hasFeature(adapter.features, 'timestamp-query')) {
      requiredFeatures.push('timestamp-query');
      timestampQuery = 'requested';
    } else if (timestampPreference === 'require') {
      throw new Error('timestamp-query required but not supported by adapter');
    } else {
      timestampQuery = 'unavailable';
    }
  }

  return {
    requiredFeatures,
    requiredLimits: copyLimits(adapter.limits),
    timestampQuery,
  };
}

export function requestBrowserWebGpuDevice(gpu, options = {}) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    throw new Error('gpu.requestAdapter must be available');
  }

  return (async () => {
    const adapter = await gpu.requestAdapter(options.adapterOptions || {});
    if (!adapter) throw new Error('WebGPU adapter unavailable');

    const deviceRequest = createWebGpuDeviceRequest(adapter, options);
    const descriptor = {
      requiredFeatures: deviceRequest.requiredFeatures,
      requiredLimits: deviceRequest.requiredLimits,
    };
    if (isNonEmptyString(options.label)) descriptor.label = options.label;

    const device = await adapter.requestDevice(descriptor);
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
