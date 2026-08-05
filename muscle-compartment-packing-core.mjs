import { createHash } from 'node:crypto';

export const MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA =
  'kaminos.muscle-compartment-packing-source.v0';
export const MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA =
  'kaminos.muscle-compartment-packing-result.v0';
export const SOURCE_SHAPED_PACKING_PERTURBATION_SERIES_SCHEMA =
  'kaminos.source-shaped-muscle-packing-perturbation-series.v0';
export const SOURCE_SHAPED_PACKING_PERTURBATION_RESULT_SCHEMA =
  'kaminos.source-shaped-muscle-packing-perturbation-result.v0';
export const VOLUME_PRESERVING_TAPERED_BELLY_PROFILE =
  'volume-preserving-tapered-belly.v0';
export const ENDPOINT_TAPERED_PACKING_SOURCE_DERIVATION_SCHEMA =
  'kaminos.endpoint-tapered-packing-source-derivation.v0';

const DEFAULT_CONFIG = Object.freeze({
  maxIterations: 640,
  relaxationStep: 0.18,
  smoothnessStep: 0.035,
  sampleCount: 25,
  convergenceTolerance: 1e-7,
  maximumSourceBendEnergyRatio: 1.05,
  minimumSourceCurvatureCosine: 0.3,
  minimumSourceTangentCosine: 0,
});

const CORRECTION_ATTRIBUTION_SCHEMA =
  'kaminos.muscle-compartment-packing-correction-attribution.v0';
const CORRECTION_CATEGORIES = Object.freeze([
  'sourceSmoothing',
  'formationConstraint',
  'skeletalClearance',
  'pairwiseExclusion',
  'compartmentProjection',
  'volumeRestoration',
]);

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function rounded(value, digits = 12) {
  const result = Number(value.toFixed(digits));
  return Object.is(result, -0) ? 0 : result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function hashMusclePackingCanonicalJson(value) {
  return hashJson(value);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function rotateAroundAxis(vector, axis, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function length(vector) {
  return Math.hypot(...vector);
}

function distance(left, right) {
  return length(subtract(left, right));
}

function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requirePoint(value, label) {
  if (!isFinitePoint(value)) throw new Error(`${label} must be a finite 3D point`);
}

function samePoint(left, right) {
  return left.every((value, index) => value === right[index]);
}

function deterministicDirection(leftIndex, rightIndex = 0) {
  const angle = (leftIndex * 2.399963229728653 + rightIndex * 0.7548776662466927) %
    (Math.PI * 2);
  const y = ((leftIndex + rightIndex) % 3 - 1) * 0.13;
  const vector = [Math.cos(angle), y, Math.sin(angle)];
  return scale(vector, 1 / length(vector));
}

function normalizedOrFallback(vector, leftIndex, rightIndex = 0) {
  const magnitude = length(vector);
  return magnitude > 1e-12
    ? scale(vector, 1 / magnitude)
    : deterministicDirection(leftIndex, rightIndex);
}

function closestPointOnSegment(point, start, end) {
  const direction = subtract(end, start);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= 1e-24) return [...start];
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), direction) / lengthSquared));
  return add(start, scale(direction, t));
}

function closestSegmentParameters(leftStart, leftEnd, rightStart, rightEnd) {
  const leftDirection = subtract(leftEnd, leftStart);
  const rightDirection = subtract(rightEnd, rightStart);
  const startOffset = subtract(leftStart, rightStart);
  const leftLengthSquared = dot(leftDirection, leftDirection);
  const rightLengthSquared = dot(rightDirection, rightDirection);
  const directionDot = dot(leftDirection, rightDirection);
  const leftOffsetDot = dot(leftDirection, startOffset);
  const rightOffsetDot = dot(rightDirection, startOffset);
  const denominator = leftLengthSquared * rightLengthSquared - directionDot ** 2;
  let leftNumerator;
  let leftDenominator = denominator;
  let rightNumerator;
  let rightDenominator = denominator;

  if (denominator < 1e-24) {
    leftNumerator = 0;
    leftDenominator = 1;
    rightNumerator = rightOffsetDot;
    rightDenominator = rightLengthSquared;
  } else {
    leftNumerator = directionDot * rightOffsetDot - rightLengthSquared * leftOffsetDot;
    rightNumerator = leftLengthSquared * rightOffsetDot - directionDot * leftOffsetDot;
    if (leftNumerator < 0) {
      leftNumerator = 0;
      rightNumerator = rightOffsetDot;
      rightDenominator = rightLengthSquared;
    } else if (leftNumerator > leftDenominator) {
      leftNumerator = leftDenominator;
      rightNumerator = rightOffsetDot + directionDot;
      rightDenominator = rightLengthSquared;
    }
  }

  if (rightNumerator < 0) {
    rightNumerator = 0;
    leftNumerator = Math.max(0, Math.min(leftDenominator, -leftOffsetDot));
    leftDenominator = leftLengthSquared;
  } else if (rightNumerator > rightDenominator) {
    rightNumerator = rightDenominator;
    leftNumerator = Math.max(
      0,
      Math.min(leftLengthSquared, directionDot - leftOffsetDot),
    );
    leftDenominator = leftLengthSquared;
  }

  return {
    leftT:leftDenominator <= 1e-24 ? 0 : leftNumerator / leftDenominator,
    rightT:rightDenominator <= 1e-24 ? 0 : rightNumerator / rightDenominator,
  };
}

function interpolate(left, right, amount) {
  return left * (1 - amount) + right * amount;
}

function interpolatePoint(left, right, amount) {
  return left.map((value, axis) => interpolate(value, right[axis], amount));
}

function goldenSectionMinimum(fn, iterations = 48) {
  const inversePhi = (Math.sqrt(5) - 1) / 2;
  let lower = 0;
  let upper = 1;
  let left = upper - inversePhi * (upper - lower);
  let right = lower + inversePhi * (upper - lower);
  let leftValue = fn(left);
  let rightValue = fn(right);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (leftValue <= rightValue) {
      upper = right;
      right = left;
      rightValue = leftValue;
      left = upper - inversePhi * (upper - lower);
      leftValue = fn(left);
    } else {
      lower = left;
      left = right;
      leftValue = rightValue;
      right = lower + inversePhi * (upper - lower);
      rightValue = fn(right);
    }
  }
  const midpoint = (lower + upper) / 2;
  const candidates = [
    { parameter:0, value:fn(0) },
    { parameter:1, value:fn(1) },
    { parameter:left, value:leftValue },
    { parameter:right, value:rightValue },
    { parameter:midpoint, value:fn(midpoint) },
  ];
  const minimum = candidates.reduce((best, candidate) =>
    candidate.value < best.value ? candidate : best);
  return { ...minimum, intervalWidth:upper - lower };
}

function taperedSegmentSurfaceMinimum(
  leftStart,
  leftEnd,
  rightStart,
  rightEnd,
) {
  // This cheap contact estimate guides projection only. Convergence still
  // depends on the conservative nested-search lower bound in measureState.
  const gapAt = (leftT, rightT) => distance(
    interpolatePoint(leftStart.position, leftEnd.position, leftT),
    interpolatePoint(rightStart.position, rightEnd.position, rightT),
  ) - interpolate(leftStart.radius, leftEnd.radius, leftT) -
    interpolate(rightStart.radius, rightEnd.radius, rightT);
  let { leftT, rightT } = closestSegmentParameters(
    leftStart.position,
    leftEnd.position,
    rightStart.position,
    rightEnd.position,
  );
  for (let round = 0; round < 3; round += 1) {
    leftT = goldenSectionMinimum(candidate => gapAt(candidate, rightT), 16).parameter;
    rightT = goldenSectionMinimum(candidate => gapAt(leftT, candidate), 16).parameter;
  }
  return { leftT, rightT, gap:gapAt(leftT, rightT) };
}

function taperedSegmentSurfaceGapLowerBound(leftStart, leftEnd, rightStart, rightEnd) {
  const gapAt = (leftT, rightT) => distance(
    interpolatePoint(leftStart.position, leftEnd.position, leftT),
    interpolatePoint(rightStart.position, rightEnd.position, rightT),
  ) - interpolate(leftStart.radius, leftEnd.radius, leftT) -
    interpolate(rightStart.radius, rightEnd.radius, rightT);
  const outer = goldenSectionMinimum(leftT =>
    goldenSectionMinimum(rightT => gapAt(leftT, rightT)).value);
  const lipschitzBound =
    distance(leftStart.position, leftEnd.position) +
    Math.abs(leftEnd.radius - leftStart.radius) +
    distance(rightStart.position, rightEnd.position) +
    Math.abs(rightEnd.radius - rightStart.radius);
  // The nested convex minimization is deterministic. Subtracting the final
  // interval's Lipschitz error makes the reported gap conservative at the
  // numerical search resolution instead of rounding a narrow collision away.
  return outer.value - lipschitzBound * outer.intervalWidth * 2;
}

function closestPointOnObstacle(point, obstacle) {
  if (obstacle.kind === 'sphere') return [...obstacle.center];
  if (obstacle.kind === 'capsule') {
    return closestPointOnSegment(point, obstacle.start, obstacle.end);
  }
  throw new Error(`unsupported muscle packing obstacle kind: ${obstacle.kind}`);
}

function obstacleRadius(obstacle) {
  return obstacle.radius + (obstacle.clearance || 0);
}

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const segmentLength = distance(start.position, end.position);
    volume += Math.PI * segmentLength / 3 * (
      start.radius ** 2 + start.radius * end.radius + end.radius ** 2
    );
  }
  return volume;
}

function resolveSourceShapedShapeProfile(shapeProfileId) {
  if (shapeProfileId === undefined || shapeProfileId === null) return null;
  if (shapeProfileId !== VOLUME_PRESERVING_TAPERED_BELLY_PROFILE) {
    throw new Error(`source-shaped packing shape profile is unsupported: ${shapeProfileId}`);
  }
  return {
    requested: { id: shapeProfileId },
    effective: {
      id: shapeProfileId,
      authority: 'agent-authored-provisional',
      parameterization: 'normalized-candidate-centerline-arc-length',
      endpointRadiusFraction: 0.32,
      bellyExponent: 0.8,
      volumePolicy: 'global-radius-scale-to-measured-candidate-target-volume',
    },
  };
}

function applySourceShapedShapeProfile(centerline, targetVolume, shapeProfile) {
  if (!shapeProfile) return centerline;
  if (shapeProfile.effective.id !== VOLUME_PRESERVING_TAPERED_BELLY_PROFILE) {
    throw new Error(`source-shaped packing shape profile is unsupported: ${shapeProfile.effective.id}`);
  }
  const cumulativeLengths = [0];
  for (let index = 1; index < centerline.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1] +
      distance(centerline[index - 1].position, centerline[index].position),
    );
  }
  const totalLength = cumulativeLengths.at(-1);
  if (!(totalLength > 0)) throw new Error('tapered belly profile requires a nonzero centerline length');
  const { endpointRadiusFraction, bellyExponent } = shapeProfile.effective;
  const profiled = centerline.map((knot, index) => {
    const pathT = cumulativeLengths[index] / totalLength;
    const bellyWeight = Math.sin(Math.PI * pathT) ** bellyExponent;
    return {
      position: [...knot.position],
      radius: endpointRadiusFraction + (1 - endpointRadiusFraction) * bellyWeight,
    };
  });
  const unscaledVolume = carrierVolume(profiled);
  if (!(unscaledVolume > 0)) throw new Error('tapered belly profile produced a nonpositive carrier volume');
  const radiusScale = Math.sqrt(targetVolume / unscaledVolume);
  for (const knot of profiled) knot.radius *= radiusScale;
  return profiled;
}

function sampleCarrier(muscle, count) {
  const segmentCount = muscle.centerline.length - 1;
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const pathT = count === 1 ? 0 : index / (count - 1);
    const segmentPosition = Math.min(pathT * segmentCount, segmentCount - Number.EPSILON);
    const segmentIndex = Math.min(Math.floor(segmentPosition), segmentCount - 1);
    const localT = pathT === 1 ? 1 : segmentPosition - segmentIndex;
    const start = muscle.centerline[segmentIndex];
    const end = muscle.centerline[segmentIndex + 1];
    samples.push({
      pathT: rounded(pathT),
      position: start.position.map((value, axis) =>
        value * (1 - localT) + end.position[axis] * localT),
      radius: start.radius * (1 - localT) + end.radius * localT,
    });
  }
  return samples;
}

function bendEnergy(muscle) {
  let energy = 0;
  for (let index = 1; index < muscle.centerline.length - 1; index += 1) {
    const previous = muscle.centerline[index - 1].position;
    const current = muscle.centerline[index].position;
    const next = muscle.centerline[index + 1].position;
    const secondDifference = add(previous, subtract(next, scale(current, 2)));
    energy += dot(secondDifference, secondDifference);
  }
  return energy;
}

function centerlineSecondDifference(centerline, index) {
  const previous = centerline[index - 1].position;
  const current = centerline[index].position;
  const next = centerline[index + 1].position;
  return add(previous, subtract(next, scale(current, 2)));
}

function measureSourceRelationshipRetention(source, muscles) {
  let maximumSourceKnotDisplacement = 0;
  let squaredDisplacementSum = 0;
  let displacementCount = 0;
  let minimumPairwiseRelationCosine = 1;
  let pairwiseRelationReversalCount = 0;
  let minimumSourceBendEnergyRetention = 1;
  let minimumSourceCurvatureCosine = 1;
  let sourceCurvatureReversalCount = 0;
  let minimumSourceTangentCosine = 1;
  let sourceTangentReversalCount = 0;
  let maximumSourceRadiusRatio = 1;
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceMuscle = source.muscles[muscleIndex];
    for (const [knotIndex, knot] of muscle.centerline.entries()) {
      const displacement = distance(knot.position, sourceMuscle.centerline[knotIndex].position);
      if (!Number.isFinite(displacement)) continue;
      maximumSourceKnotDisplacement = Math.max(maximumSourceKnotDisplacement, displacement);
      squaredDisplacementSum += displacement ** 2;
      displacementCount += 1;
      const sourceRadius = sourceMuscle.centerline[knotIndex].radius;
      if (knot.radius > 0 && sourceRadius > 0) {
        maximumSourceRadiusRatio = Math.max(
          maximumSourceRadiusRatio,
          knot.radius / sourceRadius,
          sourceRadius / knot.radius,
        );
      }
    }
    const sourceBendEnergy = bendEnergy(sourceMuscle);
    const packedBendEnergy = bendEnergy(muscle);
    if (sourceBendEnergy > 1e-12 && Number.isFinite(packedBendEnergy)) {
      minimumSourceBendEnergyRetention = Math.min(
        minimumSourceBendEnergyRetention,
        packedBendEnergy / sourceBendEnergy,
      );
    }
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const sourceCurvature = centerlineSecondDifference(sourceMuscle.centerline, knotIndex);
      const packedCurvature = centerlineSecondDifference(muscle.centerline, knotIndex);
      const sourceMagnitude = length(sourceCurvature);
      const packedMagnitude = length(packedCurvature);
      if (!(sourceMagnitude > 1e-12)) continue;
      const cosine = packedMagnitude > 1e-12
        ? Math.max(-1, Math.min(
          1,
          dot(sourceCurvature, packedCurvature) / (sourceMagnitude * packedMagnitude),
        ))
        : 0;
      if (!Number.isFinite(cosine)) continue;
      minimumSourceCurvatureCosine = Math.min(minimumSourceCurvatureCosine, cosine);
      if (cosine < 0) sourceCurvatureReversalCount += 1;
    }
    for (let knotIndex = 0; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const sourceTangent = subtract(
        sourceMuscle.centerline[knotIndex + 1].position,
        sourceMuscle.centerline[knotIndex].position,
      );
      const packedTangent = subtract(
        muscle.centerline[knotIndex + 1].position,
        muscle.centerline[knotIndex].position,
      );
      const sourceMagnitude = length(sourceTangent);
      const packedMagnitude = length(packedTangent);
      if (!(sourceMagnitude > 1e-12) || !(packedMagnitude > 1e-12)) continue;
      const cosine = Math.max(-1, Math.min(
        1,
        dot(sourceTangent, packedTangent) / (sourceMagnitude * packedMagnitude),
      ));
      if (!Number.isFinite(cosine)) continue;
      minimumSourceTangentCosine = Math.min(minimumSourceTangentCosine, cosine);
      if (cosine < 0) sourceTangentReversalCount += 1;
    }
  }
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      for (let knotIndex = 0; knotIndex < muscles[leftIndex].centerline.length; knotIndex += 1) {
        const sourceOffset = subtract(
          source.muscles[leftIndex].centerline[knotIndex].position,
          source.muscles[rightIndex].centerline[knotIndex].position,
        );
        const packedOffset = subtract(
          muscles[leftIndex].centerline[knotIndex].position,
          muscles[rightIndex].centerline[knotIndex].position,
        );
        const sourceLength = length(sourceOffset);
        const packedLength = length(packedOffset);
        if (!(sourceLength > 1e-12) || !(packedLength > 1e-12)) continue;
        const cosine = Math.max(-1, Math.min(
          1,
          dot(sourceOffset, packedOffset) / (sourceLength * packedLength),
        ));
        if (!Number.isFinite(cosine)) continue;
        minimumPairwiseRelationCosine = Math.min(minimumPairwiseRelationCosine, cosine);
        if (cosine < 0) pairwiseRelationReversalCount += 1;
      }
    }
  }
  return {
    maximumSourceKnotDisplacement: rounded(maximumSourceKnotDisplacement),
    rootMeanSquareSourceKnotDisplacement: rounded(
      displacementCount > 0 ? Math.sqrt(squaredDisplacementSum / displacementCount) : 0,
    ),
    minimumSourceBendEnergyRetention: rounded(minimumSourceBendEnergyRetention),
    minimumSourceCurvatureCosine: rounded(minimumSourceCurvatureCosine),
    sourceCurvatureReversalCount,
    minimumSourceTangentCosine: rounded(minimumSourceTangentCosine),
    sourceTangentReversalCount,
    maximumSourceRadiusRatio: rounded(maximumSourceRadiusRatio),
    minimumPairwiseRelationCosine: rounded(minimumPairwiseRelationCosine),
    pairwiseRelationReversalCount,
  };
}

