import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroTorsionField/, 'composition module names MacroTorsionField descriptors');
assert.match(core, /macro-torsion-field-v0/, 'composition module names macro torsion field mode');
assert.match(core, /createMacroTorsionField/, 'composition module creates macro torsion fields');
assert.match(core, /twistDelta/, 'controlled variation records twist delta');
assert.match(core, /torsionGradient/, 'controlled variation records torsion gradient');
assert.match(core, /surfaceRoll/, 'controlled variation records surface roll');
assert.match(core, /phaseLag/, 'controlled variation records torsion phase lag');
assert.match(core, /effectiveTorsion/, 'debug state records effective torsion');
assert.match(core, /torsionFieldCount/, 'debug state records torsion field count');
assert.match(witness, /MacroTorsionField/, 'composition witness records macro torsion fields');
assert.match(witness, /effectiveTorsion/, 'composition witness reports effective torsion');
assert.match(witness, /torsionFieldCount/, 'composition witness reports torsion field count');

const {
  ORB_SHELL_MACRO_TORSION_MODE,
  createControlledOrbShellVariationDescriptor,
  createTargetOrbShellCompositionFixture,
} = await import('../orb-shell-composition-core.js');

assert.equal(
  ORB_SHELL_MACRO_TORSION_MODE,
  'macro-torsion-field-v0',
  'macro torsion mode is stable',
);

const descriptor = createControlledOrbShellVariationDescriptor({ variantId: 'wide-cup', variationSeed: 7 });
assert.ok(descriptor.boundedParameterFamilies.includes('macro torsion'), 'descriptor permits macro torsion variation');
assert.ok(descriptor.boundedParameterFamilies.includes('twist delta'), 'descriptor permits bounded twist deltas');
assert.ok(descriptor.boundedParameterFamilies.includes('surface roll'), 'descriptor permits bounded surface roll');

for (const [id, params] of Object.entries(descriptor.effectiveParameters.macroAssemblages)) {
  assert.equal(typeof params.twistDelta, 'number', `${id} records twistDelta`);
  assert.equal(typeof params.torsionGradient, 'number', `${id} records torsionGradient`);
  assert.equal(typeof params.surfaceRoll, 'number', `${id} records surfaceRoll`);
  assert.equal(typeof params.phaseLag, 'number', `${id} records phaseLag`);
  assert.ok(Math.abs(params.twistDelta) <= 0.24, `${id} twistDelta stays bounded`);
  assert.ok(Math.abs(params.torsionGradient) <= 0.2, `${id} torsionGradient stays bounded`);
  assert.ok(Math.abs(params.surfaceRoll) <= 0.18, `${id} surfaceRoll stays bounded`);
  assert.ok(Math.abs(params.phaseLag) <= 0.14, `${id} phaseLag stays bounded`);
}

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });

assert.equal(fixture.macroTorsionFieldPlan?.schema, 'MacroTorsionFieldPlan', 'fixture exposes macro torsion field plan');
assert.equal(fixture.macroTorsionFieldPlan.mode, ORB_SHELL_MACRO_TORSION_MODE, 'fixture records torsion field mode');
assert.equal(
  fixture.macroTorsionFieldPlan.fields.length,
  fixture.macroAssemblages.length,
  'one torsion field per macro assemblage',
);
assert.ok(
  fixture.macroTorsionFieldPlan.fields.every(field => field.schema === 'MacroTorsionField'),
  'all torsion fields use MacroTorsionField schema',
);
assert.ok(
  fixture.macroTorsionFieldPlan.fields.every(field => field.appliesTo.includes('expanded-region-proxy-surface')),
  'torsion fields apply to expanded region proxy surfaces',
);
assert.ok(
  fixture.macroTorsionFieldPlan.fields.every(field => field.appliesTo.includes('spine-sampling')),
  'torsion fields apply to spine sampling',
);
assert.ok(
  fixture.macroTorsionFieldPlan.fields.every(field => field.preserve.includes('MacroRegionSeamGapDescriptor')),
  'torsion fields preserve seam/gap descriptor custody',
);
assert.ok(
  fixture.macroAssemblages.every(assemblage => assemblage.macroTorsionField?.schema === 'MacroTorsionField'),
  'each macro assemblage points at its torsion field',
);
assert.ok(
  fixture.macroAssemblages.every(assemblage => typeof assemblage.spine.control.effectiveTwist === 'number'),
  'each macro assemblage records effective twist for sampling',
);
assert.ok(
  fixture.macroAssemblages.every(assemblage => typeof assemblage.expandedRegionProxy?.effectiveTorsion?.surfaceRoll === 'number'),
  'expanded region proxies inherit effective torsion for future meshing',
);
assert.equal(
  fixture.frontApertureOwnership.lowerCupClosure.mode,
  'lower-cup-socket-contiguous',
  'torsion preserves lower cup closure',
);
assert.equal(
  fixture.frontApertureOwnership.crossingTuckIntegration.mode,
  'crossing-tuck-macro-body',
  'torsion preserves crossing tuck macro-body integration',
);
