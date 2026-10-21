import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { flamePresetForLocalControls } from '../flame-authoring.mjs';
import { flamePoseToDomain } from '../scene-flame-emitter.mjs';
import {
  describeVolumeSettingsLibraryPublication,
  describeVolumeSettingsPresetProjection,
  describeVolumeSettingsSaveOutcome,
  describeVolumeSettingsPartialSave,
  describeVolumeSettingsPresetAppliedDifferences,
  volumeSettingsPresetAppliedDifferences,
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
assert.match(admit, /showVolumeSettingsPresetStatus\(\);/, 'admission status shows the loaded basin and its projection');
const showFn = index.slice(index.indexOf('function showVolumeSettingsPresetStatus('), index.indexOf('function showVolumeSettingsPresetStatus(') + 600);
assert.match(showFn, /const active = activeVolumeSettingsPresetStatus\(\);/, 'every status shows the loaded basin report');
assert.match(showFn, /active\.warning \|\| Boolean\(summary\?\.warning\)/, 'either report keeps the status in its warning state');
const statusFn = index.slice(index.indexOf('function activeVolumeSettingsPresetStatus('), index.indexOf('async function refreshVolumeSettingsPresetList('));
assert.match(statusFn, /describeVolumeSettingsPresetProjection\(receipt\.serverProjection\)/, 'the loaded-basin status describes the server projection');
// The picker index loads concurrently with route admission; its status must
// not erase the loaded basin's report, and it selects the loaded basin.
const refresh = index.slice(index.indexOf('async function refreshVolumeSettingsPresetList('), index.indexOf('async function saveVolumeSettingsPreset('));
assert.match(refresh, /const previous = selectedPresetId \|\| activeVolumeSettingsPresetReceipt\?\.presetId \|\| select\.value;/, 'the picker selects the loaded basin');
assert.match(refresh, /volumeSettingsPresetIndexSummary = \{[\s\S]*warning: unavailable\.length > 0/, 'the index keeps its summary for later status updates');
assert.match(refresh, /showVolumeSettingsPresetStatus\(\);/, 'the index status keeps the loaded basin report');
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
// A hold only in this server's store (the library label moved) says so.
const localOnly = describeVolumeSettingsSaveOutcome({
  effective: { label: 'kiln', aliasHeld: { reason: 'would-drop-controls', controls: ['volume-new-knob'], currentPresetId: `vsp-${'7'.repeat(64)}`, scope: 'local-store' } },
  sharedPublication: { published: true, storePath: '/lib', aliasHeld: null },
});
assert.equal(localOnly.warning, true);
assert.equal(localOnly.text, 'in library /lib | this server\'s store kept "kiln" on vsp-777777777777 because this branch lacks volume-new-knob; the library label follows this save');
const libraryHeld = describeVolumeSettingsSaveOutcome({ effective: { label: 'kiln', aliasHeld: held ? { reason: 'would-drop-controls', controls: ['x'], currentPresetId: `vsp-${'9'.repeat(64)}` } : null },
  sharedPublication: { published: true, storePath: '/lib', label: 'kiln',
    aliasHeld: { reason: 'would-drop-controls', controls: ['volume-ridge-radius-cells'], currentPresetId: `vsp-${'9'.repeat(64)}` } } });
assert.equal((libraryHeld.text.match(/kept on/g) || []).length, 1, 'one hold is reported once');
const save = index.slice(index.indexOf('async function saveVolumeSettingsPreset('), index.indexOf('function buildVolumeBasinPromotionEffectiveState('));
assert.match(save, /const reuseBlock = volumeSettingsPresetLabelReuseBlock\(activeVolumeSettingsPresetReceipt, label, activeVolumeSettingsPresetApplied\);\s*if \(reuseBlock\) throw new Error\(reuseBlock\);/,
  'save refuses to reuse a cross-branch basin label before writing');
assert.match(save, /const outcome = describeVolumeSettingsSaveOutcome\(result\);/);
assert.match(save, /outcome\.text \? ` \| \$\{outcome\.text\}` : ''\}`,\s*outcome\.warning,/, 'the save status shows the library outcome and warns');
// Promotion export publishes to the library too: same guard, same report.
const promote = index.slice(index.indexOf('async function exportBasinPromotionPackage('), index.indexOf('let activeVolumeBasinDriveRecorder'));
assert.match(promote, /const reuseBlock = volumeSettingsPresetLabelReuseBlock\(activeVolumeSettingsPresetReceipt, label, activeVolumeSettingsPresetApplied\);\s*if \(reuseBlock\) throw new Error\(reuseBlock\);/,
  'promotion refuses to reuse a cross-branch basin label');
assert.match(promote, /const outcome = describeVolumeSettingsSaveOutcome\(\{ effective: result\.settingsPreset, sharedPublication: result\.sharedPublication \}\);/);
assert.match(promote, /outcome\.text \? ` \| \$\{outcome\.text\}` : ''\}`, outcome\.warning\);/, 'the promotion status shows the library outcome and warns');
// What the page actually applied is read back after a basin loads: a slider
// that clamps, or a select that cannot hold the saved option, is a difference
// the server projection cannot see.
const savedPreset = {
  domControls: {
    'volume-reaction-boundary-fire-clean-blue': { id: 'volume-reaction-boundary-fire-clean-blue', value: 1.76 },
    'volume-fire-render-mode': { id: 'volume-fire-render-mode', value: 'ridge' },
    'volume-density': { id: 'volume-density', value: '0.5' },
    'volume-gone': { id: 'volume-gone', value: 3 },
  },
  rendererControls: { 'volume-flow-kernel-coherence': { id: 'volume-flow-kernel-coherence', value: 2 } },
};
const appliedPreset = {
  domControls: {
    'volume-reaction-boundary-fire-clean-blue': { value: 1 },
    'volume-fire-render-mode': { value: 'shell' },
    'volume-density': { value: 0.5 },
  },
  rendererControls: { 'volume-flow-kernel-coherence': { value: 2 } },
};
const differences = volumeSettingsPresetAppliedDifferences(savedPreset, appliedPreset);
assert.deepEqual(JSON.parse(JSON.stringify(differences)), [
  { axis: 'basin', id: 'volume-reaction-boundary-fire-clean-blue', saved: 1.76, applied: 1 },
  { axis: 'basin', id: 'volume-fire-render-mode', saved: 'ridge', applied: 'shell' },
  { axis: 'basin', id: 'volume-gone', saved: 3, applied: null },
]);
assert.ok(Object.isFrozen(differences));
const appliedSummary = describeVolumeSettingsPresetAppliedDifferences(differences);
assert.equal(appliedSummary.warning, true);
assert.equal(appliedSummary.text,
  '3 values changed when loaded here: volume-reaction-boundary-fire-clean-blue 1.76 -> 1, volume-fire-render-mode ridge -> shell, volume-gone 3 -> (no control)');