function measureState(source, muscles, sampleCount, continuousClearance = true) {
  const sampled = muscles.map(muscle => sampleCarrier(muscle, sampleCount));
  let pairwisePenetration = 0;
  for (let leftIndex = 0; leftIndex < sampled.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sampled.length; rightIndex += 1) {
      let pairMaximum = 0;
      for (const left of sampled[leftIndex]) {
        for (const right of sampled[rightIndex]) {
          pairMaximum = Math.max(
            pairMaximum,
            left.radius + right.radius - distance(left.position, right.position),
          );
        }
      }
      if (continuousClearance) {
        const leftMuscle = muscles[leftIndex];
        const rightMuscle = muscles[rightIndex];
        for (let leftSegment = 0; leftSegment < leftMuscle.centerline.length - 1; leftSegment += 1) {
          const leftStart = leftMuscle.centerline[leftSegment];
          const leftEnd = leftMuscle.centerline[leftSegment + 1];
          for (let rightSegment = 0; rightSegment < rightMuscle.centerline.length - 1; rightSegment += 1) {
            const rightStart = rightMuscle.centerline[rightSegment];
            const rightEnd = rightMuscle.centerline[rightSegment + 1];
            pairMaximum = Math.max(
              pairMaximum,
              -taperedSegmentSurfaceGapLowerBound(
                leftStart,
                leftEnd,
                rightStart,
                rightEnd,
              ),
            );
          }
        }
      }
      pairwisePenetration += Math.max(0, pairMaximum);
    }
  }

  let skeletalPenetration = 0;
  let compartmentEscape = 0;
  let endpointDrift = 0;
  let maximumRelativeVolumeError = 0;
  let maximumBendEnergy = 0;
  let nonFiniteValueCount = 0;
  let nonPositiveRadiusCount = 0;
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceMuscle = source.muscles[muscleIndex];
    endpointDrift = Math.max(
      endpointDrift,
      distance(muscle.centerline[0].position, sourceMuscle.attachments.origin.position),
      distance(muscle.centerline.at(-1).position, sourceMuscle.attachments.insertion.position),
    );
    const realizedVolume = carrierVolume(muscle.centerline);
    maximumRelativeVolumeError = Math.max(
      maximumRelativeVolumeError,
      Math.abs(realizedVolume - muscle.targetVolume) / muscle.targetVolume,
    );
    maximumBendEnergy = Math.max(maximumBendEnergy, bendEnergy(muscle));
    for (const knot of muscle.centerline) {
      if (!knot.position.every(Number.isFinite) || !Number.isFinite(knot.radius)) {
        nonFiniteValueCount += 1;
      }
      if (!(knot.radius > 0)) nonPositiveRadiusCount += 1;
    }
    if (continuousClearance) {
      for (let segmentIndex = 0; segmentIndex < muscle.centerline.length - 1; segmentIndex += 1) {
        const segmentStart = muscle.centerline[segmentIndex];
        const segmentEnd = muscle.centerline[segmentIndex + 1];
        for (const obstacle of source.obstacles) {
          const obstacleStart = obstacle.kind === 'capsule'
            ? { position:obstacle.start, radius:obstacleRadius(obstacle) }
            : { position:obstacle.center, radius:obstacleRadius(obstacle) };
          const obstacleEnd = obstacle.kind === 'capsule'
            ? { position:obstacle.end, radius:obstacleRadius(obstacle) }
            : obstacleStart;
          skeletalPenetration = Math.max(
            skeletalPenetration,
            -taperedSegmentSurfaceGapLowerBound(
              segmentStart,
              segmentEnd,
              obstacleStart,
              obstacleEnd,
            ),
          );
        }
      }
    }
    for (const sample of sampled[muscleIndex]) {
      for (const obstacle of source.obstacles) {
        const nearest = closestPointOnObstacle(sample.position, obstacle);
        skeletalPenetration = Math.max(
          skeletalPenetration,
          sample.radius + obstacleRadius(obstacle) - distance(sample.position, nearest),
        );
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const minimum = source.compartment.minimum[axis] +
          source.compartment.clearance + sample.radius;
        const maximum = source.compartment.maximum[axis] -
          source.compartment.clearance - sample.radius;
        compartmentEscape = Math.max(
          compartmentEscape,
          minimum - sample.position[axis],
          sample.position[axis] - maximum,
        );
      }
    }
  }
  return {
    pairwisePenetration: rounded(Math.max(0, pairwisePenetration)),
    skeletalPenetration: rounded(Math.max(0, skeletalPenetration)),
    compartmentEscape: rounded(Math.max(0, compartmentEscape)),
    endpointDrift: rounded(endpointDrift),
    maximumRelativeVolumeError: rounded(maximumRelativeVolumeError),
    maximumBendEnergy: rounded(maximumBendEnergy),
    ...measureSourceRelationshipRetention(source, muscles),
    nonFiniteValueCount,
    nonPositiveRadiusCount,
  };
}

function validateConfig(config) {
  if (!Number.isInteger(config.maxIterations) || config.maxIterations <= 0) {
    throw new Error('muscle packing maxIterations must be a positive integer');
  }
  if (!Number.isInteger(config.sampleCount) || config.sampleCount < 3) {
    throw new Error('muscle packing sampleCount must be an integer of at least 3');
  }
  for (const key of ['relaxationStep', 'smoothnessStep', 'convergenceTolerance']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`muscle packing ${key} must be positive and finite`);
    }
  }
  if (
    !Number.isFinite(config.maximumSourceBendEnergyRatio) ||
    config.maximumSourceBendEnergyRatio < 1
  ) {
    throw new Error('muscle packing maximumSourceBendEnergyRatio must be finite and at least 1');
  }
  for (const key of ['minimumSourceCurvatureCosine', 'minimumSourceTangentCosine']) {
    if (!Number.isFinite(config[key]) || config[key] < -1 || config[key] > 1) {
      throw new Error(`muscle packing ${key} must be finite and in [-1, 1]`);
    }
  }
  if (
    config.minimumSourceBendEnergyRetention !== undefined &&
    (
      !Number.isFinite(config.minimumSourceBendEnergyRetention) ||
      config.minimumSourceBendEnergyRetention < 0 ||
      config.minimumSourceBendEnergyRetention > 1
    )
  ) {
    throw new Error('muscle packing minimumSourceBendEnergyRetention must be finite and in [0, 1]');
  }
  if (
    config.minimumPairwiseRelationCosine !== undefined &&
    (
      !Number.isFinite(config.minimumPairwiseRelationCosine) ||
      config.minimumPairwiseRelationCosine < -1 ||
      config.minimumPairwiseRelationCosine > 1
    )
  ) {
    throw new Error('muscle packing minimumPairwiseRelationCosine must be finite and in [-1, 1]');
  }
  if (config.relaxationStep > 1) {
    throw new Error('muscle packing relaxationStep cannot exceed 1');
  }
  if (
    config.pairwiseUpdate !== undefined &&
    !['sequential', 'reciprocal-batched'].includes(config.pairwiseUpdate)
  ) {
    throw new Error('muscle packing pairwiseUpdate must be sequential or reciprocal-batched');
  }
  if (
    config.pairwiseCoordinate !== undefined &&
    !['cartesian', 'source-normal'].includes(config.pairwiseCoordinate)
  ) {
    throw new Error('muscle packing pairwiseCoordinate must be cartesian or source-normal');
  }
  if (
    config.curvatureUpdate !== undefined &&
    !['unconstrained', 'source-sign-halfspace', 'source-frame-halfspace']
      .includes(config.curvatureUpdate)
  ) {
    throw new Error(
      'muscle packing curvatureUpdate must be unconstrained, source-sign-halfspace, or source-frame-halfspace',
    );
  }
  const sourceFrameRatioKeys = [
    'minimumSourceTangentProjectionRatio',
    'minimumSourceCurvatureProjectionRatio',
  ];
  if (config.curvatureUpdate === 'source-frame-halfspace') {
    for (const key of sourceFrameRatioKeys) {
      if (!Number.isFinite(config[key]) || config[key] <= 0 || config[key] > 1) {
        throw new Error(`${key} must be finite and in (0, 1] for source-frame-halfspace`);
      }
    }
  } else {
    for (const key of sourceFrameRatioKeys) {
      if (config[key] !== undefined) {
        throw new Error(`${key} requires source-frame-halfspace curvatureUpdate`);
      }
    }
  }
  if (
    config.clusterUpdate !== undefined &&
    ![
      'unconstrained',
      'capsule-axis-belly-turn',
      'capsule-axis-occupancy-allocation',
    ].includes(config.clusterUpdate)
  ) {
    throw new Error(
      'muscle packing clusterUpdate must be unconstrained, capsule-axis-belly-turn, ' +
      'or capsule-axis-occupancy-allocation',
    );
  }
  const clusterKeys = [
    'clusterObstacleId',
    'clusterBellyRadius',
    'clusterTurnRadians',
    'clusterChirality',
    'clusterRadialReference',
    'clusterAllocationSchedule',
    'clusterOccupancyReferenceDirection',
    'clusterOccupancyEnvelope',
  ];
  if (config.clusterUpdate === 'capsule-axis-belly-turn') {
    if (typeof config.clusterObstacleId !== 'string' || config.clusterObstacleId.length === 0) {
      throw new Error('capsule-axis-belly-turn requires a nonempty clusterObstacleId');
    }
    if (!Number.isFinite(config.clusterBellyRadius) || config.clusterBellyRadius <= 0) {
      throw new Error('capsule-axis-belly-turn requires a positive finite clusterBellyRadius');
    }
    if (
      !Number.isFinite(config.clusterTurnRadians) ||
      config.clusterTurnRadians <= 0 || config.clusterTurnRadians > Math.PI
    ) {
      throw new Error('capsule-axis-belly-turn requires clusterTurnRadians in (0, pi]');
    }
    if (!['positive', 'negative'].includes(config.clusterChirality)) {
      throw new Error('capsule-axis-belly-turn requires positive or negative clusterChirality');
    }
    if (
      config.clusterRadialReference !== undefined &&
      !['source-knot', 'attachment-bridge'].includes(config.clusterRadialReference)
    ) {
      throw new Error(
        'capsule-axis-belly-turn clusterRadialReference must be source-knot or attachment-bridge',
      );
    }
    if (config.clusterAllocationSchedule !== undefined) {
      if (
        !Array.isArray(config.clusterAllocationSchedule) ||
        config.clusterAllocationSchedule.length === 0
      ) {
        throw new Error(
          'capsule-axis-belly-turn clusterAllocationSchedule must be a nonempty array',
        );
      }
      const allocationMuscleIds = new Set();
      for (const [index, allocation] of config.clusterAllocationSchedule.entries()) {
        if (
          allocation === null ||
          typeof allocation !== 'object' ||
          Array.isArray(allocation)
        ) {
          throw new Error(`clusterAllocationSchedule[${index}] must be an object`);
        }
        if (typeof allocation.muscleId !== 'string' || allocation.muscleId.length === 0) {
          throw new Error(
            `clusterAllocationSchedule[${index}] requires a nonempty muscleId`,
          );
        }
        if (!Number.isFinite(allocation.axialOffset)) {
          throw new Error(
            `clusterAllocationSchedule[${index}] axialOffset must be finite`,
          );
        }
        if (allocationMuscleIds.has(allocation.muscleId)) {
          throw new Error(
            `clusterAllocationSchedule contains duplicate muscleId ${allocation.muscleId}`,
          );
        }
        allocationMuscleIds.add(allocation.muscleId);
      }
    }
    if (config.clusterOccupancyReferenceDirection !== undefined) {
      throw new Error(
        'clusterOccupancyReferenceDirection requires capsule-axis-occupancy-allocation',
      );
    }
    if (config.clusterOccupancyEnvelope !== undefined) {
      throw new Error(
        'clusterOccupancyEnvelope requires capsule-axis-occupancy-allocation',
      );
    }
    if (
      config.curvatureUpdate !== undefined &&
      !['unconstrained', 'source-sign-halfspace'].includes(config.curvatureUpdate)
    ) {
      throw new Error(
        'capsule-axis-belly-turn curvatureUpdate must be unconstrained or source-sign-halfspace',
      );
    }
  } else if (config.clusterUpdate === 'capsule-axis-occupancy-allocation') {
    if (typeof config.clusterObstacleId !== 'string' || config.clusterObstacleId.length === 0) {
      throw new Error(
        'capsule-axis-occupancy-allocation requires a nonempty clusterObstacleId',
      );
    }
    if (!isFinitePoint(config.clusterOccupancyReferenceDirection)) {
      throw new Error(
        'capsule-axis-occupancy-allocation requires a finite 3D ' +
        'clusterOccupancyReferenceDirection',
      );
    }
    if (
      config.clusterOccupancyEnvelope !== undefined &&
      !['normalized-sine', 'normalized-sine-squared'].includes(
        config.clusterOccupancyEnvelope,
      )
    ) {
      throw new Error(
        'clusterOccupancyEnvelope must be normalized-sine or normalized-sine-squared',
      );
    }
    if (
      !Array.isArray(config.clusterAllocationSchedule) ||
      config.clusterAllocationSchedule.length === 0
    ) {
      throw new Error(
        'capsule-axis-occupancy-allocation requires a nonempty clusterAllocationSchedule',
      );
    }
    const allowedAllocationKeys = new Set([
      'muscleId',
      'azimuthRadians',
      'radialDistance',
      'axialOffset',
    ]);
    const allocationMuscleIds = new Set();
    for (const [index, allocation] of config.clusterAllocationSchedule.entries()) {
      if (allocation === null || typeof allocation !== 'object' || Array.isArray(allocation)) {
        throw new Error(`clusterAllocationSchedule[${index}] must be an object`);
      }
      const unknown = Object.keys(allocation).filter(key => !allowedAllocationKeys.has(key));
      if (unknown.length > 0) {
        throw new Error(
          `clusterAllocationSchedule[${index}] has unknown fields: ${unknown.join(', ')}`,
        );
      }
      if (typeof allocation.muscleId !== 'string' || allocation.muscleId.length === 0) {
        throw new Error(`clusterAllocationSchedule[${index}] requires a nonempty muscleId`);
      }
      for (const key of ['azimuthRadians', 'radialDistance', 'axialOffset']) {
        if (!Number.isFinite(allocation[key])) {
          throw new Error(`clusterAllocationSchedule[${index}] ${key} must be finite`);
        }
      }
      if (!(allocation.radialDistance > 0)) {
        throw new Error(`clusterAllocationSchedule[${index}] radialDistance must be positive`);
      }
      if (allocationMuscleIds.has(allocation.muscleId)) {
        throw new Error(
          `clusterAllocationSchedule contains duplicate muscleId ${allocation.muscleId}`,
        );
      }
      allocationMuscleIds.add(allocation.muscleId);
    }
    for (const key of [
      'clusterBellyRadius',
      'clusterTurnRadians',
      'clusterChirality',
      'clusterRadialReference',
    ]) {
      if (config[key] !== undefined) {
        throw new Error(`${key} cannot accompany capsule-axis-occupancy-allocation`);
      }
    }
  } else {
    for (const key of clusterKeys) {
      if (config[key] !== undefined) {
        throw new Error(`${key} requires a capsule-axis clusterUpdate`);
      }
    }
  }
  if (
    config.crossSectionUpdate !== undefined &&
    !['uniform', 'contact-redistributed'].includes(config.crossSectionUpdate)
  ) {
    throw new Error(
      'muscle packing crossSectionUpdate must be uniform or contact-redistributed',
    );
  }
  if (config.crossSectionUpdate === 'contact-redistributed') {
    if (
      !Number.isFinite(config.crossSectionStep) ||
      config.crossSectionStep <= 0 || config.crossSectionStep > 1
    ) {
      throw new Error('contact-redistributed cross sections require crossSectionStep in (0, 1]');
    }
  } else if (config.crossSectionStep !== undefined) {
    throw new Error('crossSectionStep requires contact-redistributed crossSectionUpdate');
  }
}

