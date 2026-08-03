import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA,
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  createSyntheticFourMuscleCompartment,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';

function endpointPositions(muscle) {
  return [muscle.centerline[0].position, muscle.centerline.at(-1).position];
}

test('four endpoint-fixed swept muscles pack around rigid anatomy without identity or volume loss', () => {
  const source = createSyntheticFourMuscleCompartment();
  assert.match(source.input.requested.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(source.input.requested, source.input.effective);
  const config = {
    maxIterations: 640,
    relaxationStep: 0.18,
    smoothnessStep: 0.035,
    sampleCount: 25,
    convergenceTolerance: 1e-7,
  };
  const result = solveMuscleCompartmentPacking(source, config);

  assert.equal(result.schema, MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA);
  assert.equal(result.sourceId, source.id);
  assert.deepEqual(result.input, source.input);
  assert.deepEqual(result.config, config, 'effective config must equal caller request');
  assert.equal(result.dimension, 3);
  assert.equal(result.muscles.length, 4);
  assert.equal(
    result.status,
    'converged',
    `packing did not converge: ${JSON.stringify(result.metrics.packed)}`,
  );
  assert.ok(result.iterations > 0 && result.iterations <= config.maxIterations);

  assert.ok(result.metrics.initial.pairwisePenetration > 0.2);
  assert.ok(result.metrics.initial.skeletalPenetration > 0.2);
  assert.ok(
    result.metrics.packed.pairwisePenetration <
      result.metrics.initial.pairwisePenetration * 0.02,
  );
  assert.ok(result.metrics.packed.skeletalPenetration <= config.convergenceTolerance);
  assert.ok(result.metrics.packed.compartmentEscape <= config.convergenceTolerance);
  assert.equal(result.metrics.packed.endpointDrift, 0);
  assert.ok(result.metrics.packed.maximumRelativeVolumeError <= 1e-9);
  assert.ok(result.metrics.packed.maximumBendEnergy < 0.04);
  assert.ok(result.metrics.packed.nonFiniteValueCount === 0);
  assert.ok(result.metrics.packed.nonPositiveRadiusCount === 0);

  for (const [index, packed] of result.muscles.entries()) {
    const original = source.muscles[index];
    assert.equal(packed.id, original.id);
    assert.deepEqual(packed.identity, original.identity);
    assert.deepEqual(packed.authority, original.authority);
    assert.deepEqual(packed.attachments, original.attachments);
    assert.deepEqual(endpointPositions(packed), endpointPositions(original));
    assert.ok(packed.centerline.every(sample =>
      sample.position.every(Number.isFinite) &&
      Number.isFinite(sample.radius) &&
      sample.radius > 0));
  }

  assert.deepEqual(
    solveMuscleCompartmentPacking(source, config),
    result,
    'same source and config must produce byte-stable object state',
  );
});

test('source validation rejects identity collision and non-finite carrier state', () => {
  const duplicate = createSyntheticFourMuscleCompartment();
  duplicate.muscles[1].identity.instanceId = duplicate.muscles[0].identity.instanceId;
  assert.throws(
    () => solveMuscleCompartmentPacking(duplicate),
    /instance.*unique|duplicate.*instance/i,
  );

  const nonFinite = createSyntheticFourMuscleCompartment();
  nonFinite.muscles[0].centerline[1].position[2] = Number.NaN;
  assert.throws(
    () => solveMuscleCompartmentPacking(nonFinite),
    /finite.*centerline|centerline.*finite/i,
  );

  const staleIdentity = createSyntheticFourMuscleCompartment();
  staleIdentity.muscles[0].targetVolume *= 1.01;
  assert.throws(
    () => solveMuscleCompartmentPacking(staleIdentity),
    /synthetic fixture identity mismatch/i,
  );
});
