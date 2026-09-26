import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeVolumeSettingsPresetProjection,
  validateVolumeSettingsPresetDocument,
} from '../volume-settings-preset-contract.mjs';

// A basin loaded from another branch or an older schema is never changed
// silently: the page keeps the server's projection on its receipt and says
// what was carried, defaulted, or stripped when the basin is admitted.
const root = join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const hash = '5'.repeat(64);

function currentDocument(schemaProjection) {
  const document = {
    identity: 'kaminos-volume-settings-preset-artifact-v2',
    presetId: `vsp-${hash}`,
    contentHash: `sha256:${hash}`,
    schemaIdentity: schema.identity,
    controlCount: schema.controlCount,
    preset: {
      identity: 'kaminos-volume-settings-preset-v2',
      kind: 'settings-preset',
      schemaIdentity: schema.identity,
      savedAt: '2026-09-26T10:00:00Z',
      route: 'http://kaminos.invalid/?kaminos_volume_smoke=1',
      domControls: {},
      controlCount: schema.controlCount,
      rendererControls: {},
      rendererControlCount: schema.rendererControls.length,
      presentationControls: {},
      presentationControlCount: schema.presentationControls.length,
      stateExclusions: Object.fromEntries(schema.excludedStateFields.map(field => [field, true])),
    },
  };
  for (const [axis, controls] of [['domControls', schema.controls], ['rendererControls', schema.rendererControls],
    ['presentationControls', schema.presentationControls]]) {
    for (const control of controls) {
      const value = control.key === 'volume-scene' ? 'tall_plume'
        : control.additiveDefault ?? (control.type === 'checkbox' ? false : 0);
      document.preset[axis][control.key] = { id: control.key, param: control.param, tagName: control.tagName, type: control.type, value };
      document.preset.route += `&${encodeURIComponent(control.param)}=${encodeURIComponent(String(value))}`;
    }
  }
  for (const param of schema.routeExtraParams) document.preset.route += `&${encodeURIComponent(param)}=projection-fixture`;
  if (schemaProjection) document.schemaProjection = schemaProjection;
  return document;
}

const projection = {
  identity: 'kaminos-volume-settings-schema-projection-v1',
  defaultsApplied: ['volume-time-step', 'volume-confinement'],
  retiredControlsStripped: [{ axis: 'basin', id: 'volume-majorant-grid', param: 'volume_majorant_grid', value: '24' }],
  carriedControls: [{ axis: 'basin', id: 'volume-ridge-radius-cells', param: 'volume_ridge_radius_cells', value: 2 }],
  unsupportedValuesDefaulted: [{ axis: 'basin', id: 'volume-pressure-solver', param: 'volume_pressure_solver', value: 'multigrid', effective: 'legacy' }],
};
const receipt = validateVolumeSettingsPresetDocument(currentDocument(projection), `vsp-${hash}`, schema);
assert.deepEqual(JSON.parse(JSON.stringify(receipt.serverProjection)), {
  defaultsApplied: projection.defaultsApplied,
  retiredControlIds: ['volume-majorant-grid'],
  carriedControls: projection.carriedControls,
  unsupportedValuesDefaulted: projection.unsupportedValuesDefaulted,
});
assert.ok(Object.isFrozen(receipt.serverProjection), 'the admitted projection is immutable');

const described = describeVolumeSettingsPresetProjection(receipt.serverProjection);
assert.equal(described.warning, true, 'carried or replaced values are a warning, not a footnote');
assert.match(described.text, /carries 1 control from another branch: volume-ridge-radius-cells/);
assert.match(described.text, /1 value not offered here: volume-pressure-solver multigrid -> legacy/);
assert.match(described.text, /2 newer controls at defaults/);
assert.match(described.text, /1 retired control dropped/);

const defaultsOnly = describeVolumeSettingsPresetProjection(validateVolumeSettingsPresetDocument(
  currentDocument({ ...projection, carriedControls: [], unsupportedValuesDefaulted: [], retiredControlsStripped: [] }), null, schema,
).serverProjection);
assert.deepEqual(defaultsOnly, { text: '2 newer controls at defaults', warning: false });

// Older servers send no projection: nothing to report, nothing invented.
const exact = validateVolumeSettingsPresetDocument(currentDocument(null), null, schema);
assert.deepEqual(JSON.parse(JSON.stringify(exact.serverProjection)),
  { defaultsApplied: [], retiredControlIds: [], carriedControls: [], unsupportedValuesDefaulted: [] });
assert.deepEqual(describeVolumeSettingsPresetProjection(exact.serverProjection), { text: '', warning: false });

// The page reports the projection when it admits a basin, and the picker
// marks basins that carry controls or had values replaced.
const admit = index.slice(index.indexOf('async function admitVolumeSettingsPresetRoute('), index.indexOf('function reportKaminosVolumeRouteInitFailure('));
assert.match(admit, /describeVolumeSettingsPresetProjection\(receipt\.serverProjection\)/, 'admission describes the server projection');
assert.match(admit, /volumeSettingsPresetStatus\([\s\S]*projectionSummary\.text[\s\S]*projectionSummary\.warning/, 'admission status shows it and warns');
assert.match(index, /entry\.carriedControls\?\.length \|\| entry\.unsupportedValuesDefaulted\?\.length/, 'the picker marks basins projected across branches');
console.log('volume settings projection receipt contracts passed');
