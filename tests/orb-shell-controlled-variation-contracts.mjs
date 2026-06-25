import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(core, /OrbShellVariationDescriptor/, 'composition module names OrbShellVariationDescriptor');
assert.match(core, /orb-shell-controlled-variation-assay-v0/, 'composition module names the controlled variation assay mode');
assert.match(core, /createControlledOrbShellVariationDescriptor/, 'composition module exposes a controlled variation descriptor factory');
assert.match(core, /applyControlledOrbShellVariation/, 'composition module applies bounded semantic variation');
assert.match(core, /effectiveVariation/, 'composition fixture records effective variation parameters');
assert.match(core, /preservedInvariants/, 'variation descriptor records preserved invariants');
assert.match(core, /not-free-randomization/, 'variation descriptor rejects free randomization');
assert.match(core, /frontApertureOwnership/, 'variation keeps front aperture ownership in the fixture');
assert.match(index, /orb_shell_variant/, 'index route accepts a controlled orb shell variant parameter');
assert.match(index, /orb_shell_variation_seed/, 'index route accepts a controlled orb shell variation seed parameter');
assert.match(index, /orb-shell-composition-variant/, 'index exposes effective variation identity in the visible readout');
assert.match(witness, /effectiveVariation/, 'composition witness reports effective variation parameters');
assert.match(witness, /variantId/, 'composition witness reports the variant id');

const {
  ORB_SHELL_CONTROLLED_VARIATION_MODE,
  createControlledOrbShellVariationDescriptor,
  createTargetOrbShellCompositionFixture,
} = await import('../orb-shell-composition-core.js');

assert.equal(
  ORB_SHELL_CONTROLLED_VARIATION_MODE,
  'orb-shell-controlled-variation-assay-v0',
  'controlled variation mode is stable',
);

const descriptor = createControlledOrbShellVariationDescriptor({ variantId: 'asymmetric-tuck', variationSeed: 11 });
assert.equal(descriptor.schema, 'OrbShellVariationDescriptor', 'descriptor has the variation schema');
assert.equal(descriptor.mode, ORB_SHELL_CONTROLLED_VARIATION_MODE, 'descriptor records assay mode');
assert.equal(descriptor.variantId, 'asymmetric-tuck', 'descriptor records requested variant id');
assert.equal(descriptor.variationSeed, 11, 'descriptor records requested seed');
assert.ok(descriptor.boundedParameterFamilies.includes('macro phase'), 'descriptor permits macro phase variation');
assert.ok(descriptor.boundedParameterFamilies.includes('lower cup depth'), 'descriptor permits lower cup depth variation');
assert.ok(descriptor.forbiddenVariationClasses.includes('free-randomization'), 'descriptor forbids free randomization');
assert.ok(descriptor.preservedInvariants.includes('PrimaryApertureFrame'), 'descriptor preserves primary aperture frame');
assert.ok(descriptor.preservedInvariants.includes('front-aperture-ownership'), 'descriptor preserves front aperture ownership');
assert.ok(descriptor.effectiveParameters.macroAssemblages['north-west-dominant-thrust'], 'descriptor records per-macro effective parameters');
assert.ok(descriptor.effectiveParameters.frontApertureOwnership.lowerCupDepth >= 0.8, 'descriptor records lower cup depth');

const baseline = createTargetOrbShellCompositionFixture();
const variant = createTargetOrbShellCompositionFixture({ variantId: 'asymmetric-tuck', variationSeed: 11 });

assert.equal(variant.controlledVariation.schema, 'OrbShellVariationDescriptor', 'fixture records controlled variation descriptor');
assert.equal(variant.effectiveVariation.variantId, 'asymmetric-tuck', 'fixture exposes effective variant id');
assert.equal(variant.macroAssemblages.length, baseline.macroAssemblages.length, 'variation preserves macro count');
assert.equal(variant.frontApertureOwnership.schema, 'PrimaryApertureFrame', 'variation preserves primary aperture frame');
assert.equal(
  variant.frontApertureOwnership.owners.length,
  baseline.frontApertureOwnership.owners.length,
  'variation preserves aperture owner count',
);
assert.deepEqual(
  variant.sphericalClosureAnchors.map(anchor => anchor.id),
  baseline.sphericalClosureAnchors.map(anchor => anchor.id),
  'variation preserves closure anchor identities',
);

const baseNorthWest = baseline.macroAssemblages.find(item => item.id === 'north-west-dominant-thrust');
const variantNorthWest = variant.macroAssemblages.find(item => item.id === 'north-west-dominant-thrust');
assert.notEqual(
  variantNorthWest.sphericalTerritory.centerPhase,
  baseNorthWest.sphericalTerritory.centerPhase,
  'variation changes macro phase within the bounded regime',
);
assert.notEqual(
  variantNorthWest.spine.control.bow,
  baseNorthWest.spine.control.bow,
  'variation changes macro bow within the bounded regime',
);
assert.ok(
  variant.macroAssemblages.every(item => item.territoryBodyOccupancy?.boundaryPressureField?.schema === 'BoundaryPressureField'),
  'variation preserves shaped boundary fields',
);