function validateClusterAllocationSource(config, source) {
  if (config.clusterAllocationSchedule === undefined) return;
  const sourceMuscleIds = new Set(source.muscles.map(muscle => muscle.id));
  const allocationMuscleIds = new Set(
    config.clusterAllocationSchedule.map(allocation => allocation.muscleId),
  );
  const missingMuscleIds = [...sourceMuscleIds]
    .filter(muscleId => !allocationMuscleIds.has(muscleId));
  const unknownMuscleIds = [...allocationMuscleIds]
    .filter(muscleId => !sourceMuscleIds.has(muscleId));
  if (missingMuscleIds.length > 0 || unknownMuscleIds.length > 0) {
    throw new Error(
      `clusterAllocationSchedule must bind every source muscle exactly once: ${JSON.stringify({
        missingMuscleIds,
        unknownMuscleIds,
      })}`,
    );
  }
  if (config.clusterUpdate === 'capsule-axis-occupancy-allocation') {
    effectiveOccupancyReferenceDirection(source, config);
  }
}

function validateSource(source) {
  if (source?.schema !== MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA) {
    throw new Error(`muscle compartment packing source schema mismatch: ${source?.schema || 'missing'}`);
  }
  requireString(source.id, 'muscle packing source id');
  if (source.dimension !== 3) throw new Error('muscle compartment packing requires dimension 3');
  if (
    source.authority?.kind !== 'synthetic-proxy' &&
    source.authority?.kind !== 'operator-authored' &&
    source.authority?.kind !== 'reference-anchored'
  ) {
    throw new Error('muscle packing source authority kind is unsupported');
  }
  requireString(source.authority?.anatomicalAdmission, 'source anatomical admission');
  if (
    source.formation !== undefined &&
    source.formation?.centerlineSmoothingReference !== 'source-displacement'
  ) {
    throw new Error(
      'muscle packing centerline smoothing reference must be source-displacement when specified',
    );
  }
  for (const route of ['requested', 'effective']) {
    requireString(source.input?.[route]?.kind, `${route} input kind`);
    requireString(source.input?.[route]?.id, `${route} input id`);
    if (!HASH_PATTERN.test(source.input?.[route]?.sha256 || '')) {
      throw new Error(`${route} input sha256 must be a SHA-256 identity`);
    }
  }
  if (source.compartment?.kind !== 'box') {
    throw new Error('muscle compartment packing requires a box compartment');
  }
  requirePoint(source.compartment.minimum, 'compartment minimum');
  requirePoint(source.compartment.maximum, 'compartment maximum');
  requireFinite(source.compartment.clearance, 'compartment clearance');
  if (source.compartment.clearance < 0) throw new Error('compartment clearance cannot be negative');
  for (let axis = 0; axis < 3; axis += 1) {
    if (source.compartment.maximum[axis] <= source.compartment.minimum[axis]) {
      throw new Error('compartment bounds must be ordered');
    }
  }
  if (!Array.isArray(source.obstacles)) throw new Error('muscle packing obstacles must be an array');
  for (const obstacle of source.obstacles) {
    requireString(obstacle.id, 'obstacle id');
    if (obstacle.kind === 'capsule') {
      requirePoint(obstacle.start, `${obstacle.id} capsule start`);
      requirePoint(obstacle.end, `${obstacle.id} capsule end`);
      if (distance(obstacle.start, obstacle.end) <= 1e-12) {
        throw new Error(`${obstacle.id} capsule must have nonzero length`);
      }
    } else if (obstacle.kind === 'sphere') {
      requirePoint(obstacle.center, `${obstacle.id} sphere center`);
    } else {
      throw new Error(`unsupported muscle packing obstacle kind: ${obstacle.kind}`);
    }
    requireFinite(obstacle.radius, `${obstacle.id} radius`);
    requireFinite(obstacle.clearance || 0, `${obstacle.id} clearance`);
    if (obstacle.radius <= 0 || (obstacle.clearance || 0) < 0) {
      throw new Error(`${obstacle.id} radius must be positive and clearance nonnegative`);
    }
  }
  if (!Array.isArray(source.muscles) || source.muscles.length < 2 || source.muscles.length > 8) {
    throw new Error('muscle compartment packing requires between two and eight muscles');
  }
  const ids = new Set();
  const instanceIds = new Set();
  let knotCount = null;
  for (const muscle of source.muscles) {
    requireString(muscle.id, 'muscle id');
    if (ids.has(muscle.id)) throw new Error(`duplicate muscle id ${muscle.id}`);
    ids.add(muscle.id);
    for (const key of ['sourceId', 'constructionId', 'lineageId', 'instanceId']) {
      requireString(muscle.identity?.[key], `${muscle.id} ${key}`);
    }
    requireString(muscle.authority?.kind, `${muscle.id} authority kind`);
    requireString(
      muscle.authority?.anatomicalAdmission,
      `${muscle.id} anatomical admission`,
    );
    if (instanceIds.has(muscle.identity.instanceId)) {
      throw new Error(`muscle instance ids must be unique; duplicate instance ${muscle.identity.instanceId}`);
    }
    instanceIds.add(muscle.identity.instanceId);
    if (!Array.isArray(muscle.centerline) || muscle.centerline.length < 4) {
      throw new Error(`${muscle.id} centerline requires at least four samples`);
    }
    knotCount ??= muscle.centerline.length;
    if (muscle.centerline.length !== knotCount) {
      throw new Error('muscle centerlines must share one resampled knot count');
    }
    for (const [index, knot] of muscle.centerline.entries()) {
      requirePoint(knot.position, `${muscle.id} centerline[${index}]`);
      requireFinite(knot.radius, `${muscle.id} centerline[${index}] radius`);
      if (knot.radius <= 0) throw new Error(`${muscle.id} centerline radii must be positive`);
    }
    for (const endpoint of ['origin', 'insertion']) {
      requireString(muscle.attachments?.[endpoint]?.id, `${muscle.id} ${endpoint} attachment id`);
      requireString(
        muscle.attachments?.[endpoint]?.sourceAuthority,
        `${muscle.id} ${endpoint} source authority`,
      );
      requirePoint(muscle.attachments?.[endpoint]?.position, `${muscle.id} ${endpoint} attachment position`);
    }
    if (
      !samePoint(muscle.centerline[0].position, muscle.attachments.origin.position) ||
      !samePoint(muscle.centerline.at(-1).position, muscle.attachments.insertion.position)
    ) {
      throw new Error(`${muscle.id} centerline endpoints must equal fixed attachment positions`);
    }
    requireFinite(muscle.targetVolume, `${muscle.id} target volume`);
    if (muscle.targetVolume <= 0) throw new Error(`${muscle.id} target volume must be positive`);
  }
  if (source.input.effective.kind === 'synthetic-fixture') {
    const { input, ...fixtureCore } = source;
    const effectiveHash = hashJson(fixtureCore);
    if (
      input.requested.kind !== 'synthetic-fixture' ||
      input.requested.id !== input.effective.id ||
      input.requested.sha256 !== input.effective.sha256 ||
      input.effective.id !== source.id ||
      input.effective.sha256 !== effectiveHash
    ) {
      throw new Error(
        `synthetic fixture identity mismatch: recorded ${input.effective.sha256}, effective ${effectiveHash}`,
      );
    }
  }
}

function formationReceipt(source) {
  const reference = source.formation?.centerlineSmoothingReference || 'absolute-position';
  return {
    requestedCenterlineSmoothingReference: reference,
    effectiveCenterlineSmoothingReference: reference,
    fallbackUsed: false,
  };
}

function pairwiseProjectionReceipt(config) {
  const update = config.pairwiseUpdate || 'sequential';
  return {
    requestedUpdate: update,
    effectiveUpdate: update,
    fallbackUsed: false,
  };
}

function pairwiseCoordinateReceipt(config) {
  const coordinate = config.pairwiseCoordinate || 'cartesian';
  return {
    requested: coordinate,
    effective: coordinate,
    fallbackUsed: false,
  };
}

function curvatureProjectionReceipt(config) {
  const update = config.curvatureUpdate || 'unconstrained';
  const receipt = {
    requestedUpdate: update,
    effectiveUpdate: update,
  };
  if (update === 'source-frame-halfspace') {
    receipt.minimumSourceTangentProjectionRatio =
      config.minimumSourceTangentProjectionRatio;
    receipt.minimumSourceCurvatureProjectionRatio =
      config.minimumSourceCurvatureProjectionRatio;
  }
  receipt.fallbackUsed = false;
  return receipt;
}

function crossSectionProjectionReceipt(config) {
  const update = config.crossSectionUpdate || 'uniform';
  return {
    requestedUpdate: update,
    effectiveUpdate: update,
    requestedStep: update === 'contact-redistributed' ? config.crossSectionStep : null,
    effectiveStep: update === 'contact-redistributed' ? config.crossSectionStep : null,
    fallbackUsed: false,
  };
}

function clusterProjectionReceipt(config, source) {
  const update = config.clusterUpdate || 'unconstrained';
  const receipt = {
    requestedUpdate:update,
    effectiveUpdate:update,
  };
  if (update === 'capsule-axis-belly-turn') {
    receipt.obstacleId = config.clusterObstacleId;
    receipt.bellyRadius = config.clusterBellyRadius;
    receipt.turnRadians = config.clusterTurnRadians;
    receipt.chirality = config.clusterChirality;
    receipt.radialReference = config.clusterRadialReference || 'source-knot';
    receipt.fixedAttachmentEnvelope = 'normalized-sine-zero-at-endpoints';
    if (config.clusterAllocationSchedule !== undefined) {
      receipt.allocationSchedule = structuredClone(config.clusterAllocationSchedule);
      receipt.allocationReference =
        'capsule-axis-source-position-sine-zero-at-attachments';
    }
  } else if (update === 'capsule-axis-occupancy-allocation') {
    const envelopeProfile = config.clusterOccupancyEnvelope || 'normalized-sine';
    receipt.obstacleId = config.clusterObstacleId;
    receipt.referenceDirection = structuredClone(config.clusterOccupancyReferenceDirection);
    receipt.effectiveReferenceDirection = effectiveOccupancyReferenceDirection(source, config);
    receipt.allocationSchedule = structuredClone(config.clusterAllocationSchedule);
    receipt.requestedEnvelopeProfile = envelopeProfile;
    receipt.effectiveEnvelopeProfile = envelopeProfile;
    receipt.allocationReference =
      `capsule-axis-belly-anchor-absolute-role-preserve-local-shape-${envelopeProfile}` +
      '-zero-at-attachments';
  }
  receipt.fallbackUsed = false;
  return receipt;
}

function syntheticMuscleAtAngle(index, angle) {
  const id = `muscle-${String(index + 1).padStart(2, '0')}`;
  const radial = radius => [Math.cos(angle) * radius, Math.sin(angle) * radius];
  const endpointRadius = radial(0.5);
  const crowdedRadius = radial(0.14);
  const centerline = [
    { position: [endpointRadius[0], -0.9, endpointRadius[1]], radius: 0.16 },
    { position: [crowdedRadius[0], -0.3, crowdedRadius[1]], radius: 0.29 },
    { position: [crowdedRadius[0], 0.3, crowdedRadius[1]], radius: 0.29 },
    { position: [endpointRadius[0], 0.9, endpointRadius[1]], radius: 0.16 },
  ];
  return {
    id,
    identity: {
      sourceId: `synthetic-source-${id}`,
      constructionId: `synthetic-construction-${id}`,
      lineageId: `synthetic-lineage-${id}`,
      instanceId: `synthetic-instance-${id}`,
    },
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    attachments: {
      origin: {
        id: `${id}:origin`,
        sourceAuthority: 'synthetic-proxy',
        position: [...centerline[0].position],
      },
      insertion: {
        id: `${id}:insertion`,
        sourceAuthority: 'synthetic-proxy',
        position: [...centerline.at(-1).position],
      },
    },
    centerline,
    targetVolume: carrierVolume(centerline),
    volumeAuthority: 'synthetic-authored-target',
  };
}

const SYNTHETIC_DENSITY_LADDER_ANGLES = Object.freeze([
  0,
  Math.PI,
  Math.PI / 2,
  3 * Math.PI / 2,
  Math.PI / 4,
  5 * Math.PI / 4,
  3 * Math.PI / 4,
  7 * Math.PI / 4,
]);

const SYNTHETIC_ASYMMETRIC_FOUR_PROFILES = Object.freeze([
  {
    angles:[-0.25,-0.05,0.35,0.55,0.3,0.05],
    radial:[0.62,0.48,0.38,0.4,0.5,0.59],
    y:[-0.9,-0.58,-0.2,0.2,0.58,0.9],
    radii:[0.14,0.21,0.24,0.24,0.2,0.14],
  },
  {
    angles:[2.85,3.05,3.4,3.62,3.36,3.1],
    radial:[0.54,0.41,0.28,0.32,0.43,0.57],
    y:[-0.9,-0.55,-0.17,0.23,0.6,0.9],
    radii:[0.14,0.23,0.255,0.255,0.22,0.14],
  },
  {
    angles:[1.25,1.45,1.8,2.05,1.82,1.58],
    radial:[0.6,0.45,0.34,0.36,0.46,0.56],
    y:[-0.9,-0.6,-0.22,0.18,0.56,0.9],
    radii:[0.14,0.21,0.235,0.235,0.21,0.14],
  },
  {
    angles:[4.35,4.55,4.9,5.15,4.9,4.68],
    radial:[0.55,0.4,0.3,0.34,0.44,0.6],
    y:[-0.9,-0.57,-0.15,0.25,0.61,0.9],
    radii:[0.14,0.22,0.25,0.25,0.225,0.14],
  },
]);

function syntheticAsymmetricMuscle(index) {
  const profile = SYNTHETIC_ASYMMETRIC_FOUR_PROFILES[index];
  const muscle = syntheticMuscleAtAngle(index, profile.angles[0]);
  muscle.centerline = profile.angles.map((angle, knotIndex) => {
    const radial = profile.radial[knotIndex];
    return {
      position: [Math.cos(angle) * radial, profile.y[knotIndex], Math.sin(angle) * radial],
      radius: profile.radii[knotIndex],
    };
  });
  muscle.attachments.origin.position = [...muscle.centerline[0].position];
  muscle.attachments.insertion.position = [...muscle.centerline.at(-1).position];
  muscle.targetVolume = carrierVolume(muscle.centerline);
  return muscle;
}

