import {
  hashMusclePackingCanonicalJson,
  measureMuscleCompartmentPacking,
  taperedSegmentSurfaceGapLowerBound,
  taperedSegmentSurfaceMinimum,
} from './muscle-compartment-packing-core.mjs';
import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  validateNBodyPackingAssayFixture,
} from './nbody-packing-assay-core.mjs';

export const NBODY_PACKING_MIXED_FIELD_PROBLEM_SCHEMA =
  'kaminos.nbody-packing-mixed-field-problem.v0';
export const NBODY_PACKING_MIXED_FIELD_RESULT_SCHEMA =
  'kaminos.nbody-packing-mixed-field-result.v0';

const ALGORITHM = 'identity-bearing-shared-occupancy-pressure-traction-v0';
const TRANSLATION_BASIS = 'per-member-xz-sine-zero-at-attachments';
const CONFIG_KEYS = Object.freeze([
  'algorithm',
  'candidateEnumeration',
  'convergenceTolerance',
  'exclusionActivationMargin',
  'fieldContinuationResidual',
  'fieldPressureGain',
  'hardBoundaryWeight',
  'interfacePressureGain',
  'iterationBudget',
  'latticeQuadratureOrder',
  'latticeResolution',
  'latticeTranslation',
  'lineSearch',
  'occupancyKernelScale',
  'restoringGain',
  'translationBasis',
  'translationBounds',
]);

function rounded(value, digits = 12) {
  const result = Number(value.toFixed(digits));
  return Object.is(result, -0) ? 0 : result;
}

function add(left, right) {
  return left.map((value, axis) => value + right[axis]);
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function distance(left, right) {
  return Math.hypot(...subtract(left, right));
}

function interpolate(left, right, amount) {
  return left * (1 - amount) + right * amount;
}

function interpolatePoint(left, right, amount) {
  return left.map((value, axis) => interpolate(value, right[axis], amount));
}

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const length = distance(left.position, right.position);
    volume += Math.PI * length / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function restoreTargetVolume(muscle) {
  const realized = carrierVolume(muscle.centerline);
  if (!(realized > 0) || !(muscle.targetVolume > 0)) {
    throw new Error(`mixed field cannot restore nonpositive volume for ${muscle.id}`);
  }
  const radiusScale = Math.sqrt(muscle.targetVolume / realized);
  for (const knot of muscle.centerline) knot.radius *= radiusScale;
}

function validateRequestedConfig(config) {
  if (JSON.stringify(Object.keys(config || {}).sort()) !== JSON.stringify(CONFIG_KEYS)) {
    throw new Error(`mixed field requestedConfig requires exact keys: ${CONFIG_KEYS.join(', ')}`);
  }
  if (config.algorithm !== ALGORITHM) {
    throw new Error(`mixed field algorithm must be ${ALGORITHM}`);
  }
  if (config.translationBasis !== TRANSLATION_BASIS) {
    throw new Error(`mixed field translationBasis must be ${TRANSLATION_BASIS}`);
  }
  if (!['canonical', 'reverse'].includes(config.candidateEnumeration)) {
    throw new Error('mixed field candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'convergenceTolerance',
    'exclusionActivationMargin',
    'fieldContinuationResidual',
    'fieldPressureGain',
    'hardBoundaryWeight',
    'interfacePressureGain',
    'occupancyKernelScale',
  ]) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`mixed field ${key} must be positive and finite`);
    }
  }
  if (!Number.isFinite(config.restoringGain) || config.restoringGain < 0) {
    throw new Error('mixed field restoringGain must be finite and nonnegative');
  }
  if (!Number.isInteger(config.iterationBudget) || config.iterationBudget <= 0) {
    throw new Error('mixed field iterationBudget must be a positive integer');
  }
  if (
    !Number.isInteger(config.latticeQuadratureOrder) ||
    config.latticeQuadratureOrder < 1
  ) {
    throw new Error('mixed field latticeQuadratureOrder must be a positive integer');
  }
  if (
    !Array.isArray(config.latticeResolution) ||
    config.latticeResolution.length !== 2 ||
    !config.latticeResolution.every(value => Number.isInteger(value) && value >= 9)
  ) {
    throw new Error('mixed field latticeResolution must contain two integers at least nine');
  }
  if (
    !Array.isArray(config.latticeTranslation) ||
    config.latticeTranslation.length !== 2 ||
    !config.latticeTranslation.every(value => Number.isFinite(value) && value >= 0 && value < 1)
  ) {
    throw new Error('mixed field latticeTranslation must contain two fractions in [0, 1)');
  }
  if (
    !Array.isArray(config.lineSearch) ||
    config.lineSearch.length === 0 ||
    config.lineSearch.some(value => !Number.isFinite(value) || value <= 0 || value > 1) ||
    config.lineSearch.some((value, index) => index > 0 && value >= config.lineSearch[index - 1])
  ) {
    throw new Error('mixed field lineSearch must be a strictly decreasing positive array at most one');
  }
  if (
    !Array.isArray(config.translationBounds) ||
    config.translationBounds.length !== 2 ||
    !config.translationBounds.every(Number.isFinite) ||
    config.translationBounds[0] >= config.translationBounds[1]
  ) {
    throw new Error('mixed field translationBounds must be an ordered finite pair');
  }
}

