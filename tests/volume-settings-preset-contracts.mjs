import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVolumeSettingsPresetTarget,
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetDocument,
  validateVolumeSettingsPresetTarget,
  validateVolumeSettingsPresetVisualTarget,
} from '../volume-settings-preset-contract.mjs';

const root = new URL('..', import.meta.url).pathname;
const loader = readFileSync(join(root, 'volume-basin-smoke.html'), 'utf8');
const settingsLoader = readFileSync(join(root, 'volume-settings-preset.html'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const canonicalLegacyDocument = JSON.parse(readFileSync(
  join(root, 'artifacts/volume-captures/20260715-082845-operator-original-live-basin-settings.json'),
  'utf8',
));

const removedPersistenceControls = new Set([
  'volume-basin-slot',
  'volume-look-library-kind',
  'volume-look-library-entry',
  'volume-look-library-name',
  'volume-look-library-json',
]);

function nativeCapture() {
  const preset = structuredClone(canonicalLegacyDocument.capture);
  preset.identity = 'kaminos-volume-settings-preset-v2';
  preset.kind = 'settings-preset';
  preset.schemaIdentity = schema.identity;
  preset.stateExclusions = preset.exclusions;
  delete preset.exclusions;
  for (const field of ['status', 'sourceHref', 'discoveredContextCount', 'controlsByParam', 'failurePhase']) delete preset[field];
  for (const key of removedPersistenceControls) delete preset.domControls[key];
  preset.controlCount = Object.keys(preset.domControls).length;
  const route = new URL(preset.route);
  for (const key of removedPersistenceControls) route.searchParams.delete(key.replaceAll('-', '_'));
  preset.route = route.toString();
  return preset;
}

function controlByParam(capture, param) {
  return Object.values(capture.domControls).find(entry => entry.param === param);
}

function setControlValue(capture, param, value) {
  const control = controlByParam(capture, param);
  control.value = value;
  if (Object.hasOwn(control, 'rawValue')) control.rawValue = String(value);
}

function artifact(capture) {
  const hash = 'a'.repeat(64);
  return {
    identity: 'kaminos-volume-settings-preset-artifact-v2',
    presetId: `vsp-${hash}`,
    alias: 'legacy-contract-fixture',
    requestedPresetRef: 'legacy-contract-fixture',
    label: 'Legacy contract fixture',
    contentHash: `sha256:${hash}`,
    schemaIdentity: schema.identity,
    controlCount: schema.controlCount,
    preset: capture,
  };
}

const acceptedReceipt = validateVolumeSettingsPresetDocument(artifact(nativeCapture()), 'legacy-contract-fixture', schema);
const acceptedUrl = buildVolumeSettingsPresetTarget(acceptedReceipt, 'http://127.0.0.1:18636');
assert.equal(acceptedUrl.pathname, '/');
assert.equal(acceptedUrl.searchParams.get('settings_preset'), `vsp-${'a'.repeat(64)}`);
assert.equal(acceptedUrl.searchParams.get('settings_preset_authority'), 'shared-volume-settings-preset-v2');
assert.equal(validateVolumeSettingsPresetTarget(acceptedReceipt, acceptedUrl.searchParams), true);

const prototypeBasin = nativeCapture();
prototypeBasin.identity = 'kaminos-volume-agent-capture-v1';
prototypeBasin.kind = 'prototype-basin';
prototypeBasin.stateExclusions = prototypeBasin.exclusions;
delete prototypeBasin.exclusions;
for (const field of ['status', 'sourceHref', 'discoveredContextCount', 'controlsByParam', 'failurePhase']) delete prototypeBasin[field];
prototypeBasin.controls = {};
prototypeBasin.sceneAuthority = { identity: 'renderer-scene-authority' };
prototypeBasin.requestedSmoke = { renderer: 'splat-only-v0' };
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(prototypeBasin), 'legacy-contract-fixture', schema),
  /not an accepted volume settings preset/i,
  'renderer-bearing prototype-basin captures cannot be promoted into settings-preset authority',
);

const fakeControls = nativeCapture();
const fakeRoute = new URL('http://127.0.0.1:18632/');
fakeRoute.searchParams.set('kaminos_volume_smoke', '1');
for (const [index, entry] of Object.values(fakeControls.domControls).entries()) {
  entry.param = `volume_fake_${index}`;
  if (entry.tagName !== 'TEXTAREA') fakeRoute.searchParams.set(entry.param, String(entry.value));
}
fakeRoute.searchParams.set('volume_quality_reason', 'fake-control-inventory');
fakeControls.route = fakeRoute.toString();
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(fakeControls), 'legacy-contract-fixture', schema),
  /schema|canonical|control.*param|inventory/i,
  'a self-consistent 186-entry fake control inventory cannot default-fill the real UI',
);

assert.equal(schema.controlCount, 186);
for (const key of removedPersistenceControls) {
  assert.equal(schema.controls.some(entry => entry.key === key), false, `schema v2 excludes persistence widget ${key}`);
}

