import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeVolumeSettingsLibraryPublication,
  describeVolumeSettingsPresetProjection,
  describeVolumeSettingsSaveOutcome,
  validateVolumeSettingsPresetDocument,
  volumeSettingsPresetLabelReuseBlock,
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
assert.match(admit, /volumeSettingsPresetStatus\(activeVolumeSettingsPresetStatus\(\)\.text, activeVolumeSettingsPresetStatus\(\)\.warning\)/,
  'admission status shows the loaded basin and its projection, and warns');
const statusFn = index.slice(index.indexOf('function activeVolumeSettingsPresetStatus('), index.indexOf('async function refreshVolumeSettingsPresetList('));
assert.match(statusFn, /describeVolumeSettingsPresetProjection\(receipt\.serverProjection\)/, 'the loaded-basin status describes the server projection');
// The picker index loads concurrently with route admission; its status must
// not erase the loaded basin's report, and it selects the loaded basin.
const refresh = index.slice(index.indexOf('async function refreshVolumeSettingsPresetList('), index.indexOf('async function saveVolumeSettingsPreset('));
assert.match(refresh, /const previous = selectedPresetId \|\| activeVolumeSettingsPresetReceipt\?\.presetId \|\| select\.value;/, 'the picker selects the loaded basin');
assert.match(refresh, /const active = activeVolumeSettingsPresetStatus\(\);/, 'the index status keeps the loaded basin report');
assert.match(refresh, /active\.warning \|\| unavailable\.length > 0/, 'a projected basin keeps the status in its warning state');
assert.match(index, /entry\.carriedControls\?\.length \|\| entry\.unsupportedValuesDefaulted\?\.length/, 'the picker marks basins projected across branches');
// A basin loaded across branches with carried or replaced values cannot be
// saved back under its own label: that would replace it for every branch.
assert.match(volumeSettingsPresetLabelReuseBlock({ ...receipt, label: 'Crownflame', alias: 'crownflame' }, 'Crownflame'),
  /loaded from another branch[\s\S]*carries 1 control[\s\S]*new label/);
assert.ok(volumeSettingsPresetLabelReuseBlock({ ...receipt, label: 'Crownflame', alias: 'crownflame' }, 'crownflame'), 'the alias spelling is the same label');
assert.equal(volumeSettingsPresetLabelReuseBlock({ ...receipt, label: 'Crownflame', alias: 'crownflame' }, 'Crownflame v2'), null, 'a new label is fine');
assert.equal(volumeSettingsPresetLabelReuseBlock({ ...exact, label: 'Plain', alias: 'plain' }, 'Plain'), null, 'an exact basin keeps its label');
assert.equal(volumeSettingsPresetLabelReuseBlock(null, 'Anything'), null);

// The save status says whether the basin reached the shared library.
assert.deepEqual(describeVolumeSettingsLibraryPublication(undefined), { text: '', warning: false }, 'older servers report nothing');
assert.deepEqual(describeVolumeSettingsLibraryPublication({ published: false, reason: 'shared basin library disabled' }),
  { text: 'library off', warning: false });
assert.deepEqual(describeVolumeSettingsLibraryPublication({ published: false, storePath: '/lib', error: 'disk full' }),
  { text: 'NOT in library /lib: disk full', warning: true });
assert.deepEqual(describeVolumeSettingsLibraryPublication({ published: true, storePath: '/lib', aliasHeld: null }),
  { text: 'in library /lib', warning: false });
const held = describeVolumeSettingsLibraryPublication({ published: true, storePath: '/lib', label: 'kiln',
  aliasHeld: { reason: 'would-drop-controls', controls: ['volume-ridge-radius-cells'], currentPresetId: `vsp-${'9'.repeat(64)}` } });
assert.equal(held.warning, true);
assert.match(held.text, /in library \/lib as a version; label "kiln" kept on vsp-999999999999 because this branch lacks volume-ridge-radius-cells/);
// A save held in the server's own store (library off, or the store is the
// library) is reported just like a library hold.
const localHold = describeVolumeSettingsSaveOutcome({
  effective: { label: 'kiln', aliasHeld: { reason: 'would-replace-values', controls: ['volume-mode'], currentPresetId: `vsp-${'8'.repeat(64)}` } },
  sharedPublication: { published: false, reason: 'shared basin library disabled' },
});
assert.equal(localHold.warning, true);
assert.match(localHold.text, /library off \| label "kiln" kept on vsp-888888888888 because this branch does not offer the saved value of volume-mode/);
assert.deepEqual(describeVolumeSettingsSaveOutcome({ effective: { label: 'kiln', aliasHeld: null },
  sharedPublication: { published: true, storePath: '/lib', aliasHeld: null } }), { text: 'in library /lib', warning: false });
const libraryHeld = describeVolumeSettingsSaveOutcome({ effective: { label: 'kiln', aliasHeld: held ? { reason: 'would-drop-controls', controls: ['x'], currentPresetId: `vsp-${'9'.repeat(64)}` } : null },
  sharedPublication: { published: true, storePath: '/lib', label: 'kiln',
    aliasHeld: { reason: 'would-drop-controls', controls: ['volume-ridge-radius-cells'], currentPresetId: `vsp-${'9'.repeat(64)}` } } });
assert.equal((libraryHeld.text.match(/kept on/g) || []).length, 1, 'one hold is reported once');
const save = index.slice(index.indexOf('async function saveVolumeSettingsPreset('), index.indexOf('function buildVolumeBasinPromotionEffectiveState('));
assert.match(save, /const reuseBlock = volumeSettingsPresetLabelReuseBlock\(activeVolumeSettingsPresetReceipt, label\);\s*if \(reuseBlock\) throw new Error\(reuseBlock\);/,
  'save refuses to reuse a cross-branch basin label before writing');
assert.match(save, /const outcome = describeVolumeSettingsSaveOutcome\(result\);/);
assert.match(save, /outcome\.text \? ` \| \$\{outcome\.text\}` : ''\}`,\s*outcome\.warning,/, 'the save status shows the library outcome and warns');
// Promotion export publishes to the library too: same guard, same report.
const promote = index.slice(index.indexOf('async function exportBasinPromotionPackage('), index.indexOf('let activeVolumeBasinDriveRecorder'));
assert.match(promote, /const reuseBlock = volumeSettingsPresetLabelReuseBlock\(activeVolumeSettingsPresetReceipt, label\);\s*if \(reuseBlock\) throw new Error\(reuseBlock\);/,
  'promotion refuses to reuse a cross-branch basin label');
assert.match(promote, /const outcome = describeVolumeSettingsSaveOutcome\(\{ effective: result\.settingsPreset, sharedPublication: result\.sharedPublication \}\);/);
assert.match(promote, /outcome\.text \? ` \| \$\{outcome\.text\}` : ''\}`, outcome\.warning\);/, 'the promotion status shows the library outcome and warns');
console.log('volume settings projection receipt contracts passed');