function validateProblem(problem) {
  if (problem?.schema !== NBODY_PACKING_MIXED_FIELD_PROBLEM_SCHEMA) {
    throw new Error(`mixed field problem schema mismatch: ${problem?.schema || 'missing'}`);
  }
  const core = structuredClone(problem);
  delete core.identity;
  if (problem.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error('mixed field problem identity mismatch');
  }
  if (!Array.isArray(problem.members) || problem.members.length < 2) {
    throw new Error('mixed field problem requires at least two members');
  }
  const memberIds = problem.members.map(member => member.id);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('mixed field member ids must be unique');
  }
  if (problem.source?.crowdedStateSha256 !==
      (problem.crowdedSource.identity?.sha256 ||
        hashMusclePackingCanonicalJson(problem.crowdedSource))) {
    throw new Error('mixed field crowded source identity mismatch');
  }
  if (JSON.stringify(problem.members) !== JSON.stringify(problem.crowdedSource.muscles)) {
    throw new Error('mixed field member carrier does not match crowded source');
  }
  if (JSON.stringify(problem.field?.identityChannels) !== JSON.stringify(memberIds)) {
    throw new Error('mixed field identity channels do not match member order');
  }
}

function instantiateState(problem, vector) {
  if (!Array.isArray(vector) || vector.length !== problem.members.length * 2) {
    throw new Error(`mixed field vector must contain ${problem.members.length * 2} values`);
  }
  const muscles = structuredClone(problem.members);
  for (const [memberIndex, muscle] of muscles.entries()) {
    const translationX = vector[memberIndex * 2];
    const translationZ = vector[memberIndex * 2 + 1];
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

function maximumPhysicalResidual(metrics) {
  return Math.max(
    metrics.pairwisePenetration,
    metrics.skeletalPenetration,
    metrics.compartmentEscape,
    metrics.endpointDrift,
    metrics.maximumRelativeVolumeError,
  );
}

function measureSnapshot(problem, vector) {
  const muscles = instantiateState(problem, vector);
  const metrics = measureMuscleCompartmentPacking(problem.crowdedSource, muscles);
  return {
    vector:[...vector],
    muscles,
    metrics,
    maximumPhysicalResidual:maximumPhysicalResidual(metrics),
  };
}

function envelopeWeight(muscle, segmentIndex, segmentParameter) {
  const pathParameter = (segmentIndex + segmentParameter) / (muscle.centerline.length - 1);
  return Math.sin(Math.PI * pathParameter);
}

function closestPointOnSegment(point, start, end) {
  const segment = subtract(end, start);
  const squaredLength = segment.reduce((sum, value) => sum + value ** 2, 0);
  if (!(squaredLength > 0)) return [...start];
  const offset = subtract(point, start);
  const parameter = Math.max(0, Math.min(
    1,
    offset.reduce((sum, value, axis) => sum + value * segment[axis], 0) / squaredLength,
  ));
  return add(start, scale(segment, parameter));
}

function obstacleSegment(obstacle) {
  if (obstacle.kind === 'capsule') {
    return {
      start:{ position:obstacle.start, radius:obstacle.radius + (obstacle.clearance || 0) },
      end:{ position:obstacle.end, radius:obstacle.radius + (obstacle.clearance || 0) },
    };
  }
  if (obstacle.kind === 'sphere') {
    const point = { position:obstacle.center, radius:obstacle.radius + (obstacle.clearance || 0) };
    return { start:point, end:point };
  }
  throw new Error(`unsupported mixed field obstacle kind: ${obstacle.kind}`);
}

function stableNormal(leftPoint, rightPoint, key) {
  const delta = subtract(leftPoint, rightPoint);
  const xzLength = Math.hypot(delta[0], delta[2]);
  if (xzLength > 1e-12) return [delta[0] / xzLength, delta[2] / xzLength];
  const code = [...key].reduce((sum, character) => sum + character.codePointAt(0), 0);
  const angle = (code % 360) * Math.PI / 180;
  return [Math.cos(angle), Math.sin(angle)];
}

function sharpInterfaceRows(problem, muscles, config, exclusionActivationMargin) {
  const rows = [];
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const left = muscles[leftIndex];
      const right = muscles[rightIndex];
      let controlling = null;
      for (let leftSegment = 0; leftSegment < left.centerline.length - 1; leftSegment += 1) {
        for (let rightSegment = 0; rightSegment < right.centerline.length - 1; rightSegment += 1) {
          const minimum = taperedSegmentSurfaceMinimum(
            left.centerline[leftSegment],
            left.centerline[leftSegment + 1],
            right.centerline[rightSegment],
            right.centerline[rightSegment + 1],
          );
          if (!controlling || minimum.gap < controlling.gap) {
            controlling = { ...minimum, leftSegment, rightSegment };
          }
        }
      }
      if (controlling.gap >= 0) continue;
      const leftPoint = interpolatePoint(
        left.centerline[controlling.leftSegment].position,
        left.centerline[controlling.leftSegment + 1].position,
        controlling.leftT,
      );
      const rightPoint = interpolatePoint(
        right.centerline[controlling.rightSegment].position,
        right.centerline[controlling.rightSegment + 1].position,
        controlling.rightT,
      );
      const key = `${left.id}|${right.id}`;
      const normal = stableNormal(leftPoint, rightPoint, key);
      const leftWeight = envelopeWeight(left, controlling.leftSegment, controlling.leftT);
      const rightWeight = envelopeWeight(right, controlling.rightSegment, controlling.rightT);
      const normSquared = leftWeight ** 2 + rightWeight ** 2;
      if (!(normSquared > 1e-12)) continue;
      const jacobian = Array(muscles.length * 2).fill(0);
      jacobian[leftIndex * 2] += normal[0] * leftWeight;
      jacobian[leftIndex * 2 + 1] += normal[1] * leftWeight;
      jacobian[rightIndex * 2] -= normal[0] * rightWeight;
      jacobian[rightIndex * 2 + 1] -= normal[1] * rightWeight;
      rows.push({
        key:`muscle:${key}`,
        kind:'muscle-interface',
        pressure:-controlling.gap,
        weight:config.interfacePressureGain * config.hardBoundaryWeight,
        jacobian,
      });
    }
  }

  for (const [memberIndex, muscle] of muscles.entries()) {
    for (const obstacle of problem.crowdedSource.obstacles) {
      const obstacleCarrier = obstacleSegment(obstacle);
      let controlling = null;
      for (let segmentIndex = 0; segmentIndex < muscle.centerline.length - 1; segmentIndex += 1) {
        const minimum = taperedSegmentSurfaceMinimum(
          muscle.centerline[segmentIndex],
          muscle.centerline[segmentIndex + 1],
          obstacleCarrier.start,
          obstacleCarrier.end,
        );
        if (!controlling || minimum.gap < controlling.gap) {
          controlling = { ...minimum, segmentIndex };
        }
      }
      if (controlling.gap >= exclusionActivationMargin) continue;
      const musclePoint = interpolatePoint(
        muscle.centerline[controlling.segmentIndex].position,
        muscle.centerline[controlling.segmentIndex + 1].position,
        controlling.leftT,
      );
      const obstaclePoint = interpolatePoint(
        obstacleCarrier.start.position,
        obstacleCarrier.end.position,
        controlling.rightT,
      );
      const normal = stableNormal(musclePoint, obstaclePoint, `${muscle.id}|${obstacle.id}`);
      const weight = envelopeWeight(muscle, controlling.segmentIndex, controlling.leftT);
      if (!(Math.abs(weight) > 1e-8)) continue;
      const pressure = exclusionActivationMargin - controlling.gap;
      const jacobian = Array(muscles.length * 2).fill(0);
      jacobian[memberIndex * 2] += normal[0] * weight;
      jacobian[memberIndex * 2 + 1] += normal[1] * weight;
      rows.push({
        key:`bone:${muscle.id}|${obstacle.id}`,
        kind:'skeletal-interface',
        pressure,
        weight:config.interfacePressureGain,
        jacobian,
      });
    }

    const compartment = problem.crowdedSource.compartment;
    const finalIndex = muscle.centerline.length - 1;
    for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
      const knot = muscle.centerline[knotIndex];
      const weight = Math.sin(Math.PI * knotIndex / finalIndex);
      for (const [axis, vectorAxis] of [[0, 0], [2, 1]]) {
        const minimum = compartment.minimum[axis] + compartment.clearance + knot.radius;
        const maximum = compartment.maximum[axis] - compartment.clearance - knot.radius;
        const lowerGap = knot.position[axis] - minimum;
        const upperGap = maximum - knot.position[axis];
        for (const side of [
          { name:'minimum', gap:lowerGap, direction:1 },
          { name:'maximum', gap:upperGap, direction:-1 },
        ]) {
          if (side.gap >= exclusionActivationMargin) continue;
          const pressure = exclusionActivationMargin - side.gap;
          const jacobian = Array(muscles.length * 2).fill(0);
          jacobian[memberIndex * 2 + vectorAxis] = side.direction * weight;
          rows.push({
            key:`compartment:${muscle.id}|${axis}|${side.name}|${knotIndex}`,
            kind:'compartment-interface',
            pressure,
            weight:config.interfacePressureGain * config.hardBoundaryWeight,
            jacobian,
          });
        }
      }
    }
  }
  if (config.candidateEnumeration === 'reverse') rows.reverse();
  return rows;
}

