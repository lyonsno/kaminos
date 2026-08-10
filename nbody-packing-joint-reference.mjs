import {
  hashMusclePackingCanonicalJson,
  measureMuscleCompartmentPacking,
  taperedSegmentSurfaceMinimum,
} from './muscle-compartment-packing-core.mjs';
import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  createNBodyRosetteFixture,
  validateNBodyPackingAssayFixture,
} from './nbody-packing-assay-core.mjs';

export const NBODY_PACKING_JOINT_REFERENCE_RESULT_SCHEMA =
  'kaminos.nbody-packing-joint-reference-result.v0';

const CONFIG_KEYS = Object.freeze([
  'algorithm',
  'candidateEnumeration',
  'hardTolerance',
  'penaltySchedule',
  'startFamily',
  'stepSchedule',
  'translationBasis',
  'translationBounds',
]);
const ALGORITHM = 'synchronous-global-pattern-search-augmented-continuation-v0';
const TRANSLATION_BASIS = 'per-member-xz-sine-zero-at-attachments';
const START_FAMILY = Object.freeze([
  'crowded-zero',
  'known-feasible-continuation',
  'balanced-radial-relief',
]);
const STEP_SCHEDULE = Object.freeze([
  0.04,
  0.02,
  0.01,
  0.005,
  0.0025,
  0.00125,
  0.000625,
  0.0003125,
  0.00015625,
  0.000078125,
  0.0000390625,
  0.00001953125,
  0.000009765625,
  0.0000048828125,
  0.00000244140625,
  0.000001220703125,
  0.0000006103515625,
  0.00000030517578125,
  0.000000152587890625,
  0.0000000762939453125,
]);
const PENALTY_SCHEDULE = Object.freeze([1e3, 1e5, 1e7, 1e9, 1e11]);

function rounded(value, digits = 12) {
  const result = Number(value.toFixed(digits));
  return Object.is(result, -0) ? 0 : result;
}

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const segmentLength = distance(left.position, right.position);
    volume += Math.PI * segmentLength / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function restoreTargetVolume(muscle) {
  const realized = carrierVolume(muscle.centerline);
  if (!(realized > 0) || !(muscle.targetVolume > 0)) {
    throw new Error(`joint reference cannot restore nonpositive volume for ${muscle.id}`);
  }
  const scale = Math.sqrt(muscle.targetVolume / realized);
  for (const knot of muscle.centerline) knot.radius *= scale;
}

function canonicalVectorKey(vector) {
  return vector.map(value => rounded(value, 15).toFixed(15)).join('|');
}

function compareCandidates(left, right) {
  const scoreDifference = left.augmentedObjective - right.augmentedObjective;
  if (Math.abs(scoreDifference) > 1e-18) return scoreDifference;
  return left.vectorKey.localeCompare(right.vectorKey);
}

function rawBeltRows(muscles) {
  const rows = [];
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const left = muscles[leftIndex];
      const right = muscles[rightIndex];
      const samples = [2, 3].map(knotIndex => {
        const leftKnot = left.centerline[knotIndex];
        const rightKnot = right.centerline[knotIndex];
        const signedGap = distance(leftKnot.position, rightKnot.position) -
          leftKnot.radius - rightKnot.radius;
        return { knotIndex, signedGap };
      });
      const controlling = samples.reduce((minimum, sample) =>
        sample.signedGap < minimum.signedGap ? sample : minimum);
      rows.push({
        key:`${left.id}|${right.id}`,
        members:[left.id, right.id],
        signedGap:controlling.signedGap,
        penetration:Math.max(0, -controlling.signedGap),
        controllingKnotIndex:controlling.knotIndex,
      });
    }
  }
  return rows;
}

function beltRows(muscles) {
  return rawBeltRows(muscles).map(row => ({
    ...row,
    signedGap:rounded(row.signedGap),
    penetration:rounded(row.penetration),
  }));
}

function measureBelt(muscles) {
  const pairs = beltRows(muscles);
  return {
    sample:'paired-carrier-knots-2-and-3',
    pairs,
    byPair:Object.fromEntries(pairs.map(pair => [pair.key, structuredClone(pair)])),
    totalPenetration:rounded(pairs.reduce((sum, pair) => sum + pair.penetration, 0)),
    maximumPenetration:rounded(Math.max(...pairs.map(pair => pair.penetration))),
  };
}

function closestPointOnSegment(point, start, end) {
  const segment = end.map((value, axis) => value - start[axis]);
  const segmentSquared = segment.reduce((sum, value) => sum + value ** 2, 0);
  if (!(segmentSquared > 0)) return [...start];
  const offset = point.map((value, axis) => value - start[axis]);
  const parameter = Math.max(
    0,
    Math.min(
      1,
      offset.reduce((sum, value, axis) => sum + value * segment[axis], 0) /
        segmentSquared,
    ),
  );
  return start.map((value, axis) => value + parameter * segment[axis]);
}