export function createSyntheticFourMuscleCompartment() {
  const core = {
    schema: MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id: 'synthetic-four-muscle-asymmetric-central-bone-v3',
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    dimension: 3,
    formation: {
      centerlineSmoothingReference: 'source-displacement',
    },
    compartment: {
      id: 'local-muscle-compartment',
      kind: 'box',
      minimum: [-0.95, -1.1, -0.95],
      maximum: [0.95, 1.1, 0.95],
      clearance: 0.015,
    },
    obstacles: [{
      id: 'central-skeletal-shaft',
      kind: 'capsule',
      start: [0, -0.96, 0],
      end: [0, 0.96, 0],
      radius: 0.18,
      clearance: 0.02,
      authority: 'synthetic-proxy',
    }],
    muscles: Array.from({ length: 4 }, (_, index) => syntheticAsymmetricMuscle(index)),
  };
  const sha256 = hashJson(core);
  return {
    ...core,
    input: {
      requested: {
        kind: 'synthetic-fixture',
        id: core.id,
        sha256,
      },
      effective: {
        kind: 'synthetic-fixture',
        id: core.id,
        sha256,
      },
    },
  };
}

export function createSyntheticMuscleDensityLadder(
  muscleCount,
  { knotCount = 4 } = {},
) {
  if (![4, 6, 8].includes(muscleCount)) {
    throw new Error('synthetic muscle density ladder supports exactly 4, 6, or 8 muscles');
  }
  if (![4, 6, 8].includes(knotCount)) {
    throw new Error('synthetic muscle density ladder supports exactly 4, 6, or 8 knots');
  }
  const bellyRadius = 0.2;
  const baselineCore = {
    schema: MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id: `synthetic-muscle-density-ladder-${muscleCount}-v0`,
    authority: {
      kind:'synthetic-proxy',
      anatomicalAdmission:'none',
    },
    dimension:3,
    formation: {
      centerlineSmoothingReference:'source-displacement',
    },
    compartment: {
      id:'local-muscle-compartment',
      kind:'box',
      minimum:[-0.95, -1.1, -0.95],
      maximum:[0.95, 1.1, 0.95],
      clearance:0.015,
    },
    obstacles:[{
      id:'central-skeletal-shaft',
      kind:'capsule',
      start:[0, -0.96, 0],
      end:[0, 0.96, 0],
      radius:0.18,
      clearance:0.02,
      authority:'synthetic-proxy',
    }],
    muscles:SYNTHETIC_DENSITY_LADDER_ANGLES.slice(0, muscleCount).map(
      (angle, index) => {
        const muscle = syntheticMuscleAtAngle(index, angle);
        for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
          muscle.centerline[knotIndex].radius = bellyRadius;
        }
        muscle.targetVolume = carrierVolume(muscle.centerline);
        return muscle;
      },
    ),
  };
  const baselineSha256 = hashJson(baselineCore);
  const comparisonSource = {
    kind:'synthetic-fixture',
    id:baselineCore.id,
    sha256:baselineSha256,
  };
  const core = knotCount === 4 ? baselineCore : {
    ...baselineCore,
    id:`${baselineCore.id}-${knotCount}-knots`,
    longitudinalResolution: {
      kind:'analytic-source-curve-resample-v0',
      sampleCount:knotCount,
      comparisonSource,
    },
    muscles:baselineCore.muscles.map((baselineMuscle, muscleIndex) => {
      const angle = SYNTHETIC_DENSITY_LADDER_ANGLES[muscleIndex];
      const centerline = Array.from({ length:knotCount }, (_, knotIndex) => {
        const progress = knotIndex / (knotCount - 1);
        const y = -0.9 + 1.8 * progress;
        const radialDistance = 0.095 + 0.5 * y ** 2;
        const endpointProgress = Math.max(0, (Math.abs(y) - 0.3) / 0.6);
        return {
          position:[
            Math.cos(angle) * radialDistance,
            y,
            Math.sin(angle) * radialDistance,
          ],
          radius:bellyRadius - 0.04 * endpointProgress,
        };
      });
      centerline[0] = structuredClone(baselineMuscle.centerline[0]);
      centerline[centerline.length - 1] = structuredClone(baselineMuscle.centerline.at(-1));
      return {
        ...structuredClone(baselineMuscle),
        centerline,
      };
    }),
  };
  const sha256 = hashJson(core);
  return {
    ...core,
    input: {
      requested: { kind:'synthetic-fixture', id:core.id, sha256 },
      effective: { kind:'synthetic-fixture', id:core.id, sha256 },
    },
  };
}

function candidateValuesAgree(field, label) {
  if (!field || (field.state !== 'candidate' && field.state !== 'admitted')) {
    throw new Error(`${label} must preserve candidate or admitted evidence`);
  }
  const candidates = Array.isArray(field.candidates) ? field.candidates : [];
  const values = [
    ...(field.selected?.value === undefined ? [] : [field.selected.value]),
    ...candidates.map(candidate => candidate.value),
  ];
  if (values.length === 0) throw new Error(`${label} has no measured candidate value`);
  const first = values[0];
  const agrees = values.every(value => {
    if (isFinitePoint(first) && isFinitePoint(value)) {
      return first.every((coordinate, axis) => Math.abs(coordinate - value[axis]) <= 1e-6);
    }
    return JSON.stringify(canonical(first)) === JSON.stringify(canonical(value));
  });
  if (!agrees) throw new Error(`${label} candidate values disagree`);
  return structuredClone(field.selected?.value ?? candidates[0].value);
}

function validateSourceShapedAtlas(parentAtlas, parentAtlasFileSha256) {
  if (parentAtlas?.schema !== 'kaminos.authored-muscle-coordinate-parent-atlas.v0') {
    throw new Error(`parent atlas schema mismatch: ${parentAtlas?.schema || 'missing'}`);
  }
  if (!HASH_PATTERN.test(parentAtlasFileSha256 || '')) {
    throw new Error('parent atlas file SHA-256 must be a SHA-256 identity');
  }
  if (!HASH_PATTERN.test(parentAtlas.atlasSha256 || '')) {
    throw new Error('parent atlas SHA-256 must be a SHA-256 identity');
  }
  const { atlasSha256: ignored, ...core } = parentAtlas;
  if (hashJson(core) !== parentAtlas.atlasSha256) {
    throw new Error('parent atlas SHA-256 does not match its effective payload');
  }
  if (!Array.isArray(parentAtlas.routeInventory)) {
    throw new Error('parent atlas route inventory must be an array');
  }
}

function selectedSourceShapedRoutes(parentAtlas, requestedConstructionIds) {
  if (
    !Array.isArray(requestedConstructionIds) ||
    requestedConstructionIds.length < 2 ||
    requestedConstructionIds.length > 8
  ) {
    throw new Error('source-shaped packing assay requires two to eight requested construction ids');
  }
  if (new Set(requestedConstructionIds).size !== requestedConstructionIds.length) {
    throw new Error('source-shaped packing assay construction ids must be unique');
  }
  return requestedConstructionIds.map(constructionId => {
    requireString(constructionId, 'requested construction id');
    const matches = parentAtlas.routeInventory.filter(route => route.constructionId === constructionId);
    if (matches.length !== 1) {
      throw new Error(
        `requested construction ${constructionId} resolved to ${matches.length} parent-atlas rows`,
      );
    }
    const route = matches[0];
    if (route.state !== 'candidate' && route.state !== 'admitted') {
      throw new Error(`requested construction ${constructionId} has unusable authority state ${route.state}`);
    }
    return route;
  });
}

function validatePerturbationLevels(levels) {
  if (!Array.isArray(levels) || levels.length < 2) {
    throw new Error('source-shaped packing assay requires at least two perturbation levels');
  }
  const ids = new Set();
  let previous = -Infinity;
  for (const level of levels) {
    requireString(level?.id, 'perturbation level id');
    requireFinite(level?.crowdingFraction, `${level?.id || 'perturbation'} crowding fraction`);
    if (level.crowdingFraction < 0 || level.crowdingFraction >= 1) {
      throw new Error('perturbation crowding fractions must be in [0, 1)');
    }
    if (ids.has(level.id)) throw new Error(`duplicate perturbation level id ${level.id}`);
    if (level.crowdingFraction <= previous) {
      throw new Error('perturbation crowding fractions must be strictly increasing');
    }
    ids.add(level.id);
    previous = level.crowdingFraction;
  }
}

function sourceShapedCandidateRoute(route) {
  const constructionId = route.constructionId;
  const centerlineField = route.fields?.centerline;
  if (!centerlineField || (centerlineField.state !== 'candidate' && centerlineField.state !== 'admitted')) {
    throw new Error(`${constructionId} centerline must preserve candidate or admitted evidence`);
  }
  const centerlineCandidates = Array.isArray(centerlineField.candidates)
    ? centerlineField.candidates
    : [];
  const centerlineValue = candidateValuesAgree(
    centerlineField,
    `${constructionId} centerline`,
  );
  const samples = centerlineValue?.resampledSamples;
  if (!Array.isArray(samples) || samples.length < 4) {
    throw new Error(`${constructionId} centerline candidate requires at least four resampled samples`);
  }
  const centerline = samples.map((sample, index) => {
    requirePoint(sample.position, `${constructionId} centerline candidate[${index}]`);
    requireFinite(sample.radius, `${constructionId} centerline candidate[${index}] radius`);
    if (!(sample.radius > 0)) throw new Error(`${constructionId} centerline candidate radii must be positive`);
    return { position: [...sample.position], radius: sample.radius };
  });
  const origin = candidateValuesAgree(
    route.fields?.['attachments.origin.position'],
    `${constructionId} origin`,
  );
  const insertion = candidateValuesAgree(
    route.fields?.['attachments.insertion.position'],
    `${constructionId} insertion`,
  );
  if (
    distance(centerline[0].position, origin) > 1e-6 ||
    distance(centerline.at(-1).position, insertion) > 1e-6
  ) {
    throw new Error(`${constructionId} centerline endpoints disagree with attachment candidates`);
  }
  centerline[0].position = [...origin];
  centerline.at(-1).position = [...insertion];
  const targetVolume = candidateValuesAgree(
    route.fields?.targetVolume,
    `${constructionId} target volume`,
  );
  requireFinite(targetVolume, `${constructionId} target volume candidate`);
  if (!(targetVolume > 0)) throw new Error(`${constructionId} target volume candidate must be positive`);
  const baseVolume = carrierVolume(centerline);
  if (!(baseVolume > 0)) throw new Error(`${constructionId} candidate centerline volume must be positive`);
  const radiusScale = Math.sqrt(targetVolume / baseVolume);
  for (const knot of centerline) knot.radius *= radiusScale;
  return {
    route,
    centerline,
    origin,
    insertion,
    targetVolume,
    sourcePathSha256: centerlineValue.sourcePathSha256 ?? null,
  };
}

function cohortCentroids(candidateRoutes) {
  const knotCount = candidateRoutes[0].centerline.length;
  if (!candidateRoutes.every(route => route.centerline.length === knotCount)) {
    throw new Error('source-shaped packing routes must share one resampled knot count');
  }
  return Array.from({ length: knotCount }, (_, knotIndex) => (
    candidateRoutes.reduce(
      (sum, route) => add(sum, route.centerline[knotIndex].position),
      [0, 0, 0],
    ).map(value => value / candidateRoutes.length)
  ));
}

function provisionalCohortEnvironment(candidateRoutes, centroids) {
  const knots = candidateRoutes.flatMap(route => route.centerline);
  const maximumRadius = Math.max(...knots.map(knot => knot.radius));
  const margin = maximumRadius * 1.5;
  const minimum = [0, 1, 2].map(axis =>
    Math.min(...knots.map(knot => knot.position[axis])) - maximumRadius - margin);
  const maximum = [0, 1, 2].map(axis =>
    Math.max(...knots.map(knot => knot.position[axis])) + maximumRadius + margin);
  const lowerIndex = Math.max(1, Math.floor((centroids.length - 1) * 0.35));
  const upperIndex = Math.min(centroids.length - 2, Math.ceil((centroids.length - 1) * 0.65));
  return {
    compartment: {
      id: 'agent-authored-k4-data-envelope',
      kind: 'box',
      minimum,
      maximum,
      clearance: maximumRadius * 0.05,
    },
    obstacle: {
      id: 'agent-authored-k4-central-pressure-capsule',
      kind: 'capsule',
      start: [...centroids[lowerIndex]],
      end: [...centroids[upperIndex]],
      radius: maximumRadius * 0.15,
      clearance: maximumRadius * 0.05,
      authority: 'agent-authored-provisional',
    },
  };
}

function provisionalSourceForLevel({
  parentAtlas,
  parentAtlasFileSha256,
  requestedConstructionIds,
  candidateRoutes,
  centroids,
  environment,
  level,
  shapeProfile,
}) {
  const requestedPerturbation = {
    kind: 'interior-samples-toward-cohort-centroid',
    crowdingFraction: level.crowdingFraction,
    endpointPolicy: 'fixed-measured-candidates',
  };
  const requestedAssumptions = {
    id: 'source-shaped-k4-provisional-environment.v0',
    authority: 'agent-authored-provisional',
    compartmentDerivation: 'selected-candidate-knot-axis-envelope-plus-1.5-maximum-radius-margin',
    obstacleDerivation: 'cohort-centroid-middle-thirty-percent-capsule',
  };
  const effectiveAssumptionPayload = {
    compartment: structuredClone(environment.compartment),
    obstacles: [structuredClone(environment.obstacle)],
  };
  const muscles = candidateRoutes.map((candidate, muscleIndex) => {
    const route = candidate.route;
    let centerline = candidate.centerline.map((knot, knotIndex) => ({
      position: knotIndex === 0 || knotIndex === candidate.centerline.length - 1
        ? [...knot.position]
        : interpolatePoint(knot.position, centroids[knotIndex], level.crowdingFraction),
      radius: knot.radius,
    }));
    centerline = applySourceShapedShapeProfile(
      centerline,
      candidate.targetVolume,
      shapeProfile,
    );
    return {
      id: route.constructionId,
      identity: {
        sourceId: `${parentAtlas.source?.assetSha256 || parentAtlas.id}:${route.constructionId}`,
        constructionId: route.constructionId,
        lineageId: route.lineageId,
        instanceId: route.instanceId,
      },
      authority: {
        kind: 'synthetic-proxy',
        anatomicalAdmission: 'none',
      },
      attachments: {
        origin: {
          id: route.attachments?.origin?.id || `${route.constructionId}:origin`,
          sourceAuthority: 'measured-candidate-not-admitted',
          position: [...centerline[0].position],
        },
        insertion: {
          id: route.attachments?.insertion?.id || `${route.constructionId}:insertion`,
          sourceAuthority: 'measured-candidate-not-admitted',
          position: [...centerline.at(-1).position],
        },
      },
      centerline,
      targetVolume: candidate.targetVolume,
      volumeAuthority: 'measured-candidate-not-admitted',
      candidateEvidence: {
        parentAtlasId: parentAtlas.id,
        parentAtlasSha256: parentAtlas.atlasSha256,
        parentAtlasFileSha256,
        routeIndex: muscleIndex,
        centerlineState: route.fields.centerline.state,
        targetVolumeState: route.fields.targetVolume.state,
        sourcePathSha256: candidate.sourcePathSha256,
      },
      ...(shapeProfile ? { shapeProfile: structuredClone(shapeProfile.effective) } : {}),
    };
  });
  const core = {
    schema: MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id: `source-shaped-${requestedConstructionIds.join('-')}-${level.id}-v0`,
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    dimension: 3,
    compartment: structuredClone(environment.compartment),
    obstacles: [structuredClone(environment.obstacle)],
    muscles,
    assayProvenance: {
      evidenceTrack: 'experimental',
      claimCeiling: 'qualitative-route-local-mechanical-response',
      parentAtlas: {
        id: parentAtlas.id,
        atlasSha256: parentAtlas.atlasSha256,
        fileSha256: parentAtlasFileSha256,
      },
      requestedConstructionIds: [...requestedConstructionIds],
      effectiveConstructionIds: muscles.map(muscle => muscle.identity.constructionId),
      perturbation: {
        id: level.id,
        ...requestedPerturbation,
        requested: structuredClone(requestedPerturbation),
        effective: structuredClone(requestedPerturbation),
      },
      compartment: {
        authority: 'agent-authored-provisional',
        derivation: 'selected-candidate-knot-axis-envelope-plus-1.5-maximum-radius-margin',
      },
      obstacle: {
        authority: 'agent-authored-provisional',
        derivation: 'cohort-centroid-middle-thirty-percent-capsule',
      },
      assumptions: {
        requested: requestedAssumptions,
        effective: {
          ...structuredClone(requestedAssumptions),
          ...effectiveAssumptionPayload,
          sha256: hashJson(effectiveAssumptionPayload),
        },
      },
      ...(shapeProfile ? { shapeProfile: structuredClone(shapeProfile) } : {}),
    },
  };
  const sha256 = hashJson(core);
  return {
    ...core,
    input: {
      requested: { kind: 'synthetic-fixture', id: core.id, sha256 },
      effective: { kind: 'synthetic-fixture', id: core.id, sha256 },
    },
  };
}

