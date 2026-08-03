import { createHash } from 'node:crypto';

export const MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA =
  'kaminos.muscle-compartment-packing-source.v0';
export const MUSCLE_COMPARTMENT_PACKING_RESULT_SCHEMA =
  'kaminos.muscle-compartment-packing-result.v0';

const DEFAULT_CONFIG = Object.freeze({
  maxIterations: 640,
  relaxationStep: 0.18,
  smoothnessStep: 0.035,
  sampleCount: 25,
  convergenceTolerance: 1e-7,
});

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
  return {
    value: Math.min(fn(0), fn(1), leftValue, rightValue, fn((lower + upper) / 2)),
    intervalWidth: upper - lower,
  };
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
  if (config.relaxationStep > 1) {
    throw new Error('muscle packing relaxationStep cannot exceed 1');
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

export function createSyntheticFourMuscleCompartment() {
  const core = {
    schema: MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id: 'synthetic-four-muscle-central-bone-v0',
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    dimension: 3,
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
    muscles: Array.from({ length: 4 }, (_, index) =>
      syntheticMuscleAtAngle(index, index * Math.PI / 2)),
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

function projectRigidAndBounds(source, muscles, amount) {
  for (const [muscleIndex, muscle] of muscles.entries()) {
    for (let knotIndex = 1; knotIndex < muscle.centerline.length - 1; knotIndex += 1) {
      const knot = muscle.centerline[knotIndex];
      for (const obstacle of source.obstacles) {
        knot.position = projectObstacle(
          knot.position,
          knot.radius,
          obstacle,
          muscleIndex,
          knotIndex,
          amount,
        );
      }
      knot.position = projectCompartment(
        knot.position,
        knot.radius,
        source.compartment,
        amount,
      );
    }
  }
}

function projectPairwise(muscles, amount) {
  const knotCount = muscles[0].centerline.length;
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      for (let knotIndex = 1; knotIndex < knotCount - 1; knotIndex += 1) {
        const left = muscles[leftIndex].centerline[knotIndex];
        const right = muscles[rightIndex].centerline[knotIndex];
        const offset = subtract(left.position, right.position);
        const separation = length(offset);
        const required = left.radius + right.radius;
        if (separation >= required) continue;
        const direction = normalizedOrFallback(offset, leftIndex, rightIndex + knotIndex);
        const correction = scale(direction, (required - separation) * amount / 2);
        left.position = add(left.position, correction);
        right.position = subtract(right.position, correction);
      }
    }
  }
}

function restoreTargetVolumes(muscles) {
  for (const muscle of muscles) {
    const currentVolume = carrierVolume(muscle.centerline);
    if (!Number.isFinite(currentVolume) || currentVolume <= 0) {
      throw new Error(`muscle ${muscle.id} produced invalid carrier volume`);
    }
    const radiusScale = Math.sqrt(muscle.targetVolume / currentVolume);
    for (const knot of muscle.centerline) knot.radius *= radiusScale;
  }
}

function smoothInterior(muscles, amount) {
  for (const muscle of muscles) {
    const prior = muscle.centerline.map(knot => [...knot.position]);
    for (let index = 1; index < muscle.centerline.length - 1; index += 1) {
      const midpoint = scale(add(prior[index - 1], prior[index + 1]), 0.5);
      muscle.centerline[index].position = add(
        prior[index],
        scale(subtract(midpoint, prior[index]), amount),
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
  const muscles = structuredClone(source.muscles);
  const initial = measureState(source, muscles, config.sampleCount, true);
  const iterationHistory = [];
  let packed = initial;
  let status = 'iteration-limit';
  let iterations = 0;
  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const smoothingAmount = config.smoothnessStep *
      (1 - iteration / config.maxIterations);
    smoothInterior(muscles, smoothingAmount);
    projectRigidAndBounds(source, muscles, config.relaxationStep);
    projectPairwise(muscles, config.relaxationStep);
    projectRigidAndBounds(source, muscles, config.relaxationStep);
    restoreTargetVolumes(muscles);
    projectRigidAndBounds(source, muscles, config.relaxationStep);
    projectPairwise(muscles, config.relaxationStep);
    projectRigidAndBounds(source, muscles, config.relaxationStep);
    restoreTargetVolumes(muscles);

    packed = measureState(source, muscles, config.sampleCount, false);
    iterations = iteration;
    if (
      residualMaximum(packed) <= config.convergenceTolerance &&
      packed.nonFiniteValueCount === 0 &&
      packed.nonPositiveRadiusCount === 0
    ) {
      packed = measureState(source, muscles, config.sampleCount, true);
      status = residualMaximum(packed) <= config.convergenceTolerance
        ? 'converged'
        : 'continuous-clearance-failed';
      iterationHistory.push({
        iteration,
        validationKind:'conservative-continuous',
        residualMaximum:rounded(residualMaximum(packed)),
        ...packed,
      });
      break;
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
    clearanceValidation: {
      kind: 'conservative-continuous-piecewise-linear',
      centerlineDistance: 'nested-convex-golden-section',
      segmentRadiusBound: 'linear-taper-with-lipschitz-search-bound',
      sampledSupplementCount: config.sampleCount,
    },
    status,
    iterations,
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
  };
}