function closestPointOnObstacle(point, obstacle) {
  if (obstacle.kind === 'sphere') return obstacle.center;
  if (obstacle.kind === 'capsule') {
    return closestPointOnSegment(point, obstacle.start, obstacle.end);
  }
  throw new Error(`unsupported joint reference obstacle kind: ${obstacle.kind}`);
}

function measureAnalyticSearchState(source, vector) {
  const states = source.muscles.map((muscle, muscleIndex) => {
    const translationX = vector[muscleIndex * 2];
    const translationZ = vector[muscleIndex * 2 + 1];
    const finalIndex = muscle.centerline.length - 1;
    const positions = muscle.centerline.map((knot, knotIndex) => {
      const envelope = Math.sin(Math.PI * knotIndex / finalIndex);
      return [
        knot.position[0] + translationX * envelope,
        knot.position[1],
        knot.position[2] + translationZ * envelope,
      ];
    });
    let realizedVolume = 0;
    for (let knotIndex = 0; knotIndex < finalIndex; knotIndex += 1) {
      const leftRadius = muscle.centerline[knotIndex].radius;
      const rightRadius = muscle.centerline[knotIndex + 1].radius;
      realizedVolume += Math.PI * distance(
        positions[knotIndex],
        positions[knotIndex + 1],
      ) / 3 * (
        leftRadius ** 2 + leftRadius * rightRadius + rightRadius ** 2
      );
    }
    const radiusScale = Math.sqrt(muscle.targetVolume / realizedVolume);
    return {
      positions,
      radii:muscle.centerline.map(knot => knot.radius * radiusScale),
    };
  });

  let violationSquared = 0;
  let maximumResidual = 0;
  for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < states.length; rightIndex += 1) {
      let pairPenetration = 0;
      for (const knotIndex of [2, 3]) {
        pairPenetration = Math.max(
          pairPenetration,
          states[leftIndex].radii[knotIndex] + states[rightIndex].radii[knotIndex] -
            distance(
              states[leftIndex].positions[knotIndex],
              states[rightIndex].positions[knotIndex],
            ),
        );
      }
      pairPenetration = Math.max(0, pairPenetration);
      violationSquared += pairPenetration ** 2;
      maximumResidual = Math.max(maximumResidual, pairPenetration);
    }
  }

  let skeletalPenetration = 0;
  let compartmentEscape = 0;
  for (const state of states) {
    for (let knotIndex = 0; knotIndex < state.positions.length; knotIndex += 1) {
      const position = state.positions[knotIndex];
      const radius = state.radii[knotIndex];
      for (const obstacle of source.obstacles) {
        const nearest = closestPointOnObstacle(position, obstacle);
        skeletalPenetration = Math.max(
          skeletalPenetration,
          radius + obstacle.radius + (obstacle.clearance || 0) - distance(position, nearest),
        );
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const minimum = source.compartment.minimum[axis] + source.compartment.clearance + radius;
        const maximum = source.compartment.maximum[axis] - source.compartment.clearance - radius;
        compartmentEscape = Math.max(
          compartmentEscape,
          minimum - position[axis],
          position[axis] - maximum,
        );
      }
    }
  }
  skeletalPenetration = Math.max(0, skeletalPenetration);
  compartmentEscape = Math.max(0, compartmentEscape);
  violationSquared += skeletalPenetration ** 2 + compartmentEscape ** 2;
  maximumResidual = Math.max(maximumResidual, skeletalPenetration, compartmentEscape);
  return { violationSquared, maximumResidual };
}

function validateConfig(requestedConfig) {
  if (!requestedConfig || Object.keys(requestedConfig).length === 0) {
    throw new Error('joint reference requestedConfig must be an exact explicit contract');
  }
  if (JSON.stringify(Object.keys(requestedConfig).sort()) !== JSON.stringify(CONFIG_KEYS)) {
    throw new Error(`joint reference requestedConfig requires exact keys: ${CONFIG_KEYS.join(', ')}`);
  }
  if (requestedConfig.algorithm !== ALGORITHM) {
    throw new Error(`joint reference algorithm must be ${ALGORITHM}`);
  }
  if (requestedConfig.translationBasis !== TRANSLATION_BASIS) {
    throw new Error(`joint reference translationBasis must be ${TRANSLATION_BASIS}`);
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('joint reference candidateEnumeration must be canonical or reverse');
  }
  if (
    !Number.isFinite(requestedConfig.hardTolerance) ||
    requestedConfig.hardTolerance <= 0
  ) {
    throw new Error('joint reference hardTolerance must be positive and finite');
  }
  if (
    !Array.isArray(requestedConfig.penaltySchedule) ||
    requestedConfig.penaltySchedule.length === 0 ||
    !requestedConfig.penaltySchedule.every(value => Number.isFinite(value) && value > 0) ||
    requestedConfig.penaltySchedule.some(
      (value, index) => index > 0 && value <= requestedConfig.penaltySchedule[index - 1],
    )
  ) {
    throw new Error('joint reference penaltySchedule must be a strictly increasing positive array');
  }
  if (
    !Array.isArray(requestedConfig.stepSchedule) ||
    requestedConfig.stepSchedule.length === 0 ||
    !requestedConfig.stepSchedule.every(value => Number.isFinite(value) && value > 0) ||
    requestedConfig.stepSchedule.some(
      (value, index) => index > 0 && value >= requestedConfig.stepSchedule[index - 1],
    )
  ) {
    throw new Error('joint reference stepSchedule must be a strictly decreasing positive array');
  }
  if (JSON.stringify(requestedConfig.startFamily) !== JSON.stringify(START_FAMILY)) {
    throw new Error('joint reference startFamily must name the exact declared multistart family');
  }
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) {
    throw new Error('joint reference translationBounds must be an ordered finite pair');
  }
}

