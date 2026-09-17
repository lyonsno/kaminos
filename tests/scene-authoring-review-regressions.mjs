import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeBurner } from '../annular-burner.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let intensity = 1;
const gainControl = { value: '0' };
const geometryControl = { checked: false };
const context = vm.createContext({
  burnerRecipe: null, normalizeBurner,
  volumePrototype: { debugState: () => ({ active: true }) }, activeSceneComposition: null,
  isFireLightFieldRoute: () => true, volumeCockpitLayoutReady: Promise.resolve(),
  buildVolumeSettingsPreset: () => ({ savedAt: new Date().toISOString(), domControls: { intensity }, rendererControls: {}, presentationControls: {}, route: 'exact' }),
  saveVolumeSettingsPreset: async () => { intensity = 2; return { effective: { presetId: 'old', label: 'Old' } }; },
  fireLightFieldRouteParams: () => new URLSearchParams('volume_light_field=1'),
  location: { hash: '' }, URLSearchParams, COMPOSITION_SCHEMA: 'test',
  document: { getElementById: id => id === 'fire-light-gain-stops' ? gainControl : geometryControl },
});
vm.runInContext(between('async function collectSceneComposition()', 'async function withAuthoringAction('), context);
await assert.rejects(vm.runInContext('collectSceneComposition()', context), /changed.*(save|capture)|settings.*changed/i,
  'a changed basin must not be linked to pixels under the earlier immutable preset');
context.saveVolumeSettingsPreset = async () => ({ effective: { presetId: 'stable', label: 'Stable' } });
const unchanged = await vm.runInContext('collectSceneComposition()', context);
gainControl.value = '1';
assert.throws(unchanged, /changed/, 'changing light gain before pixels are sampled must reject the old lighting state');
gainControl.value = '0';
geometryControl.checked = true;
assert.throws(unchanged, /changed/, 'test geometry must match the sampled picture');
geometryControl.checked = false;
context.burnerRecipe = { schema: 'kaminos.annular-burner.v1', ringCount: 24 };
const burnerUnchanged = await vm.runInContext('collectSceneComposition()', context);
context.burnerRecipe.ringCount = 8;
assert.throws(burnerUnchanged, /changed/, 'burner edits before sampling must reject the earlier saved recipe');

const empty = vm.createContext({ sceneObjects: [], volumePrimitives: [],
  volumePrototype: { debugState: () => ({ active: true }) }, isFireLightFieldRoute: () => false });
vm.runInContext(between('function sceneIsEmpty()', 'function sceneSaveIsBlocked()'), empty);
assert.equal(vm.runInContext('sceneIsEmpty()', empty), true, 'unsupported standalone basin must not save an unloadable scene');

let chosenComposition;
const selection = vm.createContext({
  withAuthoringAction: action => action(), sceneSaveIsBlocked: () => false,
  collectSceneComposition: async () => {}, buildSceneData: () => ({ composition: null, objects: [{ id: 'kiln' }] }),
  saveToServer: async data => { chosenComposition = data.composition; return true; },
  currentSceneFile: 'mesh.kaminos.json', COMPOSITION_SCHEMA: 'test',
  compositionRestoreUrl: () => 'mounted', location: { origin: 'local', assign: () => {} },
});
vm.runInContext(between('async function changeCompositionBasin(entry)', 'window.captureComposition ='), selection);
assert.equal(await vm.runInContext("changeCompositionBasin({presetId: 'chosen', label: 'Chosen'})", selection), true);
assert.equal(chosenComposition.flame.presetId, 'chosen', 'mesh-only authoring can add its first basin');
assert.equal(chosenComposition.route.volume_light_field, '1');

const elements = new Map();
const document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { value: '2', checked: true, style: {}, handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.({ target: this }); } });
  return elements.get(id);
} };
const aoIntensity = { value: 2 };
const aoPass = Object.fromEntries(['radius', 'scale', 'thickness', 'distanceFallOff'].map(key => [key, { value: 0.8 }]));
const aoContext = vm.createContext({ document, aoIntensity, aoPass, window: {}, Event: class { constructor(type) { this.type = type; } },
  data: { postprocessing: { ao: { enabled: false, intensity: 0.25, radius: 0.1, scale: 1.1, thickness: 0.2, falloff: 0.3 } } } });
vm.runInContext(between('// --- AO Controls ---', '// --- Backdrop ---'), aoContext);
vm.runInContext(between('  // Apply postprocessing\n', '  // Apply backdrop\n'), aoContext);
assert.equal(aoIntensity.value, 0, 'restoring disabled AO changes the effective renderer');
assert.equal(aoPass.radius.value, 0.1);
assert.equal(aoPass.scale.value, 1.1);
assert.equal(aoPass.thickness.value, 0.2);
assert.equal(aoPass.distanceFallOff.value, 0.3);
console.log('scene authoring review regressions passed');
