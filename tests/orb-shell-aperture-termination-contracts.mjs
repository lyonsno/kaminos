import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ApertureRelativeTerminationPlan/, 'composition names aperture-relative termination descriptors');
assert.match(core, /ApertureTerminationField/, 'composition names the aperture termination vector field');
assert.match(core, /orbit-capture/, 'composition names orbit-capture termination class');
assert.match(core, /counter-curve-blade/, 'composition names counter-curve blade termination class');
assert.match(witness, /apertureRelativeTerminationPlan/, 'witness reports aperture-relative termination plan');
assert.match(witness, /apertureTerminationClassCounts/, 'witness reports aperture termination class counts');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.macroFamilySubstripPlan?.apertureRelativeTerminationPlan;

assert.equal(plan?.schema, 'ApertureRelativeTerminationPlan', 'substrip plan exposes aperture-relative termination law');
assert.equal(plan.mode, 'aperture-relative-lamellar-termination-v0', 'termination plan records first aperture-relative mode');
assert.equal(plan.apertureField?.schema, 'ApertureTerminationField', 'termination plan owns an aperture termination field');
assert.deepEqual(plan.parentAssemblageIds, fixture.macroFamilySubstripPlan.parentAssemblageIds, 'termination plan covers the same decomposed parents');
assert.equal(plan.parentTerminationPlans.length, 2, 'slice stays bounded to two decomposed families');

const byParent = new Map(plan.parentTerminationPlans.map(item => [item.parentAssemblage, item]));
assert.equal(byParent.get('north-west-dominant-thrust')?.terminationClass, 'orbit-capture', 'north-west family exercises orbit capture');
assert.equal(byParent.get('north-east-counter-thrust')?.terminationClass, 'counter-curve-blade', 'north-east family exercises counter-curve blade');
assert.ok(plan.apertureTerminationClassCounts['orbit-capture'] >= 1, 'class accounting includes orbit capture');
assert.ok(plan.apertureTerminationClassCounts['counter-curve-blade'] >= 1, 'class accounting includes counter-curve blade');

for (const parentPlan of plan.parentTerminationPlans) {
  assert.equal(parentPlan.schema, 'LamellarFamilyTerminationDescriptor', `${parentPlan.parentAssemblage} uses termination descriptor schema`);
  assert.ok(parentPlan.mouthAnchor, `${parentPlan.parentAssemblage} has a mouth anchor`);
  assert.ok(parentPlan.captureAnchor || parentPlan.tipAnchor, `${parentPlan.parentAssemblage} has a class-specific terminal anchor`);
  assert.ok(parentPlan.spreadMetrics.mouthSpread > parentPlan.spreadMetrics.midBodySpread, `${parentPlan.parentAssemblage} mouth spread exceeds mid-body spread`);
  assert.ok(parentPlan.spreadMetrics.minimumSiblingGap > 0.025, `${parentPlan.parentAssemblage} preserves minimum sibling spacing`);
  assert.equal(parentPlan.visibleParentRetirementPreserved, true, `${parentPlan.parentAssemblage} keeps parent slabs retired`);

  const reaches = parentPlan.siblingTerminations.map(item => item.normalizedTerminalReach);
  assert.equal(new Set(reaches.map(value => value.toFixed(3))).size, reaches.length, `${parentPlan.parentAssemblage} siblings do not share identical terminal reach`);
  assert.ok(parentPlan.siblingTerminations.every(item => item.siblingRole), `${parentPlan.parentAssemblage} assigns sibling roles`);

  if (parentPlan.terminationClass === 'orbit-capture') {
    assert.ok(parentPlan.apertureTangentBlend >= 0.62, 'orbit capture blends strongly toward aperture tangent');
    assert.ok(parentPlan.captureRadiusBand?.length === 2, 'orbit capture records an aperture orbit radius band');
    assert.ok(parentPlan.siblingTerminations.some(item => item.terminalVisibility === 'tucked-or-covered'), 'orbit capture has at least one tucked/covered sibling');
  }

  if (parentPlan.terminationClass === 'counter-curve-blade') {
    assert.ok(parentPlan.counterCurveAngle >= 0.22, 'counter-curve blade records a counter angle');
    assert.equal(parentPlan.siblingTerminations.filter(item => item.ownsFurthestVisibleTip).length, 1, 'counter-curve blade has exactly one lead tip owner');
    const leadReach = Math.max(...reaches);
    assert.ok(parentPlan.siblingTerminations.some(item => !item.ownsFurthestVisibleTip && item.normalizedTerminalReach < leadReach), 'counter-curve blade has secondary early deaths');
  }
}

for (const substrip of fixture.macroFamilySubstripPlan.substrips) {
  assert.equal(substrip.apertureTermination?.schema, 'MacroFamilySubstripApertureTermination', `${substrip.id} carries aperture termination metadata`);
  assert.ok(substrip.apertureTermination.siblingRole, `${substrip.id} has sibling role`);
  assert.ok(substrip.apertureTermination.normalizedStartReach >= 0, `${substrip.id} records start reach`);
  assert.ok(substrip.apertureTermination.normalizedTerminalReach > substrip.apertureTermination.normalizedStartReach, `${substrip.id} terminal reach follows start reach`);
  assert.notEqual(substrip.terminalCaps[1].terminalPlane, 'centerline-perpendicular-flat-noodle-cap', `${substrip.id} end cap is not a flat noodle cap`);
}
