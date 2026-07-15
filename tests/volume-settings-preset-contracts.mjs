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
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v1.json'), 'utf8'));
const canonicalLegacyDocument = JSON.parse(readFileSync(
  join(root, 'artifacts/volume-captures/20260715-082845-operator-original-live-basin-settings.json'),
  'utf8',
));

function legacyCapture() {
  return structuredClone(canonicalLegacyDocument.capture);
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
  return {
    identity: 'kaminos-volume-agent-capture-artifact-v1',
    captureId: 'legacy-contract-fixture',
    capture,
  };
}

const acceptedReceipt = validateVolumeSettingsPresetDocument(artifact(legacyCapture()), 'legacy-contract-fixture', schema);
const acceptedUrl = buildVolumeSettingsPresetTarget(acceptedReceipt, 'http://127.0.0.1:18636');
assert.equal(acceptedUrl.pathname, '/');
assert.equal(acceptedUrl.searchParams.get('settings_preset'), 'legacy-contract-fixture');
assert.equal(acceptedUrl.searchParams.get('settings_preset_authority'), 'legacy-dom-settings-promoted-v0');
assert.equal(validateVolumeSettingsPresetTarget(acceptedReceipt, acceptedUrl.searchParams), true);

const prototypeBasin = legacyCapture();
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

const fakeControls = legacyCapture();
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
  'a self-consistent 191-entry fake control inventory cannot default-fill the real UI',
);

const nativePreset = legacyCapture();
nativePreset.identity = 'kaminos-volume-settings-preset-v1';
nativePreset.kind = 'settings-preset';
nativePreset.schemaIdentity = schema.identity;
delete nativePreset.status;
nativePreset.stateExclusions = nativePreset.exclusions;
delete nativePreset.exclusions;
for (const field of ['failurePhase', 'sourceHref', 'discoveredContextCount', 'controlsByParam']) {
  delete nativePreset[field];
}
setControlValue(nativePreset, 'volume_look_library_json', '{"identity":"operator-library"}');
const nativeRoute = new URL(nativePreset.route);
nativeRoute.searchParams.set('volume_look_library_json', controlByParam(nativePreset, 'volume_look_library_json').value);
nativePreset.route = nativeRoute.toString();
const nativeReceipt = validateVolumeSettingsPresetDocument(artifact(nativePreset), 'legacy-contract-fixture', schema);
assert.equal(
  nativeReceipt.presetRoute.searchParams.get('volume_look_library_json'),
  controlByParam(nativePreset, 'volume_look_library_json').value,
  'native presets route every counted control, including the editable look-library textarea',
);

const rendererIndependentPreset = legacyCapture();
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
assert.equal(explicitSplatView.searchParams.get('settings_preset'), 'legacy-contract-fixture');
assert.equal(explicitSplatView.searchParams.get('settings_preset_authority'), 'legacy-dom-settings-promoted-v0');
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

const truncated = legacyCapture();
truncated.controlCount = 1;
truncated.domControls = { [schema.controls[0].key]: truncated.domControls[schema.controls[0].key] };
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(truncated), 'legacy-contract-fixture', schema),
  /191|control/i,
  'loader rejects truncated legacy captures instead of filling omitted settings from defaults',
);

const mismatchedCount = legacyCapture();
mismatchedCount.controlCount = 191;
delete mismatchedCount.domControls[schema.controls[0].key];
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(mismatchedCount), 'legacy-contract-fixture', schema),
  /191|control/i,
  'loader rejects a declared count that does not match the saved DOM-control population',
);

const routeMismatch = legacyCapture();
setControlValue(routeMismatch, 'volume_density', 999);
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(routeMismatch), 'legacy-contract-fixture', schema),
  /route|control|mismatch/i,
  'loader rejects routes that do not represent their saved DOM control values',
);

for (const field of ['replayState', 'volumeDebugState', 'camera', 'viewport', 'fluidField']) {
  const forbidden = legacyCapture();
  forbidden[field] = { forged: true };
  assert.throws(
    () => validateVolumeSettingsPresetDocument(artifact(forbidden), 'legacy-contract-fixture', schema),
    /runtime|replay|forbidden|state/i,
    `loader rejects legacy capture field ${field} even when exclusion flags claim it is absent`,
  );
}

assert.match(loader, /volume-settings-preset\.html/, 'legacy basin-smoke route delegates to the renderer-agnostic settings loader');
assert.match(
  settingsLoader,
  /buildVolumeSettingsPresetVisualTarget[\s\S]*params\.get\('view'\)/,
  'an explicit splat-only smoke view is separate from the renderer-agnostic default preset target',
);

console.log('volume settings preset contracts passed');
