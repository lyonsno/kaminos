import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA,
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  createSyntheticFourMuscleCompartment,
  createSyntheticMuscleDensityLadder,
  measureMuscleCompartmentPacking,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';

function endpointPositions(muscle) {
  return [muscle.centerline[0].position, muscle.centerline.at(-1).position];
}

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const segmentLength = Math.hypot(...left.position.map(
      (value, axis) => value - right.position[axis],
    ));
    volume += Math.PI * segmentLength / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function createInterSegmentCrossingSource() {
  const source = createSyntheticFourMuscleCompartment();
  source.id = 'operator-authored-inter-segment-crossing';
  source.authority = { kind:'operator-authored', anatomicalAdmission:'test-only' };
  source.input = {
    requested: { kind:'operator-authored-test', id:source.id, sha256:'a'.repeat(64) },
    effective: { kind:'operator-authored-test', id:source.id, sha256:'a'.repeat(64) },
  };
  source.compartment = {
    id:'crossing-test-compartment', kind:'box',
    minimum:[-2,-2,-2], maximum:[2,2,2], clearance:0,
  };
  source.obstacles = [];
  const paths = [
    [[-0.8,0,0],[0.2,0,0],[0.8,0.6,0],[0.8,0.9,0]],
    [[0,-0.8,0],[0,0.2,0],[-0.6,0.8,0],[-0.9,0.8,0]],
  ];
  source.muscles = source.muscles.slice(0, 2).map((muscle, muscleIndex) => {
    const centerline = paths[muscleIndex].map(position => ({ position, radius:0.12 }));
    return {
      ...muscle,
      authority: { kind:'operator-authored', anatomicalAdmission:'test-only' },
      centerline,
      attachments: {
        origin: { ...muscle.attachments.origin, position:[...centerline[0].position] },
        insertion: { ...muscle.attachments.insertion, position:[...centerline.at(-1).position] },
      },
      targetVolume: carrierVolume(centerline),
    };
  });
  return source;
}

