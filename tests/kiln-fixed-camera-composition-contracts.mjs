import assert from 'node:assert/strict';

import {
  KILN_FIXED_CAMERA_COMPOSITION_IDENTITY,
  compositeKilnPremultipliedSource,
  createImmutableKilnFixedCameraComposition,
  detachedKilnFixedCameraCompositionReceipt,
  kilnFixedCameraUniformData,
  parseKilnFixedCameraComposition,
  validateKilnFixedCameraCanonicalAssets,
  validateKilnFixedCameraCompositionRuntime,
} from '../kiln-fixed-camera-composition.mjs';
import { validateVolumeSettingsPresetTarget } from '../volume-settings-preset-contract.mjs';

const BASIN_ID = 'vsp-341c2a315b094a6de625f63dfffa5a8b4e3c49cf534e428f5c9301698286b424';
const PLATE_SHA = '6fd7e60f95f81452c62ac8e5c8b82c93d7736b1f0552c521495bf21e2335debb';
const NORMAL_SHA = 'f7237e8eceedeb8833a217b7bc45f21d553a2fd1e04170d217260658435ca216';
const TARGET_RECEIPT = Object.freeze({
  presetId: BASIN_ID,
  sourcePresetAuthority: 'shared-volume-settings-preset-v2',
  routeEntries: Object.freeze([
    Object.freeze(['kaminos_volume_smoke', '1']),
    Object.freeze(['volume_resolution', '96']),
  ]),
});

function admittedParams() {
  return new URLSearchParams({
    kaminos_volume_smoke: '1',
    volume_resolution: '96',
    kiln_composition: KILN_FIXED_CAMERA_COMPOSITION_IDENTITY,
    settings_preset: BASIN_ID,
    settings_preset_authority: 'shared-volume-settings-preset-v2',
    kiln_plate_root: 'image-inbox',
    kiln_plate_path: 'kiln-room-pre-ignition-source-v1.png',
    kiln_plate_sha256: PLATE_SHA,
    kiln_normal_root: 'reconstructions',
    kiln_normal_path: 'kiln-room-pre-ignition-source-v1/lotus-normal-v1/normal.png',
    kiln_normal_sha256: NORMAL_SHA,
    kiln_fire_x: '0.584',
    kiln_fire_y: '0.516',
    kiln_fire_scale_x: '0.31',
    kiln_fire_scale_y: '0.46',
    kiln_light_radius: '0.36',
    kiln_light_intensity: '2.4',
    kiln_plate_ambient: '0.34',
    kiln_normal_y_sign: '-1',
  });
}

assert.equal(
  validateVolumeSettingsPresetTarget(TARGET_RECEIPT, admittedParams()),
  true,
  'the exact complete kiln consumer extension is admitted beside the saved basin route',
);

const unknownConsumerParam = admittedParams();
unknownConsumerParam.set('kiln_fallback_mode', 'silent');
assert.throws(
  () => validateVolumeSettingsPresetTarget(TARGET_RECEIPT, unknownConsumerParam),
  /unexpected parameters.*kiln_fallback_mode/i,
  'kiln admission does not broaden into a prefix-based route allowlist',
);

assert.equal(parseKilnFixedCameraComposition(new URLSearchParams()), null, 'composition is opt-in');

const parsed = parseKilnFixedCameraComposition(admittedParams());
assert.equal(parsed.identity, KILN_FIXED_CAMERA_COMPOSITION_IDENTITY);
assert.equal(parsed.status, 'requested');
assert.equal(parsed.preset.id, BASIN_ID);
assert.equal(parsed.preset.authority, 'shared-volume-settings-preset-v2');
assert.deepEqual(parsed.plate, {
  root: 'image-inbox',
  path: 'kiln-room-pre-ignition-source-v1.png',
  sha256: PLATE_SHA,
  expectedDimensions: [1536, 1024],
  url: '/api/read?root=image-inbox&path=kiln-room-pre-ignition-source-v1.png',
});
assert.deepEqual(parsed.normal, {
  root: 'reconstructions',
  path: 'kiln-room-pre-ignition-source-v1/lotus-normal-v1/normal.png',
  sha256: NORMAL_SHA,
  expectedDimensions: [1024, 1024],
  url: '/api/read?root=reconstructions&path=kiln-room-pre-ignition-source-v1%2Flotus-normal-v1%2Fnormal.png',
});
assert.deepEqual(parsed.fire, { center: [0.584, 0.516], scale: [0.31, 0.46] });
assert.deepEqual(parsed.light, {
  radius: 0.36,
  intensity: 2.4,
  ambient: 0.34,
  normalYSign: -1,
});
assert.deepEqual(Array.from(kilnFixedCameraUniformData(parsed, {
  plateWidth: 1536,
  plateHeight: 1024,
})), [
  0.5839999914169312, 0.515999972820282, 0.3100000023841858, 0.46000000834465027,
  0.5839999914169312, 0.515999972820282, 0.36000001430511475, 2.4000000953674316,
  0.3400000035762787, -1, 1.5, 0.2800000011920929,
  1, 0.2549999952316284, 0.04500000178813934, 0,
]);

const routeAdmitted = validateKilnFixedCameraCompositionRuntime(parsed, {
  presetId: BASIN_ID,
  presetAuthority: 'shared-volume-settings-preset-v2',
  boundarySplats: false,
  browserResidual: false,
  productFrameOwner: 'prototype',
});
assert.deepEqual(routeAdmitted, {
  ...parsed,
  status: 'route-admitted',
  failurePhase: null,
  effective: {
    presetId: BASIN_ID,
    presetAuthority: 'shared-volume-settings-preset-v2',
    renderer: 'raymarch-only-v0',
    productFrameOwner: 'prototype',
  },
});