function occupancyField(problem, muscles, config) {
  const [width, depth] = config.latticeResolution;
  const [offsetX, offsetZ] = config.latticeTranslation;
  const compartment = problem.crowdedSource.compartment;
  const stepX = (compartment.maximum[0] - compartment.minimum[0]) / width;
  const stepZ = (compartment.maximum[2] - compartment.minimum[2]) / depth;
  const cellArea = stepX * stepZ;
  const vector = Array(muscles.length * 2).fill(0);
  let activeSampleCount = 0;
  let mixedSampleCount = 0;
  let maximumOvercapacity = 0;
  let pressureIntegral = 0;
  const quadratureOrder = config.latticeQuadratureOrder;
  const sampleArea = cellArea / (quadratureOrder ** 2);
  for (const knotIndex of [2, 3]) {
    for (let iz = 0; iz < depth; iz += 1) {
      for (let qz = 0; qz < quadratureOrder; qz += 1) {
        const subZ = (qz + 0.5) / quadratureOrder;
        const zIndex = (iz + subZ + offsetZ) % depth;
        const z = compartment.minimum[2] + zIndex * stepZ;
        for (let ix = 0; ix < width; ix += 1) {
          for (let qx = 0; qx < quadratureOrder; qx += 1) {
            const subX = (qx + 0.5) / quadratureOrder;
            const xIndex = (ix + subX + offsetX) % width;
            const x = compartment.minimum[0] + xIndex * stepX;
        const channels = muscles.map((muscle, memberIndex) => {
          const knot = muscle.centerline[knotIndex];
          const sigma = Math.max(1e-6, config.occupancyKernelScale * knot.radius);
          const dx = x - knot.position[0];
          const dz = z - knot.position[2];
          const density = Math.exp(-0.5 * (dx ** 2 + dz ** 2) / (sigma ** 2));
          return { memberIndex, knot, sigma, dx, dz, density };
        });
        const occupied = channels.filter(channel => channel.density >= 0.2);
        if (occupied.length > 0) activeSampleCount += 1;
        if (occupied.length > 1) mixedSampleCount += 1;
        const densitySum = channels.reduce((sum, channel) => sum + channel.density, 0);
        const overcapacity = Math.max(0, densitySum - 1);
        if (!(overcapacity > 0)) continue;
        maximumOvercapacity = Math.max(maximumOvercapacity, overcapacity);
        pressureIntegral += overcapacity * sampleArea;
        for (const channel of channels) {
          const envelope = Math.sin(
            Math.PI * knotIndex / (muscles[channel.memberIndex].centerline.length - 1),
          );
          const gain = config.fieldPressureGain * overcapacity * channel.density * sampleArea /
            (channel.sigma ** 2);
          vector[channel.memberIndex * 2] += -channel.dx * gain * envelope;
          vector[channel.memberIndex * 2 + 1] += -channel.dz * gain * envelope;
        }
          }
        }
      }
    }
  }
  return {
    vector,
    receipt:{
      activeSampleCount,
      mixedSampleCount,
      maximumOvercapacity:rounded(maximumOvercapacity, 15),
      pressureIntegral:rounded(pressureIntegral, 15),
      latticeResolution:[...config.latticeResolution],
      latticeTranslation:[...config.latticeTranslation],
      latticeQuadratureOrder:config.latticeQuadratureOrder,
    },
  };
}