test('four endpoint-fixed swept muscles pack around rigid anatomy without identity or volume loss', () => {
  const source = createSyntheticFourMuscleCompartment();
  const sourceBellyRadialDistances = source.muscles.map(muscle =>
    muscle.centerline.slice(1, -1).reduce(
      (sum, knot) => sum + Math.hypot(knot.position[0], knot.position[2]),
      0,
    ) / (muscle.centerline.length - 2));
  assert.ok(
    Math.max(...sourceBellyRadialDistances) - Math.min(...sourceBellyRadialDistances) > 0.04,
    'visual witness input must be asymmetric rather than a regular radial formation',
  );
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
  assert.deepEqual(result.formation, {
    requestedCenterlineSmoothingReference: 'source-displacement',
    effectiveCenterlineSmoothingReference: 'source-displacement',
    fallbackUsed: false,
  });
  assert.equal(result.muscles.length, 4);
  assert.equal(
    result.status,
    'converged',
    `packing did not converge: ${JSON.stringify(result.metrics.packed)}`,
  );
  assert.ok(result.iterations > 0 && result.iterations <= config.maxIterations);

  assert.ok(result.metrics.initial.pairwisePenetration > 0.1);
  assert.ok(result.metrics.initial.skeletalPenetration > 0.15);
  assert.ok(
    result.metrics.packed.pairwisePenetration <
      result.metrics.initial.pairwisePenetration * 0.02,
  );
  assert.ok(result.metrics.packed.skeletalPenetration <= config.convergenceTolerance);
  assert.ok(result.metrics.packed.compartmentEscape <= config.convergenceTolerance);
  assert.equal(result.metrics.packed.endpointDrift, 0);
  assert.ok(result.metrics.packed.maximumRelativeVolumeError <= 1e-9);
  assert.ok(
    result.metrics.packed.maximumBendEnergy <= result.metrics.initial.maximumBendEnergy * 1.05,
    'packing must not create a sharper centerline fold than the authored source',
  );
  assert.equal(result.metrics.initial.maximumSourceKnotDisplacement, 0);
  assert.equal(result.metrics.initial.rootMeanSquareSourceKnotDisplacement, 0);
  assert.equal(result.metrics.initial.minimumSourceBendEnergyRetention, 1);
  assert.equal(result.metrics.initial.minimumSourceCurvatureCosine, 1);
  assert.equal(result.metrics.initial.sourceCurvatureReversalCount, 0);
  assert.ok(result.metrics.packed.maximumSourceKnotDisplacement < 0.5);
  assert.ok(result.metrics.packed.rootMeanSquareSourceKnotDisplacement < 0.35);
  assert.ok(
    result.metrics.packed.minimumSourceBendEnergyRetention > 0.25,
    `packed centerlines collapsed source bend: ${JSON.stringify(result.metrics.packed)}`,
  );
  assert.ok(result.metrics.packed.minimumSourceCurvatureCosine > 0.3);
  assert.equal(result.metrics.packed.sourceCurvatureReversalCount, 0);
  assert.ok(result.metrics.packed.minimumPairwiseRelationCosine > 0.9);
  assert.equal(result.metrics.packed.pairwiseRelationReversalCount, 0);
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

test('nested four six and eight carrier density rungs preserve prior identity and converge', () => {
  const config = {
    maxIterations: 960,
    relaxationStep: 0.35,
    smoothnessStep: 0.035,
    sampleCount: 25,
    convergenceTolerance: 1e-7,
  };
  let priorSource = null;
  for (const muscleCount of [4, 6, 8]) {
    const source = createSyntheticMuscleDensityLadder(muscleCount);
    if (priorSource) {
      assert.deepEqual(
        source.muscles.slice(0, priorSource.muscles.length),
        priorSource.muscles,
        `${muscleCount}-carrier rung must preserve every prior source carrier`,
      );
    }
    const result = solveMuscleCompartmentPacking(source, config);
    assert.equal(
      result.status,
      'converged',
      `${muscleCount}-carrier density rung failed: ${JSON.stringify(result.metrics.packed)}`,
    );
    assert.equal(result.muscles.length, muscleCount);
    assert.ok(result.metrics.initial.pairwisePenetration > 0.2);
    assert.ok(result.metrics.initial.skeletalPenetration > 0.2);
    assert.ok(
      result.metrics.packed.pairwisePenetration <= config.convergenceTolerance,
      `${muscleCount}-carrier overlap remained ${result.metrics.packed.pairwisePenetration}`,
    );
    assert.ok(result.metrics.packed.skeletalPenetration <= config.convergenceTolerance);
    assert.ok(result.metrics.packed.compartmentEscape <= config.convergenceTolerance);
    assert.equal(result.metrics.packed.endpointDrift, 0);
    assert.ok(result.metrics.packed.maximumRelativeVolumeError <= 1e-9);
    assert.equal(result.metrics.packed.nonFiniteValueCount, 0);
    assert.equal(result.metrics.packed.nonPositiveRadiusCount, 0);
    assert.deepEqual(solveMuscleCompartmentPacking(source, config), result);
    priorSource = source;
  }
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

  const unsupportedFormationPolicy = createSyntheticFourMuscleCompartment();
  unsupportedFormationPolicy.formation.centerlineSmoothingReference = 'silent-fallback';
  assert.throws(
    () => solveMuscleCompartmentPacking(unsupportedFormationPolicy),
    /centerline smoothing reference.*source-displacement/i,
  );

  const staleIdentity = createSyntheticFourMuscleCompartment();
  staleIdentity.muscles[0].targetVolume *= 1.01;
  assert.throws(
    () => solveMuscleCompartmentPacking(staleIdentity),
    /synthetic fixture identity mismatch/i,
  );
});

test('convergence cannot hide a continuous inter-segment crossing between sparse samples', () => {
  const source = createInterSegmentCrossingSource();
  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 1,
    relaxationStep: 0.18,
    smoothnessStep: 1e-12,
    sampleCount: 3,
    convergenceTolerance: 1e-7,
  });
  const dense = measureMuscleCompartmentPacking(source, result.muscles, 401);

  assert.ok(dense.pairwisePenetration > 0.2, 'fixture must contain an inter-sample crossing');
  assert.notEqual(
    result.status,
    'converged',
    `sparse sample grid falsely admitted continuous crossing: ${JSON.stringify({
      solver: result.metrics.packed,
      dense,
    })}`,
  );
  assert.ok(result.metrics.packed.pairwisePenetration > 0.2);
  assert.equal(result.status, 'continuous-clearance-failed');
  assert.equal(result.failure.phase, 'solve');
  assert.equal(result.failure.kind, 'residual-constraint');
  assert.equal(result.failure.sourceId, source.id);
  assert.equal(result.failure.iterations, 1);
  assert.equal(result.failure.dominantMechanism.kind, 'continuous-clearance-residual');
  assert.equal(
    result.failure.dominantMechanism.residual,
    result.metrics.packed.pairwisePenetration,
  );
});

