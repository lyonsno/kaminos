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
// The table also holds selects (physical mode, material law), which have no
// range: they take the table's integer value, as before.
assert.match(fieldLoop.slice(0, 600), /if \(el\?\.type === 'range'\) applyVolumeRangeSavedValue\(el, routeValue\);\n\s*else if \(el\) el\.value = clampVolumeControlValue\(routeValue, field\)\.toFixed\(field\.decimals\);/,
  'only range inputs go through the saved-value setter; table selects keep their option value');
const shellLoop = routeInit.slice(routeInit.indexOf("['volume_shell_amount', 'volume-shell-amount'"));
assert.match(shellLoop.slice(0, 1500), /applyVolumeRangeSavedValue\(document\.getElementById\(id\), routed\)/,
  'shell route values load through the saved-value setter');
// Route selects take any option the page offers.
const shellInspect = routeInit.slice(routeInit.indexOf('const routeShellInspectMode'), routeInit.indexOf('const routeShellInspectMode') + 600);
assert.match(shellInspect, /volumeSelectOffers\(document\.getElementById\('volume-shell-inspect-mode'\), routeShellInspectMode\)/,
  'shell inspect accepts every mode the select offers, including boundary_fire');
const offersSource = grab('function volumeSelectOffers(');
assert.ok(offersSource);
const offers = vm.runInNewContext(`${offersSource}; volumeSelectOffers`, {});
assert.equal(offers({ options: [{ value: 'shell' }, { value: 'boundary_fire' }] }, 'boundary_fire'), true);
assert.equal(offers({ options: [{ value: 'shell' }] }, 'boundary_fire'), false);

// 35 library basins saved shell inspect as '' (the renderer reads it as shell,
// mode 0). The select offers no empty option, so loading '' left the select
// invalid and every flame control's edit session refused to begin.
const emptyInspect = shellInspect.slice(0, shellInspect.indexOf('} else if'));
assert.match(emptyInspect, /\.value = 'shell'/, 'an empty saved shell inspect loads as shell, its renderer equivalent');
const inspectAs = value => ({ domControls: { 'volume-shell-inspect-mode': { value } } });
assert.deepEqual(volumeSettingsPresetAppliedDifferences(inspectAs(''), inspectAs('shell')), [],
  'loading an empty shell inspect as shell is not a changed value');
assert.equal(volumeSettingsPresetAppliedDifferences(inspectAs('thermal'), inspectAs('shell')).length, 1,
  'other shell inspect changes still show');

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
// Every comparison of basins, not just the load readback, treats '' as shell.
assert.equal(volumeSettingsPresetControlValuesEqual(inspectAs(''), inspectAs('shell')), true, 'a loaded empty-inspect basin is not Modified');
console.log('volume exact load contracts passed');