function validateFixture(fixture) {
  if (fixture?.schema !== NBODY_PACKING_ASSAY_FIXTURE_SCHEMA) {
    throw new Error(`joint reference fixture schema mismatch: ${fixture?.schema || 'missing'}`);
  }
  validateNBodyPackingAssayFixture(fixture);
  if (
    !fixture.identity?.sha256 ||
    fixture.input?.requested?.sha256 !== fixture.identity.sha256 ||
    fixture.input?.effective?.sha256 !== fixture.identity.sha256
  ) {
    throw new Error('joint reference fixture identity mismatch');
  }
  // The assay core owns full physical and receipt validation. Running the counterfeit
  // is deliberately avoided here; recomputation below still makes stale geometry loud.
  measureMuscleCompartmentPacking(fixture.knownFeasible);
  measureMuscleCompartmentPacking(fixture.crowded);
}

export function createNBodyRosetteJointReferenceConfig() {
  return {
    algorithm:ALGORITHM,
    candidateEnumeration:'canonical',
    hardTolerance:1e-7,
    penaltySchedule:[...PENALTY_SCHEDULE],
    startFamily:[...START_FAMILY],
    stepSchedule:[...STEP_SCHEDULE],
    translationBounds:[-0.3, 0.3],
    translationBasis:TRANSLATION_BASIS,
  };
}

function instantiateState(fixture, vector) {
  const muscles = structuredClone(fixture.crowded.muscles);
  if (vector.length !== muscles.length * 2) {
    throw new Error(`joint reference translation vector must contain ${muscles.length * 2} values`);
  }
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const translationX = vector[muscleIndex * 2];
    const translationZ = vector[muscleIndex * 2 + 1];
    const finalIndex = muscle.centerline.length - 1;
    for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
      const envelope = Math.sin(Math.PI * knotIndex / finalIndex);
      muscle.centerline[knotIndex].position[0] += translationX * envelope;
      muscle.centerline[knotIndex].position[2] += translationZ * envelope;
    }
    restoreTargetVolume(muscle);
  }
  return muscles;
}

function deformationEnergy(vector) {
  return rounded(vector.reduce((sum, value) => sum + 0.5 * value ** 2, 0), 15);
}

function physicalViolationSquared(metrics, belt) {
  const beltSquared = belt.pairs.reduce(
    (sum, pair) => sum + pair.penetration ** 2,
    0,
  );
  return beltSquared +
    metrics.skeletalPenetration ** 2 +
    metrics.compartmentEscape ** 2 +
    metrics.endpointDrift ** 2 +
    metrics.maximumRelativeVolumeError ** 2;
}

function maximumPhysicalResidual(metrics, belt) {
  return Math.max(
    belt.maximumPenetration,
    metrics.pairwisePenetration,
    metrics.skeletalPenetration,
    metrics.compartmentEscape,
    metrics.endpointDrift,
    metrics.maximumRelativeVolumeError,
  );
}

function createEvaluator(fixture) {
  let evaluationCount = 0;
  return {
    evaluate(vector, penalty) {
      const vectorKey = canonicalVectorKey(vector);
      const searchState = measureAnalyticSearchState(fixture.crowded, vector);
      const physical = {
        vector:[...vector],
        vectorKey,
        deformationEnergy:deformationEnergy(vector),
        physicalViolationSquared:searchState.violationSquared,
        maximumPhysicalResidual:searchState.maximumResidual,
      };
      evaluationCount += 1;
      return {
        ...physical,
        augmentedObjective:physical.deformationEnergy +
          penalty * physical.physicalViolationSquared,
      };
    },
    get evaluationCount() { return evaluationCount; },
  };
}

function knownFeasibleVector(fixture) {
  const knownById = new Map(fixture.knownFeasible.muscles.map(muscle => [muscle.id, muscle]));
  return fixture.crowded.muscles.flatMap(crowdedMuscle => {
    const knownMuscle = knownById.get(crowdedMuscle.id);
    const values = [0, 2].map(axis => {
      let numerator = 0;
      let denominator = 0;
      const finalIndex = crowdedMuscle.centerline.length - 1;
      for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
        const envelope = Math.sin(Math.PI * knotIndex / finalIndex);
        numerator += envelope * (
          knownMuscle.centerline[knotIndex].position[axis] -
          crowdedMuscle.centerline[knotIndex].position[axis]
        );
        denominator += envelope ** 2;
      }
      return rounded(numerator / denominator, 15);
    });
    return values;
  });
}