test('post-iteration pairwise residual is classified instead of generic exhaustion', () => {
  const source = createInterSegmentCrossingSource();
  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 1,
    relaxationStep: 1e-12,
    smoothnessStep: 1e-12,
    sampleCount: 25,
    convergenceTolerance: 1e-12,
  });

  assert.equal(result.status, 'pairwise-exclusion-failed');
  assert.equal(result.failure.phase, 'solve');
  assert.equal(result.failure.kind, 'residual-constraint');
  assert.deepEqual(result.failure.dominantMechanism, {
    kind: 'pairwise-exclusion-residual',
    residual: result.metrics.packed.pairwisePenetration,
  });
});

test('post-iteration skeletal residual is classified with obstacle-constrained source intact', () => {
  const source = createInterSegmentCrossingSource();
  const distantMuscle = source.muscles[1];
  for (const knot of distantMuscle.centerline) knot.position[2] += 1;
  distantMuscle.attachments.origin.position[2] += 1;
  distantMuscle.attachments.insertion.position[2] += 1;
  distantMuscle.targetVolume = carrierVolume(distantMuscle.centerline);
  source.obstacles = [{
    id: 'interior-skeletal-process',
    kind: 'sphere',
    center: [...source.muscles[0].centerline[1].position],
    radius: 0.2,
    clearance: 0.03,
  }];
  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 1,
    relaxationStep: 1e-12,
    smoothnessStep: 1e-12,
    sampleCount: 25,
    convergenceTolerance: 1e-12,
  });

  assert.equal(result.status, 'skeletal-clearance-failed');
  assert.deepEqual(result.failure.dominantMechanism, {
    kind: 'skeletal-clearance-residual',
    residual: result.metrics.packed.skeletalPenetration,
  });
  assert.deepEqual(result.obstacles, source.obstacles);
});

test('post-iteration compartment residual is classified with radius-aware bound intact', () => {
  const source = createInterSegmentCrossingSource();
  const distantMuscle = source.muscles[1];
  for (const knot of distantMuscle.centerline) knot.position[2] += 1;
  distantMuscle.attachments.origin.position[2] += 1;
  distantMuscle.attachments.insertion.position[2] += 1;
  distantMuscle.targetVolume = carrierVolume(distantMuscle.centerline);
  source.muscles[0].centerline[1].position = [2.2, 0, 0];
  source.muscles[0].targetVolume = carrierVolume(source.muscles[0].centerline);
  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 1,
    relaxationStep: 1e-12,
    smoothnessStep: 1e-12,
    sampleCount: 25,
    convergenceTolerance: 1e-12,
  });

  assert.equal(result.status, 'compartment-clearance-failed');
  assert.deepEqual(result.failure.dominantMechanism, {
    kind: 'compartment-clearance-residual',
    residual: result.metrics.packed.compartmentEscape,
  });
  assert.deepEqual(result.compartment, source.compartment);
});

