import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BURNER_DEFAULTS, normalizeBurner } from '../annular-burner.mjs';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source boundary: ${start}`);
  return source.slice(a, b);
};
const tests = [];
const test = (name, run) => tests.push([name, run]);
class Scalar {
  constructor(value) { this.value = Number(value); }
  valueOf() { return this.value; }
  add(v) { return new Scalar(this.value + Number(v)); }
  sub(v) { return new Scalar(this.value - Number(v)); }
  mul(v) { return new Scalar(this.value * Number(v)); }
  div(v) { return new Scalar(this.value / Number(v)); }
  min(v) { return new Scalar(Math.min(this.value, Number(v))); }
  max(v) { return new Scalar(Math.max(this.value, Number(v))); }
  clamp(lo, hi) { return this.max(lo).min(hi); }
  pow(v) { return new Scalar(this.value ** Number(v)); }
}
const float = v => new Scalar(v);
const mix = (a, b, t) => float(a).mul(float(1).sub(t)).add(float(b).mul(t));

test('AO intensity stays monotone and nonnegative without clipping intermediate visibility', () => {
  const expression = between(source.includes('  const aoVisibility =') ? '  const aoVisibility =' : '  const aoOutput =', source.includes('  scenePass.contextNode =') ? '  scenePass.contextNode =' : '  const baseSceneOutput');
  for (const visibility of [0, 0.01, 0.2, 0.5, 0.8, 1]) {
    let previous = 1;
    for (const strength of [0, 0.25, 0.7, 1, 1.5, 2, 3]) {
      const result = Number(vm.runInNewContext(`${expression}\nNumber(aoOutput)`, {
        float, mix, denoisePass: { r: float(visibility) }, aoIntensity: float(strength),
        texture: () => ({ r: float(visibility) }), denoiseResolved: { value: {} }, screenUV: {},
      }));
      assert.ok(result >= 0 && result <= previous + 1e-12, `${visibility} at ${strength}: ${result}`);
      if (visibility > 0) assert.ok(result > 0, 'nonzero visibility must not be crushed to zero');
      if (strength <= 1) assert.ok(Math.abs(result - (1 + (visibility - 1) * strength)) < 1e-12);
      previous = result;
    }
  }
});

test('burner visibility preserves the authored recipe and its disabled scene roundtrip', () => {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: false });
    return elements.get(id);
  } };
  const composition = { schema: 'kaminos.stationary-flame-composition.v1',
    flame: { presetId: `vsp-${'a'.repeat(64)}`, stationary: true },
    route: { volume_light_field: '1' }, lightGainStops: 0 };
  const context = vm.createContext({ document, burnerFields: [], burnerRecipe: null, annularBurner: null,
    burnerError: null, activeSceneComposition: composition, BURNER_DEFAULTS, normalizeBurner,
    createAnnularBurner: (_three, _merge, recipe) => ({ group: {}, recipe, dispose() {} }),
    THREE: {}, mergeGeometries() {}, scene: { add() {} }, window: {},
    isFireLightFieldRoute: () => true, burnerSource: () => ({}),
  });
  vm.runInContext(between('function syncBurnerControls()', 'function updateAnnularBurnerFrame('), context);
  vm.runInContext(between("document.getElementById('burner-enabled').onchange", "for (const [id, sourceId] of [['radius'"), context);
  const authored = { ...BURNER_DEFAULTS, ringCount: 37, glow: 4.7, bedColor: '#123456' };
  context.setAnnularBurner(authored);
  const toggle = checked => document.getElementById('burner-enabled').onchange({ target: { checked } });
  toggle(false);
  assert.equal(context.annularBurner, null);
  assert.equal(context.burnerRecipe?.ringCount, 37, 'hiding must not delete the recipe');
  assert.equal(context.burnerRecipe.enabled, false);
  const reopened = planSceneRestore(buildSceneDocument({ composition })).composition.burner;
  context.setAnnularBurner(reopened);
  assert.equal(context.annularBurner, null, 'disabled scene must reopen disabled');
  toggle(true);
  assert.equal(context.burnerRecipe.ringCount, 37);
  assert.equal(context.burnerRecipe.glow, 4.7);
  assert.equal(context.burnerRecipe.bedColor, '#123456');
  context.setAnnularBurner(null);
  toggle(true);
  assert.equal(context.burnerRecipe.ringCount, BURNER_DEFAULTS.ringCount, 'a new scene may reset the recipe');
  assert.throws(() => normalizeBurner({ ...authored, enabled: 'false' }), /enabled/i);
});

test('unavailable light field releases both external texture bindings', () => {
  const dead = { destroyed: true };
  const context = vm.createContext({ passState: { adoptionKey: 'old', farFieldIdentity: 'old' },
    atlasTextureNode: { value: dead }, metaTextureNode: { value: dead },
    atlasExternalTexture: { placeholder: 'atlas' }, metaExternalTexture: { placeholder: 'meta' },
    fireLightFieldStrength: { value: 1 },
  });
  vm.runInContext(`${between('  const bindBlackAtlas =', '\n  return {\n    outputNode,')}\nbindBlackAtlas('unavailable');`, context);
  assert.equal(context.atlasTextureNode.value, context.atlasExternalTexture);
  assert.equal(context.metaTextureNode.value, context.metaExternalTexture, 'destroyed metadata must not survive in the render binding');
  assert.equal(context.fireLightFieldStrength.value, 0);
});

test('environment backdrop brightness and contrast are independent from scene lighting', () => {
  const values = { 'env-blur-slider': '0.4', 'env-bg-brightness': '1.7', 'env-bg-contrast': '1.3' };
  const map = {};
  const scene = { environment: map, environmentIntensity: 2.4, environmentRotation: {} };
  const context = vm.createContext({ scene, showEnvBg: true, currentEnvMap: map,
    document: { getElementById: id => ({ value: values[id] }) },
    envBackdropContrast: float(1), pmremTexture: () => ({ rgb: float(0.18) }), vec3: float, mix,
    THREE: { Color: class {} },
  });
  vm.runInContext(`${between('function updateBackground()', '// --- AO Controls ---')}\nupdateBackground();`, context);
  assert.equal(scene.backgroundIntensity, 1.7);
  assert.equal(context.envBackdropContrast.value, 1.3);
  assert.equal(scene.environmentIntensity, 2.4);
  assert.equal(scene.environment, map);
  assert.ok(scene.backgroundNode, 'contrast must reach the actual rendered background');
  assert.match(between('function buildSceneData(', 'function isCompositionAuthoring()'), /backgroundBrightness:/);
  assert.match(between('function buildSceneData(', 'function isCompositionAuthoring()'), /backgroundContrast:/);
  assert.match(between('  // Load environment first', '  if (objectRecords.length > 0)'), /env\.backgroundContrast/);
});

let failures = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures) process.exitCode = 1;
