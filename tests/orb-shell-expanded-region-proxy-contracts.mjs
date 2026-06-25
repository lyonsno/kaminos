import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ExpandedMacroRegionProxy/, 'composition module names ExpandedMacroRegionProxy descriptors');
assert.match(core, /macro-region-proxy-coverage-v0/, 'composition module names macro region proxy coverage mode');
assert.match(core, /MacroRegionSeamGapDescriptor/, 'composition module names seam/gap descriptors');
assert.match(core, /future-mesh-boundary-input/, 'composition marks seams as future mesh boundary inputs');
assert.match(core, /proxy-not-final-plate/, 'composition marks expanded regions as proxies');
assert.match(core, /intentional-slit/, 'composition records intentional slit seam/gap type');
assert.match(core, /overlap-receiver/, 'composition records overlap receiver seam/gap type');
assert.match(core, /lower-socket-join/, 'composition preserves lower socket seam/gap type');
assert.match(core, /crown-receiver/, 'composition records crown receiver seam/gap type');
assert.match(core, /side-rim-reveal/, 'composition records side rim reveal seam/gap type');
assert.match(core, /expandedRegionCount/, 'debug state records expanded region count');
assert.match(core, /seamGapCount/, 'debug state records seam/gap count');
assert.match(witness, /ExpandedMacroRegionProxy/, 'composition witness records expanded region proxies');
assert.match(witness, /MacroRegionSeamGapDescriptor/, 'composition witness records seam/gap descriptors');
assert.match(witness, /expandedRegionCount/, 'composition witness reports expanded region count');
assert.match(witness, /seamGapCount/, 'composition witness reports seam/gap count');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.expandedMacroRegionProxyPlan;

assert.equal(plan?.schema, 'ExpandedMacroRegionProxyPlan', 'fixture exposes expanded region proxy plan');
assert.equal(plan.mode, 'macro-region-proxy-coverage-v0', 'fixture records expanded proxy mode');
assert.equal(plan.proxyStatus, 'proxy-not-final-plate', 'plan states expanded regions are proxies');
assert.equal(plan.expandedRegions.length, fixture.macroAssemblages.length, 'one expanded proxy per macro assemblage');
assert.ok(plan.expandedRegions.every(region => region.schema === 'ExpandedMacroRegionProxy'), 'all expanded regions use proxy schema');
assert.ok(plan.expandedRegions.every(region => region.coverageScale > 1), 'expanded regions increase coverage');
assert.ok(plan.expandedRegions.every(region => region.futureMeshRole === 'future-mesh-boundary-input'), 'expanded regions are future mesh inputs');
assert.ok(plan.seamGaps.length >= 5, 'fixture records seam/gap descriptors');
assert.ok(plan.seamGaps.every(gap => gap.schema === 'MacroRegionSeamGapDescriptor'), 'all seam gaps use seam/gap schema');
assert.ok(plan.seamGaps.some(gap => gap.type === 'intentional-slit'), 'fixture records intentional slit gap');
assert.ok(plan.seamGaps.some(gap => gap.type === 'overlap-receiver'), 'fixture records overlap receiver gap');
assert.ok(plan.seamGaps.some(gap => gap.type === 'lower-socket-join'), 'fixture records lower socket join gap');
assert.ok(plan.seamGaps.some(gap => gap.type === 'crown-receiver'), 'fixture records crown receiver gap');
assert.ok(plan.seamGaps.some(gap => gap.type === 'side-rim-reveal'), 'fixture records side rim reveal gap');
assert.equal(
  fixture.frontApertureOwnership.lowerCupClosure.bottomGapPolicy,
  'forbid-accidental-triangle-bottom-gap',
  'expanded region proxy preserves lower cup closure policy',
);
assert.ok(
  fixture.macroAssemblages.every(assemblage => assemblage.expandedRegionProxy?.schema === 'ExpandedMacroRegionProxy'),
  'each macro assemblage points at its expanded region proxy',
);
