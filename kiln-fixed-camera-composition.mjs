export const KILN_FIXED_CAMERA_COMPOSITION_IDENTITY = 'normal-lit-fixed-camera-plate-v0';
export const KILN_FIXED_CAMERA_PRESET_ID = 'vsp-341c2a315b094a6de625f63dfffa5a8b4e3c49cf534e428f5c9301698286b424';
export const KILN_FIXED_CAMERA_PRESET_AUTHORITY = 'shared-volume-settings-preset-v2';
export const KILN_FIXED_CAMERA_ASSETS = Object.freeze({
  plate: Object.freeze({
    root: 'image-inbox',
    path: 'kiln-room-pre-ignition-source-v1.png',
    sha256: '6fd7e60f95f81452c62ac8e5c8b82c93d7736b1f0552c521495bf21e2335debb',
    dimensions: Object.freeze([1536, 1024]),
  }),
  normal: Object.freeze({
    root: 'reconstructions',
    path: 'kiln-room-pre-ignition-source-v1/lotus-normal-v1/normal.png',
    sha256: 'f7237e8eceedeb8833a217b7bc45f21d553a2fd1e04170d217260658435ca216',
    dimensions: Object.freeze([1024, 1024]),
  }),
});
export const KILN_FIXED_CAMERA_ROUTE_PARAMS = Object.freeze([
  'kiln_composition',
  'kiln_plate_root',
  'kiln_plate_path',
  'kiln_plate_sha256',
  'kiln_normal_root',
  'kiln_normal_path',
  'kiln_normal_sha256',
  'kiln_fire_x',
  'kiln_fire_y',
  'kiln_fire_scale_x',
  'kiln_fire_scale_y',
  'kiln_fire_source_overscan',
  'kiln_light_radius',
  'kiln_light_intensity',
  'kiln_plate_ambient',
  'kiln_normal_y_sign',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function cloneKilnValue(value) {
  if (Array.isArray(value)) return value.map(cloneKilnValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneKilnValue(nested)]));
  }
  return value;
}

function freezeKilnValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeKilnValue(nested);
  return Object.freeze(value);
}

export function detachedKilnFixedCameraCompositionReceipt(composition) {
  return composition ? cloneKilnValue(composition) : null;
}

export function createImmutableKilnFixedCameraComposition(composition) {
  return composition ? freezeKilnValue(cloneKilnValue(composition)) : null;
}

export function validateKilnFixedCameraCanonicalAssets(composition) {
  for (const role of ['plate', 'normal']) {
    const asset = composition?.[role];
    const expected = KILN_FIXED_CAMERA_ASSETS[role];
    if (!asset) throw new Error(`missing-kiln-${role}`);
    for (const field of ['root', 'path', 'sha256']) {
      if (asset[field] !== expected[field]) throw new Error(`kiln-${role}-${field}-mismatch`);
    }
    if (!Array.isArray(asset.expectedDimensions)
      || asset.expectedDimensions.length !== 2
      || asset.expectedDimensions.some((value, index) => value !== expected.dimensions[index])) {
      throw new Error(`kiln-${role}-dimensions-mismatch`);
    }
    const expectedQuery = new URLSearchParams({ root: expected.root, path: expected.path });
    if (asset.url !== `/api/read?${expectedQuery}`) throw new Error(`kiln-${role}-url-mismatch`);
  }
  return true;
}

function exactParam(params, name, { required = true } = {}) {
  const values = params.getAll(name);
  if (values.length > 1) throw new Error(`duplicate-${name.replaceAll('_', '-')}`);
  if (required && (values.length === 0 || values[0] === '')) {
    throw new Error(`missing-${name.replaceAll('_', '-')}`);
  }
  return values[0] ?? null;
}

function routeAsset(params, prefix, expected) {
  const root = exactParam(params, `${prefix}_root`);
  const path = exactParam(params, `${prefix}_path`);
  const sha256 = exactParam(params, `${prefix}_sha256`);
  if (!ROOT_PATTERN.test(root)) throw new Error(`invalid-${prefix.replaceAll('_', '-')}-root`);
  if (path.startsWith('/') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid-${prefix.replaceAll('_', '-')}-path`);
  }
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`invalid-${prefix.replaceAll('_', '-')}-sha256`);
  for (const [field, value] of Object.entries({ root, path, sha256 })) {
    if (value !== expected[field]) throw new Error(`${prefix.replaceAll('_', '-')}-${field}-mismatch`);
  }
  const query = new URLSearchParams({ root, path });
  return {
    root,
    path,
    sha256,
    expectedDimensions: [...expected.dimensions],
    url: `/api/read?${query}`,
  };
}

function exactNumber(params, name, minimum, maximum) {
  const raw = exactParam(params, name);
  if (!DECIMAL_PATTERN.test(raw)) throw new Error(`invalid-${name.replaceAll('_', '-')}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`invalid-${name.replaceAll('_', '-')}`);
  }
  return value;
}

