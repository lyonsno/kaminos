import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const between = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
function environmentContext({ storage = new Map(), startup = false } = {}) {
  const elements = new Map(), listeners = {};
  const document = { querySelectorAll: () => [], getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, style: {}, textContent: '',
      addEventListener(type, fn) { if (id === 'sidebar') listeners[type] = fn; },
      dispatchEvent(event) { listeners[event.type]?.(event); },
    });
    return elements.get(id);
  } };
  const scene = { environmentRotation: { y: 0 }, environmentIntensity: 1 };
  const context = vm.createContext({ document, scene, sceneObjects: [], currentEnvName: null,
    envCache: { studio: { name: 'studio' }, warehouse: { name: 'warehouse' } },
    HDR_ENVS: { studio: { exposure: 1.5, intensity: 1 }, warehouse: { exposure: 0.7, intensity: 0.5 } },
    environmentRecipes: {}, environmentLoadToken: 0, currentEnvMap: null, showEnvBg: false,
    renderer: { toneMappingExposure: 1 }, THREE: { Euler: class { constructor(x,y,z) { Object.assign(this,{x,y,z}); } } },
    updateBackground() {}, window: {}, console,
    Event: class { constructor(type) { this.type = type; } }, rimLight: null, controls: {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value) },
  });
  vm.runInContext(between('// --- Environment Loading ---', '// --- File Loading ---'), context);
  if (startup) {
    vm.runInContext(between('// --- Settings Persistence ---', '// --- HDR Environments ---'), context);
    vm.runInContext(between('// --- Authored Rim Light ---', '// --- Exposure / Intensity Controls ---'), context);
    context.setRimLight();
  }
  return context;
}
const values = { exposure: 'exposure-slider', intensity: 'env-intensity-slider', rotation: 'env-rotation-slider', backgroundBrightness: 'env-bg-brightness', backgroundContrast: 'env-bg-contrast' };
const tune = (c, recipe) => {
  for (const [key, id] of Object.entries(values)) c.document.getElementById(id).value = String(recipe[key]);
  c.renderer.toneMappingExposure = recipe.exposure;
};
const snapshot = c => Object.fromEntries(Object.entries(values).map(([key,id]) => [key, Number(c.document.getElementById(id).value)]));

test('environment A/B/A recalls each lighting recipe, including exposure', async () => {
  const c = environmentContext();
  const a = { exposure: 2.3, intensity: 1.7, rotation: 2.1, backgroundBrightness: 0.85, backgroundContrast: 1.6 };
  const b = { exposure: 0.8, intensity: 0.4, rotation: 4.1, backgroundBrightness: 0.3, backgroundContrast: 0.7 };
  await c.loadEnvironment('studio'); tune(c,a);
  await c.loadEnvironment('warehouse'); tune(c,b);
  await c.loadEnvironment('studio'); assert.deepEqual(snapshot(c), a);
  assert.equal(c.renderer.toneMappingExposure,a.exposure);
  await c.loadEnvironment('warehouse'); assert.deepEqual(snapshot(c),b);
});

test('two startups without edits retain stored map recipes, selection, and rim settings', async () => {
  const storage = new Map();
  const recipe = { exposure: 2.3, intensity: 1.7, rotation: 2.1, backgroundBrightness: 0.85, backgroundContrast: 1.6, backgroundBlur: 0.4 };
  const saved = { 'exposure-slider': '2.3', 'show-env-bg': false, environmentName: 'warehouse',
    environmentRecipes: { studio: recipe, warehouse: { ...recipe, exposure: 0.83 } },
    rimLight: { enabled: true, color: '#d6e5ff', intensity: 123, azimuth: 135, elevation: 30, distance: 6, angle: 35, penumbra: .65, target: [1,2,3] } };
  storage.set('kaminos-settings', JSON.stringify(saved));
  for (let boot = 0; boot < 2; boot++) {
    const c = environmentContext({storage,startup:true});
    await c.loadEnvironment(c.restoreSettings() || 'studio');
    assert.equal(c.currentEnvName,'warehouse');
    assert.deepEqual(JSON.parse(JSON.stringify(c.environmentRecipes)),saved.environmentRecipes);
    assert.deepEqual(JSON.parse(JSON.stringify(c.readRimLightSettings())),saved.rimLight);
    assert.deepEqual(JSON.parse(storage.get('kaminos-settings')),saved,'restoring controls must not overwrite storage with partial startup state');
  }
});

