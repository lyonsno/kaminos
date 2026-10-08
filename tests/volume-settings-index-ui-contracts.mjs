import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as contract from '../volume-settings-preset-contract.mjs';
import { describeVolumeSettingsPresetProjection, validateVolumeSettingsPresetIndex } from '../volume-settings-preset-contract.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const refresh = source.match(/async function refreshVolumeSettingsPresetList\([^]*?\n\}/)?.[0];
assert.ok(refresh);
const showStatus = source.match(/function showVolumeSettingsPresetStatus\(\)[^]*?\n\}/)?.[0] || '';
const available = { alias: 'live-kiln', label: 'Live kiln', presetId: `vsp-${'a'.repeat(64)}` };
const unavailable = {
  alias: 'future-kiln', label: 'Future kiln', presetId: `vsp-${'b'.repeat(64)}`,
  error: 'settings preset domControls contain unknown controls: volume-future-control',
};
const mixed = {
  identity: 'kaminos-volume-settings-preset-index-v1',
  schemaIdentity: 'kaminos-volume-settings-preset-schema-v2',
  controlCount: 2, rendererControlCount: 0, presentationControlCount: 0,
  storePath: '/observed-store', entries: [available], unavailableEntries: [unavailable],
};

async function render(index, selected = '', active = null) {
  const select = {
    options: [], value: selected,
    replaceChildren(...options) { this.options = options; },
    add(option) { this.options.push(option); },
  };
  const statuses = [];
  const context = vm.createContext({
    volumeSettingsPresetIndex: null,
    document: { getElementById: () => select },
    Option: class { constructor(text, value) { this.text = text; this.value = value; this.disabled = false; } },
    fetch: async () => ({ ok: true, json: async () => index }),
    validateVolumeSettingsPresetIndex,
    describeVolumeSettingsPresetProjection,
    activeVolumeSettingsPresetReceipt: active?.receipt || null,
    activeVolumeSettingsPresetStatus: () => active?.status || { text: '', warning: false },
    describeFlameSettingsProblems: () => ({ text: '', warning: false }),
    volumeSettingsPresetStatus: (...args) => statuses.push(args),
    volumeSettingsPresetIndexSummary: null,
  });
  await vm.runInContext(`${showStatus}\n${refresh}\nrefreshVolumeSettingsPresetList()`, context);
  return { select, statuses, context };
}

const mixedView = await render(mixed, available.presetId);
assert.equal(mixedView.select.value, available.presetId, 'refresh preserves an existing usable selection');
assert.equal(mixedView.select.options.length, 2, 'incompatible basins stay visible');
const blocked = mixedView.select.options.find(option => option.value === unavailable.presetId);
assert.equal(blocked.disabled, true);
assert.match(blocked.text, /unavailable/i);
assert.ok(blocked.title.includes(unavailable.error), 'tooltip explains the exact incompatibility');
assert.match(mixedView.statuses.at(-1)[0], /1 unavailable/i);
assert.equal(mixedView.statuses.at(-1)[1], true, 'partial availability is visibly distinct from full success');

// The index loads concurrently with route admission: a loaded basin stays
// selected and its report, including any cross-branch warning, survives.
const carried = { alias: 'ridge-kiln', label: 'Ridge kiln', presetId: `vsp-${'c'.repeat(64)}`,
  carriedControls: [{ axis: 'basin', id: 'volume-ridge-radius-cells', param: 'volume_ridge_radius_cells', value: 2 }] };
