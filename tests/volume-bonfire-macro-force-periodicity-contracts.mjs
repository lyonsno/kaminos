import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertBonfireMacroForceBoundary(source) {
  for (const retiredName of [
    'bonfireZeroMeanLateralFlow',
    'bonfireSymmetricLateralForce',
    'bonfireZeroMeanPlumeRoll',
    'bonfireConvectiveCellRoll',
    'bonfireLayeredPlumeShear',
    'bonfireLayerShearPhase',
    'symmetricDetailForce',
    'symmetricMicroForce',
    'symmetricShredForce',
    'symmetricFineBreakup',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${retiredName}\\b`),
      `${retiredName} must not preserve periodic Bonfire macro choreography`,
    );
  }

  const detailForceRegion = sourceBetween(
    source,
    '  let rawDetailCarrier =',
    '  let projectionCorrection = vec3<f32>(0.0);',
  );
  assert.match(
    detailForceRegion,
    /let detailLateral = vec2<f32>\(rawDetailForce\.x, rawDetailForce\.z\) \* bonfireDetailLateralDamping;/,
    'Bonfire detail forcing must retain the raw operator result instead of replacing it with an analytic symmetric field',
  );
  assert.match(
    detailForceRegion,
    /let microLateral = vec2<f32>\(rawMicroForce\.x, rawMicroForce\.z\) \* bonfireDetailLateralDamping;/,
    'Bonfire micro forcing must retain the raw operator result instead of replacing it with an analytic symmetric field',
  );
  assert.match(
    detailForceRegion,
    /let shredLateral = vec2<f32>\(rawShredForce\.x, rawShredForce\.z\) \* bonfireDetailLateralDamping;/,
    'Bonfire shred forcing must retain the raw operator result instead of replacing it with an analytic symmetric field',
  );
  assert.match(
    detailForceRegion,
    /let fineBreakupLateral = vec2<f32>\(rawFineBreakup\.x, rawFineBreakup\.z\) \* bonfireDetailLateralDamping;/,
    'Bonfire fine breakup must retain the raw operator result instead of replacing it with an analytic symmetric field',
  );

  const bonfireMacroRegion = sourceBetween(
    source,
    '  let bonfireUpperDepinchBand =',
    '  let windMaterialCoupling =',
  );
  assert.doesNotMatch(
    bonfireMacroRegion,
    /\b(?:sin|cos)\s*\(/,
    'Bonfire-specific recentering and depinching must not hide a replacement periodic macro force',
  );
  assert.match(bonfireMacroRegion, /bonfireUpperDepinchOutflow/, 'field-independent geometric depinching remains explicit');
  assert.match(bonfireMacroRegion, /bonfireNonWindCenteringForce/, 'bounded symmetric recentering remains explicit');
  assert.match(
    source,
    /vel = vel \+ bonfireReferenceConfinement \* bonfireScene \* bonfireInstabilityProbe \* 1\.6;/,
    'the instability probe may retain only transported-field reference confinement after periodic rolls retire',
  );
  assert.match(source, /vel = vel \+ confinement \*/, 'transported vorticity confinement remains active');
  assert.match(source, /thermalBuoyancyForce\(/, 'thermal buoyancy remains active');

  assert.match(
    source,
    /const MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED = 'retired-periodic-bonfire-macro-forces-v0';/,
    'the structural ledger must name periodic Bonfire macro-force retirement',
  );
  assert.match(
    source,
    /const mainFluidBonfireSymmetricForceStrategy = MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED;/,
    'the symmetric-force strategy must report retirement instead of scene-dependent activation',
  );
  assert.match(
    source,
    /const bonfireSymmetricForceEvaluationsPerCell = 0;/,
    'the symmetric-force ledger must report zero evaluations for every scene',
  );
  assert.match(
    source,
    /const mainFluidBonfireNonWindForceStrategy = MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED;/,
    'the non-wind macro-force strategy must report retirement instead of scene-dependent activation',
  );
  assert.match(
    source,
    /const bonfireNonWindForceEvaluationsPerCell = 0;/,
    'the non-wind macro-force ledger must report zero evaluations for every scene',
  );
  assert.match(
    source,
    /shear: 0,/,
    'the legacy shear route field must resolve to zero effective authority after periodic macro-force retirement',
  );
  assert.match(
    source,
    /temporal: 0,/,
    'the legacy temporal route field must resolve to zero effective authority after periodic macro-force retirement',
  );
  assert.match(
    source,
    /periodicMacroForcePolicy: MAIN_FLUID_BONFIRE_PERIODIC_MACRO_FORCE_STRATEGY_RETIRED/,
    'the effective ablation receipt must identify periodic macro-force retirement',
  );
  assert.match(source, /requestedShear/, 'the retirement receipt preserves the requested legacy shear value without applying it');
  assert.match(source, /requestedTemporal/, 'the retirement receipt preserves the requested legacy temporal value without applying it');
}

assertBonfireMacroForceBoundary(core);

function assertWitnessRetirementIdentity(source) {
  const shearChecks = sourceBetween(
    source,
    "assert.ok(Math.abs((state.controls?.bonfireShear",
    "assert.ok(Math.abs((state.controls?.bonfireDetailForces",
  );
  assert.match(shearChecks, /state\.bonfireAblation\?\.requestedShear, expectedBonfireShear/, 'witness must preserve the saved shear request');
  assert.match(shearChecks, /state\.bonfireAblation\?\.shear, 0/, 'witness must expect retired shear to have zero effect');
  assert.doesNotMatch(shearChecks, /state\.bonfireAblation\?\.shear \?\? 0\) - expectedBonfireShear/, 'witness must not confuse requested shear with effective shear');

  const temporalChecks = sourceBetween(
    source,
    "assert.ok(Math.abs((state.controls?.bonfireTemporal",
    "assert.ok(Math.abs((state.controls?.bonfireInstabilityProbe",
  );
  assert.match(temporalChecks, /state\.bonfireAblation\?\.requestedTemporal, expectedBonfireTemporal/, 'witness must preserve the saved temporal request');
  assert.match(temporalChecks, /state\.bonfireAblation\?\.temporal, 0/, 'witness must expect retired temporal forcing to have zero effect');
  assert.doesNotMatch(temporalChecks, /state\.bonfireAblation\?\.temporal \?\? 0\) - expectedBonfireTemporal/, 'witness must not confuse requested temporal forcing with effective forcing');
  assert.match(source, /state\.bonfireAblation\?\.periodicMacroForcePolicy, 'retired-periodic-bonfire-macro-forces-v0'/, 'witness must verify the named retirement policy');
}

assertWitnessRetirementIdentity(witness);
assert.match(witness, /function expectedBonfireSymmetricForceStrategy\([^)]*\) \{\s*return 'retired-periodic-bonfire-macro-forces-v0';\s*\}/,
  'witness cost ledger must expect the retired symmetric-force strategy for every scene');
assert.match(witness, /function expectedBonfireSymmetricForceEvaluationsPerCell\([^)]*\) \{\s*return 0;\s*\}/,
  'witness cost ledger must expect zero retired symmetric-force evaluations');
assert.match(witness, /function expectedBonfireNonWindForceStrategy\([^)]*\) \{\s*return 'retired-periodic-bonfire-macro-forces-v0';\s*\}/,
  'witness cost ledger must expect the retired non-wind-force strategy for every scene');
assert.match(witness, /function expectedBonfireNonWindForceEvaluationsPerCell\([^)]*\) \{\s*return 0;\s*\}/,
  'witness cost ledger must expect zero retired non-wind-force evaluations');

for (const [name, oldText, restoredText] of [
  ['effective shear restored from request', 'state.bonfireAblation?.shear, 0', 'state.bonfireAblation?.shear, expectedBonfireShear'],
  ['effective temporal forcing restored from request', 'state.bonfireAblation?.temporal, 0', 'state.bonfireAblation?.temporal, expectedBonfireTemporal'],
  ['retirement policy removed', "state.bonfireAblation?.periodicMacroForcePolicy, 'retired-periodic-bonfire-macro-forces-v0'", "state.bonfireAblation?.periodicMacroForcePolicy, 'unknown'"],
]) {
  const mutated = witness.replace(oldText, restoredText);
  assert.notEqual(mutated, witness, `${name} mutation must alter the witness`);
  assert.throws(() => assertWitnessRetirementIdentity(mutated), undefined, `${name} must fail the witness contract`);
}

const falseClosureMutations = [
  [
    'restored periodic macro helper',
    source => source.replace(
      'fn bonfireEntrainedLift(',
      'fn bonfireZeroMeanPlumeRoll() -> f32 { return sin(0.0); }\n\nfn bonfireEntrainedLift(',
    ),
  ],
  [
    'restored hidden evaluation count',
    source => source.replace(
      'const bonfireNonWindForceEvaluationsPerCell = 0;',
      "const bonfireNonWindForceEvaluationsPerCell = bonfireCombustionFieldActive ? 4 : 0;",
    ),
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertBonfireMacroForceBoundary(mutated);
    acceptedFalseClosures.push(name);
  } catch {
    // The retirement boundary must reject the mutation.
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the Bonfire macro-force boundary must reject every false-closure mutation');

console.log('volume Bonfire macro-force periodicity: authored lateral/roll/shear choreography is retired');
