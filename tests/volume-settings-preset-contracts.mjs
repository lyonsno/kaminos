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
const intrinsicPresentationTarget = new URL(acceptedUrl);
intrinsicPresentationTarget.searchParams.set('volume_presentation', 'intrinsic');
assert.equal(
  validateVolumeSettingsPresetTarget(acceptedReceipt, intrinsicPresentationTarget.searchParams),
  true,
  'presentation identity is admitted as target-only state without entering the saved controls',
);
const invalidPresentationTarget = new URL(acceptedUrl);
invalidPresentationTarget.searchParams.set('volume_presentation', 'forged');
assert.throws(
  () => validateVolumeSettingsPresetTarget(acceptedReceipt, invalidPresentationTarget.searchParams),
  /presentation/i,
  'preset target rejects unsupported presentation substitution',
);
const smokeOffPresentationTarget = new URL(acceptedUrl);
smokeOffPresentationTarget.searchParams.set('volume_raymarch_smoke', 'off');
assert.equal(
  validateVolumeSettingsPresetTarget(acceptedReceipt, smokeOffPresentationTarget.searchParams),
  true,
  'smoke presentation identity is target-only state and does not enter saved controls',
);
const invalidSmokePresentationTarget = new URL(acceptedUrl);
invalidSmokePresentationTarget.searchParams.set('volume_raymarch_smoke', 'forged');
assert.throws(
  () => validateVolumeSettingsPresetTarget(acceptedReceipt, invalidSmokePresentationTarget.searchParams),
  /smoke presentation/i,
  'preset target rejects unsupported smoke-presentation substitution',
);

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
  'a self-consistent 189-entry fake control inventory cannot default-fill the real UI',
);

assert.equal(schema.controlCount, 189);
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
for (const [view, composition] of [
  ['raymarch-only', 'raymarch-only-v0'],
  ['smoke-hybrid', 'smoke-raymarch-under-splats-v0'],
  ['full-hybrid-diagnostic', 'full-raymarch-under-splats-diagnostic-v0'],
]) {
  const target = buildVolumeSettingsPresetVisualTarget(acceptedReceipt, 'http://127.0.0.1:18636', view);
  assert.equal(target.searchParams.get('role'), 'truthHigh');
  assert.equal(target.searchParams.get('composition'), composition);
  assert.equal(validateVolumeSettingsPresetVisualTarget(acceptedReceipt, target.searchParams), true);
}
const intrinsicVisualTarget = new URL(explicitSplatView);
intrinsicVisualTarget.searchParams.set('volume_presentation', 'intrinsic');
assert.equal(
  validateVolumeSettingsPresetVisualTarget(acceptedReceipt, intrinsicVisualTarget.searchParams),
  true,
  'visual routes admit one presentation-only identity without changing the preset control count',
);
const smokeOffVisualTarget = new URL(explicitSplatView);
smokeOffVisualTarget.searchParams.set('volume_raymarch_smoke', 'off');
assert.equal(
  validateVolumeSettingsPresetVisualTarget(acceptedReceipt, smokeOffVisualTarget.searchParams),
  true,
  'visual routes admit one smoke presentation identity without changing the preset control count',
);
const forgedVisualPresentation = new URL(explicitSplatView);
forgedVisualPresentation.searchParams.set('volume_presentation', 'forged');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(acceptedReceipt, forgedVisualPresentation.searchParams),
  /presentation/i,
  'visual routes reject unsupported presentation substitution',
);
const forgedVisualSetting = new URL(explicitSplatView);
forgedVisualSetting.searchParams.set('volume_density', 'forged');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(acceptedReceipt, forgedVisualSetting.searchParams),
  /route mismatch/i,
  'visual view cannot silently substitute a validated preset setting',
);
for (const forbiddenParam of ['camera', 'viewport', 'basin_capture']) {
  const contaminatedVisualTarget = new URL(explicitSplatView);
  contaminatedVisualTarget.searchParams.set(forbiddenParam, 'forged');
  assert.throws(
    () => validateVolumeSettingsPresetVisualTarget(acceptedReceipt, contaminatedVisualTarget.searchParams),
    /unexpected parameters/i,
    `visual preset admission rejects unowned route state: ${forbiddenParam}`,
  );
}
assert.throws(
  () => buildVolumeSettingsPresetVisualTarget(acceptedReceipt, 'http://127.0.0.1:18636', 'unknown-view'),
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
  /189|control/i,
  'loader rejects truncated presets instead of filling omitted settings from defaults',
);

const mismatchedCount = nativeCapture();
mismatchedCount.controlCount = 189;
delete mismatchedCount.domControls[schema.controls[0].key];
assert.throws(
  () => validateVolumeSettingsPresetDocument(artifact(mismatchedCount), 'legacy-contract-fixture', schema),
  /189|control/i,
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
  /const view = params\.get\('view'\);[\s\S]*if \(!view\)[\s\S]*viewCommands\.hidden = false/,
  'a viewless loader exposes explicit composition commands instead of silently choosing a renderer',
);
assert.match(settingsLoader, /id="view-commands"[\s\S]*data-view="raymarch-only"/, 'the viewless loader presents an explicit raymarch command');
assert.match(settingsLoader, /id="preset-title"[\s\S]*presetTitle\.textContent = 'Volume settings preset'/, 'the validated chooser does not retain a stale loading claim');
assert.doesNotMatch(settingsLoader, /params\.get\('view'\)\s*\|\|\s*['"]splat-only['"]/, 'a viewless preset never silently substitutes splat-only');
assert.doesNotMatch(settingsLoader, /data-view="ordinary-live"|view === 'ordinary-live'/, 'the visual loader has no renderer-off side door');
assert.doesNotMatch(settingsLoader, /buildVolumeSettingsPresetTarget/, 'the visual loader cannot escape to a renderer-unreceipted ordinary route');

console.log('volume settings preset contracts passed');
