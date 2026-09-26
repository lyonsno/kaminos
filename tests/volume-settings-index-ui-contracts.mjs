import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describeVolumeSettingsPresetProjection, validateVolumeSettingsPresetIndex } from '../volume-settings-preset-contract.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const refresh = source.match(/async function refreshVolumeSettingsPresetList\([^]*?\n\}/)?.[0];
assert.ok(refresh);
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
    volumeSettingsPresetStatus: (...args) => statuses.push(args),
  });
  await vm.runInContext(`${refresh}\nrefreshVolumeSettingsPresetList()`, context);
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
