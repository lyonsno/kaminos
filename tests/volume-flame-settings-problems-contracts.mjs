import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// One invalid flame control makes the edit session refuse every flame-control
// press (begin validates the whole state). The page lists every invalid control
// when it loads, using the same check the edit session runs, so the warning
// fires exactly when edits would be refused.
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grab = head => index.match(new RegExp(`${head.replace(/[()]/g, '\\$&')}[^]*?\\n\\}`))?.[0];
const problemsSource = grab('function flameSettingsStateProblems(');
const checkSource = grab('function checkFlameSettingsState(');
assert.ok(problemsSource, 'a problem lister exists');
assert.ok(checkSource, 'the edit check exists');

const controls = {
  'volume-shell-inspect-mode': { tagName: 'SELECT', type: 'select-one', options: [{ value: 'shell' }, { value: 'thermal' }] },
  'volume-emitter-aperture-pattern': { tagName: 'SELECT', type: 'select-one', options: [{ value: 'shape' }, { value: 'jets' }] },
  'volume-density': { tagName: 'INPUT', type: 'range', min: '0', max: '2' },
  'volume-render-scale': { tagName: 'INPUT', type: 'range', min: '0.1', max: '0.3' },
};
const state = (dom, smoke = 'on') => ({
  domControls: Object.fromEntries(Object.entries(dom).map(([id, value]) => [id, { value }])),
  rendererControls: {},
  presentationControls: { 'raymarch-smoke-presentation': { value: smoke } },
});
let current = state({ 'volume-shell-inspect-mode': 'shell', 'volume-emitter-aperture-pattern': 'shape', 'volume-density': 1, 'volume-render-scale': 1 });
const context = vm.createContext({
  document: { getElementById: id => controls[id] || null },
  flameSettingsState: () => current,
  VOLUME_RETIRED_APERTURE_PATTERNS: ['concentric', 'spiral'],
  Object, Number, String, Error,
});
vm.runInContext(`${problemsSource}\n${checkSource}\nthis.problems = flameSettingsStateProblems; this.check = checkFlameSettingsState;`, context);

const good = current;
assert.deepEqual(JSON.parse(JSON.stringify(context.problems(good))), [], 'a valid state has no problems');
assert.equal(context.check(good), good, 'the edit check passes a valid state through');

current = state({ 'volume-shell-inspect-mode': '', 'volume-emitter-aperture-pattern': 'spiral', 'volume-density': 3, 'volume-render-scale': 1 }, 'maybe');
assert.deepEqual(JSON.parse(JSON.stringify(context.problems(current))), [
  { id: 'volume-shell-inspect-mode', message: 'Unsupported volume-shell-inspect-mode: ' },
  { id: 'volume-density', message: 'Out of range volume-density' },
  { id: 'raymarch-smoke-presentation', message: 'Invalid smoke presentation' },
], 'every invalid control is listed with the message the edit check gives; a kept retired pattern and Full render scale are valid');
assert.throws(() => context.check(current), /^Error: Unsupported volume-shell-inspect-mode: $/, 'the edit check still refuses with the first problem');

current = { domControls: {}, rendererControls: {}, presentationControls: {} };
assert.deepEqual(JSON.parse(JSON.stringify(context.problems(state({ 'volume-density': 1 })))).map(p => p.message)[0], 'Incomplete flame domControls',
  'a state missing controls is reported as incomplete');

// The route lists problems once every control is set, and the status line
// shows them first, as a warning.
const routeInit = index.slice(index.indexOf('async function initKaminosVolumeRoute('));
assert.match(routeInit, /recordVolumeSettingsPresetApplied\(\);\n\s*recordFlameSettingsProblems\(\);/, 'the route records flame problems after the readback');
const recorder = grab('function recordFlameSettingsProblems(');
assert.match(recorder, /flameSettingsStateProblems\(flameSettingsState\(\)\)/, 'the recorder runs the edit check on the loaded state');
assert.match(recorder, /window\.__kaminosFlameSettingsProblems = /, 'the problems are exposed for witnesses');
const show = grab('function showVolumeSettingsPresetStatus(');
assert.match(show, /describeFlameSettingsProblems\(\)/, 'the status line includes the problems');
const describeSource = grab('function describeFlameSettingsProblems(');
const describe = vm.runInNewContext(`${describeSource}; describeFlameSettingsProblems`, { window: { __kaminosFlameSettingsProblems: [
  { id: 'volume-shell-inspect-mode', message: 'Unsupported volume-shell-inspect-mode: ' },
  { id: 'volume-density', message: 'Out of range volume-density' },
] } });
assert.deepEqual(JSON.parse(JSON.stringify(describe())), {
  text: 'FLAME EDITS REFUSED: 2 invalid controls (volume-shell-inspect-mode, volume-density); Unsupported volume-shell-inspect-mode: ; Out of range volume-density',
  warning: true,
}, 'the warning names every invalid control');
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`${describeSource}; describeFlameSettingsProblems()`, { window: {} }))), { text: '', warning: false });
// The status line sits far down the panel and the info bar is under the
// volume canvas, so the warning also shows at the top of the Basins card and
// each invalid control is outlined where it sits.
assert.match(index, /<h2>Basins<\/h2>\n\s*<div class="volume-flame-problems" id="volume-flame-settings-problems" role="alert" hidden><\/div>/, 'the Basins card has a warning line');
const markSource = grab('function showFlameSettingsProblems(');
assert.ok(markSource, 'a renderer for the warning exists');
const banner = { hidden: true, textContent: '' };
const els = { 'volume-flame-settings-problems': banner, 'volume-wind-model': { classList: new Set(), title: 'Wind model', dataset: {} }, 'volume-density': { classList: new Set(), title: '', dataset: {} } };
for (const el of Object.values(els)) if (el.classList) { const set = el.classList; el.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }; }
const fakeDoc = { getElementById: id => els[id] || null, querySelectorAll: () => Object.values(els).filter(el => el.classList?.contains('volume-control-invalid')) };
const win = { __kaminosFlameSettingsProblems: [{ id: 'volume-wind-model', message: 'Unsupported volume-wind-model: ' }, { id: 'domControls', message: 'Incomplete flame domControls' }] };
vm.runInNewContext(`${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win, document: fakeDoc });
assert.equal(banner.hidden, false, 'the warning line shows when controls are invalid');
assert.match(banner.textContent, /^FLAME EDITS REFUSED: 2 invalid controls \(volume-wind-model, domControls\)/);
assert.equal(els['volume-wind-model'].classList.contains('volume-control-invalid'), true, 'the invalid control is outlined');
assert.equal(els['volume-wind-model'].title, 'Unsupported volume-wind-model: ', 'hovering the control gives the reason');
assert.equal(els['volume-density'].classList.contains('volume-control-invalid'), false);
win.__kaminosFlameSettingsProblems = [];
vm.runInNewContext(`${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win, document: fakeDoc });
assert.deepEqual([banner.hidden, els['volume-wind-model'].classList.contains('volume-control-invalid'), els['volume-wind-model'].title], [true, false, 'Wind model'], 'a clean load hides the warning, clears outlines and restores the hover text');
assert.match(recorder, /showFlameSettingsProblems\(\);/, 'the recorder shows the warning');
assert.match(index, /\.volume-control-invalid\s*\{[^}]*outline:/, 'invalid controls have a visible outline');
assert.match(index, /id:'@flame-settings',\n\s*controls:[^\n]*onError:error=>setInfo\(`Flame edit refused: \$\{error\.message\}`\)/, 'a refused flame press says so');
console.log('volume flame settings problems contracts passed');
