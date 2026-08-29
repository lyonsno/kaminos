import assert from 'node:assert/strict';

import {
  loadWakeFirePreset,
  wakeFirePresetControlEntries,
} from '../wake-volume-settings-preset-mount.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const baseUrl = new URL(args.get('--base-url') || 'http://127.0.0.1:8090/');
const stableHandle = args.get('--preset') || 'flamebowl-blockout-130r';
const fetchImpl = (input, init) => fetch(new URL(input, baseUrl), init);

const aliasReceipt = await loadWakeFirePreset(stableHandle, { fetchImpl });
const exactReceipt = await loadWakeFirePreset(aliasReceipt.presetId, { fetchImpl });
assert.equal(aliasReceipt.presetId, exactReceipt.presetId);
assert.equal(aliasReceipt.contentHash, exactReceipt.contentHash);
assert.equal(aliasReceipt.alias, stableHandle);
assert.equal(aliasReceipt.sourcePresetAuthority, 'shared-volume-settings-preset-v2');

const entries = wakeFirePresetControlEntries(aliasReceipt);
assert.equal(entries.filter(entry => entry.role === 'basin').length, 186);
assert.equal(entries.filter(entry => entry.role === 'renderer').length, 3);
assert.deepEqual(
  entries.filter(entry => entry.role === 'renderer').map(entry => entry.id).sort(),
  ['volume-flow-kernel-coherence', 'volume-flow-kernel-radius', 'volume-flow-kernel-strength'],
);

console.log(JSON.stringify({
  identity: 'kaminos.wake-fire-preset-loader-contract.v1',
  status: 'passed',
  stableHandle,
  presetId: aliasReceipt.presetId,
  contentHash: aliasReceipt.contentHash,
  sourceControlCount: entries.length,
}));
