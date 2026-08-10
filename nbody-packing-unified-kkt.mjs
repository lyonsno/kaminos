import {
  hashMusclePackingCanonicalJson,
  measureMuscleCompartmentPacking,
  taperedSegmentSurfaceGapLowerBound,
} from './muscle-compartment-packing-core.mjs';
import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  validateNBodyPackingAssayFixture,
} from './nbody-packing-assay-core.mjs';

export const NBODY_PACKING_UNIFIED_KKT_PROBLEM_SCHEMA =
  'kaminos.nbody-packing-unified-kkt-problem.v0';
export const NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA =
  'kaminos.nbody-packing-unified-kkt-result.v0';

const ALGORITHM = 'unified-active-set-pair-bone-compartment-kkt-v0';
const TRANSLATION_BASIS = 'per-member-xz-sine-zero-at-attachments';
const CONFIG_KEYS = Object.freeze([
  'activationMargin',
  'algorithm',
  'candidateEnumeration',
  'convergenceTolerance',
  'finiteDifferenceStep',
  'iterationBudget',
  'lineSearch',
  'ridge',
  'translationBasis',
  'translationBounds',
]);

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
    throw new Error(`unified KKT cannot restore nonpositive volume for ${muscle.id}`);
  }
  const radiusScale = Math.sqrt(muscle.targetVolume / realized);
  for (const knot of muscle.centerline) knot.radius *= radiusScale;
}

function validateConfig(config) {
  if (JSON.stringify(Object.keys(config || {}).sort()) !== JSON.stringify(CONFIG_KEYS)) {
    throw new Error(`unified KKT requestedConfig requires exact keys: ${CONFIG_KEYS.join(', ')}`);
  }
  if (config.algorithm !== ALGORITHM) throw new Error(`unified KKT algorithm must be ${ALGORITHM}`);
  if (config.translationBasis !== TRANSLATION_BASIS) {
    throw new Error(`unified KKT translationBasis must be ${TRANSLATION_BASIS}`);
  }
  if (!['canonical', 'reverse'].includes(config.candidateEnumeration)) {
    throw new Error('unified KKT candidateEnumeration must be canonical or reverse');
  }
  for (const key of ['activationMargin', 'convergenceTolerance', 'finiteDifferenceStep', 'ridge']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`unified KKT ${key} must be positive and finite`);
    }
  }
  if (!Number.isInteger(config.iterationBudget) || config.iterationBudget <= 0) {
    throw new Error('unified KKT iterationBudget must be a positive integer');
  }
  if (
    !Array.isArray(config.lineSearch) || config.lineSearch.length === 0 ||
    config.lineSearch.some(value => !Number.isFinite(value) || value <= 0 || value > 1) ||
    config.lineSearch.some((value, index) => index > 0 && value >= config.lineSearch[index - 1])
  ) {
    throw new Error('unified KKT lineSearch must be strictly decreasing positive values at most one');
  }
  if (
    !Array.isArray(config.translationBounds) || config.translationBounds.length !== 2 ||
    !config.translationBounds.every(Number.isFinite) ||
    config.translationBounds[0] >= config.translationBounds[1]
  ) {
    throw new Error('unified KKT translationBounds must be an ordered finite pair');
  }
}

function validateProblem(problem) {
  if (problem?.schema !== NBODY_PACKING_UNIFIED_KKT_PROBLEM_SCHEMA) {
    throw new Error(`unified KKT problem schema mismatch: ${problem?.schema || 'missing'}`);
  }
  const core = structuredClone(problem);
  delete core.identity;
  if (problem.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error('unified KKT problem identity mismatch');
  }
  if (JSON.stringify(problem.members) !== JSON.stringify(problem.crowdedSource.muscles)) {
    throw new Error('unified KKT member carrier does not match crowded source');
  }
}

function instantiate(problem, vector) {
  if (!Array.isArray(vector) || vector.length !== problem.variables.length) {
    throw new Error(`unified KKT vector must contain ${problem.variables.length} values`);
  }
  const muscles = structuredClone(problem.members);
  for (const [memberIndex, muscle] of muscles.entries()) {
    const finalIndex = muscle.centerline.length - 1;
    for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
      const envelope = Math.sin(Math.PI * knotIndex / finalIndex);
      muscle.centerline[knotIndex].position[0] += vector[memberIndex * 2] * envelope;
      muscle.centerline[knotIndex].position[2] += vector[memberIndex * 2 + 1] * envelope;
    }
    restoreTargetVolume(muscle);
  }
  return muscles;
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
  throw new Error(`unified KKT unsupported obstacle kind ${obstacle.kind}`);
}

