// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { collectVolumeCockpitControlElements, VOLUME_COCKPIT_CONTROL_ROOT_IDS } from '../volume-cockpit-layout.mjs';
import { DEFAULT_VOLUME_SCENE, normalizeVolumeScene, volumeSceneReceipt } from '../volume-scene-ontology.mjs';

assert.equal(DEFAULT_VOLUME_SCENE, 'flame');
for (const previous of ['tall_plume', 'compact_plume', 'canonical_plume', 'bonfire_plume']) {
  assert.equal(normalizeVolumeScene(previous), 'flame');
  const receipt = volumeSceneReceipt(previous);
  assert.equal(receipt.requested, previous);
  assert.equal(receipt.effective, 'flame');
  assert.equal(receipt.migrated, true);
  assert.ok(receipt.migrationNote.includes(previous));
}
assert.equal(volumeSceneReceipt('flame').migrated, false);
assert.equal(normalizeVolumeScene(undefined), 'flame');
assert.equal(normalizeVolumeScene('unknown-old-scene'), 'flame');

const schema = JSON.parse(await readFile(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
for (const id of ['volume-scene', 'volume-canonical-spread', 'volume-canonical-centerline', 'volume-canonical-body-balance']) {
  assert.ok(!schema.controls.some(c => c.key === id), `${id} is not saved as a live control`);
  assert.ok(schema.retiredControls.some(c => c.key === id), `${id} retains the basin migration bridge`);
}
console.log('single simulator admission and retired scene inventory: OK');

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const setter = html.slice(html.indexOf('function setVolumeControlValue('), html.indexOf('function normalizeVolumeHexColor('));
const select = { value: 'flame', dataset: {} };
const context = { document: { getElementById: () => select }, normalizeVolumeScene };
vm.createContext(context);
vm.runInContext(setter, context);
context.setVolumeControlValue('volume-scene', 'bonfire_plume');
assert.equal(select.value, 'flame', 'legacy programmatic assignment retains the effective simulator');

const retired = { closest: selector => selector.includes('data-volume-schema-retired') ? {} : null };
const active = { closest: () => null };
const collected = collectVolumeCockpitControlElements({ getElementById: id => ({ querySelectorAll: () => id === VOLUME_COCKPIT_CONTROL_ROOT_IDS[0] ? [active, retired] : [] }) });
assert.deepEqual(collected, [active], 'schema-retired compatibility state is not a live cockpit control');

const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const pressureDefault = witness.match(/function defaultPressureIterationsForScene\([^]*?\n\}/)?.[0];
assert.ok(pressureDefault);
const witnessContext = { normalizeVolumeScene };
vm.createContext(witnessContext);
vm.runInContext(pressureDefault, witnessContext);
assert.equal(witnessContext.defaultPressureIterationsForScene('flame'), 2, 'diagnostic default follows the single simulator');

const resetGuard = html.match(/if \((routeVolumeScene && .*)\) \{/)[1];
for (const routeVolumeScene of ['flame', 'tall_plume']) {
  assert.equal(vm.runInNewContext(resetGuard, { routeVolumeScene, shouldApplyDefaultVolumeSmokeTallPreset: true }), false, 'loading the default basin must not reset its parameters');
}
