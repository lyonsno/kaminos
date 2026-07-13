import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-boundary-splat-pbr-witness.mjs', import.meta.url), 'utf8');
const core = await import('../volume-core.js');

assert.equal(typeof core.normalizeBoundarySplatLodMode, 'function', 'runtime must export the fixed/adaptive LOD mode contract');
assert.equal(typeof core.boundarySplatProjectedTierBudget, 'function', 'runtime must export deterministic projected-size tier selection');
assert.equal(typeof core.boundarySplatApplyBudgetCeiling, 'function', 'runtime must expose explicit adaptive ceiling behavior');
assert.equal(typeof core.boundarySplatGroupDescriptorsByTier, 'function', 'runtime must expose deterministic tier grouping');
assert.equal(typeof core.boundarySplatNestedSourceIndex, 'function', 'runtime must expose the nested candidate-order reference');

assert.equal(core.normalizeBoundarySplatLodMode(), 'fixed', 'adaptive allocation must not become a hidden default');
assert.equal(core.normalizeBoundarySplatLodMode('fixed'), 'fixed', 'fixed mode must remain explicit');
assert.equal(core.normalizeBoundarySplatLodMode('projected_area'), 'projected-area', 'URL spelling must normalize to projected-area');
assert.equal(core.normalizeBoundarySplatLodMode('garbage'), 'fixed', 'unknown LOD modes must fail closed to fixed');

const projectedCases = [
  [32, 800],
  [100, 1600],
  [220, 3200],
  [340, 6400],
  [520, 12800],
  [760, 0],
];
for (const [diameterPx, expectedBudget] of projectedCases) {
  assert.equal(core.boundarySplatProjectedTierBudget(diameterPx), expectedBudget, `wrong projected tier for ${diameterPx}px`);
}
assert.equal(core.boundarySplatApplyBudgetCeiling(0, 0), 0, 'full-source tier with no ceiling must remain full source');
assert.equal(core.boundarySplatApplyBudgetCeiling(12800, 6400), 6400, 'explicit ceiling must cap a finite adaptive tier');
assert.equal(core.boundarySplatApplyBudgetCeiling(0, 6400), 6400, 'explicit ceiling must cap an adaptive full-source tier');
assert.equal(core.boundarySplatApplyBudgetCeiling(1600, 6400), 1600, 'ceiling must not inflate a small tier');

const grouped = core.boundarySplatGroupDescriptorsByTier([
  { index: 0, projectedDiameterPx: 340 },
  { index: 1, projectedDiameterPx: 32 },
  { index: 2, projectedDiameterPx: 760 },
  { index: 3, projectedDiameterPx: 100 },
  { index: 4, projectedDiameterPx: 220 },
], { mode: 'projected-area', candidateCeiling: 0 });
assert.deepEqual(grouped.groups.map(group => [group.requestedBudget, group.descriptorCount]), [
  [800, 1],
  [1600, 1],
  [3200, 1],
  [6400, 1],
  [0, 1],
], 'adaptive descriptors must be grouped into ascending finite tiers followed by full source');
assert.deepEqual(grouped.descriptors.map(descriptor => descriptor.index), [1, 3, 4, 0, 2], 'tier grouping must be deterministic without losing spatial identity');
assert.deepEqual(grouped.descriptors.map(descriptor => descriptor.renderDescriptorIndex), [0, 1, 2, 3, 4], 'render descriptor indexes must match packed GPU order');

const fixed = core.boundarySplatGroupDescriptorsByTier([
  { index: 0, projectedDiameterPx: 32 },
  { index: 1, projectedDiameterPx: 760 },
], { mode: 'fixed', candidateCeiling: 6400 });
assert.deepEqual(fixed.groups.map(group => [group.requestedBudget, group.descriptorCount]), [[6400, 2]], 'fixed mode must preserve the existing one-budget behavior');
const capped = core.boundarySplatGroupDescriptorsByTier([
  { index: 0, projectedDiameterPx: 760 },
], { mode: 'projected-area', candidateCeiling: 3200 });
assert.equal(capped.descriptors[0].requestedCandidateBudget, 3200, 'adaptive mode must surface the effective explicit ceiling per descriptor');