function constraintRows(problem, vector) {
  const muscles = instantiate(problem, vector);
  const rows = [];
  for (let leftIndex = 0; leftIndex < muscles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < muscles.length; rightIndex += 1) {
      const left = muscles[leftIndex];
      const right = muscles[rightIndex];
      for (let leftSegment = 0; leftSegment < left.centerline.length - 1; leftSegment += 1) {
        for (let rightSegment = 0; rightSegment < right.centerline.length - 1; rightSegment += 1) {
          const gap = taperedSegmentSurfaceGapLowerBound(
            left.centerline[leftSegment], left.centerline[leftSegment + 1],
            right.centerline[rightSegment], right.centerline[rightSegment + 1],
          );
          rows.push({
            key:`pair:${left.id}:${leftSegment}|${right.id}:${rightSegment}`,
            kind:'pairwise-clearance',
            members:[left.id, right.id],
            segments:[leftSegment, rightSegment],
            signedGap:gap,
          });
        }
      }
    }
  }
  for (const muscle of muscles) {
    for (const obstacle of problem.crowdedSource.obstacles) {
      const carrier = obstacleSegment(obstacle);
      for (let segmentIndex = 0; segmentIndex < muscle.centerline.length - 1; segmentIndex += 1) {
        const gap = taperedSegmentSurfaceGapLowerBound(
          muscle.centerline[segmentIndex], muscle.centerline[segmentIndex + 1],
          carrier.start, carrier.end,
        );
        rows.push({
          key:`bone:${muscle.id}:${segmentIndex}|${obstacle.id}`,
          kind:'skeletal-clearance',
          muscleId:muscle.id,
          segmentIndex,
          obstacleId:obstacle.id,
          signedGap:gap,
        });
      }
    }
    const finalIndex = muscle.centerline.length - 1;
    for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
      const knot = muscle.centerline[knotIndex];
      for (const axis of [0, 2]) {
        const minimum = problem.crowdedSource.compartment.minimum[axis] +
          problem.crowdedSource.compartment.clearance + knot.radius;
        const maximum = problem.crowdedSource.compartment.maximum[axis] -
          problem.crowdedSource.compartment.clearance - knot.radius;
        rows.push({
          key:`compartment-lower:${muscle.id}:${knotIndex}:${axis}`,
          kind:'compartment-clearance',
          signedGap:knot.position[axis] - minimum,
        });
        rows.push({
          key:`compartment-upper:${muscle.id}:${knotIndex}:${axis}`,
          kind:'compartment-clearance',
          signedGap:maximum - knot.position[axis],
        });
      }
    }
  }
  return { muscles, rows };
}

function maximumResidual(metrics) {
  return Math.max(
    metrics.pairwisePenetration,
    metrics.skeletalPenetration,
    metrics.compartmentEscape,
    metrics.endpointDrift,
    metrics.maximumRelativeVolumeError,
  );
}

