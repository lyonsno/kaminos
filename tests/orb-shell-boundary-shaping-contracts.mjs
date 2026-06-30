import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /BoundaryPressureField/, 'composition module names BoundaryPressureField descriptors');
assert.match(core, /boundaryPressureField/, 'MacroTerritoryBody records boundary pressure fields');
assert.match(core, /aperture-bite/, 'boundary pressure includes aperture bite');
assert.match(core, /sibling-band-channel/, 'boundary pressure includes sibling-band channels');
assert.match(core, /neighbor-tuck-clearance/, 'boundary pressure includes neighbor tuck clearance');
assert.match(core, /closure-taper/, 'boundary pressure includes closure taper');
assert.match(core, /silhouette-relief/, 'boundary pressure includes silhouette relief');
assert.match(core, /trimmed-spherical-section/, 'boundary shaping preserves trimmed spherical section hypothesis');
assert.match(core, /aperture-repulsor-boundary-field/, 'boundary shaping preserves aperture repulsor hypothesis');
assert.match(core, /boundaryCutProfile/, 'territory body records nonuniform boundary cut profiles');
assert.match(core, /shapedBoundaryCount/, 'debug state records shaped boundary count');
assert.match(core, /petalMaskFailurePressure/, 'composition names petal/panel mask failure pressure');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');
const fixture = createTargetOrbShellCompositionFixture();

for (const assemblage of fixture.macroAssemblages) {
  const body = assemblage.territoryBodyOccupancy;
  assert.equal(body?.schema, 'MacroTerritoryBody', `${assemblage.id} still has MacroTerritoryBody`);
  assert.equal(body.boundaryPressureField?.schema, 'BoundaryPressureField', `${assemblage.id} has BoundaryPressureField`);
  assert.ok(body.boundaryPressureField.pressures.some(item => item.type === 'aperture-bite'), `${assemblage.id} includes aperture bite`);
  assert.ok(body.boundaryPressureField.pressures.some(item => item.type === 'sibling-band-channel'), `${assemblage.id} includes sibling-band channel`);
  assert.ok(body.boundaryPressureField.pressures.some(item => item.type === 'closure-taper'), `${assemblage.id} includes closure taper`);
  assert.ok(body.boundaryPressureField.proceduralFamilies.includes('trimmed-spherical-section'), `${assemblage.id} includes trimmed spherical section family`);
  assert.ok(body.boundaryPressureField.proceduralFamilies.includes('aperture-repulsor-boundary-field'), `${assemblage.id} includes aperture repulsor boundary family`);
  assert.ok(Array.isArray(body.boundaryCutProfile) && body.boundaryCutProfile.length >= 4, `${assemblage.id} has a boundary cut profile`);
  const leftValues = body.boundaryCutProfile.map(point => point.leftScale);
  const rightValues = body.boundaryCutProfile.map(point => point.rightScale);
  assert.ok(new Set(leftValues.map(value => value.toFixed(2))).size > 1, `${assemblage.id} left boundary is nonuniform`);
  assert.ok(new Set(rightValues.map(value => value.toFixed(2))).size > 1, `${assemblage.id} right boundary is nonuniform`);
}

assert.match(witness, /BoundaryPressureField/, 'composition witness records BoundaryPressureField descriptors');
assert.match(witness, /shapedBoundaryCount/, 'composition witness records shaped boundary count');
assert.match(witness, /boundaryPressureFields/, 'composition witness reports boundary pressure fields');
