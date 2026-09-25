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

function currentPresetArtifact() {
  const current = structuredClone(parentArtifact);
  delete current.preset.domControls[retired.key];
  const route = new URL(current.preset.route);
  route.searchParams.delete(retired.param);
  current.preset.route = route.href;
  current.controlCount = schema.controlCount;
  current.preset.controlCount = schema.controlCount;
  return current;
}

const additiveFineBreakupLocalization = schema.controls.find(control => control.key === 'volume-fine-breakup-localization');
assert.equal(additiveFineBreakupLocalization?.additiveSinceControlCount, 210,
  'the Fine Breakup localization control declares the exact schema count at which it became additive');
const legacyFineBreakupArtifact = currentPresetArtifact();
const legacyFineBreakupRoute = new URL(legacyFineBreakupArtifact.preset.route);
const additionsSinceFineBreakup = schema.controls.filter(control => control.additiveSinceControlCount >= 210);
for (const control of additionsSinceFineBreakup) {
  delete legacyFineBreakupArtifact.preset.domControls[control.key];
  legacyFineBreakupRoute.searchParams.delete(control.param);
}
legacyFineBreakupArtifact.preset.route = legacyFineBreakupRoute.href;
legacyFineBreakupArtifact.controlCount = 209;
legacyFineBreakupArtifact.preset.controlCount = 209;
const legacyFineBreakupReceipt = validateVolumeSettingsPresetDocument(
  legacyFineBreakupArtifact,
  legacyFineBreakupArtifact.presetId,
  schema,
);
assert.deepEqual(legacyFineBreakupReceipt.retirementMigration?.addedControlIds, additionsSinceFineBreakup.map(control => control.key));
assert.equal(legacyFineBreakupReceipt.preset.domControls[additiveFineBreakupLocalization.key].value, 0);
assert.equal(legacyFineBreakupReceipt.presetRoute.searchParams.get(additiveFineBreakupLocalization.param), '0');
assert.equal(legacyFineBreakupReceipt.preset.controlCount, schema.controlCount,
  'the original basin traverses successive declared additions before exact current-schema validation');

const legacy206Artifact = currentPresetArtifact();
const additionsSince206 = [
  'volume-force-micro-carrier',
  'volume-force-interface-shred',
  'volume-force-fine-breakup',
  'volume-fine-breakup-localization',
  'volume-common-gas-transport',
].map(key => schema.controls.find(control => control.key === key));
assert.ok(additionsSince206.every(Boolean), 'the 206-control basin additions remain in the canonical schema');
const legacy206Route = new URL(legacy206Artifact.preset.route);
for (const control of additionsSince206) {
  delete legacy206Artifact.preset.domControls[control.key];
  legacy206Route.searchParams.delete(control.param);
}
legacy206Artifact.preset.route = legacy206Route.href;
legacy206Artifact.controlCount = 206;
legacy206Artifact.preset.controlCount = 206;
const legacy206Receipt = validateVolumeSettingsPresetDocument(legacy206Artifact, legacy206Artifact.presetId, schema);
assert.deepEqual(legacy206Receipt.retirementMigration?.addedControlIds, additionsSince206.map(control => control.key),
  'the captured 206-control basin crosses the three-control batch and subsequent single additions');
for (const control of additionsSince206) {
  assert.equal(legacy206Receipt.preset.domControls[control.key].value, control.additiveDefault);
  assert.equal(legacy206Receipt.presetRoute.searchParams.get(control.param), String(control.additiveDefault));
}
assert.equal(legacy206Receipt.preset.controlCount, schema.controlCount);

const commonGasTransport = schema.controls.find(control => control.key === 'volume-common-gas-transport');
assert.equal(commonGasTransport?.additiveSinceControlCount, 211);
const legacyTransportArtifact = currentPresetArtifact();
delete legacyTransportArtifact.preset.domControls[commonGasTransport.key];
const legacyTransportRoute = new URL(legacyTransportArtifact.preset.route);
legacyTransportRoute.searchParams.delete(commonGasTransport.param);
legacyTransportArtifact.preset.route = legacyTransportRoute.href;
legacyTransportArtifact.controlCount -= 1;
legacyTransportArtifact.preset.controlCount -= 1;
const legacyTransportReceipt = validateVolumeSettingsPresetDocument(legacyTransportArtifact, legacyTransportArtifact.presetId, schema);
assert.deepEqual(legacyTransportReceipt.retirementMigration?.addedControlIds, [commonGasTransport.key]);
assert.equal(legacyTransportReceipt.preset.domControls[commonGasTransport.key].value, false);
assert.equal(legacyTransportReceipt.presetRoute.searchParams.get(commonGasTransport.param), 'false');
assert.equal(legacyFineBreakupReceipt.preset.domControls[commonGasTransport.key].value, false,
  'both 209- and 210-control basins retain the legacy gas transport law');
assert.equal(validateVolumeSettingsPresetDocument(currentPresetArtifact(), parentArtifact.presetId, schema)
  .preset.domControls[commonGasTransport.key].value, false);
const enabledTransportArtifact = currentPresetArtifact();
enabledTransportArtifact.preset.domControls[commonGasTransport.key].value = true;
const enabledTransportRoute = new URL(enabledTransportArtifact.preset.route);
enabledTransportRoute.searchParams.set(commonGasTransport.param, 'true');
enabledTransportArtifact.preset.route = enabledTransportRoute.href;
assert.equal(validateVolumeSettingsPresetDocument(enabledTransportArtifact, enabledTransportArtifact.presetId, schema)
  .preset.domControls[commonGasTransport.key].value, true,
  'a saved opt-in choice survives validation rather than being replaced by its compatibility default');

const malformedDomCount = currentPresetArtifact();
malformedDomCount.controlCount = 999;
malformedDomCount.preset.controlCount = 999;
assert.throws(
  () => validateVolumeSettingsPresetDocument(malformedDomCount, malformedDomCount.presetId, schema),
  /count|exactly|schema identity/i,
  'migration cannot normalize malformed current-schema DOM counts when no retirement was applied',
);

const malformedRendererCount = currentPresetArtifact();
malformedRendererCount.preset.rendererControlCount = 999;
assert.throws(
  () => validateVolumeSettingsPresetDocument(malformedRendererCount, malformedRendererCount.presetId, schema),
  /renderer.*count|exactly .* renderer/i,
  'migration cannot normalize a malformed auxiliary-axis count when no retirement was applied',
);

const malformedOuterCount = currentPresetArtifact();
malformedOuterCount.controlCount = 999;
assert.throws(
  () => validateVolumeSettingsPresetDocument(malformedOuterCount, malformedOuterCount.presetId, schema),
  /count|schema identity/i,
  'migration cannot normalize disagreement between outer and source-preset DOM counts',
);

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