export function createSourceShapedPackingPerturbationSeries({
  parentAtlas,
  parentAtlasFileSha256,
  requestedConstructionIds,
  levels,
  shapeProfileId,
}) {
  validateSourceShapedAtlas(parentAtlas, parentAtlasFileSha256);
  validatePerturbationLevels(levels);
  const routes = selectedSourceShapedRoutes(parentAtlas, requestedConstructionIds);
  const candidateRoutes = routes.map(sourceShapedCandidateRoute);
  const centroids = cohortCentroids(candidateRoutes);
  const environment = provisionalCohortEnvironment(candidateRoutes, centroids);
  const shapeProfile = resolveSourceShapedShapeProfile(shapeProfileId);
  const conditions = levels.map(level => ({
    id: level.id,
    crowdingFraction: level.crowdingFraction,
    source: provisionalSourceForLevel({
      parentAtlas,
      parentAtlasFileSha256,
      requestedConstructionIds,
      candidateRoutes,
      centroids,
      environment,
      level,
      shapeProfile,
    }),
  }));
  return canonical({
    schema: SOURCE_SHAPED_PACKING_PERTURBATION_SERIES_SCHEMA,
    evidenceTrack: 'experimental',
    claimCeiling: 'qualitative-route-local-mechanical-response',
    parentAtlas: {
      id: parentAtlas.id,
      atlasSha256: parentAtlas.atlasSha256,
      fileSha256: parentAtlasFileSha256,
    },
    requestedConstructionIds: [...requestedConstructionIds],
    effectiveConstructionIds: routes.map(route => route.constructionId),
    ...(shapeProfile ? { shapeProfile } : {}),
    conditions,
  });
}

function validateEndpointTaperConfig(config) {
  const allowedKeys = new Set([
    'endpointRadiusMultiplier',
    'transitionFraction',
    'profile',
    'volumeCompensation',
  ]);
  const unexpected = Object.keys(config || {}).filter(key => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`endpoint taper config has unknown fields: ${unexpected.join(', ')}`);
  }
  requireFinite(config?.endpointRadiusMultiplier, 'endpoint taper radius multiplier');
  requireFinite(config?.transitionFraction, 'endpoint taper transition fraction');
  if (!(config.endpointRadiusMultiplier > 0 && config.endpointRadiusMultiplier < 1)) {
    throw new Error('endpoint taper radius multiplier must be in (0, 1)');
  }
  if (!(config.transitionFraction > 0 && config.transitionFraction <= 0.5)) {
    throw new Error('endpoint taper transition fraction must be in (0, 0.5]');
  }
  if (config.profile !== 'smoothstep-arc-length') {
    throw new Error('endpoint taper profile must be smoothstep-arc-length');
  }
  if (config.volumeCompensation !== 'global-radius') {
    throw new Error('endpoint taper volume compensation must be global-radius');
  }
  return canonical(config);
}

function endpointTaperProfile(centerline, config) {
  const cumulative = [0];
  for (let index = 1; index < centerline.length; index += 1) {
    cumulative.push(
      cumulative.at(-1) + distance(centerline[index - 1].position, centerline[index].position),
    );
  }
  const total = cumulative.at(-1);
  if (!(total > 0)) throw new Error('endpoint taper requires a nondegenerate centerline');
  return cumulative.map(arcDistance => {
    const progress = arcDistance / total;
    const endpointDistance = Math.min(progress, 1 - progress);
    const normalizedTransition = Math.min(1, endpointDistance / config.transitionFraction);
    const smoothstep = normalizedTransition ** 2 * (3 - 2 * normalizedTransition);
    return config.endpointRadiusMultiplier +
      (1 - config.endpointRadiusMultiplier) * smoothstep;
  });
}

export function deriveEndpointTaperedPackingSource(parentSource, requestedConfig) {
  measureMuscleCompartmentPacking(parentSource);
  const requested = validateEndpointTaperConfig(requestedConfig);
  const source = structuredClone(parentSource);
  const perMuscle = [];
  for (const muscle of source.muscles) {
    const parentMuscle = parentSource.muscles.find(candidate => candidate.id === muscle.id);
    if (!parentMuscle) throw new Error(`endpoint taper parent muscle missing: ${muscle.id}`);
    const profileMultipliers = endpointTaperProfile(parentMuscle.centerline, requested);
    for (const [knotIndex, knot] of muscle.centerline.entries()) {
      knot.radius = parentMuscle.centerline[knotIndex].radius * profileMultipliers[knotIndex];
    }
    const taperedVolume = carrierVolume(muscle.centerline);
    if (!(taperedVolume > 0)) throw new Error(`endpoint taper collapsed ${muscle.id} volume`);
    const globalRadiusCompensation = Math.sqrt(muscle.targetVolume / taperedVolume);
    for (const knot of muscle.centerline) knot.radius *= globalRadiusCompensation;
    perMuscle.push({
      muscleId: muscle.id,
      requestedEndpointRadiusMultiplier: requested.endpointRadiusMultiplier,
      globalRadiusCompensation,
      effectiveEndpointRadiusMultiplier:
        requested.endpointRadiusMultiplier * globalRadiusCompensation,
      targetVolume: muscle.targetVolume,
      effectiveVolume: carrierVolume(muscle.centerline),
    });
  }
  const parentInput = structuredClone(parentSource.input.effective);
  const effective = canonical({
    ...requested,
    perMuscle,
  });
  source.id = `${parentSource.id}--endpoint-taper-${hashJson({ parentInput, effective }).slice(0, 16)}`;
  source.crossSectionDerivation = {
    schema: ENDPOINT_TAPERED_PACKING_SOURCE_DERIVATION_SCHEMA,
    parentSource: {
      id: parentSource.id,
      input: parentInput,
    },
    requested,
    effective,
    fallbackUsed: false,
  };
  delete source.input;
  const sourceSha256 = hashJson(source);
  source.input = {
    requested: {
      kind: 'endpoint-tapered-packing-source',
      id: source.id,
      sha256: sourceSha256,
    },
    effective: {
      kind: 'endpoint-tapered-packing-source',
      id: source.id,
      sha256: sourceSha256,
    },
  };
  measureMuscleCompartmentPacking(source);
  return {
    source,
    receipt: {
      schema: ENDPOINT_TAPERED_PACKING_SOURCE_DERIVATION_SCHEMA,
      parentSource: {
        id: parentSource.id,
        input: parentInput,
      },
      requested,
      effective,
      fallbackUsed: false,
      derivedSource: structuredClone(source.input.effective),
    },
  };
}

function projectObstacle(point, radius, obstacle, muscleIndex, knotIndex, amount) {
  const nearest = closestPointOnObstacle(point, obstacle);
  const offset = subtract(point, nearest);
  const required = radius + obstacleRadius(obstacle);
  const separation = length(offset);
  if (separation >= required) return point;
  const direction = normalizedOrFallback(offset, muscleIndex, knotIndex);
  return add(point, scale(direction, (required - separation) * amount));
}

function projectCompartment(point, radius, compartment, amount) {
  return point.map((value, axis) => {
    const minimum = compartment.minimum[axis] + compartment.clearance + radius;
    const maximum = compartment.maximum[axis] - compartment.clearance - radius;
    if (maximum < minimum) throw new Error('muscle radius cannot fit inside compartment bounds');
    const projected = Math.max(minimum, Math.min(maximum, value));
    return value + (projected - value) * amount;
  });
}

function projectObstacles(source, muscles, amount, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const knot = muscle.centerline[knotIndex];
      for (const obstacle of source.obstacles) {
        applyAttributedPosition(
          attribution,
          category,
          muscles,
          muscleIndex,
          knotIndex,
          projectObstacle(
            knot.position,
            knot.radius,
            obstacle,
            muscleIndex,
            knotIndex,
            amount,
          ),
        );
      }
    }
  }
}

function projectBounds(source, muscles, amount, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const knot = muscle.centerline[knotIndex];
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        projectCompartment(knot.position, knot.radius, source.compartment, amount),
      );
    }
  }
}

function emptyCorrectionMeasures() {
  return {
    cumulativeAppliedKnotDisplacement: 0,
    cumulativeAppliedRadiusChange: 0,
    appliedPrimitiveCount: 0,
  };
}

function createCorrectionAttribution(muscles) {
  return muscles.map(muscle => ({
    muscleId: muscle.id,
    corrections: Object.fromEntries(
      CORRECTION_CATEGORIES.map(category => [category, emptyCorrectionMeasures()]),
    ),
  }));
}

function applyAttributedPosition(
  attribution,
  category,
  muscles,
  muscleIndex,
  knotIndex,
  nextPosition,
) {
  const knot = muscles[muscleIndex].centerline[knotIndex];
  const appliedDelta = distance(knot.position, nextPosition);
  knot.position = nextPosition;
  if (appliedDelta > 0) {
    const measures = attribution[muscleIndex].corrections[category];
    measures.cumulativeAppliedKnotDisplacement += appliedDelta;
    measures.appliedPrimitiveCount += 1;
  }
}

function applyAttributedRadius(attribution, category, muscles, muscleIndex, knotIndex, radius) {
  const knot = muscles[muscleIndex].centerline[knotIndex];
  const appliedDelta = Math.abs(knot.radius - radius);
  knot.radius = radius;
  if (appliedDelta > 0) {
    const measures = attribution[muscleIndex].corrections[category];
    measures.cumulativeAppliedRadiusChange += appliedDelta;
    measures.appliedPrimitiveCount += 1;
  }
}

function correctionAttributionReceipt(attribution) {
  const totals = Object.fromEntries(
    CORRECTION_CATEGORIES.map(category => [category, emptyCorrectionMeasures()]),
  );
  const byMuscle = attribution.map(row => ({
    muscleId: row.muscleId,
    corrections: Object.fromEntries(CORRECTION_CATEGORIES.map(category => {
      const measures = row.corrections[category];
      totals[category].cumulativeAppliedKnotDisplacement +=
        measures.cumulativeAppliedKnotDisplacement;
      totals[category].cumulativeAppliedRadiusChange +=
        measures.cumulativeAppliedRadiusChange;
      totals[category].appliedPrimitiveCount += measures.appliedPrimitiveCount;
      return [category, {
        cumulativeAppliedKnotDisplacement: rounded(
          measures.cumulativeAppliedKnotDisplacement,
        ),
        cumulativeAppliedRadiusChange: rounded(measures.cumulativeAppliedRadiusChange),
        appliedPrimitiveCount: measures.appliedPrimitiveCount,
      }];
    })),
  }));
  return {
    schema: CORRECTION_ATTRIBUTION_SCHEMA,
    interpretation: 'algorithmic-projection-path-length-not-physical-force',
    aggregation: 'sum-of-primitive-applied-deltas',
    categories: [...CORRECTION_CATEGORIES],
    byMuscle,
    totals: Object.fromEntries(CORRECTION_CATEGORIES.map(category => [category, {
      cumulativeAppliedKnotDisplacement: rounded(
        totals[category].cumulativeAppliedKnotDisplacement,
      ),
      cumulativeAppliedRadiusChange: rounded(totals[category].cumulativeAppliedRadiusChange),
      appliedPrimitiveCount: totals[category].appliedPrimitiveCount,
    }])),
  };
}

function emptyPositionDeltas(muscles) {
  return muscles.map(muscle => muscle.centerline.map(() => [0, 0, 0]));
}

function pairwiseCoordinateDelta(source, muscleIndex, knotIndex, delta, coordinate) {
  if (coordinate !== 'source-normal') return delta;
  const centerline = source.muscles[muscleIndex].centerline;
  const priorIndex = Math.max(0, knotIndex - 1);
  const nextIndex = Math.min(centerline.length - 1, knotIndex + 1);
  const tangentVector = subtract(
    centerline[nextIndex].position,
    centerline[priorIndex].position,
  );
  const tangentLength = length(tangentVector);
  if (tangentLength <= 1e-12) {
    throw new Error(
      `muscle ${source.muscles[muscleIndex].id} source tangent is undefined at knot ${knotIndex}`,
    );
  }
  const tangent = scale(tangentVector, 1 / tangentLength);
  return subtract(delta, scale(tangent, dot(delta, tangent)));
}

function applyPositionDeltas(source, muscles, deltas, attribution, category, coordinate) {
  for (const [muscleIndex, muscleDeltas] of deltas.entries()) {
    for (const [knotIndex, delta] of muscleDeltas.entries()) {
      if (length(delta) <= 0) continue;
      const coordinateDelta = pairwiseCoordinateDelta(
        source,
        muscleIndex,
        knotIndex,
        delta,
        coordinate,
      );
      if (length(coordinateDelta) <= 0) continue;
      const knot = muscles[muscleIndex].centerline[knotIndex];
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        add(knot.position, coordinateDelta),
      );
    }
  }
}

function projectPairwise(source, muscles, amount, attribution, category, update, coordinate) {
  const knotCount = muscles[0].centerline.length;
  const batched = update === 'reciprocal-batched';
  const centerlines = batched
    ? muscles.map(muscle => structuredClone(muscle.centerline))
    : muscles.map(muscle => muscle.centerline);
  const deltas = batched ? emptyPositionDeltas(muscles) : null;
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      for (let leftKnotIndex = 0; leftKnotIndex < knotCount; leftKnotIndex += 1) {
        for (let rightKnotIndex = 0; rightKnotIndex < knotCount; rightKnotIndex += 1) {
          const leftMovable = leftKnotIndex > 0 && leftKnotIndex < knotCount - 1;
          const rightMovable = rightKnotIndex > 0 && rightKnotIndex < knotCount - 1;
          if (!leftMovable && !rightMovable) continue;
          const left = centerlines[leftIndex][leftKnotIndex];
          const right = centerlines[rightIndex][rightKnotIndex];
          const offset = subtract(left.position, right.position);
          const separation = length(offset);
          const required = left.radius + right.radius;
          if (separation >= required) continue;
          const direction = normalizedOrFallback(
            offset,
            leftIndex + leftKnotIndex,
            rightIndex + rightKnotIndex,
          );
          const movableCount = Number(leftMovable) + Number(rightMovable);
          const correction = scale(
            direction,
            (required - separation) * amount / movableCount,
          );
          if (leftMovable) {
            if (batched) {
              deltas[leftIndex][leftKnotIndex] = add(
                deltas[leftIndex][leftKnotIndex],
                correction,
              );
            } else {
              const coordinateCorrection = pairwiseCoordinateDelta(
                source,
                leftIndex,
                leftKnotIndex,
                correction,
                coordinate,
              );
              applyAttributedPosition(
                attribution,
                category,
                muscles,
                leftIndex,
                leftKnotIndex,
                add(left.position, coordinateCorrection),
              );
            }
          }
          if (rightMovable) {
            if (batched) {
              deltas[rightIndex][rightKnotIndex] = subtract(
                deltas[rightIndex][rightKnotIndex],
                correction,
              );
            } else {
              const coordinateCorrection = pairwiseCoordinateDelta(
                source,
                rightIndex,
                rightKnotIndex,
                scale(correction, -1),
                coordinate,
              );
              applyAttributedPosition(
                attribution,
                category,
                muscles,
                rightIndex,
                rightKnotIndex,
                add(right.position, coordinateCorrection),
              );
            }
          }
        }
      }
    }
  }
  if (batched) {
    applyPositionDeltas(source, muscles, deltas, attribution, category, coordinate);
  }
}

