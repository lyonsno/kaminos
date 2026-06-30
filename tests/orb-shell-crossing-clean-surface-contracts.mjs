import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /CrossingSubSurgePlan/, 'composition module names CrossingSubSurgePlan descriptors');
assert.match(core, /CrossingSubSurge/, 'composition module names CrossingSubSurge descriptors');
assert.match(core, /crossing-sub-surge-decomposition-v0/, 'composition module names crossing sub-surge mode');
assert.match(core, /CleanProxySurfacePolicy/, 'composition module names CleanProxySurfacePolicy descriptors');
assert.match(core, /clean-proxy-surface-diagnostic-v0/, 'composition module names clean proxy surface mode');
assert.match(core, /topologyOnlySurfaceRelief/, 'composition records topology-only surface relief');
assert.match(core, /level-change-dip/, 'composition records level-change dip events');
assert.match(core, /decorativeMicroVariation/, 'composition explicitly forbids decorative micro variation');
assert.doesNotMatch(core, /const ridgeChannel\b/, 'promoted proxy geometry must not use decorative ridge-channel modulation');
assert.doesNotMatch(core, /const centerRelief\b/, 'promoted proxy geometry must not use decorative center-relief modulation');
assert.match(witness, /CrossingSubSurgePlan/, 'composition witness records crossing sub-surge plan');
assert.match(witness, /CleanProxySurfacePolicy/, 'composition witness records clean proxy surface policy');
assert.match(witness, /crossingSubSurgeCount/, 'composition witness reports crossing sub-surge count');
assert.match(witness, /topologyOnlySurfaceRelief/, 'composition witness reports topology-only relief');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.crossingSubSurgePlan;

assert.equal(plan?.schema, 'CrossingSubSurgePlan', 'fixture exposes crossing sub-surge plan');
assert.equal(plan.mode, 'crossing-sub-surge-decomposition-v0', 'fixture records crossing sub-surge mode');
assert.equal(plan.ownerAssemblageId, 'north-east-counter-thrust', 'crossing plan belongs to the north-east macro body');
assert.ok(plan.subSurges.length >= 3, 'crossing plan decomposes into body and subordinate anatomy');
assert.ok(plan.subSurges.every(surge => surge.schema === 'CrossingSubSurge'), 'all crossing sub-surges use CrossingSubSurge schema');
assert.ok(plan.subSurges.some(surge => surge.role === 'dominant-crossing-body'), 'crossing plan includes a dominant body surge');
assert.ok(plan.subSurges.some(surge => surge.role === 'subordinate-edge-rail'), 'crossing plan includes subordinate edge rails');
assert.ok(plan.subSurges.some(surge => surge.seamReceivers.includes('crossing-tuck-overlap-receiver')), 'crossing plan records overlap receiver seam');
assert.ok(
  plan.subSurges.some(surge => surge.levelEvents.some(event => event.type === 'level-change-dip')),
  'crossing plan records a level-change dip',
);
assert.equal(
  fixture.frontApertureOwnership.crossingSubSurgePlan.schema,
  'CrossingSubSurgePlan',
  'front frame exposes crossing sub-surge plan',
);

const cleanPolicy = fixture.cleanProxySurfacePolicy;
assert.equal(cleanPolicy?.schema, 'CleanProxySurfacePolicy', 'fixture exposes clean proxy surface policy');
assert.equal(cleanPolicy.mode, 'clean-proxy-surface-diagnostic-v0', 'fixture records clean proxy surface mode');
assert.equal(cleanPolicy.decorativeMicroVariation, 'forbidden', 'clean policy forbids decorative micro variation');
assert.ok(cleanPolicy.allowedReliefEvents.includes('level-change-dip'), 'clean policy allows level-change dips');
assert.ok(cleanPolicy.allowedReliefEvents.includes('under-neighbor'), 'clean policy allows under-neighbor relief');
assert.ok(cleanPolicy.forbiddenSurfaceNoise.includes('ridgeChannel'), 'clean policy forbids ridge-channel noise');
assert.ok(cleanPolicy.forbiddenSurfaceNoise.includes('centerRelief'), 'clean policy forbids center-relief noise');
assert.ok(
  fixture.expandedMacroRegionProxyPlan.expandedRegions.every(region => (
    region.cleanSurfacePolicy?.mode === 'clean-proxy-surface-diagnostic-v0'
      && region.topologyOnlySurfaceRelief === true
      && region.surfaceDetailMode === 'diagnostic-smooth-sheet'
  )),
  'each expanded proxy inherits clean diagnostic surface policy',
);
assert.equal(
  fixture.frontApertureOwnership.crossingTuckIntegration.mode,
  'crossing-tuck-macro-body',
  'clean crossing decomposition preserves crossing tuck macro-body integration',
);