const loadedView = await render({ ...mixed, entries: [available, carried], unavailableEntries: [] }, '', {
  receipt: { presetId: carried.presetId },
  status: { text: 'Ridge kiln | carries 1 control from another branch: volume-ridge-radius-cells', warning: true },
});
assert.equal(loadedView.select.value, carried.presetId, 'the picker selects the loaded basin');
assert.match(loadedView.statuses.at(-1)[0], /^Ridge kiln \| carries 1 control from another branch[\s\S]*\|\| 2 presets/);
assert.equal(loadedView.statuses.at(-1)[1], true, 'a cross-branch basin keeps the status in its warning state');
const carriedOption = loadedView.select.options.find(option => option.value === carried.presetId);
assert.match(carriedOption.text, /from another branch/);
assert.match(carriedOption.title, /volume-ridge-radius-cells/);
assert.doesNotMatch(loadedView.select.options.find(option => option.value === available.presetId).text, /another branch/);

// Earlier versions of a label and other stores' pointers stay selectable.
const earlier = { alias: 'live-kiln', label: 'Live kiln', presetId: `vsp-${'d'.repeat(64)}`, publishedAt: '2026-09-18T10:00:00Z',
  source: { branch: 'cc/wake-kiln' }, reason: 'superseded-label' };
const versionsView = await render({ ...mixed, unavailableEntries: [], earlierVersions: [earlier] });
const earlierOption = versionsView.select.options.find(option => option.value === earlier.presetId);
assert.ok(earlierOption, 'an earlier version of a label is listed');
assert.equal(earlierOption.disabled, false, 'an earlier version is selectable');
assert.match(earlierOption.text, /^Live kiln \| earlier 2026-09-18 cc\/wake-kiln \| vsp-dddddddddddd/);
assert.match(versionsView.statuses.at(-1)[0], /1 earlier version/);
const heldView = await render({ ...mixed, unavailableEntries: [], earlierVersions: [{ ...earlier, reason: 'held-label' }] });
assert.match(heldView.select.options.find(option => option.value === earlier.presetId).text, /^Live kiln \| held 2026-09-18 cc\/wake-kiln/,
  'a version the label did not follow is shown as held, not earlier');
assert.match(heldView.select.options.find(option => option.value === earlier.presetId).title, /the label did not follow this version/);
assert.equal((await render({ ...mixed, unavailableEntries: [] })).select.options.length, 1, 'indexes without versions are unchanged');

// A listed earlier version opens through the picker's own commands.
const pickerSource = ['function selectedVolumeSettingsPresetEntry(', 'function selectedVolumeSettingsPresetUrl(', 'function navigateToSelectedVolumeSettingsPreset(']
  .map(head => source.match(new RegExp(`${head.replace(/[()]/g, '\\$&')}[^]*?\\n\\}`))?.[0]);
assert.ok(pickerSource.every(Boolean), 'picker commands are present');
const assigned = [];
Object.assign(versionsView.context, {
  isCompositionAuthoring: () => false, authoringBusy: false, setInfo: () => {},
  location: { assign: target => assigned.push(target) }, window: { open: () => null },
});
versionsView.select.value = earlier.presetId;
const opened = vm.runInContext(`${pickerSource.join('\n')}\nnavigateToSelectedVolumeSettingsPreset(false)`, versionsView.context);
assert.equal(opened, `/volume-settings-preset.html?preset=${earlier.presetId}`, 'Load here opens the selected earlier version');
assert.deepEqual(assigned, [opened]);
assert.doesNotMatch(versionsView.statuses.at(-1)[0], /FAILED/);

// A corrupt artifact is not described as a version difference, and malformed
// aliases are counted without failing the index.
const corrupt = { alias: 'broken-kiln', label: 'Broken kiln', presetId: `vsp-${'e'.repeat(64)}`, reason: 'invalid-artifact',
  error: 'volume settings preset artifact content hash mismatch' };
const skewed = { ...unavailable, reason: 'schema-skew' };
const reasonsView = await render({ ...mixed, unavailableEntries: [skewed, corrupt], invalidAliases: [{ alias: 'x', path: '/x', error: 'bad' }],
  invalidHistoryRows: [{ alias: 'kiln', path: '/h', line: 2, error: 'bad' }] });