function snapshot(problem, vector) {
  const { muscles, rows } = constraintRows(problem, vector);
  const metrics = measureMuscleCompartmentPacking(problem.crowdedSource, muscles);
  return {
    vector:[...vector],
    muscles,
    rows,
    metrics,
    maximumPhysicalResidual:maximumResidual(metrics),
    deformationEnergy:rounded(vector.reduce((sum, value) => sum + 0.5 * value ** 2, 0), 15),
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
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= pivotValue;
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

function activeLinearization(problem, current, activeRows, config) {
  const gradients = activeRows.map(() => Array(current.vector.length).fill(0));
  for (let axis = 0; axis < current.vector.length; axis += 1) {
    const positive = [...current.vector];
    const negative = [...current.vector];
    positive[axis] += config.finiteDifferenceStep;
    negative[axis] -= config.finiteDifferenceStep;
    const positiveByKey = Object.fromEntries(constraintRows(problem, positive).rows.map(row => [row.key, row]));
    const negativeByKey = Object.fromEntries(constraintRows(problem, negative).rows.map(row => [row.key, row]));
    for (let row = 0; row < activeRows.length; row += 1) {
      gradients[row][axis] = (
        positiveByKey[activeRows[row].key].signedGap -
        negativeByKey[activeRows[row].key].signedGap
      ) / (2 * config.finiteDifferenceStep);
    }
  }
  return gradients;
}

function projectedTarget(current, activeRows, gradients, config) {
  let activeIndices = gradients.map((_, index) => index);
  while (activeIndices.length > 0) {
    const selectedGradients = activeIndices.map(index => gradients[index]);
    const gram = selectedGradients.map((left, leftIndex) => selectedGradients.map(
      (right, rightIndex) => left.reduce(
        (sum, value, axis) => sum + value * right[axis],
        0,
      ) + (leftIndex === rightIndex ? config.ridge : 0),
    ));
    const rhs = activeIndices.map((rowIndex) => {
      const gradient = gradients[rowIndex];
      return gradient.reduce((sum, value, axis) => sum + value * current.vector[axis], 0) -
        activeRows[rowIndex].signedGap;
    });
    const multipliers = solveLinearSystem(gram, rhs);
    if (!multipliers) return null;
    const mostNegative = multipliers.reduce(
      (worst, value, index) => value < worst.value ? { value, index } : worst,
      { value:-1e-10, index:-1 },
    );
    if (mostNegative.index >= 0) {
      activeIndices.splice(mostNegative.index, 1);
      continue;
    }
    const target = Array(current.vector.length).fill(0);
    for (let row = 0; row < activeIndices.length; row += 1) {
      const gradient = gradients[activeIndices[row]];
      for (let axis = 0; axis < target.length; axis += 1) {
        target[axis] += gradient[axis] * multipliers[row];
      }
    }
    return {
      target,
      activeIndices,
      multipliers,
      activeConstraintKeys:activeIndices.map(index => activeRows[index].key),
    };
  }
  return null;
}

function clampVector(vector, bounds) {
  return vector.map(value => rounded(Math.max(bounds[0], Math.min(bounds[1], value)), 15));
}

function compareSnapshots(left, right) {
  const residual = left.maximumPhysicalResidual - right.maximumPhysicalResidual;
  if (Math.abs(residual) > 1e-15) return residual;
  const energy = left.deformationEnergy - right.deformationEnergy;
  if (Math.abs(energy) > 1e-15) return energy;
  return hashMusclePackingCanonicalJson(left.vector)
    .localeCompare(hashMusclePackingCanonicalJson(right.vector));
}

function displacementReceipt(problem, muscles) {
  const rows = muscles.map((muscle, memberIndex) => {
    const source = problem.members[memberIndex];
    const values = muscle.centerline.map((knot, knotIndex) =>
      distance(knot.position, source.centerline[knotIndex].position));
    return {
      memberId:muscle.id,
      maximumDisplacement:rounded(Math.max(...values)),
      rootMeanSquareDisplacement:rounded(Math.sqrt(
        values.reduce((sum, value) => sum + value ** 2, 0) / values.length,
      )),
    };
  });
  return {
    rows,
    movedMemberCount:rows.filter(row => row.maximumDisplacement > 1e-8).length,
    maximumDisplacement:rounded(Math.max(...rows.map(row => row.maximumDisplacement))),
  };
}

function solveEnumeration(problem, requestedConfig) {
  validateProblem(problem);
  validateConfig(requestedConfig);
  const config = structuredClone(requestedConfig);
  let current = snapshot(problem, Array(problem.variables.length).fill(0));
  const workRows = [];
  let linearizationCount = 0;
  let candidateEvaluations = 0;
  let status = null;
  let failure = null;
  for (let iteration = 1; iteration <= config.iterationBudget; iteration += 1) {
    if (current.maximumPhysicalResidual <= config.convergenceTolerance) {
      status = 'converged-unified-kkt-candidate';
      break;
    }
    let activeRows = current.rows.filter(row => row.signedGap < config.activationMargin);
    activeRows.sort((left, right) => left.key.localeCompare(right.key));
    if (config.candidateEnumeration === 'reverse') activeRows.reverse();
    const gradients = activeLinearization(problem, current, activeRows, config);
    linearizationCount += activeRows.length;
    const projection = projectedTarget(current, activeRows, gradients, config);
    if (!projection) {
      status = 'stalled-unified-kkt-candidate';
      failure = { phase:'unified-active-set-projection', lastTrustworthyEvidence:'selected' };
      break;
    }
    const candidates = config.lineSearch.map(lineScale => {
      const vector = clampVector(current.vector.map((value, axis) =>
        value + lineScale * (projection.target[axis] - value)), config.translationBounds);
      candidateEvaluations += 1;
      return { lineScale, snapshot:snapshot(problem, vector) };
    });
    candidates.sort((left, right) => compareSnapshots(left.snapshot, right.snapshot));
    const accepted = candidates.find(candidate =>
      candidate.snapshot.maximumPhysicalResidual < current.maximumPhysicalResidual - 1e-12);
    if (!accepted) {
      status = 'stalled-unified-kkt-candidate';
      failure = {
        phase:'unified-kkt-globalization-line-search',
        lastTrustworthyEvidence:'selected',
        residual:rounded(current.maximumPhysicalResidual, 15),
        violatedConstraints:current.rows
          .filter(row => row.signedGap < 0)
          .map(row => ({
            key:row.key,
            kind:row.kind,
            signedGap:rounded(row.signedGap, 15),
          })),
        linearizedConstraintKeys:activeRows.map(row => row.key).sort(),
        projectedConstraintKeys:[...projection.activeConstraintKeys].sort(),
        candidateResiduals:candidates
          .map(candidate => ({
            lineScale:candidate.lineScale,
            maximumPhysicalResidual:rounded(
              candidate.snapshot.maximumPhysicalResidual,
              15,
            ),
            pairwisePenetration:rounded(candidate.snapshot.metrics.pairwisePenetration, 15),
            skeletalPenetration:rounded(candidate.snapshot.metrics.skeletalPenetration, 15),
            compartmentEscape:rounded(candidate.snapshot.metrics.compartmentEscape, 15),
          }))
          .sort((left, right) => right.lineScale - left.lineScale),
      };
      break;
    }
    const before = current;
    current = accepted.snapshot;
    workRows.push({
      iteration,
      activeConstraintKeys:[...projection.activeConstraintKeys].sort(),
      activeKinds:[...new Set(projection.activeIndices.map(index => activeRows[index].kind))].sort(),
      acceptedLineScale:accepted.lineScale,
      maximumPhysicalResidualBefore:rounded(before.maximumPhysicalResidual, 15),
      maximumPhysicalResidualAfter:rounded(current.maximumPhysicalResidual, 15),
      pairwisePenetration:rounded(current.metrics.pairwisePenetration, 15),
      skeletalPenetration:rounded(current.metrics.skeletalPenetration, 15),
      compartmentEscape:rounded(current.metrics.compartmentEscape, 15),
      deformationEnergy:current.deformationEnergy,
    });
  }
  if (!status) {
    status = 'iteration-budget-exhausted';
    failure = {
      phase:'unified-kkt-iteration-budget',
      lastTrustworthyEvidence:'selected',
      residual:rounded(current.maximumPhysicalResidual, 15),
    };
  }
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
    deformationEnergy:current.deformationEnergy,
    displacement:displacementReceipt(problem, current.muscles),
  };
  const core = {
    schema:NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA,
    status,
    route:{ requested:ALGORITHM, effective:ALGORITHM, fallbackUsed:false },
    source:{ problemSha256:problem.identity.sha256, fixtureSha256:problem.source.fixtureSha256 },
    config:{ requested:structuredClone(requestedConfig), effective:config },
    mechanism: {
      updateMode:'one-snapshot-one-coupled-primal-dual-projection',
      objective:'minimum-squared-translation-from-crowded-state',
      constraintKinds:['pairwise-clearance', 'skeletal-clearance', 'compartment-clearance'],
      contactGraphRowsConsumed:false,
      oracleTargetCoordinatesConsumed:false,
      traversal:config.candidateEnumeration,
    },
    work:{ iterations:workRows.length, linearizationCount, candidateEvaluations, rows:workRows },
    selected,
    failure,
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function invarianceRow(result) {
  return {
    enumeration:result.config.requested.candidateEnumeration,
    status:result.status,
    selectedVector:result.selected.vector,
    physicalStateSha256:result.selected.physicalStateSha256,
    metricsSha256:result.selected.metricsSha256,
    workSha256:hashMusclePackingCanonicalJson(result.work),
  };
}

function maximumNumericFieldDifference(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return Math.max(...keys.map(key => {
    if (!Number.isFinite(left[key]) || !Number.isFinite(right[key])) return Infinity;
    return Math.abs(left[key] - right[key]);
  }));
}

function workDecisionStructure(work) {
  return work.rows.map(row => ({
    activeConstraintKeys:row.activeConstraintKeys,
    activeKinds:row.activeKinds,
    acceptedLineScale:row.acceptedLineScale,
  }));
}

export function createNBodyUnifiedKktConfig() {
  return {
    activationMargin:0.02,
    algorithm:ALGORITHM,
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-7,
    finiteDifferenceStep:1e-6,
    iterationBudget:128,
    lineSearch:[1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125],
    ridge:1e-10,
    translationBasis:TRANSLATION_BASIS,
    translationBounds:[-0.3, 0.3],
  };
}

export function compileNBodyUnifiedKktProblem(fixture) {
  if (fixture?.schema !== NBODY_PACKING_ASSAY_FIXTURE_SCHEMA) {
    throw new Error(`unified KKT fixture schema mismatch: ${fixture?.schema || 'missing'}`);
  }
  validateNBodyPackingAssayFixture(fixture);
  if (
    !fixture.identity?.sha256 ||
    fixture.input?.requested?.sha256 !== fixture.identity.sha256 ||
    fixture.input?.effective?.sha256 !== fixture.identity.sha256
  ) {
    throw new Error('unified KKT fixture identity mismatch');
  }
  const members = structuredClone(fixture.crowded.muscles);
  const variables = members.flatMap((member, memberIndex) => [
    { index:memberIndex * 2, memberId:member.id, axis:'x' },
    { index:memberIndex * 2 + 1, memberId:member.id, axis:'z' },
  ]);
  const core = {
    schema:NBODY_PACKING_UNIFIED_KKT_PROBLEM_SCHEMA,
    source:{
      fixtureSha256:fixture.identity.sha256,
      crowdedStateSha256:fixture.crowded.identity?.sha256 ||
        hashMusclePackingCanonicalJson(fixture.crowded),
    },
    crowdedSource:structuredClone(fixture.crowded),
    members,
    variables,
    carrier:{
      translationBasis:TRANSLATION_BASIS,
      degreesOfFreedomPerMember:2,
      attachmentDisplacement:'exact-zero',
      volumePolicy:'restore-exact-target-after-every-state-instantiation',
    },
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function solveNBodyUnifiedKktCandidate({ problem, requestedConfig } = {}) {
  validateProblem(problem);
  validateConfig(requestedConfig);
  const primary = solveEnumeration(problem, requestedConfig);
  const alternate = solveEnumeration(problem, {
    ...structuredClone(requestedConfig),
    candidateEnumeration:requestedConfig.candidateEnumeration === 'canonical'
      ? 'reverse'
      : 'canonical',
  });
  const primaryRow = invarianceRow(primary);
  const alternateRow = invarianceRow(alternate);
  const equivalenceTolerance = Math.max(requestedConfig.convergenceTolerance * 0.01, 1e-10);
  const maximumVectorDifference = Math.max(...primaryRow.selectedVector.map(
    (value, index) => Math.abs(value - alternateRow.selectedVector[index]),
  ));
  const maximumMetricsDifference = maximumNumericFieldDifference(
    primary.selected.metrics,
    alternate.selected.metrics,
  );
  const comparison = {
    statusEqual:primaryRow.status === alternateRow.status,
    selectedCarrierEquivalent:maximumVectorDifference <= equivalenceTolerance,
    physicalMetricsEquivalent:maximumMetricsDifference <= equivalenceTolerance,
    workDecisionStructureEqual:JSON.stringify(workDecisionStructure(primary.work)) ===
      JSON.stringify(workDecisionStructure(alternate.work)),
  };
  const passed = Object.values(comparison).every(Boolean);
  return {
    ...primary,
    invariance:{
      candidateEnumeration:passed ? 'passed' : 'failed',
      mechanism:'paired-complete-coupled-kkt-solve-comparison',
      equivalenceTolerance,
      maximumVectorDifference,
      maximumMetricsDifference,
      rows:[primaryRow, alternateRow],
      comparison,
    },
    identity:{ sha256:hashMusclePackingCanonicalJson({
      ...primary,
      invariance:{
        candidateEnumeration:passed ? 'passed' : 'failed',
        mechanism:'paired-complete-coupled-kkt-solve-comparison',
        equivalenceTolerance,
        maximumVectorDifference,
        maximumMetricsDifference,
        rows:[primaryRow, alternateRow],
        comparison,
      },
    }) },
  };
}