const sourceCount = 10003;
const order = Array.from({ length: 6400 }, (_, rank) => core.boundarySplatNestedSourceIndex(rank, sourceCount));
assert.equal(new Set(order).size, order.length, 'nested candidate order must not duplicate source candidates');
assert.ok(order.every(index => index >= 0 && index < sourceCount), 'nested candidate order must stay inside the live source');
assert.deepEqual(order.slice(0, 800), order.slice(0, 1600).slice(0, 800), '800 tier must be an exact prefix of 1600');
assert.deepEqual(order.slice(0, 1600), order.slice(0, 3200).slice(0, 1600), '1600 tier must be an exact prefix of 3200');
assert.deepEqual(order.slice(0, 3200), order.slice(0, 6400).slice(0, 3200), '3200 tier must be an exact prefix of 6400');

assert.match(coreSource, /BOUNDARY_SPLAT_ADAPTIVE_LOD_IDENTITY\s*=\s*'boundary-splat-projected-area-nested-tiers-v0'/, 'runtime must publish the adaptive allocator identity');
assert.match(coreSource, /BOUNDARY_SPLAT_SELECTOR_POLICY_IDENTITY\s*=\s*'boundary-splat-nested-permutation-prefix-v0'/, 'selector telemetry must name the budget-independent nested source order');
assert.match(coreSource, /struct BoundarySplatDrawGroup[\s\S]*descriptorStart:\s*u32[\s\S]*descriptorCount:\s*u32[\s\S]*requestedCandidateBudget:\s*u32[\s\S]*effectiveCandidateBudget:\s*u32/, 'GPU draw groups must preserve descriptor and budget authority');
assert.match(coreSource, /fn boundarySplatNestedSourceIndex\(rank:\s*u32,\s*sourceCount:\s*u32\)/, 'WGSL must use a budget-independent nested source order');
assert.match(coreSource, /archiveBoundarySplatHistory[\s\S]*boundarySplatNestedSourceIndex\(candidateIndex,\s*boundarySplatDraw\.sourceCandidateCount\)/, 'history archive must store one nested prefix for every tier');
assert.match(coreSource, /finalizeBoundarySplats[\s\S]*archiveCandidateCount[\s\S]*totalRenderedInstanceCount[\s\S]*boundarySplatDrawGroups/, 'GPU finalize must derive archive and global raster counts from effective tier groups');
assert.match(coreSource, /boundarySplatVs[\s\S]*groupIndex[\s\S]*descriptorStart[\s\S]*descriptorCount[\s\S]*sourceCandidateIndex/, 'vertex decode must map each indirect tier draw to its descriptor range and nested rank');
assert.match(coreSource, /for\s*\(let groupIndex = 0; groupIndex < BOUNDARY_SPLAT_DRAW_GROUP_COUNT; groupIndex \+= 1\)[\s\S]*drawIndirect\(boundarySplatIndirectBuffer,\s*groupIndex \* 16\)/, 'renderer must issue bounded indirect draws for actual tier groups');
assert.match(coreSource, /boundarySplatLodMode[\s\S]*boundarySplatAdaptiveLodIdentity[\s\S]*boundarySplatTierGroups[\s\S]*boundarySplatGlobalRenderedInstanceCount/, 'debug state must preserve requested/effective allocation and global count evidence');
assert.match(coreSource, /addedSimulationPasses:\s*0[\s\S]*addedHistoryArchivePasses:\s*1/, 'adaptive allocation must preserve one-simulator and one-history-archive authority');

assert.match(page, /id="volume-boundary-splat-lod-mode"[\s\S]*value="fixed"[\s\S]*value="projected-area"/, 'operator UI must expose fixed versus projected-area allocation');
assert.match(page, /volume_boundary_splat_lod_mode/, 'URL controls must carry the requested LOD mode');
assert.match(page, /boundarySplatCandidateBudget[\s\S]*max:\s*12800/, 'operator budget ceiling must expose the finite 12,800 tier without hiding full source');

assert.match(witness, /volume_boundary_splat_lod_mode/, 'PBR witness must record the requested LOD mode');
assert.match(witness, /boundarySplatAdaptiveLodIdentity[\s\S]*boundarySplatTierGroups[\s\S]*boundarySplatGlobalRenderedInstanceCount/, 'PBR witness must preserve adaptive allocation authority');
assert.match(witness, /stale-or-default-adaptive-lod|adaptive-lod-allocation-mismatch/, 'PBR witness must fail loud on stale or inconsistent adaptive allocation evidence');

console.log('boundary splat adaptive LOD contracts passed');