function assembleField(problem, current, config) {
  const fieldContinuationScale = Math.min(
    1,
    current.metrics.pairwisePenetration / config.fieldContinuationResidual,
  ) ** 4;
  const restoringContinuationScale = fieldContinuationScale;
  const effectiveExclusionActivationMargin =
    config.exclusionActivationMargin * fieldContinuationScale;
  const rows = sharpInterfaceRows(
    problem,
    current.muscles,
    config,
    effectiveExclusionActivationMargin,
  );
  const occupancy = occupancyField(problem, current.muscles, config);
  const orderedRows = [...rows].sort((left, right) => left.key.localeCompare(right.key));
  const size = current.vector.length;
  const matrix = Array.from({ length:size }, (_, row) =>
    Array.from({ length:size }, (_, column) => row === column ? 1e-8 : 0));
  const rhs = occupancy.vector.map(value => value * fieldContinuationScale);
  for (const row of orderedRows) {
    for (let leftAxis = 0; leftAxis < size; leftAxis += 1) {
      rhs[leftAxis] += row.weight * row.jacobian[leftAxis] * row.pressure;
      for (let rightAxis = 0; rightAxis < size; rightAxis += 1) {
        matrix[leftAxis][rightAxis] += row.weight *
          row.jacobian[leftAxis] * row.jacobian[rightAxis];
      }
    }
  }
  for (let axis = 0; axis < size; axis += 1) {
    const effectiveRestoringGain = config.restoringGain * restoringContinuationScale;
    matrix[axis][axis] += effectiveRestoringGain;
    rhs[axis] -= effectiveRestoringGain * current.vector[axis];
  }
  const delta = solveLinearSystem(matrix, rhs) || Array(size).fill(0);
  const maximumDelta = Math.max(...delta.map(Math.abs));
  if (maximumDelta > 0.08) {
    for (let axis = 0; axis < delta.length; axis += 1) delta[axis] *= 0.08 / maximumDelta;
  }
  return {
    delta,
    rows,
    occupancy:occupancy.receipt,
    fieldContinuationScale:rounded(fieldContinuationScale, 15),
    restoringContinuationScale:rounded(restoringContinuationScale, 15),
    effectiveExclusionActivationMargin:rounded(effectiveExclusionActivationMargin, 15),
    contributionKeys:[
      ...orderedRows.map(row => row.key),
      'field:aggregate-occupancy',
      'regularizer:source-rest',
    ].sort(),
  };
}

