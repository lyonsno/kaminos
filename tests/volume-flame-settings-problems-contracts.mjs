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

current = { domControls: { 'volume-density': null }, rendererControls: {}, presentationControls: { 'raymarch-smoke-presentation': null } };
assert.deepEqual(JSON.parse(JSON.stringify(context.problems(current))).map(p => p.message), ['Invalid flame setting volume-density', 'Invalid flame setting raymarch-smoke-presentation'],
  'a malformed descriptor is a listed problem, not a crash');

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
const describe = vm.runInNewContext(`${describeSource}; describeFlameSettingsProblems`, { flameSettingsProblemLabel: problem => problem.id, window: { __kaminosFlameSettingsProblems: [
  { id: 'volume-shell-inspect-mode', message: 'Unsupported volume-shell-inspect-mode: ' },
  { id: 'volume-density', message: 'Out of range volume-density' },
] } });
assert.deepEqual(JSON.parse(JSON.stringify(describe())), {
  text: 'FLAME EDITS REFUSED: 2 invalid controls (volume-shell-inspect-mode, volume-density); Unsupported volume-shell-inspect-mode: ; Out of range volume-density',
  warning: true,
}, 'the warning names every invalid control');
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`${describeSource}; describeFlameSettingsProblems()`, { flameSettingsProblemLabel: problem => problem.id, window: {} }))), { text: '', warning: false });
// The status line sits far down the panel and the info bar is under the
// volume canvas, so the warning also shows at the top of the Basins card and
// each invalid control is outlined where it sits.
assert.match(index, /<h2>Basins<\/h2>\n\s*<div class="volume-flame-problems" id="volume-flame-settings-problems" role="alert" hidden><\/div>/, 'the Basins card has a warning line');
const markSource = grab('function showFlameSettingsProblems(');
assert.ok(markSource, 'a renderer for the warning exists');
const banner = { hidden: true, textContent: '' };
const els = { 'volume-flame-settings-problems': banner, 'volume-wind-model': { classList: new Set(), title: 'Wind model', dataset: {} }, 'volume-density': { classList: new Set(), title: '', dataset: {} } };
for (const el of Object.values(els)) if (el.classList) { const set = el.classList; el.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }; }
const fakeDoc = { getElementById: id => els[id] || null, querySelectorAll: sel => (sel === '.volume-control-invalid' ? Object.values(els).filter(el => el.classList?.contains('volume-control-invalid')) : []) };
const win = { __kaminosFlameSettingsProblems: [{ id: 'volume-wind-model', message: 'Unsupported volume-wind-model: ' }, { id: 'domControls', message: 'Incomplete flame domControls' }] };
vm.runInNewContext(`function flameSettingsProblemLabel(problem) { return problem.id === 'volume-wind-model' ? 'Wind model' : problem.id; }\n${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win, document: fakeDoc });
assert.equal(banner.hidden, false, 'the warning line shows when controls are invalid');
assert.match(banner.textContent, /^FLAME EDITS REFUSED: 2 invalid controls \(Wind model, domControls\)/);
assert.equal(els['volume-wind-model'].classList.contains('volume-control-invalid'), true, 'the invalid control is outlined');
assert.equal(els['volume-wind-model'].title, 'Unsupported volume-wind-model: ', 'hovering the control gives the reason');
assert.equal(els['volume-density'].classList.contains('volume-control-invalid'), false);
win.__kaminosFlameSettingsProblems = [];
vm.runInNewContext(`function flameSettingsProblemLabel(problem) { return problem.id === 'volume-wind-model' ? 'Wind model' : problem.id; }\n${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win, document: fakeDoc });
assert.deepEqual([banner.hidden, els['volume-wind-model'].classList.contains('volume-control-invalid'), els['volume-wind-model'].title], [true, false, 'Wind model'], 'a clean load hides the warning, clears outlines and restores the hover text');
assert.match(recorder, /showFlameSettingsProblems\(\);/, 'the recorder shows the warning');
assert.match(index, /\.volume-control-invalid\s*\{[^}]*outline:/, 'invalid controls have a visible outline');
// The Workbench is hidden in the Authoring workspace, and the info bar paints
// under the volume canvas, so the warning also shows in the viewport above the
// canvas, names controls by their visible label, and outlines Authoring
// aliases. A refused press shows there too.
assert.match(index, /<div id="viewport">\n\s*<div class="viewport-flame-problems" id="viewport-flame-settings-problems" role="alert" hidden><\/div>/, 'the viewport has its own warning line');
assert.match(index, /\.viewport-flame-problems\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*12/, 'the viewport warning paints above the volume canvas and the edit HUD');
const labelSource = grab('function flameSettingsProblemLabel(');
assert.ok(labelSource, 'problems are named by their visible label');
const TEXT_NODE = 3;
const labelEl = text => ({ textContent: text, childNodes: [{ nodeType: TEXT_NODE, textContent: ' ' + text + ' ' }] });
const row = { querySelector: sel => (sel === '.slider-label' ? labelEl('Wind model') : null) };
// A help mark ("i") lives inside the label; it is not part of the name.
const helpRow = { querySelector: sel => (sel === '.slider-label' ? { textContent: 'Pressure Solveri', childNodes: [{ nodeType: TEXT_NODE, textContent: 'Pressure Solver' }, { nodeType: 1, textContent: 'i' }] } : null) };
const labelOf = vm.runInNewContext(`${labelSource}; flameSettingsProblemLabel`, { Node: { TEXT_NODE }, document: { getElementById: id => (id === 'volume-wind-model' ? { closest: () => row } : id === 'volume-pressure-solver' ? { closest: () => helpRow } : null) } });
assert.equal(labelOf({ id: 'volume-pressure-solver' }), 'Pressure Solver', 'a help mark inside the label is not part of the name');
assert.equal(labelOf({ id: 'volume-wind-model' }), 'Wind model', 'a control is named by its row label');
assert.equal(labelOf({ id: 'domControls' }), 'domControls', 'a problem with no control keeps its id');
const viewportBanner = { hidden: true, textContent: '' };
const alias = { classList: new Set(), title: 'drag to adjust', dataset: {} };
{ const set = alias.classList; alias.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }; }
const doc2 = {
  getElementById: id => ({ 'volume-flame-settings-problems': banner, 'viewport-flame-settings-problems': viewportBanner })[id] || null,
  querySelectorAll: sel => (sel === '[data-authoring-alias="volume-wind-model"]' ? [alias] : sel === '.volume-control-invalid' ? [alias].filter(a => a.classList.contains('volume-control-invalid')) : []),
};
const win2 = { __kaminosFlameSettingsProblems: [{ id: 'volume-wind-model', message: 'Unsupported volume-wind-model: ' }] };
vm.runInNewContext(`function flameSettingsProblemLabel(problem) { return problem.id === 'volume-wind-model' ? 'Wind model' : problem.id; }\n${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win2, document: doc2 });
assert.equal(viewportBanner.hidden, false, 'the viewport warning shows');
assert.match(viewportBanner.textContent, /^FLAME EDITS REFUSED: 1 invalid control \(Wind model\)/, 'the viewport warning names the control by label');
assert.deepEqual([alias.classList.contains('volume-control-invalid'), alias.title], [true, 'Unsupported volume-wind-model: '], 'Authoring aliases are outlined with the reason');
win2.__kaminosFlameSettingsProblems = [];
vm.runInNewContext(`function flameSettingsProblemLabel(problem) { return problem.id; }\n${describeSource}\n${markSource}\nshowFlameSettingsProblems();`, { window: win2, document: doc2 });
assert.deepEqual([viewportBanner.hidden, alias.classList.contains('volume-control-invalid'), alias.title], [true, false, 'drag to adjust'], 'clearing restores the alias');
assert.match(index, /id:'@flame-settings',\n\s*controls:[^\n]*onError:error=>showFlameEditRefused\(error\)/, 'a refused flame press shows in the viewport');
const refusedSource = grab('function showFlameEditRefused(');
const vb = { hidden: true, textContent: '' };
const timers = [];
vm.runInNewContext(`${refusedSource}; showFlameEditRefused(new Error('Unsupported volume-wind-model: '))`, { setInfo: () => {}, clearTimeout: () => {}, setTimeout: (fn, ms) => timers.push([fn.name, ms]), showFlameSettingsProblems: function showFlameSettingsProblems() {}, document: { getElementById: id => (id === 'viewport-flame-settings-problems' ? vb : null) } });
assert.deepEqual([vb.hidden, vb.textContent], [false, 'Flame edit refused: Unsupported volume-wind-model: ']);
assert.deepEqual(timers, [['showFlameSettingsProblems', 4000]], 'a refusal message falls back to the load state after a few seconds');
console.log('volume flame settings problems contracts passed');