const privateComposition = createImmutableKilnFixedCameraComposition(routeAdmitted);
assert.equal(validateKilnFixedCameraCanonicalAssets(privateComposition), true);
assert.ok(Object.isFrozen(privateComposition));
assert.ok(Object.isFrozen(privateComposition.plate));
assert.ok(Object.isFrozen(privateComposition.plate.expectedDimensions));
assert.ok(Object.isFrozen(privateComposition.fire.center));
for (const exposedState of [
  parsed,
  routeAdmitted,
  { ...routeAdmitted, status: 'initializing', failurePhase: 'asset-verification' },
]) {
  const exposed = detachedKilnFixedCameraCompositionReceipt(exposedState);
  exposed.preset.id = `vsp-${'c'.repeat(64)}`;
  Object.assign(exposed.plate, {
    root: 'scratch',
    path: 'other.png',
    sha256: 'a'.repeat(64),
    url: '/api/read?root=scratch&path=other.png',
  });
  exposed.plate.expectedDimensions[0] = 1;
  Object.assign(exposed.normal, {
    root: 'image-inbox',
    path: 'other.png',
    sha256: 'b'.repeat(64),
    url: '/api/read?root=image-inbox&path=other.png',
  });
  exposed.normal.expectedDimensions[1] = 1;
  exposed.fire.center[0] = 0;
  exposed.fire.scale[1] = 2;
  exposed.light.radius = 2;
  exposed.light.intensity = 16;
  exposed.light.ambient = 1;
  exposed.light.normalYSign = 1;
}
assert.equal(privateComposition.preset.id, BASIN_ID);
assert.deepEqual(privateComposition.plate, parsed.plate);
assert.deepEqual(privateComposition.normal, parsed.normal);
assert.deepEqual(privateComposition.fire, parsed.fire);
assert.deepEqual(privateComposition.light, parsed.light);
assert.throws(
  () => { privateComposition.plate.root = 'scratch'; },
  TypeError,
  'private asset custody is recursively immutable',
);

assert.deepEqual(
  compositeKilnPremultipliedSource([0, 0, 0], 0, [0.2, 0.4, 0.6]),
  [0.2, 0.4, 0.6],
  'zero-alpha fire preserves the plate',
);
assert.deepEqual(
  compositeKilnPremultipliedSource([0.3, 0.2, 0.1], 0.5, [0.2, 0.4, 0.6]),
  [0.4, 0.4, 0.4],
  'partial-alpha source-over does not multiply already premultiplied radiance again',
);
assert.deepEqual(
  compositeKilnPremultipliedSource([0.3, 0.2, 0.1], 1, [0.2, 0.4, 0.6]),
  [0.3, 0.2, 0.1],
  'opaque fire replaces the plate',
);

for (const [name, mutate, pattern] of [
  ['missing plate hash', params => params.delete('kiln_plate_sha256'), /missing-kiln-plate-sha256/],
  ['invalid normal root', params => params.set('kiln_normal_root', '../escape'), /invalid-kiln-normal-root/],
  ['duplicate route field', params => params.append('kiln_fire_x', '0.5'), /duplicate-kiln-fire-x/],
  ['wrong composition identity', params => params.set('kiln_composition', 'fallback'), /unsupported-kiln-composition/],
  ['wrong basin', params => params.set('settings_preset', `vsp-${'a'.repeat(64)}`), /unsupported-kiln-preset/],
  ['out of range fire scale', params => params.set('kiln_fire_scale_x', '0'), /invalid-kiln-fire-scale-x/],
  ['silent numeric coercion', params => params.set('kiln_light_intensity', '2.4watts'), /invalid-kiln-light-intensity/],
]) {
  const params = admittedParams();
  mutate(params);
  assert.throws(() => parseKilnFixedCameraComposition(params), pattern, name);
}

for (const [name, mutate, pattern] of [
  ['substituted plate root', params => params.set('kiln_plate_root', 'scratch'), /kiln-plate-root-mismatch/],
  ['substituted plate path', params => params.set('kiln_plate_path', 'other.png'), /kiln-plate-path-mismatch/],
  ['substituted plate hash', params => params.set('kiln_plate_sha256', 'a'.repeat(64)), /kiln-plate-sha256-mismatch/],
  ['substituted normal root', params => params.set('kiln_normal_root', 'image-inbox'), /kiln-normal-root-mismatch/],
  ['substituted normal path', params => params.set('kiln_normal_path', 'other.png'), /kiln-normal-path-mismatch/],
  ['substituted normal hash', params => params.set('kiln_normal_sha256', 'b'.repeat(64)), /kiln-normal-sha256-mismatch/],
]) {
  const params = admittedParams();
  mutate(params);
  assert.throws(() => parseKilnFixedCameraComposition(params), pattern, name);
}

for (const [name, runtime, pattern] of [
  ['effective basin mismatch', { presetId: `vsp-${'b'.repeat(64)}` }, /kiln-preset-mismatch/],
  ['splat route', { boundarySplats: true }, /kiln-composition-requires-raymarch-only/],
  ['browser residual route', { browserResidual: true }, /kiln-composition-rejects-browser-residual/],
  ['caller-owned frame', { productFrameOwner: 'caller' }, /kiln-composition-requires-prototype-frame-owner/],
]) {
  assert.throws(() => validateKilnFixedCameraCompositionRuntime(parsed, {
    presetId: BASIN_ID,
    presetAuthority: 'shared-volume-settings-preset-v2',
    boundarySplats: false,
    browserResidual: false,
    productFrameOwner: 'prototype',
    ...runtime,
  }), pattern, name);
}

console.log('kiln fixed-camera composition contracts passed');