function segmentPointMutableResponse(centerline, segmentIndex, segmentT) {
  const weights = [1 - segmentT, segmentT];
  const mutable = [
    segmentIndex > 0,
    segmentIndex + 1 < centerline.length - 1,
  ];
  return weights.reduce(
    (sum, weight, endpoint) => sum + (mutable[endpoint] ? weight ** 2 : 0),
    0,
  );
}

function moveSegmentPoint(
  source,
  muscles,
  muscleIndex,
  segmentIndex,
  segmentT,
  displacement,
  attribution,
  category,
  coordinate = 'cartesian',
) {
  const centerline = muscles[muscleIndex].centerline;
  const weights = [1 - segmentT, segmentT];
  const mutable = [
    segmentIndex > 0,
    segmentIndex + 1 < centerline.length - 1,
  ];
  const response = segmentPointMutableResponse(centerline, segmentIndex, segmentT);
  if (response <= 1e-18) return false;
  for (let endpoint = 0; endpoint < 2; endpoint += 1) {
    if (!mutable[endpoint]) continue;
    const knot = centerline[segmentIndex + endpoint];
    const knotIndex = segmentIndex + endpoint;
    const coordinateDisplacement = pairwiseCoordinateDelta(
      source,
      muscleIndex,
      knotIndex,
      scale(displacement, weights[endpoint]),
      coordinate,
    );
    // Do not divide by the response. Near a fixed attachment that would turn
    // an infinitesimal contact weight into unbounded interior-knot motion.
    applyAttributedPosition(
      attribution,
      category,
      muscles,
      muscleIndex,
      knotIndex,
      add(knot.position, coordinateDisplacement),
    );
  }
  return true;
}

function accumulateSegmentPoint(
  deltas,
  centerline,
  muscleIndex,
  segmentIndex,
  segmentT,
  displacement,
) {
  const weights = [1 - segmentT, segmentT];
  if (segmentPointMutableResponse(centerline, segmentIndex, segmentT) <= 1e-18) return false;
  for (let endpoint = 0; endpoint < 2; endpoint += 1) {
    const knotIndex = segmentIndex + endpoint;
    if (knotIndex <= 0 || knotIndex >= centerline.length - 1) continue;
    deltas[muscleIndex][knotIndex] = add(
      deltas[muscleIndex][knotIndex],
      scale(displacement, weights[endpoint]),
    );
  }
  return true;
}

function projectSegmentObstacles(source, muscles, amount, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    for (let segmentIndex = 0; segmentIndex < muscle.centerline.length - 1; segmentIndex += 1) {
      const segmentStart = muscle.centerline[segmentIndex];
      const segmentEnd = muscle.centerline[segmentIndex + 1];
      for (const [obstacleIndex, obstacle] of source.obstacles.entries()) {
        const obstacleStart = obstacle.kind === 'capsule'
          ? { position:obstacle.start, radius:obstacleRadius(obstacle) }
          : { position:obstacle.center, radius:obstacleRadius(obstacle) };
        const obstacleEnd = obstacle.kind === 'capsule'
          ? { position:obstacle.end, radius:obstacleRadius(obstacle) }
          : obstacleStart;
        const spatialParameters = closestSegmentParameters(
          segmentStart.position,
          segmentEnd.position,
          obstacleStart.position,
          obstacleEnd.position,
        );
        const musclePoint = interpolatePoint(
          segmentStart.position,
          segmentEnd.position,
          spatialParameters.leftT,
        );
        const obstaclePoint = interpolatePoint(
          obstacleStart.position,
          obstacleEnd.position,
          spatialParameters.rightT,
        );
        if (
          distance(musclePoint, obstaclePoint) -
            Math.max(segmentStart.radius, segmentEnd.radius) - obstacleStart.radius >= 0
        ) continue;
        const { leftT, rightT, gap } = taperedSegmentSurfaceMinimum(
          segmentStart,
          segmentEnd,
          obstacleStart,
          obstacleEnd,
        );
        if (gap >= 0) continue;
        const contactMusclePoint = interpolatePoint(
          segmentStart.position,
          segmentEnd.position,
          leftT,
        );
        const contactObstaclePoint = interpolatePoint(
          obstacleStart.position,
          obstacleEnd.position,
          rightT,
        );
        const direction = normalizedOrFallback(
          subtract(contactMusclePoint, contactObstaclePoint),
          muscleIndex + segmentIndex,
          obstacleIndex,
        );
        moveSegmentPoint(
          source,
          muscles,
          muscleIndex,
          segmentIndex,
          leftT,
          scale(direction, -gap * amount),
          attribution,
          category,
        );
      }
    }
  }
}

function projectSegmentPairwise(
  source,
  muscles,
  amount,
  attribution,
  category,
  update,
  coordinate,
) {
  const batched = update === 'reciprocal-batched';
  const centerlines = batched
    ? muscles.map(muscle => structuredClone(muscle.centerline))
    : muscles.map(muscle => muscle.centerline);
  const deltas = batched ? emptyPositionDeltas(muscles) : null;
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    const leftCenterline = centerlines[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const rightCenterline = centerlines[rightIndex];
      for (let leftSegment = 0; leftSegment < leftCenterline.length - 1; leftSegment += 1) {
        for (
          let rightSegment = 0;
          rightSegment < rightCenterline.length - 1;
          rightSegment += 1
        ) {
          const leftStart = leftCenterline[leftSegment];
          const leftEnd = leftCenterline[leftSegment + 1];
          const rightStart = rightCenterline[rightSegment];
          const rightEnd = rightCenterline[rightSegment + 1];
          const spatialParameters = closestSegmentParameters(
            leftStart.position,
            leftEnd.position,
            rightStart.position,
            rightEnd.position,
          );
          const spatialLeftPoint = interpolatePoint(
            leftStart.position,
            leftEnd.position,
            spatialParameters.leftT,
          );
          const spatialRightPoint = interpolatePoint(
            rightStart.position,
            rightEnd.position,
            spatialParameters.rightT,
          );
          const possibleSurfaceGap = distance(spatialLeftPoint, spatialRightPoint) -
            Math.max(leftStart.radius, leftEnd.radius) -
            Math.max(rightStart.radius, rightEnd.radius);
          // Minimum centerline distance minus both maximum endpoint radii is a
          // safe broad-phase lower bound for linearly tapered segments.
          if (possibleSurfaceGap >= 0) continue;
          const { leftT, rightT, gap } = taperedSegmentSurfaceMinimum(
            leftStart,
            leftEnd,
            rightStart,
            rightEnd,
          );
          const leftPoint = interpolatePoint(leftStart.position, leftEnd.position, leftT);
          const rightPoint = interpolatePoint(rightStart.position, rightEnd.position, rightT);
          const leftRadius = interpolate(leftStart.radius, leftEnd.radius, leftT);
          const rightRadius = interpolate(rightStart.radius, rightEnd.radius, rightT);
          const offset = subtract(leftPoint, rightPoint);
          const separation = length(offset);
          const overlap = Math.max(leftRadius + rightRadius - separation, -gap);
          if (overlap <= 0) continue;
          const direction = normalizedOrFallback(
            offset,
            leftIndex + leftSegment,
            rightIndex + rightSegment,
          );
          const leftCanMove = segmentPointMutableResponse(
            leftCenterline,
            leftSegment,
            leftT,
          ) > 1e-18;
          const rightCanMove = segmentPointMutableResponse(
            rightCenterline,
            rightSegment,
            rightT,
          ) > 1e-18;
          const movableSideCount = Number(leftCanMove) + Number(rightCanMove);
          if (movableSideCount === 0) continue;
          const correction = overlap * amount / movableSideCount;
          if (leftCanMove) {
            if (batched) {
              accumulateSegmentPoint(
                deltas,
                leftCenterline,
                leftIndex,
                leftSegment,
                leftT,
                scale(direction, correction),
              );
            } else {
              moveSegmentPoint(
                source,
                muscles,
                leftIndex,
                leftSegment,
                leftT,
                scale(direction, correction),
                attribution,
                category,
                coordinate,
              );
            }
          }
          if (rightCanMove) {
            if (batched) {
              accumulateSegmentPoint(
                deltas,
                rightCenterline,
                rightIndex,
                rightSegment,
                rightT,
                scale(direction, -correction),
              );
            } else {
              moveSegmentPoint(
                source,
                muscles,
                rightIndex,
                rightSegment,
                rightT,
                scale(direction, -correction),
                attribution,
                category,
                coordinate,
              );
            }
          }
        }
      }
    }
  }
  if (batched) {
    applyPositionDeltas(source, muscles, deltas, attribution, category, coordinate);
  }
}

function restoreTargetVolumes(muscles, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const currentVolume = carrierVolume(muscle.centerline);
    if (!Number.isFinite(currentVolume) || currentVolume <= 0) {
      throw new Error(`muscle ${muscle.id} produced invalid carrier volume`);
    }
    const radiusScale = Math.sqrt(muscle.targetVolume / currentVolume);
    for (const [knotIndex, knot] of muscle.centerline.entries()) {
      applyAttributedRadius(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        knot.radius * radiusScale,
      );
    }
  }
}

function redistributePairwiseCrossSections(muscles, amount, attribution, category) {
  const pressures = muscles.map(muscle => muscle.centerline.map(() => 0));
  const knotCount = muscles[0].centerline.length;
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      for (let leftKnotIndex = 1; leftKnotIndex < knotCount - 1; leftKnotIndex += 1) {
        for (let rightKnotIndex = 1; rightKnotIndex < knotCount - 1; rightKnotIndex += 1) {
          const left = muscles[leftIndex].centerline[leftKnotIndex];
          const right = muscles[rightIndex].centerline[rightKnotIndex];
          const required = left.radius + right.radius;
          const overlap = required - distance(left.position, right.position);
          if (overlap <= 0 || required <= 0) continue;
          const normalizedPressure = overlap / required;
          pressures[leftIndex][leftKnotIndex] = Math.max(
            pressures[leftIndex][leftKnotIndex],
            normalizedPressure,
          );
          pressures[rightIndex][rightKnotIndex] = Math.max(
            pressures[rightIndex][rightKnotIndex],
            normalizedPressure,
          );
        }
      }
    }
  }
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const interiorPressures = pressures[muscleIndex].slice(1, -1);
    const meanPressure = interiorPressures.reduce((sum, value) => sum + value, 0) /
      interiorPressures.length;
    for (let knotIndex = 1; knotIndex < knotCount - 1; knotIndex += 1) {
      const pressureOffset = pressures[muscleIndex][knotIndex] - meanPressure;
      if (Math.abs(pressureOffset) <= 1e-15) continue;
      const knot = muscle.centerline[knotIndex];
      applyAttributedRadius(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        knot.radius * Math.exp(-amount * pressureOffset),
      );
    }
  }
}

function smoothInteriorDisplacement(source, muscles, amount, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceCenterline = source.muscles[muscleIndex].centerline;
    const prior = muscle.centerline.map(knot => [...knot.position]);
    const priorDisplacements = prior.map((position, index) =>
      subtract(position, sourceCenterline[index].position));
    for (let index = 1; index < muscle.centerline.length - 1; index += 1) {
      const midpointDisplacement = scale(
        add(priorDisplacements[index - 1], priorDisplacements[index + 1]),
        0.5,
      );
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        index,
        add(prior[index], scale(
          subtract(midpointDisplacement, priorDisplacements[index]),
          amount,
        )),
      );
    }
  }
}

function smoothInteriorAbsolute(muscles, amount, attribution, category) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const prior = muscle.centerline.map(knot => [...knot.position]);
    for (let index = 1; index < muscle.centerline.length - 1; index += 1) {
      const midpoint = scale(add(prior[index - 1], prior[index + 1]), 0.5);
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        index,
        add(prior[index], scale(subtract(midpoint, prior[index]), amount)),
      );
    }
  }
}

function denseDot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function solveDenseLinearSystem(matrix, rightHandSide) {
  const size = rightHandSide.length;
  const rows = matrix.map((row, index) => [...row, rightHandSide[index]]);
  const scaleMaximum = Math.max(1, ...matrix.flat().map(Math.abs));
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) <= scaleMaximum * 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const pivotValue = rows[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      rows[column][entry] /= pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }
  return rows.map(row => row[size]);
}

function sourceCurvatureConstraints(sourceCenterline, projectionRatio = 1e-6) {
  const variableCount = (sourceCenterline.length - 2) * 3;
  const coefficients = [1, -2, 1];
  const constraints = [];
  for (let knotIndex = 1; knotIndex < sourceCenterline.length - 1; knotIndex += 1) {
    const sourceCurvature = centerlineSecondDifference(sourceCenterline, knotIndex);
    const sourceMagnitudeSquared = dot(sourceCurvature, sourceCurvature);
    if (sourceMagnitudeSquared <= 1e-24) continue;
    const row = Array(variableCount).fill(0);
    let fixedContribution = 0;
    for (let localIndex = 0; localIndex < 3; localIndex += 1) {
      const targetKnotIndex = knotIndex + localIndex - 1;
      const coefficient = coefficients[localIndex];
      if (targetKnotIndex > 0 && targetKnotIndex < sourceCenterline.length - 1) {
        const variableOffset = (targetKnotIndex - 1) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          row[variableOffset + axis] += coefficient * sourceCurvature[axis];
        }
      } else {
        fixedContribution += coefficient * dot(
          sourceCurvature,
          sourceCenterline[targetKnotIndex].position,
        );
      }
    }
    constraints.push({
      row,
      lowerBound:sourceMagnitudeSquared * projectionRatio - fixedContribution,
      tolerance:sourceMagnitudeSquared * 1e-12,
    });
  }
  return constraints;
}

function sourceCurvatureFrameConstraints(sourceCenterline, config) {
  const variableCount = (sourceCenterline.length - 2) * 3;
  const coefficients = [1, -2, 1];
  const constraints = [];
  const appendConstraint = (knotIndex, direction, lowerBound, sign = 1) => {
    const row = Array(variableCount).fill(0);
    let fixedContribution = 0;
    for (let localIndex = 0; localIndex < 3; localIndex += 1) {
      const targetKnotIndex = knotIndex + localIndex - 1;
      const coefficient = coefficients[localIndex] * sign;
      if (targetKnotIndex > 0 && targetKnotIndex < sourceCenterline.length - 1) {
        const variableOffset = (targetKnotIndex - 1) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          row[variableOffset + axis] += coefficient * direction[axis];
        }
      } else {
        fixedContribution += coefficient * dot(
          direction,
          sourceCenterline[targetKnotIndex].position,
        );
      }
    }
    constraints.push({
      row,
      lowerBound:lowerBound - fixedContribution,
      tolerance:Math.max(1, Math.abs(lowerBound)) * 1e-12,
    });
  };
  for (let knotIndex = 1; knotIndex < sourceCenterline.length - 1; knotIndex += 1) {
    const sourceCurvature = centerlineSecondDifference(sourceCenterline, knotIndex);
    const sourceMagnitude = length(sourceCurvature);
    const sourceMagnitudeSquared = sourceMagnitude ** 2;
    if (sourceMagnitudeSquared <= 1e-24) continue;
    appendConstraint(
      knotIndex,
      sourceCurvature,
      sourceMagnitudeSquared * config.minimumSourceCurvatureProjectionRatio,
    );
    appendConstraint(
      knotIndex,
      sourceCurvature,
      -sourceMagnitudeSquared * Math.sqrt(config.maximumSourceBendEnergyRatio),
      -1,
    );
    const sourceDirection = scale(sourceCurvature, 1 / sourceMagnitude);
    const leastAlignedAxis = Math.abs(sourceDirection[0]) <= Math.abs(sourceDirection[1]) &&
      Math.abs(sourceDirection[0]) <= Math.abs(sourceDirection[2])
      ? [1, 0, 0]
      : Math.abs(sourceDirection[1]) <= Math.abs(sourceDirection[2])
        ? [0, 1, 0]
        : [0, 0, 1];
    const firstPerpendicularRaw = cross(sourceDirection, leastAlignedAxis);
    const firstPerpendicular = scale(firstPerpendicularRaw, 1 / length(firstPerpendicularRaw));
    const secondPerpendicular = cross(sourceDirection, firstPerpendicular);
    for (const perpendicular of [firstPerpendicular, secondPerpendicular]) {
      const scaledPerpendicular = scale(perpendicular, sourceMagnitude);
      appendConstraint(knotIndex, scaledPerpendicular, 0);
      appendConstraint(knotIndex, scaledPerpendicular, 0, -1);
    }
  }
  return constraints;
}