assert.deepEqual(describeVolumeSettingsPresetAppliedDifferences([]), { text: '', warning: false });
assert.match(volumeSettingsPresetLabelReuseBlock({ ...exact, label: 'Plain', alias: 'plain' }, 'Plain', differences),
  /changed when loaded here[\s\S]*new label/, 'a basin crushed on load cannot be saved back under its own label');
assert.equal(volumeSettingsPresetLabelReuseBlock({ ...exact, label: 'Plain', alias: 'plain' }, 'Plain', []), null);
const init = index.slice(index.indexOf('async function initKaminosVolumeRoute('));
const initBody = init.slice(0, init.indexOf('\n}\n'));
assert.match(initBody, /syncControls\(\);\s*recordVolumeSettingsPresetApplied\(\);/, 'the applied values are read back once the route has set every control');
const recordFn = index.match(/function recordVolumeSettingsPresetApplied\(\)[^]*?\n\}/)?.[0];
assert.ok(recordFn, 'the actual applied-value readback function is present');
for (const scale of [0.1, 1, 8]) {
  const portable = { sourceRadiusSpace:'simulation-v1', domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:0.3}} };
  const local = { domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:0.3/scale}} };
  const context = vm.createContext({ activeVolumeSettingsPresetReceipt:{preset:portable}, activeVolumeSettingsPresetApplied:[],
    flamePresetForLocalControls, flamePoseToDomain, volumeSettingsPresetAppliedDifferences, console,
    flameEmitterPose:{position:[0,0,0],rotation:[0,0,0],scale:[scale,scale,scale]},
    flameDomainTranslation:[0,0,0], flameDomainScale:1, buildVolumeSettingsPreset:()=>local,
    showVolumeSettingsPresetStatus(){}, window:{} });
  vm.runInContext(recordFn, context);
  assert.equal(context.recordVolumeSettingsPresetApplied().length, 0, 'portable radius is compared in local coordinates');
  local.domControls['volume-immersed-radius'].value *= 1.1;
  const actual = context.recordVolumeSettingsPresetApplied();
  assert.equal(actual.length, 1, 'a real radius edit is still reported');
  assert.equal(actual[0].id, 'volume-immersed-radius');
  assert.equal(portable.domControls['volume-immersed-radius'].value, 0.3, 'readback preserves the immutable receipt');
}
assert.match(statusFn, /describeVolumeSettingsPresetAppliedDifferences\(activeVolumeSettingsPresetApplied\)/, 'the loaded-basin status reports what changed on load');
for (const [name, body] of [['save', save], ['promotion', promote]]) {
  assert.match(body, /volumeSettingsPresetLabelReuseBlock\(activeVolumeSettingsPresetReceipt, label, activeVolumeSettingsPresetApplied\)/,
    `${name} refuses to reuse the label of a basin that changed on load`);
}
// A save whose library publish succeeded and local write failed says both.
assert.equal(describeVolumeSettingsPartialSave({ partial: true, localError: 'permission denied',
  sharedPublication: { published: true, storePath: '/lib', presetId: `vsp-${'6'.repeat(64)}`, label: 'kiln', aliasMoved: true } }),
  'in library /lib as vsp-666666666666 under "kiln"; NOT saved locally: permission denied');