const rendererIndependentPreset = nativeCapture();
for (const [param, value] of [
  ['volume_scene', 'compact_plume'],
  ['volume_boundary_splat_mode', 'off'],
  ['volume_resolution', '128'],
]) {
  setControlValue(rendererIndependentPreset, param, value);
  rendererIndependentPreset.route = new URL(rendererIndependentPreset.route);
  rendererIndependentPreset.route.searchParams.set(param, value);
  rendererIndependentPreset.route = rendererIndependentPreset.route.toString();
}
const rendererIndependentReceipt = validateVolumeSettingsPresetDocument(
  artifact(rendererIndependentPreset),
  'legacy-contract-fixture',
  schema,
);
const rendererIndependentUrl = buildVolumeSettingsPresetTarget(rendererIndependentReceipt, 'http://127.0.0.1:18636');
assert.equal(
  rendererIndependentUrl.pathname,
  '/',
  'settings preset loading uses the ordinary live prototype rather than a selective-head renderer wrapper',
);
for (const parameter of ['role', 'composition', 'warmup_steps', 'basin_capture', 'basin_source_authority']) {
  assert.equal(
    rendererIndependentUrl.searchParams.has(parameter),
    false,
    `settings preset loading does not invent renderer-assay parameter ${parameter}`,
  );
}
assert.equal(rendererIndependentUrl.searchParams.get('volume_scene'), 'compact_plume');
assert.equal(rendererIndependentUrl.searchParams.get('volume_boundary_splat_mode'), 'off');
assert.equal(rendererIndependentUrl.searchParams.get('volume_resolution'), '128');

const explicitSplatView = buildVolumeSettingsPresetVisualTarget(
  acceptedReceipt,
  'http://127.0.0.1:18636',
  'splat-only',
);
assert.equal(explicitSplatView.pathname, '/volume-selective-head-live.html');
assert.equal(explicitSplatView.searchParams.get('role'), 'truthHigh');
assert.equal(explicitSplatView.searchParams.get('composition'), 'splat-only-v0');
assert.equal(explicitSplatView.searchParams.get('warmup_steps'), '0');
assert.equal(explicitSplatView.searchParams.get('settings_preset'), `vsp-${'a'.repeat(64)}`);
assert.equal(explicitSplatView.searchParams.get('settings_preset_authority'), 'shared-volume-settings-preset-v2');
assert.equal(explicitSplatView.searchParams.has('basin_capture'), false);
assert.equal(explicitSplatView.searchParams.get('volume_density'), '5.05');
assert.equal(validateVolumeSettingsPresetVisualTarget(acceptedReceipt, explicitSplatView.searchParams), true);
const forgedVisualSetting = new URL(explicitSplatView);
forgedVisualSetting.searchParams.set('volume_density', 'forged');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(acceptedReceipt, forgedVisualSetting.searchParams),
  /route mismatch/i,
  'visual view cannot silently substitute a validated preset setting',
);
assert.throws(
  () => buildVolumeSettingsPresetVisualTarget(acceptedReceipt, 'http://127.0.0.1:18636', 'raymarch'),
  /unsupported.*view/i,
  'preset visual loading rejects unimplemented view substitution',
);

const forgedAuthority = new URL(acceptedUrl);
forgedAuthority.searchParams.set('settings_preset_authority', 'forged-authority');
assert.throws(
  () => validateVolumeSettingsPresetTarget(acceptedReceipt, forgedAuthority.searchParams),
  /authority/i,
  'preset target rejects caller-authored authority even when the preset id is real',
);

const forgedSetting = new URL(acceptedUrl);
forgedSetting.searchParams.set('volume_density', '999');
assert.throws(
  () => validateVolumeSettingsPresetTarget(acceptedReceipt, forgedSetting.searchParams),
  /route mismatch/i,
  'preset target rejects settings that diverge from the independently validated artifact',
);

const truncated = nativeCapture();
truncated.controlCount = 1;
truncated.domControls = { [schema.controls[0].key]: truncated.domControls[schema.controls[0].key] };
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(truncated), 'legacy-contract-fixture', schema),
  /186|control/i,
  'loader rejects truncated presets instead of filling omitted settings from defaults',
);

const mismatchedCount = nativeCapture();
mismatchedCount.controlCount = 186;
delete mismatchedCount.domControls[schema.controls[0].key];
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(mismatchedCount), 'legacy-contract-fixture', schema),
  /186|control/i,
  'loader rejects a declared count that does not match the saved DOM-control population',
);

const routeMismatch = nativeCapture();
setControlValue(routeMismatch, 'volume_density', 999);
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(routeMismatch), 'legacy-contract-fixture', schema),
  /route|control|mismatch/i,
  'loader rejects routes that do not represent their saved DOM control values',
);

for (const field of ['replayState', 'volumeDebugState', 'camera', 'viewport', 'fluidField']) {
  const forbidden = nativeCapture();
  forbidden[field] = { forged: true };
  assert.throws(
    () => validateVolumeSettingsPresetDocument(artifact(forbidden), 'legacy-contract-fixture', schema),
    /runtime|replay|forbidden|state/i,
    `loader rejects preset field ${field} even when exclusion flags claim it is absent`,
  );
}

assert.match(loader, /volume-settings-preset\.html/, 'legacy basin-smoke route delegates to the renderer-agnostic settings loader');
assert.match(
  settingsLoader,
  /buildVolumeSettingsPresetVisualTarget[\s\S]*params\.get\('view'\)/,
  'an explicit splat-only smoke view is separate from the renderer-agnostic default preset target',
);
assert.match(
  settingsLoader,
  /const requestedView = params\.get\('view'\);[\s\S]*const view = requestedView \|\| 'splat-only'/,
  'operator preset loading defaults explicitly to the visible splat-only view',
);
assert.match(
  settingsLoader,
  /view === 'ordinary-live'[\s\S]*buildVolumeSettingsPresetTarget[\s\S]*buildVolumeSettingsPresetVisualTarget/,
  'renderer-unspecified ordinary live remains an explicit diagnostic instead of an unlabeled operator default',
);

console.log('volume settings preset contracts passed');