function startVector(fixture, name) {
  const size = fixture.crowded.muscles.length * 2;
  if (name === 'crowded-zero') return Array(size).fill(0);
  if (name === 'known-feasible-continuation') return knownFeasibleVector(fixture);
  if (name === 'balanced-radial-relief') {
    const directions = new Map([
      ['rosette-west', [-0.04, 0]],
      ['rosette-center', [0.015, 0]],
      ['rosette-east', [0.04, 0]],
      ['rosette-north', [0, 0.04]],
      ['rosette-south', [0, -0.04]],
    ]);
    return fixture.crowded.muscles.flatMap(muscle => directions.get(muscle.id) || [0, 0]);
  }
  throw new Error(`unknown joint reference start ${name}`);
}

function boundedCandidate(vector, index, delta, bounds) {
  const candidate = [...vector];
  candidate[index] = rounded(candidate[index] + delta, 15);
  if (candidate[index] < bounds[0] || candidate[index] > bounds[1]) return null;
  return candidate;
}

function materializeCandidate(fixture, vector, penalty) {
  const evaluator = createEvaluator(fixture);
  const searchFinal = evaluator.evaluate(vector, penalty);
  const muscles = instantiateState(fixture, vector);
  const metrics = measureMuscleCompartmentPacking(fixture.crowded, muscles);
  const belt = measureBelt(muscles);
  return {
    ...searchFinal,
    muscles,
    metrics,
    belt,
    physicalViolationSquared:physicalViolationSquared(metrics, belt),
    maximumPhysicalResidual:maximumPhysicalResidual(metrics, belt),
  };
}

function optimizeStart(fixture, config, startName) {
  const evaluator = createEvaluator(fixture);
  let vector = startVector(fixture, startName);
  const stages = [];
  for (const penalty of config.penaltySchedule) {
    let current = evaluator.evaluate(vector, penalty);
    const stepRows = [];
    for (const step of config.stepSchedule) {
      let acceptedMoves = 0;
      while (true) {
        const indices = Array.from({ length:vector.length }, (_, index) => index);
        if (config.candidateEnumeration === 'reverse') indices.reverse();
        const neighbors = [];
        for (const index of indices) {
          for (const direction of config.candidateEnumeration === 'reverse' ? [-1, 1] : [1, -1]) {
            const candidateVector = boundedCandidate(
              vector,
              index,
              direction * step,
              config.translationBounds,
            );
            if (candidateVector) neighbors.push(evaluator.evaluate(candidateVector, penalty));
          }
        }
        neighbors.sort(compareCandidates);
        const best = neighbors[0];
        if (!best || !(best.augmentedObjective < current.augmentedObjective - 1e-18)) break;
        vector = [...best.vector];
        current = best;
        acceptedMoves += 1;
      }
      stepRows.push({
        step,
        acceptedMoves,
        augmentedObjective:rounded(current.augmentedObjective, 15),
        deformationEnergy:current.deformationEnergy,
        maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
      });
    }
    stages.push({
      penalty,
      steps:stepRows,
      augmentedObjective:rounded(current.augmentedObjective, 15),
      deformationEnergy:current.deformationEnergy,
      maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
      vector:[...vector],
    });
  }
  const final = materializeCandidate(
    fixture,
    vector,
    config.penaltySchedule.at(-1),
  );
  return {
    startName,
    final,
    stages,
    evaluationCount:evaluator.evaluationCount,
  };
}

function solveLinearSystem(matrix, rhs) {
  const size = rhs.length;
  if (size === 0) return [];
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const pivotValue = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map(row => row[size]);
}

