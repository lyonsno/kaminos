import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createWakeFirePresetMountReceipt,
  loadWakeFirePreset,
  wakeFirePresetControlEntries,
} from '../wake-volume-settings-preset-mount.mjs';


const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const baseUrl = new URL(args.get('--base-url') || 'http://127.0.0.1:8090/');
const stableHandle = args.get('--preset') || 'flamebowl-blockout-130r';
const reportPath = resolve(args.get('--report') || 'artifacts/wake-fire-preset-roundtrip/report.json');
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

const effectiveControlValues = Object.fromEntries(entries.map(entry => [entry.id, entry.requestedValue]));
const productBudget = {
  requestedFireBudget: {
    identity: 'kaminos.kiln-contention-fire-budget.v0',
    resolution: 90,
    renderScale: 0.4,
    adaptiveRays: 1,
  },
  effectiveFireBudget: {
    identity: 'kaminos.kiln-contention-fire-budget.v0',
    resolution: 90,
    renderScale: 0.4,
    adaptiveRays: 1,
  },
};
const mountReceipt = createWakeFirePresetMountReceipt({
  requestedPresetRef: stableHandle,
  sourceReceipt: aliasReceipt,
  effectiveControlValues,
  productBudget,
  presentation: {
    requested: 'raymarch-only',
    effective: 'raymarch-only',
    boundarySplatMode: 'off',
  },
});
assert.equal(mountReceipt.effective.presetId, aliasReceipt.presetId);
assert.equal(mountReceipt.effective.mountedControlCount, 189);
assert.equal(mountReceipt.effective.presentation, 'raymarch-only');
assert.equal(mountReceipt.effective.boundarySplatMode, 'off');

const report = {
  identity: 'kaminos.wake-fire-preset-roundtrip-report.v1',
  status: 'passed',
  requested: {
    baseUrl: baseUrl.toString(),
    stableHandle,
  },
  effective: {
    presetId: aliasReceipt.presetId,
    contentHash: aliasReceipt.contentHash,
    packagePath: `${aliasReceipt.storePath}/presets/${aliasReceipt.presetId}.json`,
    schemaIdentity: aliasReceipt.schemaIdentity,
    sourceAuthority: aliasReceipt.sourcePresetAuthority,
  },
  mountReceipt,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
