import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(core, /MacroAssemblageCountLaw/, 'composition core must name the macro assemblage count law');
assert.match(core, /macroAssemblageCountLaw/, 'composition debug state must expose the macro assemblage count law');
assert.match(index, /macro thrusts \$\{state\?\.macroAssemblageCount/, 'HUD must expose effective macro thrust count');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const baseline = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 10,
});
const sweepConfigs = [
  { variationSeed: 1, variationLeafCount: 10 },
  { variationSeed: 2, variationLeafCount: 10 },
  { variationSeed: 6, variationLeafCount: 11 },
  { variationSeed: 8, variationLeafCount: 12 },
  { variationSeed: 10, variationLeafCount: 14 },
  { variationSeed: 14, variationLeafCount: 14 },
].map(config => ({ variantId: 'wide-cup', ...config }));
const sweepFixtures = sweepConfigs.map(config => createTargetOrbShellCompositionFixture(config));
const sweepCounts = sweepFixtures.map(fixture => fixture.macroAssemblages.length);
const distinctSweepCounts = new Set(sweepCounts);

assert.equal(baseline.macroAssemblageCountLaw?.schema, 'MacroAssemblageCountLaw', 'baseline exposes macro count law');
assert.equal(baseline.macroAssemblages.length, 4, 'accepted wide-cup:7 baseline remains the four-macro comparison anchor');
assert.deepEqual(
  baseline.macroAssemblages.map(item => item.id),
  [
    'north-west-dominant-thrust',
    'north-east-counter-thrust',
    'equatorial-cupping-whorl',
    'polar-crown-lock',
  ],
  'accepted wide-cup:7 baseline preserves the previously-smoked four-family composition',
);
assert.ok(
  distinctSweepCounts.size >= 3,
  `seed/density sweep must produce at least three macro thrust counts, got ${sweepCounts.join(',')}`,
);
assert.ok(Math.min(...sweepCounts) >= 3, `macro count sweep must stay above the anchor-plus-support minimum, got ${sweepCounts.join(',')}`);
assert.ok(Math.max(...sweepCounts) <= 5, `macro count sweep must stay within the target 3-5 range, got ${sweepCounts.join(',')}`);
assert.ok(Math.max(...sweepCounts) > baseline.macroAssemblages.length, 'sweep must sometimes add a fifth macro thrust');
assert.ok(Math.min(...sweepCounts) < baseline.macroAssemblages.length, 'sweep must sometimes retire an optional macro thrust');

for (const fixture of sweepFixtures) {
  const ids = fixture.macroAssemblages.map(item => item.id);
  assert.ok(ids.includes('north-west-dominant-thrust'), 'macro count law must preserve north-west aperture anchor');
  assert.ok(ids.includes('north-east-counter-thrust'), 'macro count law must preserve north-east counter anchor');
  assert.deepEqual(fixture.macroAssemblageCountLaw.selectedMacroAssemblageIds, ids, 'count law selected ids match rendered macro assemblages');
  assert.ok(fixture.macroAssemblageCountLaw.optionalMacroCandidateIds.length >= 3, 'count law exposes optional macro candidates');
  assert.equal(fixture.macroAssemblageCountLaw.anchorMacroAssemblageIds.length, 2, 'count law keeps exactly two required anchor families');
  assert.equal(fixture.macroBodyPromotion.promotedBodies.length, fixture.macroAssemblages.length, 'promotion follows selected macro count');
  assert.equal(fixture.liveMacroSideWallPlan.sideWallCount, fixture.macroAssemblages.length * 2, 'sidewalls follow selected macro count');
}