function rawPhysicalConstraintRows(fixture, vector) {
  const muscles = instantiateState(fixture, vector);
  const segmentPairs = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [1, 2],
    [2, 1],
    [2, 3],
    [3, 2],
  ];
  const continuousPairs = [];
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const left = muscles[leftIndex];
      const right = muscles[rightIndex];
      let signedGap = Infinity;
      let controllingSegments = null;
      for (const [leftSegment, rightSegment] of segmentPairs) {
        const candidateGap = taperedSegmentSurfaceMinimum(
          left.centerline[leftSegment],
          left.centerline[leftSegment + 1],
          right.centerline[rightSegment],
          right.centerline[rightSegment + 1],
        ).gap;
        if (candidateGap < signedGap) {
          signedGap = candidateGap;
          controllingSegments = [leftSegment, rightSegment];
        }
      }
      continuousPairs.push({
        key:`${left.id}|${right.id}`,
        members:[left.id, right.id],
        signedGap,
        controllingSegments,
      });
    }
  }
  const rows = continuousPairs.map(row => ({
    key:`pair:${row.key}`,
    kind:'pairwise-clearance',
    pairKey:row.key,
    members:[...row.members],
    signedGap:row.signedGap,
    controllingSegments:[...row.controllingSegments],
  }));
  for (const muscle of muscles) {
    for (const [knotIndex, knot] of muscle.centerline.entries()) {
      for (const obstacle of fixture.crowded.obstacles) {
        const nearest = closestPointOnObstacle(knot.position, obstacle);
        rows.push({
          key:`skeletal:${muscle.id}:${knotIndex}:${obstacle.id}`,
          kind:'skeletal-clearance',
          muscleId:muscle.id,
          knotIndex,
          obstacleId:obstacle.id,
          signedGap:distance(knot.position, nearest) - knot.radius - obstacle.radius -
            (obstacle.clearance || 0),
        });
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const minimum = fixture.crowded.compartment.minimum[axis] +
          fixture.crowded.compartment.clearance + knot.radius;
        const maximum = fixture.crowded.compartment.maximum[axis] -
          fixture.crowded.compartment.clearance - knot.radius;
        rows.push({
          key:`compartment-lower:${muscle.id}:${knotIndex}:${axis}`,
          kind:'compartment-clearance',
          side:'lower',
          muscleId:muscle.id,
          knotIndex,
          axis,
          signedGap:knot.position[axis] - minimum,
        });
        rows.push({
          key:`compartment-upper:${muscle.id}:${knotIndex}:${axis}`,
          kind:'compartment-clearance',
          side:'upper',
          muscleId:muscle.id,
          knotIndex,
          axis,
          signedGap:maximum - knot.position[axis],
        });
      }
    }
  }
  return rows;
}

function rawPhysicalConstraintByKey(fixture, vector) {
  return Object.fromEntries(
    rawPhysicalConstraintRows(fixture, vector).map(row => [row.key, row]),
  );
}

function activeGapLinearization(fixture, vector, constraintKeys, finiteDifferenceStep) {
  const currentByKey = rawPhysicalConstraintByKey(fixture, vector);
  const gradients = constraintKeys.map(() => Array(vector.length).fill(0));
  for (let axis = 0; axis < vector.length; axis += 1) {
    const positive = [...vector];
    const negative = [...vector];
    positive[axis] += finiteDifferenceStep;
    negative[axis] -= finiteDifferenceStep;
    const positiveByKey = rawPhysicalConstraintByKey(fixture, positive);
    const negativeByKey = rawPhysicalConstraintByKey(fixture, negative);
    for (let row = 0; row < constraintKeys.length; row += 1) {
      gradients[row][axis] = (
        positiveByKey[constraintKeys[row]].signedGap -
        negativeByKey[constraintKeys[row]].signedGap
      ) / (2 * finiteDifferenceStep);
    }
  }
  return {
    gaps:constraintKeys.map(key => currentByKey[key].signedGap),
    gradients,
  };
}

