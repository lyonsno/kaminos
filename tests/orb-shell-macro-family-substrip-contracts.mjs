import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroFamilySubstripPlan/, 'composition module names MacroFamilySubstripPlan descriptors');
assert.match(core, /MacroFamilySubstrip/, 'composition module names parent-owned MacroFamilySubstrip lanes');
assert.match(core, /parent-owned-lamellar-substrip-decomposition-v0/, 'composition module names the parent-owned substrip mode');
assert.match(core, /makeMacroFamilySubstripGeometry/, 'composition renders flat parent-owned substrip geometry');
assert.match(core, /makeMacroFamilySubstripSideWallGeometry/, 'composition renders exposed substrip sidewall geometry');
assert.match(core, /VisibleParentRetirementPolicy/, 'composition names visible parent retirement policy');
assert.match(core, /selectedParentPromotedBodyMeshCount/, 'composition reports selected parent promoted body render suppression');
assert.match(core, /makeMacroFamilySubstripTerminalCapGeometry/, 'composition renders substrip terminal cap geometry after parent caps retire');
assert.match(witness, /MacroFamilySubstripPlan/, 'composition witness records the macro-family substrip plan');
assert.match(witness, /macroFamilySubstripMeshCount/, 'composition witness reports rendered substrip mesh count');
assert.match(witness, /macroFamilySubstripSideWallMeshCount/, 'composition witness reports rendered substrip sidewall mesh count');
assert.match(witness, /macroFamilySubstripTerminalCapMeshCount/, 'composition witness reports rendered substrip terminal cap mesh count');
assert.match(witness, /selectedParentPromotedBodyMeshCount/, 'composition witness reports selected parent promoted body mesh suppression');
assert.match(witness, /macroFamilyObjecthoodVerdict/, 'composition witness reports whether parent macro objecthood is preserved');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const denseFixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 12, variationLeafCount: 14 });
const plan = fixture.macroFamilySubstripPlan;
const densePlan = denseFixture.macroFamilySubstripPlan;

assert.equal(plan?.schema, 'MacroFamilySubstripPlan', 'fixture exposes a macro family substrip plan');
assert.equal(plan.mode, 'parent-owned-lamellar-substrip-decomposition-v0', 'plan records the accepted parent-owned substrip mode');
assert.equal(plan.scope, 'limited-two-family-proof-slice', 'first slice stays limited instead of decomposing the whole shell');
assert.equal(plan.substripCountLaw?.schema, 'MacroFamilySubstripCountLaw', 'plan exposes the generative substrip count law');
assert.equal(plan.substripCountLaw?.mode, 'density-and-seed-driven-substrip-count-v0', 'plan records the density/seed count mode');
assert.equal(plan.substripCountLaw?.macroFamilyCountPreserved, true, 'substrip count law preserves macro family count');
assert.ok(plan.parentAssemblageIds.includes('north-west-dominant-thrust'), 'plan decomposes the dominant north-west family');
assert.ok(plan.parentAssemblageIds.includes('north-east-counter-thrust'), 'plan decomposes the counter-thrust family');
assert.ok(plan.parentAssemblageIds.length <= 2, 'first substrip slice stays bounded to two parent families');
assert.ok(plan.substripCount >= 5, 'two families expose at least five owned sub-lanes');
assert.equal(plan.renderPolicy.parentFillDemotion, 'muted-territory-support-not-final-slab', 'parent fills are demoted below child lane read');
assert.equal(plan.renderPolicy.roundDiagnosticRailsVisible, false, 'substrip grammar forbids round diagnostic rails as final-visible lanes');
assert.equal(plan.renderPolicy.textureGrooveSubstitutionAllowed, false, 'substrip grammar forbids texture grooves as lane proof');
assert.equal(plan.visibleParentRetirementPolicy?.schema, 'VisibleParentRetirementPolicy', 'plan exposes visible parent retirement policy');
assert.equal(plan.visibleParentRetirementPolicy?.mode, 'visible-parent-slab-retired-for-decomposed-families-v0', 'plan records retired visible parent slab mode');
assert.deepEqual(plan.visibleParentRetirementPolicy?.retiredParentAssemblageIds, plan.parentAssemblageIds, 'selected decomposed parents are retired from normal visible slab rendering');
assert.equal(plan.visibleParentRetirementPolicy?.normalRenderParentPromotedBodiesVisible, false, 'normal smoke hides selected parent promoted bodies');
assert.equal(plan.visibleParentRetirementPolicy?.normalRenderParentSideWallsVisible, false, 'normal smoke hides selected parent sidewalls');
assert.equal(plan.visibleParentRetirementPolicy?.normalRenderParentTerminalCapsVisible, false, 'normal smoke hides selected parent terminal caps');
assert.equal(plan.macroFamilyObjecthoodVerdict, 'parent-families-remain-nameable-after-subdivision', 'plan preserves macro family objecthood');
assert.equal(densePlan?.substripCountLaw?.schema, 'MacroFamilySubstripCountLaw', 'dense fixture exposes the count law');
assert.equal(
  densePlan.parentAssemblageIds.length,
  plan.parentAssemblageIds.length,
  'density-driven substrip count preserves decomposed macro parent count',
);
assert.notEqual(
  densePlan.substripCount,
  plan.substripCount,
  'changing seed/density must change literal visible substrip count',
);
assert.notDeepEqual(
  densePlan.substripCountLaw.perParentCounts,
  plan.substripCountLaw.perParentCounts,
  'changing seed/density must change per-parent substrip count allocation',
);
assert.ok(
  densePlan.substripCountLaw.perParentCounts.some(item => item.actualCount > item.minimumCount),
  'dense count law adds at least one sibling lane beyond minimum anatomy',
);
assert.equal(
  densePlan.apertureTangencyWitnessPlan.verdictCounts['counter-curve-request-not-yet-geometrically-proven'] || 0,
  0,
  'dense optional sibling lanes must still inherit measured counter-curve refusal instead of unproven endpoint drift',
);