export function parseKilnFixedCameraComposition(params) {
  const identity = exactParam(params, 'kiln_composition', { required: false });
  if (identity === null) return null;
  if (identity !== KILN_FIXED_CAMERA_COMPOSITION_IDENTITY) {
    throw new Error(`unsupported-kiln-composition:${identity}`);
  }
  const presetId = exactParam(params, 'settings_preset');
  if (presetId !== KILN_FIXED_CAMERA_PRESET_ID) throw new Error(`unsupported-kiln-preset:${presetId}`);
  const presetAuthority = exactParam(params, 'settings_preset_authority');
  if (presetAuthority !== KILN_FIXED_CAMERA_PRESET_AUTHORITY) {
    throw new Error(`unsupported-kiln-preset-authority:${presetAuthority}`);
  }
  const normalYSign = exactNumber(params, 'kiln_normal_y_sign', -1, 1);
  if (normalYSign !== -1 && normalYSign !== 1) throw new Error('invalid-kiln-normal-y-sign');
  const composition = {
    identity,
    status: 'requested',
    preset: { id: presetId, authority: presetAuthority },
    plate: routeAsset(params, 'kiln_plate', KILN_FIXED_CAMERA_ASSETS.plate),
    normal: routeAsset(params, 'kiln_normal', KILN_FIXED_CAMERA_ASSETS.normal),
    fire: {
      center: [
        exactNumber(params, 'kiln_fire_x', 0, 1),
        exactNumber(params, 'kiln_fire_y', 0, 1),
      ],
      scale: [
        exactNumber(params, 'kiln_fire_scale_x', 0.01, 2),
        exactNumber(params, 'kiln_fire_scale_y', 0.01, 2),
      ],
      sourceOverscan: exactNumber(params, 'kiln_fire_source_overscan', 1.01, 2),
      sourceFramingIdentity: 'ndc-overscan-with-compensated-plate-scale-v0',
    },
    light: {
      radius: exactNumber(params, 'kiln_light_radius', 0.01, 2),
      intensity: exactNumber(params, 'kiln_light_intensity', 0, 16),
      ambient: exactNumber(params, 'kiln_plate_ambient', 0, 1),
      normalYSign,
    },
  };
  validateKilnFixedCameraCanonicalAssets(composition);
  return composition;
}

export function validateKilnFixedCameraCompositionRuntime(composition, runtime = {}) {
  if (!composition) return null;
  if (runtime.presetId !== composition.preset.id
    || runtime.presetAuthority !== composition.preset.authority) {
    throw new Error(
      `kiln-preset-mismatch:requested=${composition.preset.id}:effective=${runtime.presetId || 'none'}`,
    );
  }
  if (runtime.boundarySplats) throw new Error('kiln-composition-requires-raymarch-only');
  if (runtime.browserResidual) throw new Error('kiln-composition-rejects-browser-residual');
  if (runtime.productFrameOwner !== 'prototype') {
    throw new Error('kiln-composition-requires-prototype-frame-owner');
  }
  return {
    ...composition,
    status: 'route-admitted',
    failurePhase: null,
    effective: {
      presetId: runtime.presetId,
      presetAuthority: runtime.presetAuthority,
      renderer: 'raymarch-only-v0',
      productFrameOwner: runtime.productFrameOwner,
    },
  };
}

export function compositeKilnPremultipliedSource(radiance, alpha, background) {
  if (![radiance, background].every(value => Array.isArray(value) && value.length === 3)
    || ![...radiance, ...background, alpha].every(Number.isFinite)
    || alpha < 0
    || alpha > 1) {
    throw new Error('invalid-kiln-premultiplied-source-over-input');
  }
  return radiance.map((channel, index) => channel + background[index] * (1 - alpha));
}

export function kilnFixedCameraUniformData(composition, { plateWidth, plateHeight } = {}) {
  if (!composition || !(plateWidth > 0) || !(plateHeight > 0)) {
    throw new Error('kiln-composition-uniforms-require-admitted-composition-and-plate-dimensions');
  }
  return new Float32Array([
    ...composition.fire.center,
    ...composition.fire.scale.map(value => value * composition.fire.sourceOverscan),
    ...composition.fire.center,
    composition.light.radius,
    composition.light.intensity,
    composition.light.ambient,
    composition.light.normalYSign,
    plateWidth / plateHeight,
    0.28,
    1.0,
    0.255,
    0.045,
    0,
  ]);
}
