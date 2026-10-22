import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { volumeSettingsPresetAppliedDifferences, volumeSettingsPresetControlValuesEqual } from '../volume-settings-preset-contract.mjs';

// A saved basin loads with the values it was saved with, as far as the
// renderer can draw them. The renderer clamps each control to its slider's
// range, so a value outside it loads at the limit (the readback reports it);
// an in-range value keeps its saved precision instead of snapping to the step
// grid; a select takes any option it offers.
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grab = head => index.match(new RegExp(`${head.replace(/[()]/g, '\\$&')}[^]*?\\n\\}`))?.[0];
const setterSource = grab('function applyVolumeRangeSavedValue(');
assert.ok(setterSource, 'a saved-value range setter exists');

const continuous = [];
const context = vm.createContext({ window: { __kaminosVolumeControlStepsMadeContinuous: continuous }, Number, String, Math });
vm.runInContext(`${setterSource}; this.applyVolumeRangeSavedValue = applyVolumeRangeSavedValue;`, context);
const range = (min, max, step, value) => ({ id: 'slider', type: 'range', min, max, step, value });

const yellow = range('0', '0.4', 'any', '0.28');
context.applyVolumeRangeSavedValue(yellow, 0.86);
assert.deepEqual([yellow.min, yellow.max, yellow.value], ['0', '0.4', '0.4'], 'a saved value above the range loads at the limit the renderer draws; the slider keeps its range');
const low = range('0.05', '2', 'any', '1');
context.applyVolumeRangeSavedValue(low, 0.01);
assert.deepEqual([low.min, low.value], ['0.05', '0.05'], 'a saved value below the range loads at the lower limit');
const stepped = range('0', '1', '0.02', '0.5');
context.applyVolumeRangeSavedValue(stepped, 0.7727);
assert.deepEqual([stepped.step, stepped.value], ['any', '0.7727'], 'an off-grid saved value keeps its precision');
const onGrid = range('0', '1', '0.02', '0.5');
context.applyVolumeRangeSavedValue(onGrid, 0.64);
assert.deepEqual([onGrid.min, onGrid.max, onGrid.step, onGrid.value], ['0', '1', '0.02', '0.64'], 'an in-range on-grid value changes nothing else');
const clampedOffGrid = range('0', '0.4', '0.02', '0.2');
context.applyVolumeRangeSavedValue(clampedOffGrid, 0.4433);
assert.deepEqual([clampedOffGrid.step, clampedOffGrid.value], ['0.02', '0.4'], 'a clamped value is on the grid at the limit');
assert.deepEqual(JSON.parse(JSON.stringify(continuous)), [{ id: 'slider', value: 0.7727, step: '0.02' }],
  'every step made continuous is recorded with the step it had');

// The route loader uses the saved-value setter instead of rounding.
const routeInit = index.slice(index.indexOf('async function initKaminosVolumeRoute('));
const fieldLoop = routeInit.slice(routeInit.indexOf('for (const field of REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS)'));
assert.match(fieldLoop.slice(0, 600), /if \(el\?\.type === 'range'\) applyVolumeRangeSavedValue\(el, routeValue\);\n\s*else if \(el\) el\.value = clampVolumeControlValue\(routeValue, field\)\.toFixed\(field\.decimals\);/,
  'only range inputs go through the saved-value setter; table selects keep their option value');
const offersSource = grab('function volumeSelectOffers(');
assert.ok(offersSource);
const offers = vm.runInNewContext(`${offersSource}; volumeSelectOffers`, {});
assert.equal(offers({ options: [{ value: 'shell' }, { value: 'boundary_fire' }] }, 'boundary_fire'), true);
assert.equal(offers({ options: [{ value: 'shell' }] }, 'boundary_fire'), false);

// A retired aperture pattern (spiral, concentric) is kept as the basin's
// request beside the shape fallback. The flame settings check accepts it, and
// writing it back (undo) restores the request instead of blanking the select.
const check = grab('function flameSettingsStateProblems('); // the edit check's rules (checkFlameSettingsState throws its first problem)
assert.match(check, /VOLUME_RETIRED_APERTURE_PATTERNS\.includes\(String\(value\)\)/, 'the flame check accepts a kept retired aperture pattern');
const setSource = grab('function setVolumeControlValue(');
const pattern = { id: 'volume-emitter-aperture-pattern', tagName: 'SELECT', type: 'select-one', value: 'shape', dataset: {} };
const fakeDocument = { getElementById: id => (id === pattern.id ? pattern : null) };
const setter = vm.runInNewContext(`const VOLUME_RETIRED_APERTURE_PATTERNS = ['concentric', 'spiral']; function setVolumeRenderScaleControlValue() {}; ${setSource}; setVolumeControlValue`, { document: fakeDocument, String });
setter(pattern.id, 'spiral');
assert.deepEqual([pattern.value, pattern.dataset.volumeRetiredPatternRequest], ['shape', 'spiral'], 'writing a retired pattern keeps it as the request');
setter(pattern.id, 'ring');
assert.deepEqual([pattern.value, pattern.dataset.volumeRetiredPatternRequest], ['ring', undefined], 'writing an offered pattern clears the request');
// The kept request holds only while the select still shows its shape
// fallback: choosing a pattern reads as that pattern at once, so the edit
// session records the change (and undo restores the request).
const requestSource = grab('function volumeAperturePatternValue(');
assert.ok(requestSource, 'one reader decides the aperture pattern value');
const patternValue = vm.runInNewContext(`${requestSource}; volumeAperturePatternValue`, {});
assert.equal(patternValue({ value: 'shape', dataset: { volumeRetiredPatternRequest: 'spiral' } }), 'spiral');
assert.equal(patternValue({ value: 'jets', dataset: { volumeRetiredPatternRequest: 'spiral' } }), 'jets', 'a chosen pattern wins over a stale request');
assert.equal(patternValue({ value: 'ring', dataset: {} }), 'ring');
assert.doesNotMatch(index.replace(requestSource, ''), /\.dataset\.volumeRetiredPatternRequest(?! =)(?!;)(?! \?)/,
  'no reader outside volumeAperturePatternValue consults the request directly');
// Observed Chrome for Testing 154 range readback (native004): the accepted
// temperature reference is serialized to 15 significant digits by the DOM.
const numericPreset = value => ({ domControls: { 'volume-physical-kelvin-per-heat': { value } } });
const requestedTemperature = numericPreset(1283.6830556513362);
const domTemperature = numericPreset('1283.68305565134');
assert.equal(volumeSettingsPresetControlValuesEqual(requestedTemperature, domTemperature), true,
  'native range serialization is not a substituted setting');
assert.deepEqual(volumeSettingsPresetAppliedDifferences(requestedTemperature, domTemperature), []);
for (const changed of [1283.68305565, 1283.68, 1600, 6000]) {
  assert.equal(volumeSettingsPresetControlValuesEqual(requestedTemperature, numericPreset(changed)), false);
  assert.equal(volumeSettingsPresetAppliedDifferences(requestedTemperature, numericPreset(changed)).length, 1);
}
assert.equal(volumeSettingsPresetControlValuesEqual(numericPreset(0), numericPreset(1e-20)), false,
  'no absolute epsilon erases small nonzero settings');
// Every comparison of basins, not just the load readback, treats '' as shell.
console.log('volume exact load contracts passed');