const byParent = new Map();
for (const substrip of plan.substrips) {
  assert.equal(substrip.schema, 'MacroFamilySubstrip', `${substrip.id} uses MacroFamilySubstrip schema`);
  assert.equal(substrip.mode, plan.mode, `${substrip.id} records plan mode`);
  assert.ok(plan.parentAssemblageIds.includes(substrip.parentAssemblage), `${substrip.id} belongs to a selected parent family`);
  assert.equal(substrip.coordinateFrame.schema, 'MacroFamilyLocalFrame', `${substrip.id} records parent local coordinates`);
  assert.equal(substrip.geometryKind, 'flat-shell-conforming-lamellar-strip', `${substrip.id} is flat strip geometry`);
  assert.equal(substrip.crossSection, 'flat-ribbon-with-sidewalls-not-round-tube', `${substrip.id} is not a round tube`);
  assert.ok(substrip.normalizedVRange[0] >= -1 && substrip.normalizedVRange[1] <= 1, `${substrip.id} stays inside parent side bounds`);
  assert.ok(substrip.normalizedVRange[0] < substrip.normalizedVRange[1], `${substrip.id} has positive normalized width`);
  assert.ok(substrip.edgeSamples.length >= 36, `${substrip.id} carries enough samples for a smooth lane`);
  assert.ok(substrip.sideWallSamples.left.length === substrip.edgeSamples.length, `${substrip.id} has left sidewall samples`);
  assert.ok(substrip.sideWallSamples.right.length === substrip.edgeSamples.length, `${substrip.id} has right sidewall samples`);
  assert.equal(substrip.termination.start.inheritsParentTermination, true, `${substrip.id} start terminus inherits parent termination`);
  assert.equal(substrip.termination.end.inheritsParentTermination, true, `${substrip.id} end terminus inherits parent termination`);
  byParent.set(substrip.parentAssemblage, [...(byParent.get(substrip.parentAssemblage) || []), substrip]);
}

for (const parentId of plan.parentAssemblageIds) {
  const substrips = byParent.get(parentId) || [];
  assert.ok(substrips.length >= 2 && substrips.length <= 3, `${parentId} has two or three owned sub-lanes`);
  assert.ok(substrips.some(strip => strip.role === 'broad-main-lamella'), `${parentId} has a broad main lamella`);
  assert.ok(substrips.some(strip => strip.role === 'edge-lip-rail' || strip.role === 'inner-support-strip'), `${parentId} has subordinate strip anatomy`);
}

assert.ok(plan.gapContracts.length >= plan.parentAssemblageIds.length, 'plan records gap contracts between sibling substrips');
for (const gap of plan.gapContracts) {
  assert.equal(gap.schema, 'MacroFamilySubstripGapContract', `${gap.id} uses gap contract schema`);
  assert.ok(gap.normalizedGapWidth >= 0.04 && gap.normalizedGapWidth <= 0.18, `${gap.id} gap stays in the designed parent-space range`);
  assert.ok(gap.gapDistanceStats.relativeVariation <= 0.18, `${gap.id} keeps mostly constant spacing`);
  assert.equal(gap.constantGapVerdict, 'within-parent-space-budget', `${gap.id} records bounded sibling spacing`);
}

assert.equal(plan.meshAccounting.substripMeshCount, plan.substripCount, 'mesh accounting covers every substrip face');
assert.equal(plan.meshAccounting.sideWallMeshCount, plan.substripCount * 2, 'mesh accounting includes both exposed sidewalls per substrip');
assert.equal(plan.meshAccounting.terminalCapMeshCount, plan.substripCount * 2, 'mesh accounting includes both terminal caps per visible substrip');
assert.equal(plan.meshAccounting.selectedParentPromotedBodyMeshCount, 0, 'selected parent body slabs are not normal-rendered');
assert.equal(plan.meshAccounting.selectedParentSideWallMeshCount, 0, 'selected parent sidewall slabs are not normal-rendered');
assert.equal(plan.meshAccounting.selectedParentTerminalCapMeshCount, 0, 'selected parent terminal caps are not normal-rendered');
assert.ok(plan.substrips.every(strip => strip.terminalCaps?.length === 2), 'each visible substrip owns its own terminal caps after parent caps retire');
assert.equal(plan.failurePressure, 'do-not-regress-to-independent-strip-soup', 'plan records the strip-soup failure pressure');
