import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /PrimaryApertureFrame/, 'composition module names PrimaryApertureFrame');
assert.match(core, /frontApertureOwnership/, 'OrbShellComposition records front aperture ownership');
assert.match(core, /primary-front-aperture-frame/, 'fixture records the primary front aperture frame');
assert.match(core, /lower-cupping-owner/, 'front aperture has lower cupping ownership');
assert.match(core, /crossing-tuck-owner/, 'front aperture has crossing/tuck ownership');
assert.match(core, /side-rim-owner/, 'front aperture has side rim ownership');
assert.match(core, /front-cupping-thrust/, 'fixture records a front cupping thrust relation');
assert.match(core, /front-crossing-tuck/, 'fixture records a front crossing tuck relation');
assert.match(core, /aperture-repulsor-field/, 'front ownership preserves aperture repulsor generation hypothesis');
assert.match(core, /dominance-crossing-field/, 'front ownership preserves dominance crossing hypothesis');
assert.match(core, /frontApertureOwnershipCount/, 'debug state records aperture ownership count');
assert.match(core, /frontCompositionBias/, 'fixture names front composition bias');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');
const fixture = createTargetOrbShellCompositionFixture();
const frame = fixture.frontApertureOwnership;

assert.equal(frame?.schema, 'PrimaryApertureFrame', 'fixture exposes a PrimaryApertureFrame');
assert.equal(frame.id, 'primary-front-aperture-frame', 'fixture names the primary front aperture frame');
assert.ok(frame.owners.some(owner => owner.role === 'lower-cupping-owner'), 'primary aperture has lower cupping owner');
assert.ok(frame.owners.some(owner => owner.role === 'crossing-tuck-owner'), 'primary aperture has crossing tuck owner');
assert.ok(frame.owners.filter(owner => owner.role === 'side-rim-owner').length >= 2, 'primary aperture has side rim owners');
assert.ok(frame.proceduralFamilies.includes('aperture-repulsor-field'), 'front frame includes aperture repulsor hypothesis');
assert.ok(frame.proceduralFamilies.includes('dominance-crossing-field'), 'front frame includes dominance crossing hypothesis');
assert.ok(frame.frontCompositionBias.includes('break-open-horseshoe-symmetry'), 'frame records horseshoe-breaking bias');

const lowerOwner = frame.owners.find(owner => owner.role === 'lower-cupping-owner');
const crossingOwner = frame.owners.find(owner => owner.role === 'crossing-tuck-owner');
assert.ok(lowerOwner?.memberIds?.length, 'lower cupping owner names member ids');
assert.ok(crossingOwner?.memberIds?.length, 'crossing tuck owner names member ids');

assert.match(witness, /PrimaryApertureFrame/, 'composition witness records PrimaryApertureFrame');
assert.match(witness, /frontApertureOwnershipCount/, 'composition witness reports aperture ownership count');
assert.match(witness, /frontApertureOwnership/, 'composition witness reports front aperture ownership');