function sourceTangentConstraints(sourceCenterline, projectionRatio) {
  const variableCount = (sourceCenterline.length - 2) * 3;
  const constraints = [];
  for (let segmentIndex = 0; segmentIndex < sourceCenterline.length - 1; segmentIndex += 1) {
    const sourceTangent = subtract(
      sourceCenterline[segmentIndex + 1].position,
      sourceCenterline[segmentIndex].position,
    );
    const sourceMagnitudeSquared = dot(sourceTangent, sourceTangent);
    if (sourceMagnitudeSquared <= 1e-24) continue;
    const row = Array(variableCount).fill(0);
    let fixedContribution = 0;
    for (const [targetKnotIndex, coefficient] of [
      [segmentIndex, -1],
      [segmentIndex + 1, 1],
    ]) {
      if (targetKnotIndex > 0 && targetKnotIndex < sourceCenterline.length - 1) {
        const variableOffset = (targetKnotIndex - 1) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          row[variableOffset + axis] += coefficient * sourceTangent[axis];
        }
      } else {
        fixedContribution += coefficient * dot(
          sourceTangent,
          sourceCenterline[targetKnotIndex].position,
        );
      }
    }
    constraints.push({
      row,
      lowerBound:sourceMagnitudeSquared * projectionRatio - fixedContribution,
      tolerance:sourceMagnitudeSquared * 1e-12,
    });
  }
  return constraints;
}

function minimumHalfspaceProjection(initial, constraints) {
  if (constraints.length === 0) return initial;
  const active = [];
  let projected = [...initial];
  const iterationLimit = constraints.length ** 2 * 4 + 4;
  for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
    if (active.length > 0) {
      const gram = active.map(leftIndex => active.map(rightIndex =>
        denseDot(constraints[leftIndex].row, constraints[rightIndex].row)));
      const rightHandSide = active.map(index =>
        constraints[index].lowerBound - denseDot(constraints[index].row, initial));
      const multipliers = solveDenseLinearSystem(gram, rightHandSide);
      if (!multipliers) {
        throw new Error('source-curvature halfspace active constraints are singular');
      }
      let negativeMultiplier = -1;
      for (let index = 0; index < multipliers.length; index += 1) {
        if (multipliers[index] < -1e-12 && (
          negativeMultiplier < 0 ||
          multipliers[index] < multipliers[negativeMultiplier]
        )) negativeMultiplier = index;
      }
      if (negativeMultiplier >= 0) {
        active.splice(negativeMultiplier, 1);
        continue;
      }
      projected = initial.map((value, variableIndex) => value + active.reduce(
        (sum, constraintIndex, activeIndex) =>
          sum + multipliers[activeIndex] * constraints[constraintIndex].row[variableIndex],
        0,
      ));
    }
    let mostViolated = -1;
    let mostNegativeGap = 0;
    for (const [constraintIndex, constraint] of constraints.entries()) {
      const gap = denseDot(constraint.row, projected) - constraint.lowerBound;
      if (gap < -constraint.tolerance && gap < mostNegativeGap) {
        mostViolated = constraintIndex;
        mostNegativeGap = gap;
      }
    }
    if (mostViolated < 0) return projected;
    if (!active.includes(mostViolated)) active.push(mostViolated);
  }
  throw new Error('source-curvature halfspace active-set projection did not stabilize');
}

function projectSourceFormation(source, muscles, attribution, category, config) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceCenterline = source.muscles[muscleIndex].centerline;
    const initial = muscle.centerline.slice(1, -1).flatMap(knot => knot.position);
    const constraints = config.curvatureUpdate === 'source-frame-halfspace'
      ? [
          ...sourceTangentConstraints(
            sourceCenterline,
            config.minimumSourceTangentProjectionRatio,
          ),
          ...sourceCurvatureFrameConstraints(sourceCenterline, config),
        ]
      : sourceCurvatureConstraints(sourceCenterline);
    const projected = minimumHalfspaceProjection(
      initial,
      constraints,
    );
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const offset = (knotIndex - 1) * 3;
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        projected.slice(offset, offset + 3),
      );
    }
  }
}

function projectCapsuleAxisBellyTurn(source, muscles, attribution, category, config) {
  const obstacle = source.obstacles.find(row => row.id === config.clusterObstacleId);
  if (!obstacle) {
    throw new Error(`capsule-axis-belly-turn obstacle not found: ${config.clusterObstacleId}`);
  }
  if (obstacle.kind !== 'capsule') {
    throw new Error('capsule-axis-belly-turn requires a capsule obstacle');
  }
  const axisVector = subtract(obstacle.end, obstacle.start);
  const axisLength = length(axisVector);
  if (axisLength <= 1e-12) throw new Error('capsule-axis-belly-turn obstacle axis is degenerate');
  const axis = scale(axisVector, 1 / axisLength);
  const chirality = config.clusterChirality === 'positive' ? 1 : -1;
  const allocationByMuscleId = new Map(
    (config.clusterAllocationSchedule || []).map(allocation => [
      allocation.muscleId,
      allocation.axialOffset,
    ]),
  );
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceCenterline = source.muscles[muscleIndex].centerline;
    const attachmentRadialLengths = [sourceCenterline[0], sourceCenterline.at(-1)].map(
      knot => length(subtract(knot.position, closestPointOnObstacle(knot.position, obstacle))),
    );
    const envelopeMaximum = Math.max(
      ...sourceCenterline.slice(1, -1).map((_, interiorIndex) =>
        Math.sin(Math.PI * (interiorIndex + 1) / (sourceCenterline.length - 1))),
    );
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const sourcePosition = sourceCenterline[knotIndex].position;
      const axisPoint = closestPointOnObstacle(sourcePosition, obstacle);
      const sourceRadial = subtract(sourcePosition, axisPoint);
      const sourceRadialLength = length(sourceRadial);
      if (sourceRadialLength <= 1e-12) {
        throw new Error(
          `muscle ${muscle.id} source knot ${knotIndex} has undefined capsule radial direction`,
        );
      }
      const progress = knotIndex / (muscle.centerline.length - 1);
      const envelope = Math.sin(Math.PI * progress) / envelopeMaximum;
      const radialReference = config.clusterRadialReference === 'attachment-bridge'
        ? attachmentRadialLengths[0] * (1 - progress) + attachmentRadialLengths[1] * progress
        : sourceRadialLength;
      const targetRadius = radialReference +
        (config.clusterBellyRadius - radialReference) * envelope;
      const turnedDirection = rotateAroundAxis(
        scale(sourceRadial, 1 / sourceRadialLength),
        axis,
        chirality * config.clusterTurnRadians * envelope,
      );
      const allocatedAxisPoint = add(
        axisPoint,
        scale(axis, (allocationByMuscleId.get(muscle.id) || 0) * envelope),
      );
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        add(allocatedAxisPoint, scale(turnedDirection, targetRadius)),
      );
    }
  }
}

function occupancyCapsuleFrame(source, config) {
  const obstacle = source.obstacles.find(row => row.id === config.clusterObstacleId);
  if (!obstacle) {
    throw new Error(
      `capsule-axis-occupancy-allocation obstacle not found: ${config.clusterObstacleId}`,
    );
  }
  if (obstacle.kind !== 'capsule') {
    throw new Error('capsule-axis-occupancy-allocation requires a capsule obstacle');
  }
  const axisVector = subtract(obstacle.end, obstacle.start);
  const axisLength = length(axisVector);
  if (axisLength <= 1e-12) {
    throw new Error('capsule-axis-occupancy-allocation obstacle axis is degenerate');
  }
  return { obstacle, axis: scale(axisVector, 1 / axisLength) };
}

function effectiveOccupancyReferenceDirection(source, config) {
  const { axis } = occupancyCapsuleFrame(source, config);
  const requested = config.clusterOccupancyReferenceDirection;
  const projected = subtract(requested, scale(axis, dot(requested, axis)));
  const projectedLength = length(projected);
  if (projectedLength <= 1e-12) {
    throw new Error(
      'clusterOccupancyReferenceDirection must not be parallel to the capsule axis',
    );
  }
  return scale(projected, 1 / projectedLength);
}

function projectCapsuleAxisOccupancyAllocation(
  source,
  muscles,
  attribution,
  category,
  config,
) {
  const { obstacle, axis } = occupancyCapsuleFrame(source, config);
  const referenceDirection = effectiveOccupancyReferenceDirection(source, config);
  const allocationByMuscleId = new Map(
    config.clusterAllocationSchedule.map(allocation => [allocation.muscleId, allocation]),
  );
  const envelopeProfile = config.clusterOccupancyEnvelope || 'normalized-sine';
  const envelopeAt = progress => {
    const sine = Math.sin(Math.PI * progress);
    return envelopeProfile === 'normalized-sine-squared' ? sine ** 2 : sine;
  };
  for (const [muscleIndex, muscle] of muscles.entries()) {
    const sourceCenterline = source.muscles[muscleIndex].centerline;
    const allocation = allocationByMuscleId.get(muscle.id);
    const roleDirection = rotateAroundAxis(
      referenceDirection,
      axis,
      allocation.azimuthRadians,
    );
    const anchorKnotIndex = Math.floor((sourceCenterline.length - 1) / 2);
    const anchorPosition = sourceCenterline[anchorKnotIndex].position;
    const anchorAxisPoint = closestPointOnObstacle(anchorPosition, obstacle);
    const anchorOffset = subtract(anchorPosition, anchorAxisPoint);
    const anchorRadial = subtract(anchorOffset, scale(axis, dot(anchorOffset, axis)));
    const anchorRadialLength = length(anchorRadial);
    if (anchorRadialLength <= 1e-12) {
      throw new Error(`muscle ${muscle.id} belly anchor has undefined capsule radial direction`);
    }
    const anchorDirection = scale(anchorRadial, 1 / anchorRadialLength);
    const signedRoleAngle = Math.atan2(
      dot(axis, cross(anchorDirection, roleDirection)),
      dot(anchorDirection, roleDirection),
    );
    const radialOffset = allocation.radialDistance - anchorRadialLength;
    const envelopeMaximum = Math.max(
      ...sourceCenterline.slice(1, -1).map((_, interiorIndex) =>
        envelopeAt((interiorIndex + 1) / (sourceCenterline.length - 1))),
    );
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const sourcePosition = sourceCenterline[knotIndex].position;
      const axisPoint = closestPointOnObstacle(sourcePosition, obstacle);
      const sourceOffset = subtract(sourcePosition, axisPoint);
      const sourceAxialOffset = dot(sourceOffset, axis);
      const sourceRadial = subtract(sourceOffset, scale(axis, dot(sourceOffset, axis)));
      const sourceRadialLength = length(sourceRadial);
      if (sourceRadialLength <= 1e-12) {
        throw new Error(
          `muscle ${muscle.id} source knot ${knotIndex} has undefined capsule radial direction`,
        );
      }
      const sourceDirection = scale(sourceRadial, 1 / sourceRadialLength);
      const progress = knotIndex / (muscle.centerline.length - 1);
      const envelope = envelopeAt(progress) / envelopeMaximum;
      const allocatedDirection = rotateAroundAxis(
        sourceDirection,
        axis,
        signedRoleAngle * envelope,
      );
      const allocatedRadius = sourceRadialLength + radialOffset * envelope;
      const allocatedAxisPoint = add(
        axisPoint,
        scale(axis, sourceAxialOffset + allocation.axialOffset * envelope),
      );
      applyAttributedPosition(
        attribution,
        category,
        muscles,
        muscleIndex,
        knotIndex,
        add(allocatedAxisPoint, scale(allocatedDirection, allocatedRadius)),
      );
    }
  }
}

function residualMaximum(metrics) {
  return Math.max(
    metrics.pairwisePenetration,
    metrics.skeletalPenetration,
    metrics.compartmentEscape,
    metrics.endpointDrift,
    metrics.maximumRelativeVolumeError,
  );
}

function classifyTerminalResidual(metrics, continuousCandidateFailed) {
  if (continuousCandidateFailed) {
    return {
      status: 'continuous-clearance-failed',
      dominantMechanism: {
        kind: 'continuous-clearance-residual',
        residual: rounded(residualMaximum(metrics)),
      },
    };
  }
  const candidates = [
    {
      status: 'pairwise-exclusion-failed',
      kind: 'pairwise-exclusion-residual',
      residual: metrics.pairwisePenetration,
    },
    {
      status: 'skeletal-clearance-failed',
      kind: 'skeletal-clearance-residual',
      residual: metrics.skeletalPenetration,
    },
    {
      status: 'compartment-clearance-failed',
      kind: 'compartment-clearance-residual',
      residual: metrics.compartmentEscape,
    },
    {
      status: 'iteration-limit',
      kind: 'iteration-exhausted',
      residual: Math.max(
        metrics.endpointDrift,
        metrics.maximumRelativeVolumeError,
      ),
    },
  ];
  const dominant = candidates.reduce((best, candidate) =>
    candidate.residual > best.residual ? candidate : best);
  return {
    status: dominant.status,
    dominantMechanism: {
      kind: dominant.kind,
      residual: rounded(dominant.residual),
    },
  };
}

function classifySourceFormationRetention(initial, packed, config) {
  const bendEnergyRatio = initial.maximumBendEnergy > 1e-12
    ? packed.maximumBendEnergy / initial.maximumBendEnergy
    : 1;
  const violations = [];
  if (packed.sourceCurvatureReversalCount > 0) {
    violations.push({
      kind:'source-curvature-reversal',
      reversalCount:packed.sourceCurvatureReversalCount,
      minimumSourceCurvatureCosine:packed.minimumSourceCurvatureCosine,
    });
  }
  if (
    packed.sourceTangentReversalCount > 0 ||
    packed.minimumSourceTangentCosine < config.minimumSourceTangentCosine
  ) {
    violations.push({
      kind:'source-longitudinal-fold',
      reversalCount:packed.sourceTangentReversalCount,
      minimumSourceTangentCosine:packed.minimumSourceTangentCosine,
      requiredMinimumSourceTangentCosine:config.minimumSourceTangentCosine,
    });
  }
  if (
    packed.sourceCurvatureReversalCount === 0 &&
    packed.minimumSourceCurvatureCosine < config.minimumSourceCurvatureCosine
  ) {
    violations.push({
      kind:'source-curvature-alignment-loss',
      reversalCount:packed.sourceCurvatureReversalCount,
      minimumSourceCurvatureCosine:packed.minimumSourceCurvatureCosine,
      requiredMinimumSourceCurvatureCosine:config.minimumSourceCurvatureCosine,
    });
  }
  if (bendEnergyRatio > config.maximumSourceBendEnergyRatio) {
    violations.push({
      kind:'source-bend-energy-inflation',
      bendEnergyRatio:rounded(bendEnergyRatio),
      maximumSourceBendEnergyRatio:config.maximumSourceBendEnergyRatio,
      sourceMaximumBendEnergy:initial.maximumBendEnergy,
      packedMaximumBendEnergy:packed.maximumBendEnergy,
    });
  }
  if (
    config.minimumSourceBendEnergyRetention !== undefined &&
    packed.minimumSourceBendEnergyRetention < config.minimumSourceBendEnergyRetention
  ) {
    violations.push({
      kind:'source-bend-energy-collapse',
      minimumSourceBendEnergyRetention:packed.minimumSourceBendEnergyRetention,
      requiredMinimumSourceBendEnergyRetention:config.minimumSourceBendEnergyRetention,
    });
  }
  if (
    config.minimumPairwiseRelationCosine !== undefined &&
    packed.minimumPairwiseRelationCosine < config.minimumPairwiseRelationCosine
  ) {
    violations.push({
      kind:'source-pairwise-relation-loss',
      minimumPairwiseRelationCosine:packed.minimumPairwiseRelationCosine,
      requiredMinimumPairwiseRelationCosine:config.minimumPairwiseRelationCosine,
      reversalCount:packed.pairwiseRelationReversalCount,
    });
  }
  return {
    passed:violations.length === 0,
    dominantMechanism:violations[0] || null,
    violations,
  };
}

