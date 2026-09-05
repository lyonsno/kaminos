import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateVolumeSettingsPresetDocument } from '../volume-settings-preset-contract.mjs';
import {
  VOLUME_COCKPIT_LAYOUT_IDENTITY,
  reconcileVolumeCockpitLayoutDocument,
} from '../volume-cockpit-layout.mjs';

const root = join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const retired = schema.retiredControls.find(control => control.key === 'volume-procedural-transport-slip');
assert.deepEqual(retired, {
  axis: 'domControls',
  key: 'volume-procedural-transport-slip',
  param: 'volume_procedural_transport_slip',
  tagName: 'INPUT',
  type: 'checkbox',
});

const activeDescriptor = schema.controls.find(control => control.key === 'volume-scene');
const hash = '7'.repeat(64);
function parentPresetArtifact(retiredEntry = {}) {
  return {
    identity: 'kaminos-volume-settings-preset-artifact-v2',
    presetId: `vsp-${hash}`,
    contentHash: `sha256:${hash}`,
    schemaIdentity: schema.identity,
    controlCount: schema.controlCount + 1,
    preset: {
      identity: 'kaminos-volume-settings-preset-v2',
      kind: 'settings-preset',
      schemaIdentity: schema.identity,
      savedAt: '2026-09-05T18:00:00Z',
      route: 'http://kaminos.invalid/?kaminos_volume_smoke=1&volume_scene=bonfire&volume_procedural_transport_slip=true',
      domControls: {
        [activeDescriptor.key]: { ...activeDescriptor, id: activeDescriptor.key, value: 'bonfire' },
        [retired.key]: { ...retired, id: retired.key, value: true, ...retiredEntry },
      },
      controlCount: schema.controlCount + 1,
      rendererControls: Object.fromEntries(schema.rendererControls.map(control => [control.key, {
        ...control,
        id: control.key,
        value: control.additiveDefault ?? 0,
      }])),
      rendererControlCount: schema.rendererControls.length,
      presentationControls: Object.fromEntries(schema.presentationControls.map(control => [control.key, {
        ...control,
        id: control.key,
        value: control.additiveDefault,
      }])),
      presentationControlCount: schema.presentationControls.length,
      stateExclusions: Object.fromEntries(schema.excludedStateFields.map(field => [field, true])),
      note: 'parent-schema retirement fixture',
    },
  };
}

// Populate every still-active control so the fixture differs from current exactness only by the declared retirement.
const parentArtifact = parentPresetArtifact();
for (const control of schema.controls) {
  if (control.key === activeDescriptor.key) continue;
  const value = control.additiveDefault ?? (control.type === 'checkbox' ? false : 0);
  parentArtifact.preset.domControls[control.key] = { ...control, id: control.key, value };
  parentArtifact.preset.route += `&${encodeURIComponent(control.param)}=${encodeURIComponent(String(value))}`;
}
for (const control of [...schema.rendererControls, ...schema.presentationControls]) {
  const value = control.additiveDefault ?? 0;
  parentArtifact.preset.route += `&${encodeURIComponent(control.param)}=${encodeURIComponent(String(value))}`;
}
for (const param of schema.routeExtraParams) parentArtifact.preset.route += `&${encodeURIComponent(param)}=retirement-fixture`;

const migratedReceipt = validateVolumeSettingsPresetDocument(parentArtifact, parentArtifact.presetId, schema);
assert.deepEqual(migratedReceipt.retirementMigration?.removedControlIds, [retired.key]);
assert.equal(migratedReceipt.preset.domControls[retired.key], undefined);
assert.equal(migratedReceipt.presetRoute.searchParams.has(retired.param), false);
assert.equal(migratedReceipt.preset.domControls[activeDescriptor.key].value, 'bonfire');
assert.equal(migratedReceipt.preset.controlCount, schema.controlCount);

const retypedArtifact = structuredClone(parentArtifact);
retypedArtifact.preset.domControls[retired.key].type = 'range';
assert.throws(
  () => validateVolumeSettingsPresetDocument(retypedArtifact, retypedArtifact.presetId, schema),
  /retired control descriptor mismatch/,
  'a retyped historical control cannot borrow declared-retirement authority',
);

const unknownArtifact = structuredClone(parentArtifact);
unknownArtifact.controlCount += 1;
unknownArtifact.preset.controlCount += 1;
unknownArtifact.preset.domControls['volume-invented-retired-control'] = {
  id: 'volume-invented-retired-control',
  param: 'volume_invented_retired_control',
  tagName: 'INPUT',
  type: 'checkbox',
  value: true,
};
unknownArtifact.preset.route += '&volume_invented_retired_control=true';
assert.throws(
  () => validateVolumeSettingsPresetDocument(unknownArtifact, unknownArtifact.presetId, schema),
  /schema identity mismatch|exactly .* canonical controls|inventory mismatch/,
  'an invented unknown control remains a hard failure',
);

const activeControlIds = schema.controls.map(control => control.key);
const historicalLayout = {
  identity: VOLUME_COCKPIT_LAYOUT_IDENTITY,
  layoutId: 'pre-slip-retirement',
  label: 'Pre-slip retirement',
  groups: [{
    id: 'primary-controls',
    label: 'Primary controls',
    surface: 'primary',
    collapsed: true,
    controlIds: [retired.key, ...activeControlIds],
  }],
};
const layoutMigration = reconcileVolumeCockpitLayoutDocument({
  document: historicalLayout,
  authorableControlIds: activeControlIds,
  retiredControls: schema.retiredControls,
});
assert.deepEqual(layoutMigration.retiredControlIds, [retired.key]);
assert.deepEqual(layoutMigration.document.groups[0].controlIds, activeControlIds);
assert.equal(layoutMigration.document.groups[0].collapsed, true, 'surviving group state is preserved');

const inventedLayout = structuredClone(historicalLayout);
inventedLayout.groups[0].controlIds.unshift('volume-invented-retired-control');
assert.throws(
  () => reconcileVolumeCockpitLayoutDocument({
    document: inventedLayout,
    authorableControlIds: activeControlIds,
    retiredControls: schema.retiredControls,
  }),
  /unknown-control:volume-invented-retired-control/,
  'layout reconciliation continues to reject undeclared unknown controls',
);

console.log('volume retired-control migration contracts passed');
