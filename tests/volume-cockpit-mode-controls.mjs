import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../volume-retired-control-migration.mjs', import.meta.url), 'utf8');
const executable = source.replace(
  "import { migrateRetiredVolumeCockpitLayoutDocument } from './volume-retired-control-migration.mjs';", migration,
) + '\nexport { buildSourceDefaultLayout, controlCluster };';
const layout = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const budgetRow = { nextElementSibling: null };
const budgetTool = { id: 'volume-ray-budget-section' };
assert.deepEqual(layout.controlCluster({ id: 'volume-steps', closest: () => budgetRow,
  ownerDocument: { getElementById: id => id === budgetTool.id ? budgetTool : null },
}), [budgetRow, budgetTool], 'ray budget companion must move with its step control on every layout apply');
const ids = ['volume-density', 'volume-flow-rate', 'volume-physical-kelvin-per-heat',
  'volume-physical-thermal', 'volume-wavelet-strength', 'volume-steps', 'future-control'];
const controls = ids.map(id => ({ id, closest() { return null; } }));
const defaults = layout.buildSourceDefaultLayout(controls);
const groupOf = id => defaults.groups.find(group => group.controlIds.includes(id));
assert.notEqual(groupOf('volume-density'), groupOf('volume-flow-rate'),
  'material density must not be grouped with simulation flow');
assert.equal(groupOf('volume-physical-thermal'), groupOf('volume-physical-kelvin-per-heat'),
  'glow gain and Kelvin per heat belong together despite historical DOM sections');
assert.notEqual(groupOf('volume-steps'), groupOf('volume-physical-thermal'),
  'raymarch budget must be separate from appearance');
assert.deepEqual(defaults.groups.flatMap(group => group.controlIds).sort(), [...ids].sort(),
  'organization must retain unknown controls exactly once');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const knownIds = new Set([...schema.controls, ...schema.rendererControls].map(control => control.key));
for (const id of ids.filter(id => id !== 'future-control')) assert.ok(knownIds.has(id), id);
// The Physics law (emissive transport) is the only material law since the
// legacy laws' controls were retired (2026-10-18); the request snapshot no
// longer carries a color mode or material law.
const emissive = { boundarySidecarSource: 'baked' };
const before = structuredClone(emissive);
const availability = layout.volumeCockpitModeAvailability(emissive);
// The legacy transfer controls (Smoke, Absorption, the pyro carriers) are retired; nothing is left for availability to dim on the emissive route.
assert.ok(![...knownIds].some(id => id.startsWith('volume-pyro-')), 'no legacy pyro control is live');
for (const id of Object.keys(availability)) assert.ok(knownIds.has(id), id);
for (const id of ['volume-physical-thermal', 'volume-physical-smoke-extinction', 'volume-physical-kelvin-per-heat', 'volume-boundary-sidecar-ridge']) {
  assert.equal(availability[id], '', `${id} is active in emissive baked mode`);
}
assert.deepEqual(emissive, before, 'availability never retunes source controls');
assert.ok(layout.volumeCockpitModeAvailability({ ...emissive, boundarySidecarSource: 'live' })['volume-boundary-sidecar-blur']);
assert.ok(layout.volumeCockpitModeAvailability({ ...emissive, boundarySidecarSource: 'override' })['volume-boundary-sidecar-ridge']);
// Renderer receipts outrank the requested mode, regardless of why it fell back.
for (const inactiveReason of ['intrinsic-presentation', 'caller-owned-presentation']) {
  const fallback = layout.volumeCockpitModeAvailability(emissive, [...knownIds], {
    requested: 'emissive-transport-v2', effective: 'legacy', inactiveReason,
  });
  assert.ok(fallback['volume-physical-thermal'], `${inactiveReason}: unused emission control must disappear`);
}
// Exercise the actual readout's receipt-to-DOM integration without starting a
// GPU. These are UI fixtures, not evidence that a native renderer was executed.
const nodes = new Map([...knownIds].map(id => [id, { id, value: `preserved:${id}`, dataset: {}, disabled: false }]));
for(const id of ['volume-raymarch-status','volume-ray-step-status'])nodes.set(id,{id,textContent:''});
const rows = ['volume-physical-thermal'].map(id => ({
  dataset: {}, style: {}, querySelectorAll: () => [Object.assign(nodes.get(id), { closest: () => null })],
}));
const root = { querySelectorAll: selector => selector === '.slider-row' ? rows : [] };
const doc = {
  getElementById: id => id === 'volume-primary-control-root' ? root : nodes.get(id),
  querySelectorAll: () => [],
};
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = index.indexOf('function refreshVolumeReadout() {');
const hook = index.slice(start + 'function refreshVolumeReadout() {'.length,
  index.indexOf("  renderVolumeEmitterReceipt(window.__kaminosVolumeEmitterReceipt);", start));
const savedValues = [...nodes.values()].map(input => input.value);
for (const inactiveReason of ['intrinsic-presentation', 'caller-owned-presentation']) {
  for (const effective of ['emissive-transport-v2', 'legacy', 'emissive-transport-v2']) {
    vm.runInNewContext(`(function(){${hook}})()`, {
      volumePrototype: { debugState: () => ({ physicalColor: { requested: 'emissive-transport-v2', effective, inactiveReason } }) },
      flameInspector:null,syncKilnCollisionControl(){},readVolumeControls: () => emissive, document: doc,
      syncVolumeCockpitModeAvailability: layout.syncVolumeCockpitModeAvailability,
    });
    assert.equal(rows[0].dataset.volumeModeHidden, String(effective === 'legacy'));
    assert.deepEqual([...nodes.values()].map(input => input.value), savedValues);
  }
}
console.log('volume cockpit mode controls: pass');