assert.equal(describeVolumeSettingsPartialSave({ partial: true, localError: 'x',
  sharedPublication: { published: true, storePath: '/lib', presetId: `vsp-${'6'.repeat(64)}`, label: 'kiln', aliasMoved: false } }),
  'in library /lib as vsp-666666666666; NOT saved locally: x');
assert.match(save, /if \(!sceneSnapshot\) \{\s*const reuseBlock = volumeSettingsPresetLabelReuseBlock/, 'scene snapshots move no label, so the reuse guard does not apply');
assert.match(save, /result\.partial[\s\S]*describeVolumeSettingsPartialSave\(result\)[\s\S]*partialSave = true/, 'a partial save is raised as partial');
assert.match(save, /result\.partial[\s\S]*await refreshVolumeSettingsPresetList\(result\.sharedPublication\.presetId\)[\s\S]*partialSave = true/, 'after a partial save the picker shows what the library now holds');
assert.match(save, /error\.partialSave \? 'PRESET SAVE PARTIAL' : 'PRESET SAVE FAILED'/, 'the status distinguishes a partial save');
console.log('volume settings projection receipt contracts passed');

for (const requested of ['tall_plume', 'canonical_plume', 'bonfire_plume']) {
  for (const serverProjected of [true, false]) {
    const source = currentDocument(serverProjected ? {
      retiredControlsStripped: [{ axis: 'basin', id: 'volume-scene', param: 'volume_scene', value: requested }],
    } : null);
    if (!serverProjected) {
      source.preset.domControls['volume-scene'] = { id: 'volume-scene', param: 'volume_scene', tagName: 'SELECT', type: 'select-one', value: requested };
      source.preset.route += '&volume_scene=' + requested;
      source.preset.controlCount++;
      source.controlCount++;
    }
    const original = JSON.stringify(source);
    const migrated = validateVolumeSettingsPresetDocument(source, null, schema);
    assert.equal(migrated.serverProjection.sceneMigration?.requested, requested);
    assert.equal(migrated.serverProjection.sceneMigration?.effective, 'flame');
    const status = describeVolumeSettingsPresetProjection(migrated.serverProjection);
    assert.match(status.text, new RegExp(requested + '.*Flame'));
    assert.equal(status.warning, requested !== 'tall_plume');
    if (requested !== 'tall_plume') assert.match(status.text, /Flame dynamics/);
    assert.deepEqual(migrated.preset.domControls, currentDocument(null).preset.domControls);
    assert.equal(JSON.stringify(source), original, 'loading never rewrites the source basin');
  }
}