assert.match(reasonsView.select.options.find(option => option.value === skewed.presetId).text, /unavailable on this version/);
assert.match(reasonsView.select.options.find(option => option.value === corrupt.presetId).text, /unreadable artifact/);
assert.doesNotMatch(reasonsView.select.options.find(option => option.value === corrupt.presetId).text, /this version/);
assert.match(reasonsView.statuses.at(-1)[0], /1 unreadable \| 1 malformed label \| 1 malformed history row/);
assert.equal(reasonsView.statuses.at(-1)[1], true);

// The readback at the end of route init and the index load race; whichever
// lands last, the status keeps both the loaded basin's report and the index summary.
{
  const grab = head => source.match(new RegExp(`${head.replace(/[()]/g, '\\$&')}[^]*?\\n\\}`))?.[0];
  const pageFns = [grab('function describeFlameSettingsProblems()'), grab('function activeVolumeSettingsPresetStatus()'), grab('function recordVolumeSettingsPresetApplied()'), showStatus, refresh]
    .filter(Boolean).join('\n');
  const receipt = { presetId: available.presetId, label: 'Live kiln', requestedPresetRef: 'live-kiln', schemaIdentity: 's', storePath: '/store',
    serverProjection: { defaultsApplied: [], retiredControlIds: [], carriedControls: [], unsupportedValuesDefaulted: [] },
    preset: { domControls: { 'volume-detail': { value: 0.44 } } } };
  for (const order of [['index', 'readback'], ['readback', 'index']]) {
    for (const applied of [0.44, 0.4]) {
      let status = null;
      const select = { options: [], value: '', replaceChildren(...o) { this.options = o; }, add(o) { this.options.push(o); } };
      const context = vm.createContext({ ...contract, window: {}, console, volumeSettingsPresetIndex: null, volumeSettingsPresetIndexSummary: null,
        activeVolumeSettingsPresetReceipt: receipt, activeVolumeSettingsPresetApplied: Object.freeze([]),
        document: { getElementById: () => select }, Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        fetch: async () => ({ ok: true, json: async () => mixed }),
        buildVolumeSettingsPreset: () => ({ domControls: { 'volume-detail': { value: applied } } }),
        volumeSettingsPresetStatus: (text, warning) => { status = { text, warning }; } });
      vm.runInContext(pageFns, context);
      for (const step of order) await vm.runInContext(step === 'index' ? 'refreshVolumeSettingsPresetList()' : 'recordVolumeSettingsPresetApplied()', context);
      const label = `${order.join(' then ')}, ${applied === 0.44 ? 'exact' : 'clamped'} load`;
      assert.match(status.text, /^Live kiln \| requested live-kiln/, `${label}: loaded basin report`);
      assert.match(status.text, /\|\| 1 presets \| 1 unavailable on this version/, `${label}: index summary kept`);
      assert.equal(/changed when loaded here: volume-detail 0\.44 -> 0\.4/.test(status.text), applied === 0.4, `${label}: readback`);
      assert.equal(status.warning, true, `${label}: the unavailable basin keeps the warning`);
    }
  }
}

const emptyView = await render({ ...mixed, entries: [] });
assert.equal(emptyView.select.value, '');
assert.match(emptyView.select.options[0].text, /no compatible/i);
assert.equal(emptyView.select.options[1].disabled, true);

const legacyIndex = { ...mixed };
delete legacyIndex.unavailableEntries;
assert.equal((await render(legacyIndex)).select.options.length, 1, 'old index producers remain supported');
assert.equal(validateVolumeSettingsPresetIndex({ ...mixed, futureMetadata: true }), true);
for (const broken of [null, {}, [null], [{ ...unavailable, error: '' }], [{ ...unavailable, presetId: 'invented' }]]) {
  assert.throws(() => validateVolumeSettingsPresetIndex({ ...mixed, unavailableEntries: broken }), /unavailable/i);
}
console.log('volume settings index UI contracts passed');
