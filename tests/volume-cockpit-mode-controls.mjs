import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../volume-retired-control-migration.mjs', import.meta.url), 'utf8');
const executable = source.replace(
  "import { migrateRetiredVolumeCockpitLayoutDocument } from './volume-retired-control-migration.mjs';", migration,
) + '\nexport { buildSourceDefaultLayout };';
const layout = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const ids = ['volume-density', 'volume-flow-rate', 'volume-physical-mode',
  'volume-physical-thermal', 'volume-reaction-boundary-fire-soot', 'volume-steps', 'future-control'];
const controls = ids.map(id => ({ id, closest() { return null; } }));
const defaults = layout.buildSourceDefaultLayout(controls);
const groupOf = id => defaults.groups.find(group => group.controlIds.includes(id));
assert.notEqual(groupOf('volume-density'), groupOf('volume-flow-rate'),
  'material density must not be grouped with simulation flow');
assert.equal(groupOf('volume-physical-thermal'), groupOf('volume-reaction-boundary-fire-soot'),
  'hot-soot strength and soot yield belong together despite historical DOM sections');
assert.notEqual(groupOf('volume-steps'), groupOf('volume-physical-thermal'),
  'raymarch budget must be separate from appearance');
assert.deepEqual(defaults.groups.flatMap(group => group.controlIds).sort(), [...ids].sort(),
  'organization must retain unknown controls exactly once');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const knownIds = new Set([...schema.controls, ...schema.rendererControls].map(control => control.key));
for (const id of ids.filter(id => id !== 'future-control')) assert.ok(knownIds.has(id), id);
const emissive = { physicalColorMode: 2, fireRenderMode: 'inspect', shellInspectMode: 'boundary_fire', boundarySidecarSource: 'baked' };
const before = structuredClone(emissive);
const availability = layout.volumeCockpitModeAvailability(emissive);
const pyro = layout.volumeCockpitModeAvailability(emissive, [...knownIds]);
assert.ok(pyro['volume-pyro-material-gain']);
assert.ok(pyro['volume-pyro-flame-core-color']);
assert.equal(pyro['volume-pyro-detail'], undefined, 'detail producer is not hidden as a color control');
for (const id of Object.keys(availability)) assert.ok(knownIds.has(id), id);
for (const id of ['volume-smoke', 'volume-absorption', 'volume-reaction-boundary-gamma', 'volume-shell-thermal']) {
  assert.ok(availability[id], `${id} is inactive in emissive mode`);
}
for (const id of ['volume-physical-thermal', 'volume-physical-smoke-extinction', 'volume-boundary-sidecar-ridge']) {
  assert.equal(availability[id], '', `${id} is active in emissive baked mode`);
}
assert.deepEqual(emissive, before, 'availability never retunes source controls');
const thermal = layout.volumeCockpitModeAvailability({ ...emissive, physicalColorMode: 1 });
assert.equal(thermal['volume-reaction-boundary-fire-clean-color'], '');
assert.ok(thermal['volume-physical-smoke-extinction']);
const legacy = layout.volumeCockpitModeAvailability({ ...emissive, physicalColorMode: 0 });
assert.equal(legacy['volume-reaction-boundary-gamma'], '');
assert.ok(legacy['volume-physical-thermal']);
for (const override of [{ boundarySidecarView: 'ridge' }, { boundarySplatMode: 'analytic' }, { volumeResidualMode: 'direct' }]) {
  const diagnostic = layout.volumeCockpitModeAvailability({ ...emissive, ...override });
  assert.ok(diagnostic['volume-physical-thermal'], 'diagnostics must not impersonate active emissive transport');
  assert.equal(diagnostic['volume-reaction-boundary-gamma'], '', 'diagnostic fallback retains its actual transfer controls');
}
assert.ok(layout.volumeCockpitModeAvailability({ ...emissive, boundarySidecarSource: 'live' })['volume-boundary-sidecar-blur']);
assert.ok(layout.volumeCockpitModeAvailability({ ...emissive, boundarySidecarSource: 'override' })['volume-boundary-sidecar-ridge']);
// Renderer receipts outrank the requested mode, regardless of why it fell back.
for (const inactiveReason of ['intrinsic-presentation', 'caller-owned-presentation']) {
  const fallback = layout.volumeCockpitModeAvailability(emissive, [...knownIds], {
    requested: 'emissive-transport-v2', effective: 'legacy', inactiveReason,
  });
  assert.equal(fallback['volume-reaction-boundary-gamma'], '', `${inactiveReason}: effective legacy gamma must return`);
  assert.ok(fallback['volume-physical-thermal'], `${inactiveReason}: unused emission control must disappear`);
}
// Exercise the actual readout's receipt-to-DOM integration without starting a
// GPU. These are UI fixtures, not evidence that a native renderer was executed.
const nodes = new Map([...knownIds].map(id => [id, { id, value: `preserved:${id}`, dataset: {}, disabled: false }]));
const rows = ['volume-reaction-boundary-gamma', 'volume-physical-thermal'].map(id => ({
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
  index.indexOf("  if (s.physicalColor?.requested", start));
const savedValues = [...nodes.values()].map(input => input.value);
for (const inactiveReason of ['intrinsic-presentation', 'caller-owned-presentation']) {
  for (const effective of ['emissive-transport-v2', 'legacy', 'emissive-transport-v2']) {
    vm.runInNewContext(`(function(){${hook}})()`, {
      volumePrototype: { debugState: () => ({ physicalColor: { requested: 'emissive-transport-v2', effective, inactiveReason } }) },
      readVolumeControls: () => emissive, document: doc,
      syncVolumeCockpitModeAvailability: layout.syncVolumeCockpitModeAvailability,
    });
    assert.equal(rows[0].dataset.volumeModeHidden, String(effective !== 'legacy'));
    assert.equal(rows[1].dataset.volumeModeHidden, String(effective === 'legacy'));
    assert.deepEqual([...nodes.values()].map(input => input.value), savedValues);
  }
}
console.log('volume cockpit mode controls: pass');
