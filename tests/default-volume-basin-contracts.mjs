import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Bare kaminos_volume_smoke routes boot into the committed default basin
// (Noah's cheap-blast-furnace export), applied with its exact saved values.
// The page and the volume witness both derive the default from that one file.
const artifactUrl = new URL('../artifacts/default-basin/cheap-blast-furnace.json', import.meta.url);
const artifact = JSON.parse(readFileSync(artifactUrl, 'utf8'));
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.equal(artifact.identity, 'kaminos-volume-settings-preset-artifact-v2');
assert.equal(artifact.presetId, 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b');
assert.equal(artifact.contentHash, `sha256:${artifact.presetId.slice(4)}`);
assert.equal(artifact.initialLabel, 'cheap-blast-furnace');
const dom = artifact.preset.domControls;
assert.equal(dom['volume-resolution'].value, '64', 'default basin is a 64 grid');
assert.ok(dom['volume-steps'].value <= 60, 'default basin keeps ray steps cheap');
assert.equal(dom['volume-adaptive-rays'].value, 1, 'adaptive rays at max');
for (const id of Object.keys(dom)) {
  if (id === 'volume-render-scale') continue;
  assert.ok(html.includes(`id="${id}"`), `default basin control ${id} exists in the page`);
}
assert.ok(Object.keys(dom).length <= schema.controlCount, 'default basin fits the current schema');

// Page: bare routes apply the committed basin before any route parameter is
// read, and never when a settings preset is routed (preset routes carry their
// own complete basin; the default must not leak into controls they predate).
const routeInit = html.slice(html.indexOf('async function initKaminosVolumeRoute()'));
const beforeAdmission = routeInit.slice(0, routeInit.indexOf('await admitVolumeSettingsPresetRoute(params);'));
assert.match(beforeAdmission, /const shouldApplyDefaultVolumeSmokeTallPreset =[\s\S]*!params\.has\('settings_preset'\)[\s\S]*if \(shouldApplyDefaultVolumeSmokeTallPreset\) await applyDefaultVolumeSmokeBasin\(params\);/,
  'bare smoke routes apply the default basin before route parameters are read, excluding settings-preset routes');
assert.equal((routeInit.slice(0, routeInit.indexOf('\n}\n')).match(/applyDefaultVolumeSmokeBasin\(/g) || []).length, 1, 'the default basin applies once');
assert.doesNotMatch(routeInit.slice(0, routeInit.indexOf('\n}\n')), /applyTallPlumeOperatorPreset\(DEFAULT/, 'the ruffles preset is no longer the implicit default');

const fnStart = html.indexOf('async function applyDefaultVolumeSmokeBasin(');
assert.ok(fnStart >= 0, 'default basin loader exists');
const fnSource = html.slice(fnStart, html.indexOf('\n}\n', fnStart) + 2);
const setCalls = new Map();
let sceneApplied = null;
const context = vm.createContext({
  DEFAULT_VOLUME_SMOKE_BASIN_URL: './artifacts/default-basin/cheap-blast-furnace.json',
  fetch: async url => ({ ok: url === './artifacts/default-basin/cheap-blast-furnace.json', json: async () => artifact, status: 200 }),
  document: { getElementById: id => (id === 'retired-control' ? null : {}) },
  setVolumeControlValue: (id, value) => setCalls.set(id, value),
  applyVolumeScenePreset: (scene, options) => { sceneApplied = { scene, options }; },
  window: {},
  activeCanonicalVolumeMacroPreset: 'something',
  Object, JSON, Error, RegExp, Array, String, URL, URLSearchParams,
});
vm.runInContext(`${fnSource}; this.applyDefaultVolumeSmokeBasin = applyDefaultVolumeSmokeBasin;`, context);
const routeParams = new URLSearchParams('kaminos_volume_smoke=1&volume_steps=90');
const receipt = await context.applyDefaultVolumeSmokeBasin(routeParams);
assert.equal(routeParams.get('volume_emitter_family'), 'ring', 'route-driven emitter family comes from the basin');
assert.equal(routeParams.get('volume_emitter_source_law'), dom['volume-emitter-source-law'].value);
assert.equal(routeParams.get('volume_emitter_inlet_profile'), dom['volume-emitter-inlet-profile'].value);
assert.equal(routeParams.get('volume_steps'), '90', 'an explicit route parameter still wins');
assert.equal(routeParams.getAll('volume_resolution').length, 1);
assert.equal(routeParams.has('volume_quality_reason'), false, 'only basin control parameters are merged');
assert.equal(sceneApplied.scene, 'tall_plume');
assert.equal(sceneApplied.options.keepBudgetPreset, true, 'the routed ray-budget preset survives the default basin');
for (const [id, descriptor] of Object.entries(dom)) {
  if (id === 'volume-scene') continue;
  const expected = Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : descriptor.value;
  assert.deepEqual(setCalls.get(id), expected, `exact saved value for ${id}`);
}
for (const [id, descriptor] of Object.entries(artifact.preset.rendererControls)) {
  assert.deepEqual(setCalls.get(id), descriptor.value, `renderer control ${id}`);
}
assert.equal(receipt.presetId, artifact.presetId);
assert.equal(context.window.__kaminosDefaultVolumeSmokeBasin, receipt);
await assert.rejects(vm.runInContext(`(async () => { const saved = fetch; fetch = async () => ({ ok: false, status: 404 });
  try { return await applyDefaultVolumeSmokeBasin(new URLSearchParams()); } finally { fetch = saved; } })()`, context), /default volume basin unavailable: 404/);

// Witness: bare-route expectations come from the same artifact.
assert.match(witness, /artifacts\/default-basin\/cheap-blast-furnace\.json/, 'witness reads the committed default basin');
const convertStart = witness.indexOf('function volumeBasinScenePreset(');
assert.ok(convertStart >= 0, 'witness converts the basin into scene expectations');
const convert = witness.slice(witness.indexOf('const VOLUME_BASIN_EXPLICIT_KEYS'), witness.indexOf('\n}\n', convertStart) + 2);
const expected = vm.runInNewContext(`${convert}; volumeBasinScenePreset(artifact)`, { artifact, Object, Number, String });
assert.equal(expected.volumeScene, 'tall_plume');
assert.equal(expected.resolution, 64);
assert.equal(expected.raySteps, dom['volume-steps'].value);
assert.equal(expected.adaptiveRays, 1);
assert.equal(expected.renderScale, dom['volume-render-scale'].value);
assert.equal(expected.flowKernelCoherence, artifact.preset.rendererControls['volume-flow-kernel-coherence'].value,
  'renderer controls from the basin become witness expectations');
assert.match(witness, /: Number\.isFinite\(scenePreset\.flowKernelCoherence\) \? quantizeFlowKernelControl\(scenePreset\.flowKernelCoherence/,
  'witness expects the default basin flow-kernel coherence when the route does not set it');
assert.match(witness, /const shouldApplyDefaultVolumeSmokeTallPreset =[\s\S]*!routeParams\.has\('settings_preset'\)/,
  'witness does not expect the default basin on settings-preset routes');
assert.match(witness, /mergeDefaultVolumeBasinRouteParams\(routeParams/, 'witness sees the same merged route parameters as the page');
console.log('default volume basin contracts passed');
