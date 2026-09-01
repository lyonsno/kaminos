export const KILN_FIXED_CAMERA_COMPOSITION_IDENTITY = 'normal-lit-fixed-camera-plate-v0';
export const KILN_FIXED_CAMERA_PRESET_ID = 'vsp-341c2a315b094a6de625f63dfffa5a8b4e3c49cf534e428f5c9301698286b424';
export const KILN_FIXED_CAMERA_PRESET_AUTHORITY = 'shared-volume-settings-preset-v2';
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
  'kiln_light_radius',
  'kiln_light_intensity',
  'kiln_plate_ambient',
  'kiln_normal_y_sign',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function exactParam(params, name, { required = true } = {}) {
  const values = params.getAll(name);
  if (values.length > 1) throw new Error(`duplicate-${name.replaceAll('_', '-')}`);
  if (required && (values.length === 0 || values[0] === '')) {
    throw new Error(`missing-${name.replaceAll('_', '-')}`);
  }
  return values[0] ?? null;
}

function routeAsset(params, prefix) {
  const root = exactParam(params, `${prefix}_root`);
  const path = exactParam(params, `${prefix}_path`);
  const sha256 = exactParam(params, `${prefix}_sha256`);
  if (!ROOT_PATTERN.test(root)) throw new Error(`invalid-${prefix.replaceAll('_', '-')}-root`);
  if (path.startsWith('/') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid-${prefix.replaceAll('_', '-')}-path`);
  }
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`invalid-${prefix.replaceAll('_', '-')}-sha256`);
  const query = new URLSearchParams({ root, path });
  return { root, path, sha256, url: `/api/read?${query}` };
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
  return {
    identity,
    status: 'requested',
    preset: { id: presetId, authority: presetAuthority },
    plate: routeAsset(params, 'kiln_plate'),
    normal: routeAsset(params, 'kiln_normal'),
    fire: {
      center: [
        exactNumber(params, 'kiln_fire_x', 0, 1),
        exactNumber(params, 'kiln_fire_y', 0, 1),
      ],
      scale: [
        exactNumber(params, 'kiln_fire_scale_x', 0.01, 2),
        exactNumber(params, 'kiln_fire_scale_y', 0.01, 2),
      ],
    },
    light: {
      radius: exactNumber(params, 'kiln_light_radius', 0.01, 2),
      intensity: exactNumber(params, 'kiln_light_intensity', 0, 16),
      ambient: exactNumber(params, 'kiln_plate_ambient', 0, 1),
      normalYSign,
    },
  };
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
    status: 'admitted',
    effective: {
      presetId: runtime.presetId,
      presetAuthority: runtime.presetAuthority,
      renderer: 'raymarch-only-v0',
      productFrameOwner: runtime.productFrameOwner,
    },
  };
}

export function kilnFixedCameraUniformData(composition, { plateWidth, plateHeight } = {}) {
  if (!composition || !(plateWidth > 0) || !(plateHeight > 0)) {
    throw new Error('kiln-composition-uniforms-require-admitted-composition-and-plate-dimensions');
  }
  return new Float32Array([
    ...composition.fire.center,
    ...composition.fire.scale,
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