test('a late HDR response cannot replace the selected environment or its tuning', async () => {
  const c = environmentContext(), requests = new Map();
  c.envCache = {};
  c.HDR_ENVS.studio.url = 'studio.hdr'; c.HDR_ENVS.warehouse.url = 'warehouse.hdr';
  c.RGBELoader = class { load(url, resolve) { requests.set(url, resolve); } };
  c.pmremGenerator = { fromEquirectangular: tex => ({ texture: { name: tex.name } }) };
  const studio = c.loadEnvironment('studio'), warehouse = c.loadEnvironment('warehouse');
  const recipe = { exposure: 2.3, intensity: 0.37, rotation: 2.1, backgroundBrightness: 0.85, backgroundContrast: 1.6 };
  tune(c,recipe);
  requests.get('warehouse.hdr')({ name: 'warehouse', dispose() {} }); await warehouse;
  requests.get('studio.hdr')({ name: 'studio', dispose() {} }); await studio;
  assert.equal(c.currentEnvName,'warehouse'); assert.equal(c.scene.environment.name,'warehouse');
  assert.equal(c.scene.environmentIntensity,0.37); assert.deepEqual(snapshot(c),recipe);
});

test('recipe validation preserves fine values and rejects invalid authored light', () => {
  const c = environmentContext();
  const recipe = { exposure: 1.23456789, intensity: 7.3456789, rotation: -9.1234, backgroundBrightness: 0, backgroundContrast: 0, backgroundBlur: 0.345678 };
  assert.deepEqual(JSON.parse(JSON.stringify(c.normalizeEnvironmentRecipe('studio',recipe))),recipe);
  for (const invalid of [{ intensity: -1 }, { exposure: '1' }, { rotation: Infinity }, { backgroundBlur: 2 }]) {
    assert.throws(()=>c.normalizeEnvironmentRecipe('studio',invalid));
  }
});

test('rim off/on preserves its aim and fine-valued recipe', () => {
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id,{ value:'',min:'0',max:'1',checked:false,addEventListener(){} }); return elements.get(id); } };
  const c=vm.createContext({document,rimLight:null,window:{},controls:{},saveSettings(){}});
  vm.runInContext(between('// --- Authored Rim Light ---','// --- Exposure / Intensity Controls ---'),c);
  const recipe={enabled:true,color:'#d6e5ff',intensity:123.45,azimuth:-237.89,elevation:34.56,distance:5.4321,angle:45.67,penumbra:0.1234,target:[1.234,2.345,-3.456]};
  c.setRimLight(recipe);document.getElementById('rim-enabled').checked=false;c.updateRimLight();
  assert.equal(document.getElementById('rim-controls').hidden,true);
  document.getElementById('rim-enabled').checked=true;c.updateRimLight();
  assert.deepEqual(JSON.parse(JSON.stringify(c.readRimLightSettings())),recipe);
  c.setRimLight();assert.equal(c.readRimLightSettings().enabled,false);
  assert.throws(()=>c.setRimLight({...recipe,distance:0}),/range/);
});

test('AO is attached to material indirect lighting, not multiplied over lit output', () => {
  class Scalar {
    constructor(value) { this.value = Number(value); }
    valueOf() { return this.value; }
    add(v) { return new Scalar(this.value + Number(v)); }
    sub(v) { return new Scalar(this.value - Number(v)); }
    mul(v) { return new Scalar(this.value * Number(v)); }
    div(v) { return new Scalar(this.value / Number(v)); }
    min(v) { return new Scalar(Math.min(this.value, Number(v))); }
    max(v) { return new Scalar(Math.max(this.value, Number(v))); }
    clamp(a,b) { return this.max(a).min(b); }
  }
  const float = v => new Scalar(v), scenePass = float(10);
  const c = vm.createContext({ scenePass, denoisePass:{r:float(0.2)}, aoIntensity:float(3), float,
    mix:(a,b,t)=>float(a).mul(float(1).sub(t)).add(float(b).mul(t)), vec3:float, vec4:float,
    builtinAOContext: ao => ({ ao }),
    texture: () => ({ r: float(0.2) }), denoiseResolved: { value: {} }, screenUV: {},
  });
  const output = vm.runInContext(between('  const aoVisibility =', '  fireLightFieldPass?.dispose?.();') + '\nbaseSceneOutput;',c);
  assert.equal(Number(output),10,'direct/emissive scene output must not receive a post-lighting AO multiplier');
  assert.ok(scenePass.contextNode?.ao,'material AO hook must remain active');
});

test('rim light has authorable controls and is saved independently of map recipes', () => {
  for (const id of ['rim-enabled','rim-intensity','rim-color','rim-azimuth','rim-elevation','rim-distance','rim-angle','rim-penumbra','rim-target-x','rim-target-y','rim-target-z']) {
    assert.ok(source.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.match(between('function buildSceneData(', 'function isCompositionAuthoring()'), /rimLight:/);
  assert.match(between('  // Load environment first', '  if (objectRecords.length > 0)'), /setRimLight/);
});
