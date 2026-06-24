import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroTerritoryBody/, 'composition module names MacroTerritoryBody descriptors');
assert.match(core, /territoryBodyOccupancy/, 'composition records territory body occupancy');
assert.match(core, /makeMacroTerritoryBodyGeometry/, 'composition renders area-bearing territory body geometry');
assert.match(core, /sphericalClosureAnchors/, 'composition records spherical closure anchors');
assert.match(core, /crown-closure-anchor/, 'composition records a crown closure anchor');
assert.match(core, /lower-socket-anchor/, 'composition records a lower socket closure anchor');
assert.match(core, /side-rim-pressure-anchor/, 'composition records side rim pressure anchors');
assert.match(core, /offset-impulse-line-envelope/, 'body occupancy preserves inverse procedural envelope hypothesis');
assert.match(core, /pressure-field-boundary/, 'body occupancy preserves pressure-field boundary hypothesis');
assert.match(core, /spherical-section-panel/, 'body occupancy considers spherical section panel generation');
assert.match(core, /territoryBodyCount/, 'debug state records territory body count');
assert.match(core, /closureAnchorCount/, 'debug state records closure anchor count');
assert.match(core, /uShapedCageFailurePressure/, 'composition names the U-shaped cage failure pressure');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');
const fixture = createTargetOrbShellCompositionFixture();

assert.equal(fixture.schema, 'OrbShellComposition', 'fixture remains an OrbShellComposition');
assert.ok(Array.isArray(fixture.sphericalClosureAnchors), 'fixture records spherical closure anchors');
assert.ok(fixture.sphericalClosureAnchors.length >= 4, 'fixture records crown/lower/side closure anchors');
assert.ok(fixture.sphericalClosureAnchors.some(anchor => anchor.id === 'crown-closure-anchor'), 'fixture has crown closure anchor');
assert.ok(fixture.sphericalClosureAnchors.some(anchor => anchor.id === 'lower-socket-anchor'), 'fixture has lower socket anchor');
assert.ok(fixture.sphericalClosureAnchors.filter(anchor => anchor.role === 'side-rim-pressure-anchor').length >= 2, 'fixture has side rim pressure anchors');

for (const assemblage of fixture.macroAssemblages) {
  assert.equal(assemblage.territoryBodyOccupancy?.schema, 'MacroTerritoryBody', `${assemblage.id} has MacroTerritoryBody occupancy`);
  assert.ok(assemblage.territoryBodyOccupancy.widthProfile.mid > assemblage.childBandPlan[0].widthProfile.mid, `${assemblage.id} territory body is wider than its main band`);
  assert.ok(assemblage.territoryBodyOccupancy.proceduralFamily.includes('offset-impulse-line-envelope'), `${assemblage.id} preserves envelope generation hypothesis`);
  assert.ok(assemblage.territoryBodyOccupancy.boundaryHypotheses.includes('pressure-field-boundary'), `${assemblage.id} preserves pressure boundary hypothesis`);
  assert.ok(assemblage.territoryBodyOccupancy.closureAnchorIds.length >= 2, `${assemblage.id} links to closure anchors`);
}

assert.match(witness, /territoryBodyCount/, 'composition witness records territory body count');
assert.match(witness, /closureAnchorCount/, 'composition witness records closure anchor count');
assert.match(witness, /MacroTerritoryBody/, 'composition witness records MacroTerritoryBody descriptors');
assert.match(witness, /sphericalClosureAnchors/, 'composition witness records closure anchors');