test('pairwise exclusion cannot launder colliding fixed attachments into convergence', () => {
  const source = createInterSegmentCrossingSource();
  const fixedOrigin = [...source.muscles[0].attachments.origin.position];
  source.id = 'operator-authored-fixed-attachment-collision';
  source.input.requested.id = source.id;
  source.input.effective.id = source.id;
  source.muscles[1].centerline[0].position = [...fixedOrigin];
  source.muscles[1].attachments.origin.position = [...fixedOrigin];
  source.muscles[1].targetVolume = carrierVolume(source.muscles[1].centerline);

  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 64,
    relaxationStep: 0.35,
    smoothnessStep: 0.035,
    sampleCount: 25,
    convergenceTolerance: 1e-7,
  });

  assert.equal(result.status, 'immutable-constraint-conflict');
  assert.equal(result.iterations, 0);
  assert.equal(result.failure.phase, 'preflight');
  assert.equal(result.failure.kind, 'immutable-constraint-conflict');
  assert.equal(result.failure.sourceId, source.id);
  assert.deepEqual(result.failure.blockingMechanisms, [{
    kind: 'pairwise-fixed-attachment-penetration',
    left: {
      muscleId: source.muscles[0].id,
      attachment: 'origin',
      attachmentId: source.muscles[0].attachments.origin.id,
    },
    right: {
      muscleId: source.muscles[1].id,
      attachment: 'origin',
      attachmentId: source.muscles[1].attachments.origin.id,
    },
    penetration: 0.24,
  }]);
  assert.equal(result.metrics.packed.endpointDrift, 0);
  assert.ok(result.metrics.packed.pairwisePenetration >= 0.24);
  assert.equal(result.metrics.packed.maximumRelativeVolumeError, 0);
  assert.equal(result.metrics.packed.nonFiniteValueCount, 0);
  assert.equal(result.metrics.packed.nonPositiveRadiusCount, 0);
  assert.deepEqual(result.muscles[0].centerline[0].position, fixedOrigin);
  assert.deepEqual(result.muscles[1].centerline[0].position, fixedOrigin);
});

test('fixed attachment inside skeletal clearance fails at preflight with exact obstacle receipt', () => {
  const source = createInterSegmentCrossingSource();
  const origin = source.muscles[0].attachments.origin;
  source.id = 'operator-authored-fixed-attachment-skeletal-conflict';
  source.input.requested.id = source.id;
  source.input.effective.id = source.id;
  source.obstacles = [{
    id: 'authored-skeletal-process',
    kind: 'sphere',
    center: [...origin.position],
    radius: 0.2,
    clearance: 0.03,
  }];

  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 64,
    relaxationStep: 0.35,
    smoothnessStep: 0.035,
    sampleCount: 25,
    convergenceTolerance: 1e-7,
  });

  assert.equal(result.status, 'immutable-constraint-conflict');
  assert.equal(result.iterations, 0);
  assert.deepEqual(result.failure.blockingMechanisms, [{
    kind: 'fixed-attachment-skeletal-penetration',
    muscleId: source.muscles[0].id,
    attachment: 'origin',
    attachmentId: origin.id,
    obstacleId: 'authored-skeletal-process',
    penetration: 0.35,
  }]);
  assert.ok(result.metrics.packed.skeletalPenetration >= 0.35);
  assert.ok(result.metrics.packed.skeletalPenetration < 0.351);
  assert.equal(result.metrics.packed.endpointDrift, 0);
});

test('fixed attachment outside compartment fails at preflight with exact boundary receipt', () => {
  const source = createInterSegmentCrossingSource();
  const muscle = source.muscles[0];
  source.id = 'operator-authored-fixed-attachment-compartment-conflict';
  source.input.requested.id = source.id;
  source.input.effective.id = source.id;
  muscle.centerline[0].position = [-2.2, 0, 0];
  muscle.attachments.origin.position = [-2.2, 0, 0];
  muscle.targetVolume = carrierVolume(muscle.centerline);

  const result = solveMuscleCompartmentPacking(source, {
    maxIterations: 64,
    relaxationStep: 0.35,
    smoothnessStep: 0.035,
    sampleCount: 25,
    convergenceTolerance: 1e-7,
  });

  assert.equal(result.status, 'immutable-constraint-conflict');
  assert.equal(result.iterations, 0);
  assert.deepEqual(result.failure.blockingMechanisms, [{
    kind: 'fixed-attachment-compartment-escape',
    muscleId: muscle.id,
    attachment: 'origin',
    attachmentId: muscle.attachments.origin.id,
    axis: 'x',
    side: 'minimum',
    effectiveBound: -1.88,
    escape: 0.32,
  }]);
  assert.equal(result.metrics.packed.compartmentEscape, 0.32);
  assert.equal(result.metrics.packed.endpointDrift, 0);
});