function refineStationaryCandidate(fixture, initialVector, config) {
  const activeThreshold = Math.max(5e-4, config.hardTolerance * 100);
  const finiteDifferenceStep = 1e-6;
  const convergenceTolerance = Math.min(5e-8, config.hardTolerance / 2);
  let vector = [...initialVector];
  const seen = new Set();
  const rows = [];
  while (true) {
    const vectorKey = canonicalVectorKey(vector);
    if (seen.has(vectorKey)) {
      throw new Error(
        'joint reference stationarity refinement cycled before convergence: ' +
        JSON.stringify(rows.slice(-2)),
      );
    }
    seen.add(vectorKey);
    const constraints = rawPhysicalConstraintRows(fixture, vector);
    const active = constraints.filter(row => row.signedGap <= activeThreshold);
    if (active.length === 0) {
      throw new Error('joint reference stationarity refinement found no active contact constraints');
    }
    const constraintKeys = active.map(row => row.key);
    const { gaps, gradients } = activeGapLinearization(
      fixture,
      vector,
      constraintKeys,
      finiteDifferenceStep,
    );
    let activeIndices = gradients.map((_, index) => index);
    let multipliers = null;
    while (activeIndices.length > 0) {
      const activeGradients = activeIndices.map(index => gradients[index]);
      const activeGaps = activeIndices.map(index => gaps[index]);
      const gram = activeGradients.map((left, leftIndex) => activeGradients.map(
        (right, rightIndex) => left.reduce(
          (sum, value, axis) => sum + value * right[axis],
          0,
        ) + (leftIndex === rightIndex ? 1e-12 : 0),
      ));
      const rhs = activeGradients.map((gradient, row) =>
        gradient.reduce((sum, value, axis) => sum + value * vector[axis], 0) -
          activeGaps[row]);
      const solution = solveLinearSystem(gram, rhs);
      if (!solution) {
        throw new Error('joint reference stationarity refinement active system is singular');
      }
      const mostNegative = solution.reduce(
        (result, value, index) => value < result.value ? { value, index } : result,
        { value:-1e-10, index:-1 },
      );
      if (mostNegative.index < 0) {
        multipliers = solution;
        break;
      }
      activeIndices.splice(mostNegative.index, 1);
    }
    if (!multipliers || activeIndices.length === 0) {
      throw new Error('joint reference stationarity refinement has no nonnegative active set');
    }
    const activeGradients = activeIndices.map(index => gradients[index]);
    const projected = Array(vector.length).fill(0);
    for (let row = 0; row < activeGradients.length; row += 1) {
      for (let axis = 0; axis < vector.length; axis += 1) {
        projected[axis] += activeGradients[row][axis] * multipliers[row];
      }
    }
    if (projected.some((value, axis) =>
      value < config.translationBounds[0] || value > config.translationBounds[1])) {
      throw new Error('joint reference stationarity refinement escaped translation bounds');
    }
    const projectedMaximumUpdate = Math.max(
      ...projected.map((value, axis) => Math.abs(value - vector[axis])),
    );
    const currentMaximumPenetration = Math.max(
      0,
      ...constraints.map(row => Math.max(0, -row.signedGap)),
    );
    if (
      projectedMaximumUpdate <= convergenceTolerance &&
      currentMaximumPenetration <= config.hardTolerance
    ) {
      rows.push({
        iteration:rows.length + 1,
        activeConstraintKeys:activeIndices.map(index => constraintKeys[index]),
        acceptedLineScale:0,
        maximumUpdate:rounded(projectedMaximumUpdate, 15),
        maximumPenetration:rounded(currentMaximumPenetration, 15),
      });
      break;
    }
    const currentEnergy = deformationEnergy(vector);
    let accepted = null;
    let lineScale = 1;
    while (projectedMaximumUpdate * lineScale > convergenceTolerance / 4) {
      const candidate = projected.map(
        (value, axis) => rounded(vector[axis] + lineScale * (value - vector[axis]), 15),
      );
      const candidateConstraints = rawPhysicalConstraintRows(fixture, candidate);
      const candidateMaximumPenetration = Math.max(
        0,
        ...candidateConstraints.map(row => Math.max(0, -row.signedGap)),
      );
      const candidateEnergy = deformationEnergy(candidate);
      const restoresFeasibility = currentMaximumPenetration > config.hardTolerance &&
        candidateMaximumPenetration < currentMaximumPenetration - 1e-12;
      const improvesFeasibleObjective = currentMaximumPenetration <= config.hardTolerance &&
        candidateMaximumPenetration <= config.hardTolerance &&
        candidateEnergy < currentEnergy - 1e-18;
      if (restoresFeasibility || improvesFeasibleObjective) {
        accepted = {
          vector:candidate,
          lineScale,
          maximumPenetration:candidateMaximumPenetration,
        };
        break;
      }
      lineScale *= 0.5;
    }
    if (!accepted) {
      throw new Error(
        'joint reference stationarity refinement line search stalled: ' +
        JSON.stringify({ currentMaximumPenetration, projectedMaximumUpdate }),
      );
    }
    const maximumUpdate = Math.max(
      ...accepted.vector.map((value, axis) => Math.abs(value - vector[axis])),
    );
    rows.push({
      iteration:rows.length + 1,
      activeConstraintKeys:activeIndices.map(index => constraintKeys[index]),
      acceptedLineScale:accepted.lineScale,
      maximumUpdate:rounded(maximumUpdate, 15),
      maximumPenetration:rounded(accepted.maximumPenetration, 15),
    });
    vector = accepted.vector;
    if (
      maximumUpdate <= convergenceTolerance &&
      accepted.maximumPenetration <= config.hardTolerance
    ) break;
  }
  return {
    vector,
    receipt:{
      kind:'iterated-active-gap-tangent-projection',
      finiteDifferenceStep,
      activeConstraintThreshold:activeThreshold,
      convergenceTolerance,
      cycleDetection:'canonical-vector-key-fail-loud',
      iterations:rows.length,
      rows,
    },
  };
}