function solveLinearSystem(matrix, rhs) {
  const size = rhs.length;
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

function clampVector(vector, bounds) {
  return vector.map(value => rounded(Math.max(bounds[0], Math.min(bounds[1], value)), 15));
}

function isAdmissibleImprovement(current, candidate, tolerance) {
  return candidate.metrics.pairwisePenetration < current.metrics.pairwisePenetration - 1e-12 &&
    candidate.metrics.skeletalPenetration <= current.metrics.skeletalPenetration + tolerance &&
    candidate.metrics.compartmentEscape <= current.metrics.compartmentEscape + tolerance;
}

function compareCandidates(left, right) {
  const residualDifference = left.snapshot.maximumPhysicalResidual - right.snapshot.maximumPhysicalResidual;
  if (Math.abs(residualDifference) > 1e-15) return residualDifference;
  const pairDifference = left.snapshot.metrics.pairwisePenetration -
    right.snapshot.metrics.pairwisePenetration;
  if (Math.abs(pairDifference) > 1e-15) return pairDifference;
  return left.lineScale - right.lineScale;
}

function displacementReceipt(problem, muscles) {
  const rows = muscles.map((muscle, memberIndex) => {
    const source = problem.members[memberIndex];
    const displacements = muscle.centerline.map((knot, knotIndex) =>
      distance(knot.position, source.centerline[knotIndex].position));
    return {
      memberId:muscle.id,
      maximumDisplacement:rounded(Math.max(...displacements)),
      rootMeanSquareDisplacement:rounded(Math.sqrt(
        displacements.reduce((sum, value) => sum + value ** 2, 0) / displacements.length,
      )),
    };
  });
  return {
    rows,
    movedMemberCount:rows.filter(row => row.maximumDisplacement > 1e-8).length,
    maximumDisplacement:rounded(Math.max(...rows.map(row => row.maximumDisplacement))),
  };
}

function pairwisePenetrationReceipt(muscles) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const left = muscles[leftIndex];
      const right = muscles[rightIndex];
      let controlling = null;
      for (let leftSegment = 0; leftSegment < left.centerline.length - 1; leftSegment += 1) {
        for (let rightSegment = 0; rightSegment < right.centerline.length - 1; rightSegment += 1) {
          const lowerBoundGap = taperedSegmentSurfaceGapLowerBound(
            left.centerline[leftSegment],
            left.centerline[leftSegment + 1],
            right.centerline[rightSegment],
            right.centerline[rightSegment + 1],
          );
          if (!controlling || lowerBoundGap < controlling.gap) {
            const minimum = taperedSegmentSurfaceMinimum(
              left.centerline[leftSegment],
              left.centerline[leftSegment + 1],
              right.centerline[rightSegment],
              right.centerline[rightSegment + 1],
            );
            controlling = { ...minimum, gap:lowerBoundGap, leftSegment, rightSegment };
          }
        }
      }
      const penetration = Math.max(0, -controlling.gap);
      if (!(penetration > 0)) continue;
      pairs.push({
        key:`${left.id}|${right.id}`,
        members:[left.id, right.id],
        penetration:rounded(penetration, 15),
        leftPoint:interpolatePoint(
          left.centerline[controlling.leftSegment].position,
          left.centerline[controlling.leftSegment + 1].position,
          controlling.leftT,
        ).map(value => rounded(value, 15)),
        rightPoint:interpolatePoint(
          right.centerline[controlling.rightSegment].position,
          right.centerline[controlling.rightSegment + 1].position,
          controlling.rightT,
        ).map(value => rounded(value, 15)),
      });
    }
  }
  return {
    kind:'continuous-all-pair-tapered-segment-minima',
    pairs,
    totalPenetration:rounded(pairs.reduce((sum, pair) => sum + pair.penetration, 0), 15),
  };
}

