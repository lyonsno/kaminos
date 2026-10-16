// kaminos-test: node
// Opening or changing an owner experiment on a saved-basin page must not put
// experiment state into the strict settings-preset query. Otherwise the next
// load of that address fails "target settings route contains unexpected
// parameters: experiment,experiment_inputs" and experiments are unavailable.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerExperimentAddress,writeOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
import {validateVolumeSettingsPresetTarget} from '../volume-settings-preset-contract.mjs';

const preset = 'vsp-' + 'a'.repeat(64);
const authority = 'shared-volume-settings-preset-v2';
const receipt = {presetId: preset, sourcePresetAuthority: authority, routeEntries: [['volume_light_field', '1']]};
const basinPage = `http://localhost/index.html?settings_preset=${preset}&settings_preset_authority=${authority}&volume_light_field=1#workspace=workbench&authoring=1&scene=tuned.kaminos.json`;
const inputs = {size: 2, label: 'water & flame / Δ'};

test('the saved-basin address still validates after an owner experiment opens', () => {
  const opened = new URL(writeOwnerExperimentAddress(basinPage, {id: 'fixture/owner', inputs}));
  assert.doesNotThrow(() => validateVolumeSettingsPresetTarget(receipt, opened.searchParams));
  assert.deepEqual([...opened.searchParams.keys()], [...new URL(basinPage).searchParams.keys()]);
  assert.deepEqual(readOwnerExperimentAddress(opened), {id: 'fixture/owner', inputsText: JSON.stringify(inputs)});
  assert.equal(new URLSearchParams(opened.hash.slice(1)).get('scene'), 'tuned.kaminos.json');
});

test('changing and then closing the experiment keeps the basin address strict', () => {
  const first = writeOwnerExperimentAddress(basinPage, {id: 'fixture/owner', inputs});
  const changed = new URL(writeOwnerExperimentAddress(first, {id: 'fixture/other', inputs: {size: 3}}));
  assert.doesNotThrow(() => validateVolumeSettingsPresetTarget(receipt, changed.searchParams));
  assert.deepEqual(readOwnerExperimentAddress(changed), {id: 'fixture/other', inputsText: '{"size":3}'});
  const closed = new URL(writeOwnerExperimentAddress(changed.href, {id: null, inputs: null}));
  for (const params of [closed.searchParams, new URLSearchParams(closed.hash.slice(1))]) {
    assert.equal(params.has('experiment'), false);
    assert.equal(params.has('experiment_inputs'), false);
  }
  assert.doesNotThrow(() => validateVolumeSettingsPresetTarget(receipt, closed.searchParams));
});

test('an address written by the old code, with experiment keys in the basin query, still admits', () => {
  const legacy = new URL(basinPage);
  legacy.searchParams.set('experiment', 'fixture/owner');
  legacy.searchParams.set('experiment_inputs', JSON.stringify(inputs));
  assert.doesNotThrow(() => validateVolumeSettingsPresetTarget(receipt, legacy.searchParams));
  assert.deepEqual(readOwnerExperimentAddress(legacy), {id: 'fixture/owner', inputsText: JSON.stringify(inputs)});
});

test('an ordinary page keeps its shareable experiment query', () => {
  const ordinary = new URL(writeOwnerExperimentAddress('http://localhost/index.html?workspace=workbench', {id: 'fixture/owner', inputs}));
  assert.equal(ordinary.searchParams.get('experiment'), 'fixture/owner');
  assert.equal(ordinary.searchParams.get('experiment_inputs'), JSON.stringify(inputs));
});