function stationarityReceipt(fixture, selected, hardTolerance) {
  const vector = selected.vector;
  const finiteDifferenceStep = 1e-6;
  const constraints = rawPhysicalConstraintRows(fixture, vector);
  const activeConstraints = constraints.filter(
    row => row.signedGap <= Math.max(5e-5, hardTolerance * 20),
  );
  const constraintKeys = activeConstraints.map(row => row.key);
  const { gradients } = activeGapLinearization(
    fixture,
    vector,
    constraintKeys,
    finiteDifferenceStep,
  );
  const objectiveGradient = vector.map(value => value);
  let activeIndices = gradients.map((_, index) => index);
  let multipliers = [];
  while (activeIndices.length > 0) {
    const activeGradients = activeIndices.map(index => gradients[index]);
    const gram = activeGradients.map((left, leftIndex) => activeGradients.map((right, rightIndex) =>
      left.reduce((sum, value, axis) => sum + value * right[axis], 0) +
      (leftIndex === rightIndex ? 1e-12 : 0)));
    const rhs = activeGradients.map(gradient =>
      gradient.reduce((sum, value, axis) => sum + value * objectiveGradient[axis], 0));
    const solution = solveLinearSystem(gram, rhs);
    if (!solution) break;
    const mostNegative = solution.reduce(
      (result, value, index) => value < result.value ? { value, index } : result,
      { value:0, index:-1 },
    );
    if (mostNegative.index < 0) {
      multipliers = solution;
      break;
    }
    activeIndices.splice(mostNegative.index, 1);
  }
  const residual = [...objectiveGradient];
  for (let row = 0; row < activeIndices.length; row += 1) {
    const gradient = gradients[activeIndices[row]];
    const multiplier = multipliers[row] || 0;
    for (let axis = 0; axis < residual.length; axis += 1) {
      residual[axis] -= multiplier * gradient[axis];
    }
  }
  return {
    kind:'finite-difference-active-constraint-kkt',
    objective:'minimum-squared-translation-from-crowded-state',
    constraint:'nonnegative-pair-skeletal-and-compartment-clearance',
    finiteDifferenceStep,
    activeConstraintThreshold:Math.max(5e-5, hardTolerance * 20),
    activeConstraintCount:activeIndices.length,
    activeConstraints:activeIndices.map((index, row) => ({
      constraintKey:constraintKeys[index],
      kind:activeConstraints[index].kind,
      pairKey:activeConstraints[index].pairKey || null,
      signedGap:rounded(activeConstraints[index].signedGap, 15),
      multiplier:rounded(multipliers[row] || 0),
    })),
    projectedGradientInfinityNorm:rounded(Math.max(...residual.map(Math.abs))),
    rawObjectiveGradientInfinityNorm:rounded(Math.max(...objectiveGradient.map(Math.abs))),
  };
}

function displacementReceipt(fixture, muscles) {
  const sourceById = new Map(fixture.crowded.muscles.map(muscle => [muscle.id, muscle]));
  const rows = muscles.map(muscle => {
    const sourceMuscle = sourceById.get(muscle.id);
    let maximum = 0;
    let squared = 0;
    for (let index = 0; index < muscle.centerline.length; index += 1) {
      const displacement = distance(
        muscle.centerline[index].position,
        sourceMuscle.centerline[index].position,
      );
      maximum = Math.max(maximum, displacement);
      squared += displacement ** 2;
    }
    return {
      muscleId:muscle.id,
      maximumDisplacement:rounded(maximum),
      rootMeanSquareDisplacement:rounded(Math.sqrt(squared / muscle.centerline.length)),
    };
  });
  const nonDriver = rows.filter(row => row.muscleId !== fixture.crowded.derivation.driverMuscleId);
  return {
    driverMuscleId:fixture.crowded.derivation.driverMuscleId,
    rows,
    movedMemberCount:rows.filter(row => row.maximumDisplacement > 1e-8).length,
    maximumNonDriverDisplacement:rounded(Math.max(...nonDriver.map(row => row.maximumDisplacement))),
  };
}

