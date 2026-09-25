import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Saving an authored composition must keep the loaded flame basin's identity
// when the author did not change the flame. Preset content identity covers the
// current schema's full control list, so a basin authored before the schema
// grew projects to the same effective controls but re-saves under a new id;
// re-saving it on every Save As would silently repoint the scene and the
// basin's label alias to a projected copy.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('async function collectSceneComposition()');
assert.ok(start >= 0, 'composition collection exists');
const collect = html.slice(start, html.indexOf('\n}\n', start));
const reuseAt = collect.search(/volumeSettingsPresetControlValuesEqual\(preset, activeVolumeSettingsPresetReceipt\.preset\)/);
const saveAt = collect.indexOf('saveVolumeSettingsPreset({ preset })');
assert.ok(reuseAt >= 0, 'unchanged loaded basin is recognized before minting a preset');
assert.ok(saveAt > reuseAt, 'a preset is written only when the loaded basin changed');
assert.match(collect, /flame: \{ presetId: basin\.presetId, label: basin\.label, stationary: true \}/,
  'composition references the reused or newly written basin');

const { volumeSettingsPresetControlValuesEqual } = await import('../volume-settings-preset-contract.mjs');
const control = (value, extra = {}) => ({ param: 'p', tagName: 'INPUT', type: 'range', value, ...extra });
const loaded = {
  domControls: { a: control(1), b: control('0.5', { rawValue: '0.50' }), added: control(0) },
  rendererControls: { r: control(2) },
  presentationControls: { exposure: control(0) },
};
const live = {
  domControls: { added: control(0, { label: 'Added default' }), a: control(1), b: control('0.5', { rawValue: '0.50' }) },
  rendererControls: { r: control(2) },
  presentationControls: { exposure: control(0) },
};
assert.equal(volumeSettingsPresetControlValuesEqual(live, loaded), true, 'order and non-value metadata do not change identity');
assert.equal(volumeSettingsPresetControlValuesEqual(
  { ...live, domControls: { ...live.domControls, b: control('0.5', { rawValue: '0.5' }) } }, loaded),
false, 'rawValue is the identity value when present, as on the server');
assert.equal(volumeSettingsPresetControlValuesEqual(
  { ...live, domControls: { ...live.domControls, a: control(1.01) } }, loaded), false, 'an edited flame control is a new basin');
const { added, ...missing } = live.domControls;
assert.equal(volumeSettingsPresetControlValuesEqual({ ...live, domControls: missing }, loaded), false, 'a missing control is a different basin');
assert.equal(volumeSettingsPresetControlValuesEqual(
  { ...live, presentationControls: { exposure: control(1) } }, loaded), false, 'presentation controls are part of identity');
assert.equal(volumeSettingsPresetControlValuesEqual(live, null), false, 'no loaded basin cannot be reused');
assert.equal(volumeSettingsPresetControlValuesEqual({ domControls: { a: 1 } }, { domControls: { a: 2 } }), false,
  'bare values never collapse to an equal missing descriptor value');
console.log('scene composition basin identity contracts passed');
