import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
// Fail first on the missing production connection, not a missing test import.
assert.match(core, /uniforms\.set\(detailForceContributionMask\(controlsSnapshot\.detailForceContributions\), 348\)/,
  'independent force contribution switches must reach the live uniform upload');
const { detailForceContributionMask, detailForceContributionReceipt } = await import('../volume-detail-force-isolation.mjs');
assert.deepEqual(detailForceContributionMask(), [1, 1, 1, 1]);
assert.deepEqual(detailForceContributionMask({ micro: false }), [1, 0, 1, 1]);
assert.deepEqual(detailForceContributionMask({ shred: false }), [1, 1, 0, 1]);
assert.deepEqual(detailForceContributionMask({ fine: false }), [1, 1, 1, 0]);
assert.deepEqual(detailForceContributionMask({ micro: false, shred: false, fine: false }), [1, 0, 0, 0]);
assert.deepEqual(detailForceContributionReceipt({ proceduralDetailForces: false }).effectiveMask, [0, 0, 0, 0]);
assert.deepEqual(detailForceContributionReceipt({ volumeScene: 'tall_plume' }).effectiveMask, [0, 1, 1, 1]);
assert.deepEqual(detailForceContributionReceipt({ volumeScene: 'bonfire_plume', bonfireDetailForces: 0 }).effectiveMask, [0, 0, 0, 0]);
assert.deepEqual(detailForceContributionReceipt({ volumeScene: 'bonfire_plume', bonfireDetailForces: 0.5 }).effectiveMask, [0.5, 0.5, 0.5, 0.5]);
assert.deepEqual(detailForceContributionReceipt({ volumeScene: 'bonfire_plume' }).effectiveMask, [1, 1, 1, 1]);
assert.match(core, /detail_force_isolation: vec4<f32>/);
for (const [component, rawCall] of [['y', 'transportedDetailDirection'], ['z', 'interfaceShreddingForce'], ['w', 'fieldDerivedFineScaleBreakup']]) {
  assert.match(core, new RegExp(`if \\(u\\.detail_force_isolation\\.${component} > 0\\.5\\) \\{[\\s\\S]*?${rawCall}\\(`),
    `${rawCall} must be bypassed when its contribution is disabled`);
}
assert.match(core, /detailForceIsolation: state\.detailForceIsolation/);
assert.doesNotMatch(index, /id="detail-force-isolation"/, 'the mutually exclusive diagnostic dropdown is removed');
for (const [id, label, gloss] of [
  ['volume-force-micro-carrier', 'Micro-carrier', 'transported microstructure'],
  ['volume-force-interface-shred', 'Interface shred', 'material boundaries'],
  ['volume-force-fine-breakup', 'Fine breakup', 'coupled reaction regimes'],
]) {
  assert.match(index, new RegExp(`<span class="slider-label">${label}<\\/span>[\\s\\S]*?<input type="checkbox" id="${id}"[^>]+checked>[\\s\\S]*?${gloss}`),
    `${label} exposes a default-on checkbox and a behavioral gloss`);
}
for (const [id, param] of [
  ['volume-force-micro-carrier', 'volume_force_micro_carrier'],
  ['volume-force-interface-shred', 'volume_force_interface_shred'],
  ['volume-force-fine-breakup', 'volume_force_fine_breakup'],
]) {
  assert.ok(index.includes(`['${id}', '${param}']`), `${id} maps to its exact persisted basin-route key`);
}
assert.match(
  index,
  /for \(const \[id, param\] of \[[\s\S]*?if \(params\.has\(param\)\) setVolumeControlValue\(id, params\.get\(param\)\)/,
  'force contribution route mappings restore their persisted off/on state before the renderer reads the cockpit',
);
assert.match(index, /detailForceContributions:\s*\{[\s\S]*?micro: document\.getElementById\('volume-force-micro-carrier'\)\.checked[\s\S]*?shred: document\.getElementById\('volume-force-interface-shred'\)\.checked[\s\S]*?fine: document\.getElementById\('volume-force-fine-breakup'\)\.checked/);
assert.match(layout, /\['force', 'Force contributions',[\s\S]*?\['simulation', 'Simulation dynamics'/,
  'force contribution controls sit immediately above simulation dynamics in the source layout');
const { reconcileVolumeCockpitLayoutDocument } = await import('../volume-cockpit-layout.mjs');
const forceControlIds = [
  'volume-procedural-detail-forces',
  'volume-force-micro-carrier',
  'volume-force-interface-shred',
  'volume-force-fine-breakup',
  'volume-speed',
];
const reconciled = reconcileVolumeCockpitLayoutDocument({
  document: {
    identity: 'kaminos.volume.cockpit-layout.v1',
    layoutId: 'existing-operator-layout',
    label: 'Existing operator layout',
    groups: [{
      id: 'organized-simulation',
      label: 'Simulation dynamics',
      surface: 'primary',
      collapsed: false,
      controlIds: ['volume-procedural-detail-forces', 'volume-speed'],
    }],
  },
  authorableControlIds: forceControlIds,
});
assert.deepEqual(reconciled.document.groups.map(group => group.id), ['organized-force', 'organized-simulation']);
assert.deepEqual(reconciled.document.groups[0].controlIds, forceControlIds.slice(0, 4));
assert.deepEqual(reconciled.document.groups[1].controlIds, ['volume-speed']);
assert.deepEqual(reconciled.newControlIds, forceControlIds.slice(1, 4));
const authoredLayout = {
  identity: 'kaminos.volume.cockpit-layout.v1',
  layoutId: 'operator-authored-force-layout',
  label: 'Operator-authored force layout',
  groups: [
    {
      id: 'operator-primary',
      label: 'My immediate controls',
      surface: 'primary',
      collapsed: true,
      controlIds: ['volume-force-fine-breakup', 'volume-speed'],
    },
    {
      id: 'operator-secondary',
      label: 'My occasional controls',
      surface: 'authored-mix',
      collapsed: false,
      controlIds: [
        'volume-procedural-detail-forces',
        'volume-force-interface-shred',
        'volume-force-micro-carrier',
      ],
    },
  ],
};
const preserved = reconcileVolumeCockpitLayoutDocument({
  document: authoredLayout,
  authorableControlIds: forceControlIds,
});
assert.deepEqual(
  preserved.document,
  authoredLayout,
  'once every force control is known, reconciliation must preserve the operator-authored grouping, order and collapse state',
);
assert.deepEqual(preserved.newControlIds, []);
console.log('detail force contributions: independent controls, bypass routing and cockpit placement pass');