function solveSingleEnumeration({ problem, requestedConfig }) {
  validateProblem(problem);
  validateRequestedConfig(requestedConfig);
  const config = structuredClone(requestedConfig);
  let current = measureSnapshot(problem, Array(problem.members.length * 2).fill(0));
  const workRows = [];
  let fieldAssemblies = 0;
  let candidateEvaluations = 0;
  let status = null;
  let failure = null;
  let lastField = null;

  for (let iteration = 1; iteration <= config.iterationBudget; iteration += 1) {
    if (current.maximumPhysicalResidual <= config.convergenceTolerance) {
      status = 'converged-mixed-field-candidate';
      break;
    }
    const field = assembleField(problem, current, config);
    fieldAssemblies += 1;
    lastField = field;
    if (!field.delta.some(value => Math.abs(value) > 1e-15)) {
      status = 'stalled-mixed-field-candidate';
      failure = { phase:'mixed-field-gather-scatter', lastTrustworthyEvidence:'selected' };
      break;
    }
    const candidates = [];
    for (const lineScale of config.lineSearch) {
      const vector = clampVector(
        current.vector.map((value, axis) => value + lineScale * field.delta[axis]),
        config.translationBounds,
      );
      const snapshot = measureSnapshot(problem, vector);
      candidateEvaluations += 1;
      if (isAdmissibleImprovement(current, snapshot, 1e-12)) {
        candidates.push({ lineScale, snapshot });
      }
    }
    candidates.sort(compareCandidates);
    const accepted = candidates[0];
    if (!accepted) {
      status = 'stalled-mixed-field-candidate';
      failure = {
        phase:'mixed-field-admissibility-line-search',
        lastTrustworthyEvidence:'selected',
        residual:rounded(current.maximumPhysicalResidual, 15),
      };
      break;
    }
    const before = current;
    current = accepted.snapshot;
    workRows.push({
      iteration,
      acceptedLineScale:accepted.lineScale,
      activeInterfaceCount:field.rows.length,
      fieldMixedSampleCount:field.occupancy.mixedSampleCount,
      pairwisePenetrationBefore:rounded(before.metrics.pairwisePenetration, 15),
      pairwisePenetrationAfter:rounded(current.metrics.pairwisePenetration, 15),
      skeletalPenetrationBefore:rounded(before.metrics.skeletalPenetration, 15),
      skeletalPenetrationAfter:rounded(current.metrics.skeletalPenetration, 15),
      compartmentEscapeBefore:rounded(before.metrics.compartmentEscape, 15),
      compartmentEscapeAfter:rounded(current.metrics.compartmentEscape, 15),
      maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
    });
  }

  if (!status) {
    status = 'iteration-budget-exhausted';
    failure = {
      phase:'mixed-field-gather-scatter',
      lastTrustworthyEvidence:'selected',
      residual:rounded(current.maximumPhysicalResidual, 15),
    };
  }
  const identityLeakCount = current.muscles.filter((muscle, index) =>
    muscle.id !== problem.members[index].id ||
    JSON.stringify(muscle.identity) !== JSON.stringify(problem.members[index].identity) ||
    JSON.stringify(muscle.attachments) !== JSON.stringify(problem.members[index].attachments)
  ).length;
  const selected = {
    vector:[...current.vector],
    muscles:structuredClone(current.muscles),
    metrics:structuredClone(current.metrics),
    metricsSha256:hashMusclePackingCanonicalJson(current.metrics),
    physicalStateSha256:hashMusclePackingCanonicalJson({
      muscles:current.muscles,
      metrics:current.metrics,
    }),
    maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
    displacement:displacementReceipt(problem, current.muscles),
    pairwisePenetrationReceipt:pairwisePenetrationReceipt(current.muscles),
    identityLeakCount,
  };
  const core = {
    schema:NBODY_PACKING_MIXED_FIELD_RESULT_SCHEMA,
    status,
    route:{ requested:ALGORITHM, effective:ALGORITHM, fallbackUsed:false },
    source:{
      problemSha256:problem.identity.sha256,
      fixtureSha256:problem.source.fixtureSha256,
    },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(config) },
    mechanism:{
      updateMode:'one-field-snapshot-one-simultaneous-gather-apply',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      channels:[
        'identity-bearing-muscle-occupancy',
        'aggregate-overcapacity-pressure',
        'skeletal-exclusion-pressure',
        'compartment-boundary-pressure',
        'sharp-interface-traction',
      ],
      sharpInterfaceCorrection:'all-member-and-rigid-interface-scan-no-declared-contact-graph',
      projection:'identity-specific-field-traction-to-explicit-carrier-basis',
      traversal:config.candidateEnumeration,
    },
    work:{
      iterations:workRows.length,
      fieldAssemblies,
      candidateEvaluations,
      rows:workRows,
      lastField:lastField ? {
        occupancy:lastField.occupancy,
        fieldContinuationScale:lastField.fieldContinuationScale,
        restoringContinuationScale:lastField.restoringContinuationScale,
        effectiveExclusionActivationMargin:lastField.effectiveExclusionActivationMargin,
        interfaceKeys:lastField.rows.map(row => row.key).sort(),
        contributionKeys:lastField.contributionKeys,
      } : null,
    },
    selected,
    failure,
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function invarianceRow(result) {
  return {
    enumeration:result.config.requested.candidateEnumeration,
    status:result.status,
    selectedVector:[...result.selected.vector],
    physicalStateSha256:result.selected.physicalStateSha256,
    metricsSha256:result.selected.metricsSha256,
    workSha256:hashMusclePackingCanonicalJson(result.work),
  };
}

export function createNBodyMixedFieldConfig() {
  return {
    algorithm:ALGORITHM,
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-7,
    exclusionActivationMargin:0.025,
    fieldPressureGain:0.03,
    hardBoundaryWeight:1000,
    fieldContinuationResidual:0.15,
    interfacePressureGain:0.88,
    iterationBudget:2048,
    latticeQuadratureOrder:2,
    latticeResolution:[25, 29],
    latticeTranslation:[0, 0],
    lineSearch:[1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625],
    occupancyKernelScale:0.82,
    restoringGain:0.002,
    translationBasis:TRANSLATION_BASIS,
    translationBounds:[-0.3, 0.3],
  };
}

export function compileNBodyMixedFieldProblem(fixture) {
  if (fixture?.schema !== NBODY_PACKING_ASSAY_FIXTURE_SCHEMA) {
    throw new Error(`mixed field fixture schema mismatch: ${fixture?.schema || 'missing'}`);
  }
  validateNBodyPackingAssayFixture(fixture);
  const core = {
    schema:NBODY_PACKING_MIXED_FIELD_PROBLEM_SCHEMA,
    source:{
      fixtureSha256:fixture.identity.sha256,
      crowdedStateSha256:fixture.crowded.identity?.sha256 ||
        hashMusclePackingCanonicalJson(fixture.crowded),
    },
    crowdedSource:structuredClone(fixture.crowded),
    members:structuredClone(fixture.crowded.muscles),
    carrier:{
      translationBasis:TRANSLATION_BASIS,
      degreesOfFreedomPerMember:2,
      attachmentDisplacement:'exact-zero',
      volumePolicy:'restore-exact-target-after-every-state-instantiation',
    },
    field:{
      dimension:'two-belt-slices-of-short-extruded-three-dimensional-carriers',
      identityChannels:fixture.crowded.muscles.map(muscle => muscle.id),
      obstacleIds:fixture.crowded.obstacles.map(obstacle => obstacle.id),
      compartmentId:fixture.crowded.compartment.id,
      contactGraphConsumed:false,
    },
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function solveNBodyMixedFieldCandidate({ problem, requestedConfig } = {}) {
  validateProblem(problem);
  validateRequestedConfig(requestedConfig);
  const primary = solveSingleEnumeration({ problem, requestedConfig });
  const alternateConfig = {
    ...structuredClone(requestedConfig),
    candidateEnumeration:requestedConfig.candidateEnumeration === 'canonical'
      ? 'reverse'
      : 'canonical',
  };
  const alternate = solveSingleEnumeration({ problem, requestedConfig:alternateConfig });
  const rows = [invarianceRow(primary), invarianceRow(alternate)];
  const comparison = {
    statusEqual:rows[0].status === rows[1].status,
    selectedVectorEqual:JSON.stringify(rows[0].selectedVector) === JSON.stringify(rows[1].selectedVector),
    physicalStateEqual:rows[0].physicalStateSha256 === rows[1].physicalStateSha256,
    metricsEqual:rows[0].metricsSha256 === rows[1].metricsSha256,
    workEqual:rows[0].workSha256 === rows[1].workSha256,
  };
  const passed = Object.values(comparison).every(Boolean);
  const core = structuredClone(primary);
  delete core.identity;
  core.status = passed ? primary.status : 'candidate-enumeration-order-dependent';
  core.invariance = {
    candidateEnumeration:passed ? 'passed' : 'failed-order-dependent',
    mechanism:'paired-full-field-assembly-comparison',
    rows,
    comparison,
  };
  if (!passed) {
    core.failure = { phase:'paired-field-assembly-invariance', lastTrustworthyEvidence:'invariance.rows' };
  }
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}