function immutableFixedAttachmentConflicts(source) {
  const blockingMechanisms = [];
  const endpoints = ['origin', 'insertion'];
  for (let leftIndex = 0; leftIndex < source.muscles.length; leftIndex += 1) {
    const leftMuscle = source.muscles[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < source.muscles.length; rightIndex += 1) {
      const rightMuscle = source.muscles[rightIndex];
      for (const leftEndpoint of endpoints) {
        const leftKnot = leftEndpoint === 'origin'
          ? leftMuscle.centerline[0]
          : leftMuscle.centerline.at(-1);
        for (const rightEndpoint of endpoints) {
          const rightKnot = rightEndpoint === 'origin'
            ? rightMuscle.centerline[0]
            : rightMuscle.centerline.at(-1);
          const penetration = rounded(
            leftKnot.radius + rightKnot.radius -
              distance(leftKnot.position, rightKnot.position),
          );
          if (penetration <= 0) continue;
          blockingMechanisms.push({
            kind: 'pairwise-fixed-attachment-penetration',
            left: {
              muscleId: leftMuscle.id,
              attachment: leftEndpoint,
              attachmentId: leftMuscle.attachments[leftEndpoint].id,
            },
            right: {
              muscleId: rightMuscle.id,
              attachment: rightEndpoint,
              attachmentId: rightMuscle.attachments[rightEndpoint].id,
            },
            penetration,
          });
        }
      }
    }
  }
  const axisNames = ['x', 'y', 'z'];
  for (const muscle of source.muscles) {
    for (const endpoint of endpoints) {
      const knot = endpoint === 'origin'
        ? muscle.centerline[0]
        : muscle.centerline.at(-1);
      const attachment = muscle.attachments[endpoint];
      for (const obstacle of source.obstacles) {
        const nearest = closestPointOnObstacle(knot.position, obstacle);
        const penetration = rounded(
          knot.radius + obstacleRadius(obstacle) - distance(knot.position, nearest),
        );
        if (penetration <= 0) continue;
        blockingMechanisms.push({
          kind: 'fixed-attachment-skeletal-penetration',
          muscleId: muscle.id,
          attachment: endpoint,
          attachmentId: attachment.id,
          obstacleId: obstacle.id,
          penetration,
        });
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const minimum = source.compartment.minimum[axis] +
          source.compartment.clearance + knot.radius;
        const maximum = source.compartment.maximum[axis] -
          source.compartment.clearance - knot.radius;
        const minimumEscape = rounded(minimum - knot.position[axis]);
        const maximumEscape = rounded(knot.position[axis] - maximum);
        if (minimumEscape > 0) {
          blockingMechanisms.push({
            kind: 'fixed-attachment-compartment-escape',
            muscleId: muscle.id,
            attachment: endpoint,
            attachmentId: attachment.id,
            axis: axisNames[axis],
            side: 'minimum',
            effectiveBound: rounded(minimum),
            escape: minimumEscape,
          });
        }
        if (maximumEscape > 0) {
          blockingMechanisms.push({
            kind: 'fixed-attachment-compartment-escape',
            muscleId: muscle.id,
            attachment: endpoint,
            attachmentId: attachment.id,
            axis: axisNames[axis],
            side: 'maximum',
            effectiveBound: rounded(maximum),
            escape: maximumEscape,
          });
        }
      }
    }
  }
  return blockingMechanisms;
}

export function measureMuscleCompartmentPacking(source, muscles = source.muscles, sampleCount = 25) {
  validateSource(source);
  return measureState(source, muscles, sampleCount, true);
}

export function solveMuscleCompartmentPacking(source, requestedConfig = {}) {
  validateSource(source);
  const config = Object.keys(requestedConfig).length === 0
    ? { ...DEFAULT_CONFIG }
    : { ...DEFAULT_CONFIG, ...structuredClone(requestedConfig) };
  validateConfig(config);
  validateClusterAllocationSource(config, source);
  const muscles = structuredClone(source.muscles);
  const correctionAttribution = createCorrectionAttribution(muscles);
  const initial = measureState(source, muscles, config.sampleCount, true);
  const blockingMechanisms = immutableFixedAttachmentConflicts(source);
  if (blockingMechanisms.length > 0) {
    return {
      schema: MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA,
      sourceSchema: source.schema,
      sourceId: source.id,
      sourceAuthority: structuredClone(source.authority),
      dimension: 3,
      formation: formationReceipt(source),
      pairwiseProjection: pairwiseProjectionReceipt(config),
      pairwiseCoordinate: pairwiseCoordinateReceipt(config),
      curvatureProjection: curvatureProjectionReceipt(config),
      crossSectionProjection: crossSectionProjectionReceipt(config),
      clusterProjection: clusterProjectionReceipt(config, source),
      clearanceValidation: {
        kind: 'conservative-continuous-piecewise-linear',
        centerlineDistance: 'nested-convex-golden-section',
        segmentRadiusBound: 'linear-taper-with-lipschitz-search-bound',
        sampledSupplementCount: config.sampleCount,
      },
      status: 'immutable-constraint-conflict',
      iterations: 0,
      correctionAttribution: correctionAttributionReceipt(correctionAttribution),
      input: structuredClone(source.input),
      config,
      compartment: structuredClone(source.compartment),
      obstacles: structuredClone(source.obstacles),
      muscles: muscles.map(muscle => ({
        ...structuredClone(muscle),
        realizedVolume: rounded(carrierVolume(muscle.centerline)),
      })),
      metrics: { initial, packed: structuredClone(initial) },
      iterationHistory: [],
      failure: {
        phase: 'preflight',
        kind: 'immutable-constraint-conflict',
        sourceId: source.id,
        blockingMechanisms,
      },
    };
  }
  if (config.clusterUpdate === 'capsule-axis-occupancy-allocation') {
    projectCapsuleAxisOccupancyAllocation(
      source,
      muscles,
      correctionAttribution,
      'formationConstraint',
      config,
    );
  }
  const iterationHistory = [];
  let packed = initial;
  let status = 'iteration-limit';
  let iterations = 0;
  let continuousCandidateFailed = false;
  let failure = null;
  const preservesSourceFormation =
    source.formation?.centerlineSmoothingReference === 'source-displacement';
  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const smoothingHorizon = preservesSourceFormation
      ? Math.min(config.maxIterations * 0.5, 320)
      : config.maxIterations * 0.8;
    const smoothingProgress = Math.max(
      0,
      1 - iteration / smoothingHorizon,
    );
    const smoothingAmount = config.smoothnessStep * smoothingProgress ** 2;
    if (preservesSourceFormation) {
      smoothInteriorDisplacement(
        source,
        muscles,
        smoothingAmount,
        correctionAttribution,
        'sourceSmoothing',
      );
    } else {
      smoothInteriorAbsolute(
        muscles,
        smoothingAmount,
        correctionAttribution,
        'sourceSmoothing',
      );
    }
    projectObstacles(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'skeletalClearance',
    );
    projectBounds(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'compartmentProjection',
    );
    projectSegmentObstacles(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'skeletalClearance',
    );
    projectPairwise(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'pairwiseExclusion',
      config.pairwiseUpdate || 'sequential',
      config.pairwiseCoordinate || 'cartesian',
    );
    projectSegmentPairwise(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'pairwiseExclusion',
      config.pairwiseUpdate || 'sequential',
      config.pairwiseCoordinate || 'cartesian',
    );
    projectObstacles(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'skeletalClearance',
    );
    projectBounds(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'compartmentProjection',
    );
    if (config.crossSectionUpdate === 'contact-redistributed') {
      redistributePairwiseCrossSections(
        muscles,
        config.crossSectionStep,
        correctionAttribution,
        'volumeRestoration',
      );
    }
    restoreTargetVolumes(muscles, correctionAttribution, 'volumeRestoration');
    projectObstacles(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'skeletalClearance',
    );
    projectBounds(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'compartmentProjection',
    );
    projectPairwise(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'pairwiseExclusion',
      config.pairwiseUpdate || 'sequential',
      config.pairwiseCoordinate || 'cartesian',
    );
    projectSegmentPairwise(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'pairwiseExclusion',
      config.pairwiseUpdate || 'sequential',
      config.pairwiseCoordinate || 'cartesian',
    );
    projectObstacles(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'skeletalClearance',
    );
    projectBounds(
      source,
      muscles,
      config.relaxationStep,
      correctionAttribution,
      'compartmentProjection',
    );
    if (config.clusterUpdate === 'capsule-axis-belly-turn') {
      projectCapsuleAxisBellyTurn(
        source,
        muscles,
        correctionAttribution,
        'formationConstraint',
        config,
      );
    }
    if (
      config.curvatureUpdate === 'source-sign-halfspace' ||
      config.curvatureUpdate === 'source-frame-halfspace'
    ) {
      projectSourceFormation(
        source,
        muscles,
        correctionAttribution,
        'formationConstraint',
        config,
      );
    }
    restoreTargetVolumes(muscles, correctionAttribution, 'volumeRestoration');
    packed = measureState(source, muscles, config.sampleCount, false);
    iterations = iteration;
    if (
      residualMaximum(packed) <= config.convergenceTolerance &&
      packed.nonFiniteValueCount === 0 &&
      packed.nonPositiveRadiusCount === 0
    ) {
      packed = measureState(source, muscles, config.sampleCount, true);
      iterationHistory.push({
        iteration,
        validationKind:'conservative-continuous',
        residualMaximum:rounded(residualMaximum(packed)),
        ...packed,
      });
      if (residualMaximum(packed) <= config.convergenceTolerance) {
        const formationClassification = classifySourceFormationRetention(
          initial,
          packed,
          config,
        );
        if (!formationClassification.passed) {
          status = 'source-formation-failed';
          failure = {
            phase: 'solve',
            kind: 'source-formation-constraint',
            sourceId: source.id,
            iterations,
            dominantMechanism:formationClassification.dominantMechanism,
            violations:formationClassification.violations,
            residuals: structuredClone(packed),
          };
        } else {
          status = 'converged';
        }
        break;
      }
      continuousCandidateFailed = true;
      continue;
    }
    iterationHistory.push({
      iteration,
      validationKind:'sampled-supplement',
      residualMaximum: rounded(residualMaximum(packed)),
      ...packed,
    });
  }

  if (status === 'iteration-limit') {
    packed = measureState(source, muscles, config.sampleCount, true);
    const classification = classifyTerminalResidual(packed, continuousCandidateFailed);
    status = classification.status;
    failure = {
      phase: 'solve',
      kind: 'residual-constraint',
      sourceId: source.id,
      iterations,
      dominantMechanism: classification.dominantMechanism,
      residuals: structuredClone(packed),
    };
    if (iterationHistory.length > 0) {
      iterationHistory[iterationHistory.length - 1] = {
        iteration:iterations,
        validationKind:'conservative-continuous',
        residualMaximum:rounded(residualMaximum(packed)),
        ...packed,
      };
    }
  }

  return {
    schema: MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA,
    sourceSchema: source.schema,
    sourceId: source.id,
    sourceAuthority: structuredClone(source.authority),
    dimension: 3,
    formation: formationReceipt(source),
    pairwiseProjection: pairwiseProjectionReceipt(config),
    pairwiseCoordinate: pairwiseCoordinateReceipt(config),
    curvatureProjection: curvatureProjectionReceipt(config),
    crossSectionProjection: crossSectionProjectionReceipt(config),
    clusterProjection: clusterProjectionReceipt(config, source),
    clearanceValidation: {
      kind: 'conservative-continuous-piecewise-linear',
      centerlineDistance: 'nested-convex-golden-section',
      segmentRadiusBound: 'linear-taper-with-lipschitz-search-bound',
      sampledSupplementCount: config.sampleCount,
    },
    status,
    iterations,
    correctionAttribution: correctionAttributionReceipt(correctionAttribution),
    input: structuredClone(source.input),
    config,
    compartment: structuredClone(source.compartment),
    obstacles: structuredClone(source.obstacles),
    muscles: muscles.map(muscle => ({
      ...structuredClone(muscle),
      realizedVolume: rounded(carrierVolume(muscle.centerline)),
    })),
    metrics: {
      initial,
      packed,
    },
    iterationHistory,
    ...(failure ? { failure } : {}),
  };
}

function perturbationDisplacement(source, result) {
  let maximumInteriorDisplacement = 0;
  let totalInteriorDisplacement = 0;
  let interiorSampleCount = 0;
  for (const [muscleIndex, packed] of result.muscles.entries()) {
    const input = source.muscles[muscleIndex];
    for (let knotIndex = 1; knotIndex < packed.centerline.length - 1; knotIndex += 1) {
      const displacement = distance(
        packed.centerline[knotIndex].position,
        input.centerline[knotIndex].position,
      );
      maximumInteriorDisplacement = Math.max(maximumInteriorDisplacement, displacement);
      totalInteriorDisplacement += displacement;
      interiorSampleCount += 1;
    }
  }
  return {
    maximumInteriorDisplacement: rounded(maximumInteriorDisplacement),
    meanInteriorDisplacement: rounded(
      interiorSampleCount === 0 ? 0 : totalInteriorDisplacement / interiorSampleCount,
    ),
    interiorSampleCount,
  };
}

export function runSourceShapedPackingPerturbationSeries({
  parentAtlas,
  parentAtlasFileSha256,
  requestedConstructionIds,
  levels,
  solverConfig = {},
  shapeProfileId,
}) {
  const requestedMechanismConfig = Object.keys(solverConfig).length === 0
    ? { ...DEFAULT_CONFIG }
    : { ...DEFAULT_CONFIG, ...structuredClone(solverConfig) };
  const series = createSourceShapedPackingPerturbationSeries({
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds,
    levels,
    shapeProfileId,
  });
  const conditions = series.conditions.map(condition => {
    const result = solveMuscleCompartmentPacking(condition.source, requestedMechanismConfig);
    return {
      ...condition,
      result,
      response: perturbationDisplacement(condition.source, result),
    };
  });
  const initialPairwisePenetrations = conditions.map(
    condition => condition.result.metrics.initial.pairwisePenetration,
  );
  const maximumInteriorDisplacements = conditions.map(
    condition => condition.response.maximumInteriorDisplacement,
  );
  return canonical({
    schema: SOURCE_SHAPED_PACKING_PERTURBATION_RESULT_SCHEMA,
    evidenceTrack: series.evidenceTrack,
    claimCeiling: series.claimCeiling,
    parentAtlas: series.parentAtlas,
    requestedConstructionIds: series.requestedConstructionIds,
    effectiveConstructionIds: series.effectiveConstructionIds,
    ...(series.shapeProfile ? { shapeProfile: series.shapeProfile } : {}),
    mechanism: {
      requested: {
        id: 'muscle-compartment-packing-projection.v0',
        config: requestedMechanismConfig,
      },
      effective: {
        id: 'muscle-compartment-packing-projection.v0',
        config: conditions[0]?.result.config ?? {},
      },
    },
    solverConfig: conditions[0]?.result.config ?? {},
    interpretationChecks: {
      initialPairwisePenetrationStrictlyIncreasing: initialPairwisePenetrations.every(
        (value, index) => index === 0 || value > initialPairwisePenetrations[index - 1],
      ),
      maximumInteriorDisplacementNondecreasing: maximumInteriorDisplacements.every(
        (value, index) => index === 0 || value >= maximumInteriorDisplacements[index - 1],
      ),
      fixedEndpointsPreserved: conditions.every(
        condition => condition.result.metrics.packed.endpointDrift === 0,
      ),
      targetVolumesPreserved: conditions.every(
        condition => condition.result.metrics.packed.maximumRelativeVolumeError <= 1e-9,
      ),
    },
    conditions,
  });
}