function solveSingleEnumeration({
  fixture = createNBodyRosetteFixture(),
  requestedConfig,
} = {}) {
  validateConfig(requestedConfig);
  validateFixture(fixture);
  const config = structuredClone(requestedConfig);
  const runs = config.startFamily.map(startName => optimizeStart(fixture, config, startName));
  const patternAdmissible = runs.filter(run =>
    run.final.maximumPhysicalResidual <= config.hardTolerance &&
    run.final.metrics.nonFiniteValueCount === 0 &&
    run.final.metrics.nonPositiveRadiusCount === 0);
  const selectionPool = patternAdmissible.length > 0 ? patternAdmissible : runs;
  selectionPool.sort((left, right) => {
    if (patternAdmissible.length > 0) {
      const energyDifference = left.final.deformationEnergy - right.final.deformationEnergy;
      if (Math.abs(energyDifference) > 1e-15) return energyDifference;
    } else {
      const residualDifference = left.final.maximumPhysicalResidual -
        right.final.maximumPhysicalResidual;
      if (Math.abs(residualDifference) > 1e-15) return residualDifference;
    }
    return left.final.vectorKey.localeCompare(right.final.vectorKey);
  });
  const selectedPatternRun = selectionPool[0];
  const refinement = refineStationaryCandidate(
    fixture,
    selectedPatternRun.final.vector,
    config,
  );
  const selectedFinal = materializeCandidate(
    fixture,
    refinement.vector,
    config.penaltySchedule.at(-1),
  );
  const selected = {
    startName:selectedPatternRun.startName,
    vector:[...selectedFinal.vector],
    muscles:structuredClone(selectedFinal.muscles),
    metrics:structuredClone(selectedFinal.metrics),
    belt:structuredClone(selectedFinal.belt),
    deformationEnergy:selectedFinal.deformationEnergy,
    physicalViolationSquared:rounded(selectedFinal.physicalViolationSquared, 15),
    maximumPhysicalResidual:rounded(selectedFinal.maximumPhysicalResidual, 15),
  };
  selected.physicalStateSha256 = hashMusclePackingCanonicalJson({
    muscles:selected.muscles,
    metrics:selected.metrics,
    belt:selected.belt,
  });
  const stationarity = stationarityReceipt(fixture, selected, config.hardTolerance);
  const distantResponse = displacementReceipt(fixture, selected.muscles);
  const selectedAdmissible = selected.maximumPhysicalResidual <= config.hardTolerance &&
    selected.metrics.nonFiniteValueCount === 0 &&
    selected.metrics.nonPositiveRadiusCount === 0;
  const status = selectedAdmissible &&
    stationarity.projectedGradientInfinityNorm <= 5e-5
    ? 'converged-joint-reference'
    : selectedAdmissible
      ? 'feasible-stationarity-residual'
      : 'reference-physical-residual';
  const core = {
    schema:NBODY_PACKING_JOINT_REFERENCE_RESULT_SCHEMA,
    status,
    fixture: {
      id:fixture.id,
      schema:fixture.schema,
      sha256:fixture.identity.sha256,
      input:structuredClone(fixture.input),
    },
    config: {
      requested:structuredClone(requestedConfig),
      effective:config,
      fallbackUsed:false,
    },
    reference: {
      algorithm:config.algorithm,
      translationBasis:config.translationBasis,
      sharedIterationState:true,
      candidateSelection:'all-axis-neighbors-evaluated-from-one-snapshot-then-global-best',
      stationaritySelection:'refine-once-after-physically-admissible-multistart-selection',
      physicalResidualSeparatedFromAugmentedObjective:true,
      innerLoopMeasure:'exact-belt-plus-knot-sampled-obstacle-and-compartment',
      finalAdmissionMeasure:'conservative-continuous-piecewise-linear-on-selected-candidate',
      claimCeiling:'bounded-synthetic-reference-only',
    },
    selected,
    stationarity,
    stationarityRefinement:refinement.receipt,
    distantResponse,
    multistart: {
      declaredStartFamily:[...config.startFamily],
      admissibleCount:patternAdmissible.length,
      rows:runs.map(run => ({
        startName:run.startName,
        completed:true,
        fallbackUsed:false,
        evaluationCount:run.evaluationCount,
        status:run.final.maximumPhysicalResidual <= config.hardTolerance
          ? 'physically-admissible'
          : 'physical-residual',
        maximumPhysicalResidual:rounded(run.final.maximumPhysicalResidual, 15),
        deformationEnergy:run.final.deformationEnergy,
        physicalViolationSquared:rounded(run.final.physicalViolationSquared, 15),
        physicalStateSha256:hashMusclePackingCanonicalJson({
          muscles:run.final.muscles,
          metrics:run.final.metrics,
          belt:run.final.belt,
        }),
        stationarityRefinement:{
          status:run === selectedPatternRun
            ? 'selected-for-post-multistart-refinement'
            : 'not-run-after-global-selection',
        },
        continuation:run.stages,
      })),
    },
  };
  return core;
}

function candidateEnumerationRow(result) {
  return {
    requestedConfig:structuredClone(result.config.requested),
    effectiveConfig:structuredClone(result.config.effective),
    fallbackUsed:result.config.fallbackUsed,
    status:result.status,
    selectedVector:[...result.selected.vector],
    selectedPhysicalStateSha256:result.selected.physicalStateSha256,
    selectedMetricsSha256:hashMusclePackingCanonicalJson(result.selected.metrics),
    selectedBeltSha256:hashMusclePackingCanonicalJson(result.selected.belt),
  };
}

export function solveNBodyRosetteJointReference({
  fixture = createNBodyRosetteFixture(),
  requestedConfig,
} = {}) {
  validateConfig(requestedConfig);
  validateFixture(fixture);
  const primary = solveSingleEnumeration({ fixture, requestedConfig });
  const alternateConfig = {
    ...structuredClone(requestedConfig),
    candidateEnumeration:requestedConfig.candidateEnumeration === 'canonical'
      ? 'reverse'
      : 'canonical',
  };
  const alternate = solveSingleEnumeration({ fixture, requestedConfig:alternateConfig });
  const primaryRow = candidateEnumerationRow(primary);
  const alternateRow = candidateEnumerationRow(alternate);
  const comparison = {
    selectedVectorEqual:canonicalVectorKey(primaryRow.selectedVector) ===
      canonicalVectorKey(alternateRow.selectedVector),
    selectedPhysicalStateEqual:primaryRow.selectedPhysicalStateSha256 ===
      alternateRow.selectedPhysicalStateSha256,
    selectedMetricsEqual:primaryRow.selectedMetricsSha256 ===
      alternateRow.selectedMetricsSha256,
    selectedBeltEqual:primaryRow.selectedBeltSha256 === alternateRow.selectedBeltSha256,
  };
  const passed = Object.values(comparison).every(Boolean);
  const core = {
    ...primary,
    status:passed ? primary.status : 'candidate-enumeration-order-dependent',
    invariance: {
      candidateEnumeration:passed ? 'passed' : 'failed-order-dependent',
      mechanism:'paired-full-solve-artifact-comparison',
      rows:[primaryRow, alternateRow],
      comparison,
      labelPermutation:'not-yet-assayed',
    },
  };
  return {
    ...core,
    identity:{ sha256:hashMusclePackingCanonicalJson(core) },
  };
}
