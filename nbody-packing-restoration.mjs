import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import { evaluateNBodyUnifiedKktState } from './nbody-packing-unified-kkt.mjs';

export const NBODY_PACKING_RESTORATION_RESULT_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-result.v0';
export const NBODY_PACKING_COMMON_DESCENT_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-result.v0';
export const NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-trajectory-result.v0';
export const NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_STEP_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-adaptive-common-descent-step-result.v0';
export const NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-adaptive-common-descent-trajectory-result.v0';
export const NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_RESULT_SCHEMA =
  'kaminos.nbody-packing-active-row-trust-region-result.v0';
export const NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_TRAJECTORY_RESULT_SCHEMA =
  'kaminos.nbody-packing-active-row-trust-region-trajectory-result.v0';
export const NBODY_PACKING_ELASTIC_ALL_ROW_RESULT_SCHEMA =
  'kaminos.nbody-packing-elastic-all-row-result.v0';

const ALGORITHM = 'all-neighbor-p8-merit-trust-region-restoration-v0';
const FAMILY_FILTER_ALGORITHM = 'all-neighbor-p8-family-filter-restoration-v0';
const COMMON_DESCENT_ALGORITHM = 'family-gradient-minimum-norm-common-descent-v0';
const COMMON_DESCENT_TRAJECTORY_ALGORITHM =
  'family-gradient-minimum-norm-common-descent-trajectory-v0';
const ADAPTIVE_COMMON_DESCENT_STEP_ALGORITHM =
  'family-gradient-minimum-norm-common-descent-adaptive-step-v0';
const ADAPTIVE_COMMON_DESCENT_TRAJECTORY_ALGORITHM =
  'family-gradient-minimum-norm-common-descent-adaptive-trajectory-v0';
const ACTIVE_ROW_TRUST_REGION_ALGORITHM =
  'active-row-minimum-norm-common-descent-trust-region-v0';
const ACTIVE_ROW_TRUST_REGION_TRAJECTORY_ALGORITHM =
  'active-row-minimum-norm-common-descent-trust-region-trajectory-v0';
const ELASTIC_ALL_ROW_ALGORITHM =
  'elastic-all-row-linearized-least-squares-trust-region-v0';
const CONFIG_KEYS = Object.freeze([
  'acceptancePolicy',
  'algorithm',
  'candidateEnumeration',
  'convergenceTolerance',
  'familyRegressionTolerance',
  'finiteDifferenceStep',
  'iterationBudget',
  'meritNormOrder',
  'translationBounds',
  'trustRegionRadii',
  'violationWeight',
]);

function rounded(value, digits = 15) {
  const result = Number(value.toFixed(digits));
  return Object.is(result, -0) ? 0 : result;
}

function validateConfig(config) {
  if (JSON.stringify(Object.keys(config || {}).sort()) !== JSON.stringify(CONFIG_KEYS)) {
    throw new Error(`restoration requestedConfig requires exact keys: ${CONFIG_KEYS.join(', ')}`);
  }
  const algorithmByPolicy = {
    'scalar-merit':ALGORITHM,
    'family-pareto-no-resurrection':FAMILY_FILTER_ALGORITHM,
  };
  if (!Object.hasOwn(algorithmByPolicy, config.acceptancePolicy)) {
    throw new Error('restoration acceptancePolicy is unsupported');
  }
  if (config.algorithm !== algorithmByPolicy[config.acceptancePolicy]) {
    throw new Error(
      `restoration algorithm must match acceptancePolicy ${config.acceptancePolicy}`,
    );
  }
  if (!['canonical', 'reverse'].includes(config.candidateEnumeration)) {
    throw new Error('restoration candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'convergenceTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'violationWeight',
  ]) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`restoration ${key} must be positive and finite`);
    }
  }
  if (!Number.isInteger(config.iterationBudget) || config.iterationBudget <= 0) {
    throw new Error('restoration iterationBudget must be a positive integer');
  }
  if (!Number.isInteger(config.meritNormOrder) || config.meritNormOrder < 2) {
    throw new Error('restoration meritNormOrder must be an integer at least two');
  }
  if (
    !Array.isArray(config.translationBounds) || config.translationBounds.length !== 2 ||
    !config.translationBounds.every(Number.isFinite) ||
    config.translationBounds[0] >= config.translationBounds[1]
  ) {
    throw new Error('restoration translationBounds must be an ordered finite pair');
  }
  if (
    !Array.isArray(config.trustRegionRadii) || config.trustRegionRadii.length === 0 ||
    config.trustRegionRadii.some(value => !Number.isFinite(value) || value <= 0) ||
    config.trustRegionRadii.some(
      (value, index) => index > 0 && value >= config.trustRegionRadii[index - 1],
    )
  ) {
    throw new Error(
      'restoration trustRegionRadii must be strictly decreasing positive finite values',
    );
  }
}

function validateStart(problem, vector, bounds) {
  if (
    !Array.isArray(vector) || vector.length !== problem?.variables?.length ||
    vector.some(value => !Number.isFinite(value))
  ) {
    throw new Error(
      `restoration startVector must contain ${problem?.variables?.length || 0} finite values`,
    );
  }
  if (vector.some(value => value < bounds[0] || value > bounds[1])) {
    throw new Error('restoration startVector exceeds translationBounds');
  }
}

function hardResidualComponents(state) {
  return [
    state.metrics.pairwisePenetration,
    state.metrics.skeletalPenetration,
    state.metrics.compartmentEscape,
    state.metrics.endpointDrift,
    state.metrics.maximumRelativeVolumeError,
  ];
}

const CONSTRAINT_FAMILY_METRIC_KEYS = Object.freeze([
  'pairwisePenetration',
  'skeletalPenetration',
  'compartmentEscape',
]);

function constraintFamilyMetrics(receipt) {
  return Object.fromEntries(
    CONSTRAINT_FAMILY_METRIC_KEYS.map(key => [key, receipt.metrics[key]]),
  );
}

function familyRegressions(before, candidate, tolerance) {
  return CONSTRAINT_FAMILY_METRIC_KEYS.filter(
    key => candidate.metrics[key] > before.metrics[key] + tolerance,
  );
}

function stateReceipt(state, config) {
  const orderedRows = [...state.rows].sort((left, right) => left.key.localeCompare(right.key));
  const violatedRows = orderedRows.filter(row => row.signedGap < 0);
  const violationEnergy = violatedRows.reduce(
    (sum, row) => sum + Math.max(0, -row.signedGap) ** 2,
    0,
  );
  const hardResidualNorm = hardResidualComponents(state).reduce(
    (sum, value) => sum + value ** config.meritNormOrder,
    0,
  ) ** (1 / config.meritNormOrder);
  return {
    vector:[...state.vector],
    maximumPhysicalResidual:rounded(state.maximumPhysicalResidual),
    hardResidualNorm:rounded(hardResidualNorm),
    violationEnergy:rounded(violationEnergy),
    merit:rounded(hardResidualNorm + config.violationWeight * Math.sqrt(violationEnergy)),
    deformationEnergy:state.deformationEnergy,
    metrics:structuredClone(state.metrics),
    rowCount:orderedRows.length,
    violatedConstraintKeys:violatedRows.map(row => row.key),
    violatedKinds:[...new Set(violatedRows.map(row => row.kind))].sort(),
  };
}

function compareReceipts(left, right) {
  if (Math.abs(left.merit - right.merit) > 1e-15) return left.merit - right.merit;
  if (
    Math.abs(left.maximumPhysicalResidual - right.maximumPhysicalResidual) > 1e-15
  ) {
    return left.maximumPhysicalResidual - right.maximumPhysicalResidual;
  }
  if (Math.abs(left.violationEnergy - right.violationEnergy) > 1e-18) {
    return left.violationEnergy - right.violationEnergy;
  }
  return hashMusclePackingCanonicalJson(left.vector)
    .localeCompare(hashMusclePackingCanonicalJson(right.vector));
}

function clampVector(vector, bounds) {
  return vector.map(value => rounded(Math.max(bounds[0], Math.min(bounds[1], value))));
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function normalized(vector) {
  const norm = Math.hypot(...vector);
  if (!(norm > 0) || !Number.isFinite(norm)) return { norm, vector:null };
  return { norm, vector:vector.map(value => value / norm) };
}

function allRowSquaredViolationEnergy(state) {
  return state.rows.reduce(
    (sum, row) => sum + Math.max(0, -row.signedGap) ** 2,
    0,
  );
}

function solvePivotedLinearSystem(matrix, rightHandSide, pivotTolerance) {
  const size = rightHandSide.length;
  if (
    matrix.length !== size ||
    matrix.some(row => row.length !== size || row.some(value => !Number.isFinite(value))) ||
    rightHandSide.some(value => !Number.isFinite(value))
  ) throw new Error('elastic all-row normal equations must be square and finite');
  const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) <= pivotTolerance) {
      throw new Error(`elastic all-row normal-equation pivot collapsed at ${column}`);
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map(row => row[size]);
}

function solveBoundedNormalEquations({
  matrix,
  rightHandSide,
  radius,
  pivotTolerance,
  convergenceTolerance,
  iterationBudget,
}) {
  const shifted = shift => matrix.map((row, rowIndex) => row.map(
    (value, columnIndex) => value + (rowIndex === columnIndex ? shift : 0),
  ));
  const unconstrained = solvePivotedLinearSystem(matrix, rightHandSide, pivotTolerance);
  const unconstrainedNorm = Math.hypot(...unconstrained);
  if (unconstrainedNorm <= radius + convergenceTolerance) {
    return { vector:unconstrained, multiplier:0, iterations:0, converged:true };
  }
  let lower = 0;
  let upper = 1;
  let upperVector = solvePivotedLinearSystem(
    shifted(upper),
    rightHandSide,
    pivotTolerance,
  );
  let expansionIterations = 0;
  while (Math.hypot(...upperVector) > radius && expansionIterations < iterationBudget) {
    lower = upper;
    upper *= 2;
    upperVector = solvePivotedLinearSystem(
      shifted(upper),
      rightHandSide,
      pivotTolerance,
    );
    expansionIterations += 1;
  }
  if (Math.hypot(...upperVector) > radius) {
    return {
      vector:upperVector,
      multiplier:upper,
      iterations:expansionIterations,
      converged:false,
    };
  }
  let vector = upperVector;
  let multiplier = upper;
  let iterations = expansionIterations;
  for (; iterations < iterationBudget; iterations += 1) {
    multiplier = (lower + upper) / 2;
    vector = solvePivotedLinearSystem(
      shifted(multiplier),
      rightHandSide,
      pivotTolerance,
    );
    const norm = Math.hypot(...vector);
    if (Math.abs(norm - radius) <= convergenceTolerance) {
      return { vector, multiplier, iterations:iterations + 1, converged:true };
    }
    if (norm > radius) lower = multiplier;
    else upper = multiplier;
  }
  return {
    vector,
    multiplier,
    iterations,
    converged:Math.hypot(...vector) <= radius + convergenceTolerance,
  };
}

function minimumNormConvexCombination(vectors) {
  const candidates = [];
  for (let index = 0; index < vectors.length; index += 1) {
    const weights = vectors.map((_, vectorIndex) => vectorIndex === index ? 1 : 0);
    candidates.push({ weights, vector:[...vectors[index]] });
  }
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      const delta = vectors[right].map((value, axis) => value - vectors[left][axis]);
      const denominator = dot(delta, delta);
      const t = denominator > 0
        ? Math.max(0, Math.min(1, -dot(vectors[left], delta) / denominator))
        : 0;
      const weights = vectors.map((_, index) =>
        index === left ? 1 - t : index === right ? t : 0
      );
      candidates.push({
        weights,
        vector:vectors[left].map((value, axis) => value + t * delta[axis]),
      });
    }
  }
  if (vectors.length === 3) {
    const a = vectors[0].map((value, axis) => value - vectors[2][axis]);
    const b = vectors[1].map((value, axis) => value - vectors[2][axis]);
    const aa = dot(a, a);
    const ab = dot(a, b);
    const bb = dot(b, b);
    const ac = dot(a, vectors[2]);
    const bc = dot(b, vectors[2]);
    const determinant = aa * bb - ab * ab;
    if (Math.abs(determinant) > 1e-15) {
      const first = (-ac * bb + ab * bc) / determinant;
      const second = (-bc * aa + ab * ac) / determinant;
      const weights = [first, second, 1 - first - second];
      if (weights.every(value => value >= -1e-12 && value <= 1 + 1e-12)) {
        const clampedWeights = weights.map(value => Math.max(0, Math.min(1, value)));
        const total = clampedWeights.reduce((sum, value) => sum + value, 0);
        const normalizedWeights = clampedWeights.map(value => value / total);
        candidates.push({
          weights:normalizedWeights,
          vector:vectors[0].map((_, axis) => vectors.reduce(
            (sum, vector, index) => sum + normalizedWeights[index] * vector[axis],
            0,
          )),
        });
      }
    }
  }
  candidates.sort((left, right) => {
    const normDifference = dot(left.vector, left.vector) - dot(right.vector, right.vector);
    if (Math.abs(normDifference) > 1e-15) return normDifference;
    return JSON.stringify(left.weights).localeCompare(JSON.stringify(right.weights));
  });
  return candidates[0];
}

function minimumNormConvexCombinationFrankWolfe(vectors, {
  iterationBudget,
  tolerance,
}) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('active-row convex solver requires at least one vector');
  }
  const dimension = vectors[0].length;
  if (vectors.some(vector => vector.length !== dimension || vector.some(value => !Number.isFinite(value)))) {
    throw new Error('active-row convex solver vectors must share one finite dimension');
  }
  let weights = vectors.map(() => 1 / vectors.length);
  let combined = vectors[0].map((_, axis) => vectors.reduce(
    (sum, vector, index) => sum + weights[index] * vector[axis],
    0,
  ));
  let dualityGap = Infinity;
  let iterations = 0;
  for (; iterations < iterationBudget; iterations += 1) {
    const gradient = vectors.map(vector => dot(vector, combined));
    let toward = 0;
    for (let index = 1; index < gradient.length; index += 1) {
      if (gradient[index] < gradient[toward] - 1e-18) toward = index;
    }
    dualityGap = dot(combined, combined) - gradient[toward];
    if (dualityGap <= tolerance) break;
    let away = weights.findIndex(value => value > 1e-15);
    for (let index = away + 1; index < gradient.length; index += 1) {
      if (weights[index] > 1e-15 && gradient[index] > gradient[away] + 1e-18) away = index;
    }
    if (away < 0 || away === toward) break;
    const delta = vectors[toward].map((value, axis) => value - vectors[away][axis]);
    const denominator = dot(delta, delta);
    if (!(denominator > 0)) break;
    const step = Math.max(0, Math.min(weights[away], -dot(combined, delta) / denominator));
    if (!(step > 0)) break;
    weights[toward] += step;
    weights[away] -= step;
    if (weights[away] < 1e-15) weights[away] = 0;
    combined = combined.map((value, axis) => value + step * delta[axis]);
  }
  const finalGradient = vectors.map(vector => dot(vector, combined));
  dualityGap = dot(combined, combined) - Math.min(...finalGradient);
  return {
    weights,
    vector:combined,
    norm:Math.hypot(...combined),
    iterations,
    dualityGap:Math.max(0, dualityGap),
    converged:dualityGap <= tolerance,
  };
}

export function createNBodyActiveRowTrustRegionConfig({
  activeSetPolicy = 'all-violated',
  relativeActivationBand = 0.01,
} = {}) {
  return {
    activeSetPolicy,
    activationMargin:0,
    algorithm:ACTIVE_ROW_TRUST_REGION_ALGORITHM,
    candidateEnumeration:'canonical',
    convexSolverIterationBudget:10000,
    convexSolverTolerance:1e-12,
    directionalDerivativeTolerance:1e-10,
    familyRegressionTolerance:1e-12,
    finiteDifferenceStep:1e-5,
    improvementTolerance:1e-12,
    relativeActivationBand,
    translationBounds:[-0.3, 0.3],
    trustRegionRadii:[
      0.001,
      0.0005,
      0.00025,
      0.000125,
      0.0000625,
      0.00003125,
      0.000015625,
      0.0000078125,
      0.00000390625,
      0.000001953125,
      0.0000009765625,
      0.00000048828125,
      0.000000244140625,
      0.0000001220703125,
      0.00000006103515625,
      0.000000030517578125,
      0.0000000152587890625,
      0.00000000762939453125,
      0.000000003814697265625,
      0.0000000019073486328125,
    ],
  };
}

export function solveNBodyActiveRowTrustRegionStep({
  problem,
  startVector,
  requestedConfig = createNBodyActiveRowTrustRegionConfig(),
} = {}) {
  const expectedKeys = [
    'activeSetPolicy',
    'activationMargin',
    'algorithm',
    'candidateEnumeration',
    'convexSolverIterationBudget',
    'convexSolverTolerance',
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'relativeActivationBand',
    'translationBounds',
    'trustRegionRadii',
  ].sort();
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `active-row trust-region requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== ACTIVE_ROW_TRUST_REGION_ALGORITHM) {
    throw new Error('active-row trust-region algorithm identity is unsupported');
  }
  if (!['all-violated', 'family-maximum-relative-band'].includes(
    requestedConfig.activeSetPolicy,
  )) {
    throw new Error('active-row trust-region activeSetPolicy is unsupported');
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('active-row trust-region candidateEnumeration must be canonical or reverse');
  }
  if (!Number.isFinite(requestedConfig.activationMargin) || requestedConfig.activationMargin < 0) {
    throw new Error('active-row trust-region activationMargin must be finite and nonnegative');
  }
  if (
    !Number.isFinite(requestedConfig.relativeActivationBand) ||
    requestedConfig.relativeActivationBand <= 0 ||
    requestedConfig.relativeActivationBand >= 1
  ) {
    throw new Error('active-row trust-region relativeActivationBand must be between zero and one');
  }
  for (const key of [
    'convexSolverTolerance',
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'improvementTolerance',
  ]) {
    if (!Number.isFinite(requestedConfig[key]) || requestedConfig[key] <= 0) {
      throw new Error(`active-row trust-region ${key} must be positive and finite`);
    }
  }
  if (
    !Number.isInteger(requestedConfig.convexSolverIterationBudget) ||
    requestedConfig.convexSolverIterationBudget <= 0
  ) {
    throw new Error('active-row trust-region convexSolverIterationBudget must be positive');
  }
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) throw new Error('active-row trust-region translationBounds must be an ordered finite pair');
  if (
    !Array.isArray(requestedConfig.trustRegionRadii) ||
    requestedConfig.trustRegionRadii.length === 0 ||
    requestedConfig.trustRegionRadii.some(value => !Number.isFinite(value) || value <= 0) ||
    requestedConfig.trustRegionRadii.some(
      (value, index) => index > 0 && value >= requestedConfig.trustRegionRadii[index - 1],
    )
  ) throw new Error('active-row trust-region radii must be strictly decreasing');
  validateStart(problem, startVector, requestedConfig.translationBounds);

  const startState = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  let evaluationCount = 1;
  const violatedSourceRows = startState.rows.filter(row => row.signedGap <= 0);
  const rowFamilyMaxima = Object.fromEntries(
    [...new Set(violatedSourceRows.map(row => row.kind))].sort().map(kind => [
      kind,
      Math.max(...violatedSourceRows
        .filter(row => row.kind === kind)
        .map(row => Math.max(0, -row.signedGap))),
    ]),
  );
  const activeCandidates = requestedConfig.activeSetPolicy === 'all-violated'
    ? startState.rows.filter(row => row.signedGap <= requestedConfig.activationMargin)
    : violatedSourceRows;
  const activeSourceRows = activeCandidates
    .filter(row => requestedConfig.activeSetPolicy === 'all-violated'
      ? row.signedGap <= requestedConfig.activationMargin
      : Math.max(0, -row.signedGap) >=
        rowFamilyMaxima[row.kind] * (1 - requestedConfig.relativeActivationBand)
    )
    .sort((left, right) => left.key.localeCompare(right.key));
  if (activeSourceRows.length === 0) {
    throw new Error('active-row trust-region start has no active constraint rows');
  }
  const gradientByKey = Object.fromEntries(activeSourceRows.map(row => [
    row.key,
    Array(startVector.length).fill(0),
  ]));
  for (let axis = 0; axis < startVector.length; axis += 1) {
    const positive = clampVector(startVector.map((value, index) =>
      index === axis ? value + requestedConfig.finiteDifferenceStep : value
    ), requestedConfig.translationBounds);
    const negative = clampVector(startVector.map((value, index) =>
      index === axis ? value - requestedConfig.finiteDifferenceStep : value
    ), requestedConfig.translationBounds);
    const span = positive[axis] - negative[axis];
    if (!(span > 0)) {
      throw new Error(`active-row trust-region finite-difference span collapsed at ${axis}`);
    }
    const positiveState = evaluateNBodyUnifiedKktState({ problem, vector:positive });
    const negativeState = evaluateNBodyUnifiedKktState({ problem, vector:negative });
    evaluationCount += 2;
    const positiveByKey = Object.fromEntries(positiveState.rows.map(row => [row.key, row]));
    const negativeByKey = Object.fromEntries(negativeState.rows.map(row => [row.key, row]));
    for (const row of activeSourceRows) {
      gradientByKey[row.key][axis] = -(
        positiveByKey[row.key].signedGap - negativeByKey[row.key].signedGap
      ) / span;
    }
  }
  const activeRows = activeSourceRows.map(row => {
    const gradient = gradientByKey[row.key];
    const unit = normalized(gradient);
    return {
      key:row.key,
      kind:row.kind,
      signedGap:rounded(row.signedGap),
      violation:rounded(Math.max(0, -row.signedGap)),
      gradient:gradient.map(value => rounded(value)),
      gradientNorm:rounded(unit.norm),
      normalizedGradient:unit.vector?.map(value => rounded(value)) || null,
    };
  });
  const degenerateConstraintKeys = activeRows
    .filter(row => !row.normalizedGradient)
    .map(row => row.key);
  const optimizer = degenerateConstraintKeys.length === 0
    ? minimumNormConvexCombinationFrankWolfe(
      activeRows.map(row => row.normalizedGradient),
      {
        iterationBudget:requestedConfig.convexSolverIterationBudget,
        tolerance:requestedConfig.convexSolverTolerance,
      },
    )
    : null;
  if (optimizer && !optimizer.converged) {
    throw new Error('active-row convex solver did not converge within its requested budget');
  }
  const combined = optimizer ? normalized(optimizer.vector) : { norm:0, vector:null };
  const direction = combined.vector?.map(value => -value) || null;
  const predictedDirectionalDerivatives = direction
    ? activeRows.map(row => rounded(dot(row.normalizedGradient, direction)))
    : activeRows.map(() => null);
  const predictedCommonDescent = direction !== null &&
    predictedDirectionalDerivatives.every(
      value => value < -requestedConfig.directionalDerivativeTolerance,
    );
  const startMaximumActiveRowViolation = Math.max(
    ...activeRows.map(row => row.violation),
  );
  const beforeFamilies = constraintFamilyMetrics(startState);
  const enumeratedRadii = requestedConfig.candidateEnumeration === 'canonical'
    ? [...requestedConfig.trustRegionRadii]
    : [...requestedConfig.trustRegionRadii].reverse();
  const candidates = direction ? enumeratedRadii.map(radius => {
    const vector = clampVector(
      startVector.map((value, axis) => value + radius * direction[axis]),
      requestedConfig.translationBounds,
    );
    const state = evaluateNBodyUnifiedKktState({ problem, vector });
    evaluationCount += 1;
    const stateByKey = Object.fromEntries(state.rows.map(row => [row.key, row]));
    const maximumActiveRowViolation = Math.max(
      ...activeRows.map(row => Math.max(0, -stateByKey[row.key].signedGap)),
    );
    const families = constraintFamilyMetrics(state);
    const regressedFamilies = CONSTRAINT_FAMILY_METRIC_KEYS.filter(
      key => families[key] > beforeFamilies[key] + requestedConfig.familyRegressionTolerance,
    );
    return { radius, vector, state, maximumActiveRowViolation, families, regressedFamilies };
  }) : [];
  candidates.sort((left, right) => {
    if (left.maximumActiveRowViolation !== right.maximumActiveRowViolation) {
      return left.maximumActiveRowViolation - right.maximumActiveRowViolation;
    }
    if (left.state.maximumPhysicalResidual !== right.state.maximumPhysicalResidual) {
      return left.state.maximumPhysicalResidual - right.state.maximumPhysicalResidual;
    }
    return hashMusclePackingCanonicalJson(left.vector)
      .localeCompare(hashMusclePackingCanonicalJson(right.vector));
  });
  const accepted = predictedCommonDescent ? candidates.find(candidate =>
    candidate.maximumActiveRowViolation <
      startMaximumActiveRowViolation - requestedConfig.improvementTolerance &&
    candidate.regressedFamilies.length === 0
  ) : null;
  const candidateReceipts = [...candidates]
    .sort((left, right) => right.radius - left.radius)
    .map(candidate => ({
      radius:candidate.radius,
      vector:[...candidate.vector],
      maximumActiveRowViolation:rounded(candidate.maximumActiveRowViolation),
      maximumPhysicalResidual:candidate.state.maximumPhysicalResidual,
      constraintFamilies:structuredClone(candidate.families),
      regressedFamilies:[...candidate.regressedFamilies],
      selected:candidate === accepted,
      rejectionReason:candidate === accepted
        ? null
        : !predictedCommonDescent
          ? 'no-predicted-active-row-common-descent'
          : candidate.regressedFamilies.length > 0
            ? 'constraint-family-regression'
            : !(candidate.maximumActiveRowViolation <
                startMaximumActiveRowViolation - requestedConfig.improvementTolerance)
              ? 'non-improving-active-row-violation'
              : 'higher-ranked-admissible-candidate',
    }));
  const selectedState = accepted?.state || startState;
  const selectedVector = accepted?.vector || startVector;
  const status = accepted
    ? 'active-row-trust-region-step-accepted'
    : predictedCommonDescent
      ? 'nonlinear-active-row-trust-region-floor'
      : 'local-active-row-cone-certificate';
  const certificate = accepted ? null : {
    kind:predictedCommonDescent
      ? 'nonlinear-active-row-radius-floor'
      : 'linearized-active-row-cone-floor',
    activeConstraintKeys:activeRows.map(row => row.key),
    activeConstraintKinds:[...new Set(activeRows.map(row => row.kind))].sort(),
    minimumNorm:optimizer ? rounded(optimizer.norm) : null,
    predictedDirectionalDerivatives:[...predictedDirectionalDerivatives],
    trustRegionRadii:[...requestedConfig.trustRegionRadii],
    availableDegreesOfFreedom:problem.variables.length,
    carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    reason:predictedCommonDescent
      ? 'all-requested-radii-fail-nonlinear-progress-or-family-admission'
      : degenerateConstraintKeys.length > 0
        ? 'one-or-more-active-row-gradients-are-degenerate'
        : 'origin-reaches-the-active-violation-gradient-convex-hull-within-tolerance',
  };
  const core = {
    schema:NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_RESULT_SCHEMA,
    status,
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start:{
      vector:[...startVector],
      maximumActiveRowViolation:rounded(startMaximumActiveRowViolation),
      maximumPhysicalResidual:startState.maximumPhysicalResidual,
      metrics:structuredClone(startState.metrics),
      rowFamilyMaxima:Object.fromEntries(Object.entries(rowFamilyMaxima).map(
        ([kind, value]) => [kind, rounded(value)],
      )),
    },
    directionConstruction:{
      activeRows,
      activationMargin:requestedConfig.activationMargin,
      degenerateConstraintKeys,
      convexWeights:optimizer?.weights.map(value => rounded(value)) || activeRows.map(() => 0),
      minimumNorm:optimizer ? rounded(optimizer.norm) : null,
      optimizer:{
        algorithm:'deterministic-pairwise-simplex-minimum-norm',
        iterations:optimizer?.iterations || 0,
        dualityGap:optimizer ? rounded(optimizer.dualityGap) : null,
        converged:optimizer?.converged || false,
      },
      direction:direction?.map(value => rounded(value)) || null,
      predictedDirectionalDerivatives,
      predictedCommonDescent,
      activeSetPolicy:requestedConfig.activeSetPolicy,
      relativeActivationBand:requestedConfig.relativeActivationBand,
    },
    selected:{
      vector:[...selectedVector],
      maximumActiveRowViolation:accepted
        ? rounded(accepted.maximumActiveRowViolation)
        : rounded(startMaximumActiveRowViolation),
      maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
      metrics:structuredClone(selectedState.metrics),
      muscles:structuredClone(selectedState.muscles),
    },
    work:{
      iterations:accepted ? 1 : 0,
      attempts:direction ? 1 : 0,
      evaluationCount,
      terminalReason:accepted
        ? null
        : predictedCommonDescent
          ? 'no-active-row-admissible-trust-region-candidate'
          : 'no-predicted-active-row-common-descent-direction',
      candidateReceipts,
    },
    certificate,
    mechanism:{
      directionBasis:'minimum-norm-convex-combination-of-normalized-active-row-violation-gradients',
      nonlinearAcceptance:'lower-active-row-maximum-and-no-family-regression',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:true,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-active-row-step-or-local-floor-certificate-not-global-feasibility-or-carrier-impossibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyElasticAllRowComparatorConfig() {
  return {
    algorithm:ELASTIC_ALL_ROW_ALGORITHM,
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-12,
    familyTradeoffAllowance:0.00004249551501,
    finiteDifferenceStep:1e-5,
    improvementTolerance:1e-12,
    internalIterationBudget:64,
    pivotTolerance:1e-14,
    slackPenalty:1,
    stepRegularization:1e-4,
    translationBounds:[-0.3, 0.3],
    trustRegionRadii:[
      0.001,
      0.0005,
      0.00025,
      0.000125,
      0.0000625,
      0.00003125,
      0.000015625,
      0.0000078125,
      0.00000390625,
      0.000001953125,
      0.0000009765625,
      0.00000048828125,
      0.000000244140625,
      0.0000001220703125,
      0.00000006103515625,
      0.000000030517578125,
      0.0000000152587890625,
      0.00000000762939453125,
      0.000000003814697265625,
      0.0000000019073486328125,
    ],
  };
}

export function solveNBodyElasticAllRowComparatorStep({
  problem,
  startVector,
  requestedConfig = createNBodyElasticAllRowComparatorConfig(),
} = {}) {
  const expectedKeys = [
    'algorithm',
    'candidateEnumeration',
    'convergenceTolerance',
    'familyTradeoffAllowance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'internalIterationBudget',
    'pivotTolerance',
    'slackPenalty',
    'stepRegularization',
    'translationBounds',
    'trustRegionRadii',
  ].sort();
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `elastic all-row requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== ELASTIC_ALL_ROW_ALGORITHM) {
    throw new Error('elastic all-row algorithm identity is unsupported');
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('elastic all-row candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'convergenceTolerance',
    'familyTradeoffAllowance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'pivotTolerance',
    'slackPenalty',
    'stepRegularization',
  ]) {
    if (!Number.isFinite(requestedConfig[key]) || requestedConfig[key] <= 0) {
      throw new Error(`elastic all-row ${key} must be positive and finite`);
    }
  }
  if (
    !Number.isInteger(requestedConfig.internalIterationBudget) ||
    requestedConfig.internalIterationBudget <= 0
  ) throw new Error('elastic all-row internalIterationBudget must be a positive integer');
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) throw new Error('elastic all-row translationBounds must be an ordered finite pair');
  if (
    !Array.isArray(requestedConfig.trustRegionRadii) ||
    requestedConfig.trustRegionRadii.length === 0 ||
    requestedConfig.trustRegionRadii.some(value => !Number.isFinite(value) || value <= 0) ||
    requestedConfig.trustRegionRadii.some(
      (value, index) => index > 0 && value >= requestedConfig.trustRegionRadii[index - 1],
    )
  ) throw new Error('elastic all-row radii must be strictly decreasing');
  validateStart(problem, startVector, requestedConfig.translationBounds);

  const startState = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  let evaluationCount = 1;
  const sourceRows = [...startState.rows].sort((left, right) => left.key.localeCompare(right.key));
  const sourceKeys = sourceRows.map(row => row.key);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error('elastic all-row source row keys must be unique');
  }
  const gradients = sourceRows.map(() => Array(startVector.length).fill(0));
  for (let axis = 0; axis < startVector.length; axis += 1) {
    const positive = clampVector(startVector.map((value, index) =>
      index === axis ? value + requestedConfig.finiteDifferenceStep : value
    ), requestedConfig.translationBounds);
    const negative = clampVector(startVector.map((value, index) =>
      index === axis ? value - requestedConfig.finiteDifferenceStep : value
    ), requestedConfig.translationBounds);
    const span = positive[axis] - negative[axis];
    if (!(span > 0)) {
      throw new Error(`elastic all-row finite-difference span collapsed at ${axis}`);
    }
    const positiveState = evaluateNBodyUnifiedKktState({ problem, vector:positive });
    const negativeState = evaluateNBodyUnifiedKktState({ problem, vector:negative });
    evaluationCount += 2;
    const positiveRows = [...positiveState.rows]
      .sort((left, right) => left.key.localeCompare(right.key));
    const negativeRows = [...negativeState.rows]
      .sort((left, right) => left.key.localeCompare(right.key));
    if (
      JSON.stringify(positiveRows.map(row => row.key)) !== JSON.stringify(sourceKeys) ||
      JSON.stringify(negativeRows.map(row => row.key)) !== JSON.stringify(sourceKeys)
    ) throw new Error(`elastic all-row row keys changed at finite-difference axis ${axis}`);
    for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
      gradients[rowIndex][axis] = (
        positiveRows[rowIndex].signedGap - negativeRows[rowIndex].signedGap
      ) / span;
    }
  }

  let activeIndices = sourceRows
    .map((row, index) => row.signedGap < 0 ? index : null)
    .filter(index => index !== null);
  let displacement = Array(startVector.length).fill(0);
  let multiplier = 0;
  let internalIterations = 0;
  let trustRegionIterations = 0;
  let converged = false;
  for (; internalIterations < requestedConfig.internalIterationBudget; internalIterations += 1) {
    const matrix = Array.from({ length:startVector.length }, (_, row) =>
      Array.from({ length:startVector.length }, (_, column) =>
        row === column ? requestedConfig.stepRegularization : 0
      )
    );
    const rightHandSide = Array(startVector.length).fill(0);
    for (const rowIndex of activeIndices) {
      const gradient = gradients[rowIndex];
      const gap = sourceRows[rowIndex].signedGap;
      for (let row = 0; row < startVector.length; row += 1) {
        rightHandSide[row] -= requestedConfig.slackPenalty * gradient[row] * gap;
        for (let column = 0; column < startVector.length; column += 1) {
          matrix[row][column] += requestedConfig.slackPenalty *
            gradient[row] * gradient[column];
        }
      }
    }
    const bounded = solveBoundedNormalEquations({
      matrix,
      rightHandSide,
      radius:requestedConfig.trustRegionRadii[0],
      pivotTolerance:requestedConfig.pivotTolerance,
      convergenceTolerance:requestedConfig.convergenceTolerance,
      iterationBudget:requestedConfig.internalIterationBudget,
    });
    displacement = bounded.vector;
    multiplier = bounded.multiplier;
    trustRegionIterations += bounded.iterations;
    if (!bounded.converged) break;
    const nextActiveIndices = sourceRows
      .map((row, index) => row.signedGap + dot(gradients[index], displacement) < 0
        ? index
        : null)
      .filter(index => index !== null);
    if (JSON.stringify(nextActiveIndices) === JSON.stringify(activeIndices)) {
      activeIndices = nextActiveIndices;
      converged = true;
      internalIterations += 1;
      break;
    }
    activeIndices = nextActiveIndices;
  }

  const predictedGaps = sourceRows.map(
    (row, index) => row.signedGap + dot(gradients[index], displacement),
  );
  const predictedSlacks = predictedGaps.map(gap => Math.max(0, -gap));
  const finalActiveSet = predictedSlacks
    .map((slack, index) => slack > 0 ? index : null)
    .filter(index => index !== null);
  const normalGradient = displacement.map(value => requestedConfig.stepRegularization * value);
  for (const rowIndex of finalActiveSet) {
    const residual = sourceRows[rowIndex].signedGap + dot(gradients[rowIndex], displacement);
    for (let axis = 0; axis < normalGradient.length; axis += 1) {
      normalGradient[axis] += requestedConfig.slackPenalty *
        gradients[rowIndex][axis] * residual;
    }
  }
  if (multiplier > 0) {
    for (let axis = 0; axis < normalGradient.length; axis += 1) {
      normalGradient[axis] += multiplier * displacement[axis];
    }
  }
  const normalEquationResidual = Math.max(...normalGradient.map(Math.abs));
  const normalizedDisplacement = normalized(displacement);
  const direction = normalizedDisplacement.vector;
  const beforeFamilies = constraintFamilyMetrics(startState);
  const sourceEnergy = allRowSquaredViolationEnergy(startState);
  const candidateDirection = direction || Array(startVector.length).fill(0);
  const enumeratedRadii = requestedConfig.candidateEnumeration === 'canonical'
    ? [...requestedConfig.trustRegionRadii]
    : [...requestedConfig.trustRegionRadii].reverse();
  const evaluatedCandidates = enumeratedRadii.map(radius => {
    const vector = clampVector(
      startVector.map((value, axis) => value + radius * candidateDirection[axis]),
      requestedConfig.translationBounds,
    );
    const actualDisplacement = vector.map(
      (value, axis) => value - startVector[axis],
    );
    const candidatePredictedGaps = sourceRows.map(
      (row, index) => row.signedGap + dot(gradients[index], actualDisplacement),
    );
    const candidatePredictedSlacks = candidatePredictedGaps.map(
      gap => Math.max(0, -gap),
    );
    const state = evaluateNBodyUnifiedKktState({ problem, vector });
    evaluationCount += 1;
    const rows = [...state.rows].sort((left, right) => left.key.localeCompare(right.key));
    if (JSON.stringify(rows.map(row => row.key)) !== JSON.stringify(sourceKeys)) {
      throw new Error(`elastic all-row row keys changed at nonlinear radius ${radius}`);
    }
    const energy = allRowSquaredViolationEnergy(state);
    const families = constraintFamilyMetrics(state);
    const rejectionReasons = [];
    if (!converged) rejectionReasons.push('linearized-subproblem-not-converged');
    if (!direction) rejectionReasons.push('linearized-subproblem-zero-displacement');
    if (!(energy < sourceEnergy - requestedConfig.improvementTolerance)) {
      rejectionReasons.push('non-improving-all-row-squared-violation-energy');
    }
    for (const key of CONSTRAINT_FAMILY_METRIC_KEYS) {
      if (families[key] > beforeFamilies[key] + requestedConfig.familyTradeoffAllowance) {
        rejectionReasons.push(`${key}-tradeoff-envelope-exceeded`);
      }
    }
    if (
      state.maximumPhysicalResidual >
        startState.maximumPhysicalResidual + requestedConfig.familyTradeoffAllowance
    ) rejectionReasons.push('maximum-physical-residual-envelope-exceeded');
    if (state.metrics.endpointDrift !== 0) rejectionReasons.push('endpoint-drift');
    if (state.metrics.maximumRelativeVolumeError !== 0) rejectionReasons.push('volume-error');
    if (state.metrics.nonFiniteValueCount !== 0) rejectionReasons.push('nonfinite-value');
    if (state.metrics.nonPositiveRadiusCount !== 0) rejectionReasons.push('nonpositive-radius');
    if (
      state.metrics.sourceCurvatureReversalCount >
        startState.metrics.sourceCurvatureReversalCount
    ) rejectionReasons.push('source-curvature-reversal');
    if (
      state.metrics.sourceTangentReversalCount > startState.metrics.sourceTangentReversalCount
    ) rejectionReasons.push('source-tangent-reversal');
    return {
      radius,
      vector,
      actualDisplacement,
      candidatePredictedGaps,
      candidatePredictedSlacks,
      state,
      rows,
      energy,
      families,
      rejectionReasons,
    };
  });
  const admissible = evaluatedCandidates.filter(
    candidate => candidate.rejectionReasons.length === 0,
  );
  admissible.sort((left, right) => {
    if (left.energy !== right.energy) return left.energy - right.energy;
    if (left.state.maximumPhysicalResidual !== right.state.maximumPhysicalResidual) {
      return left.state.maximumPhysicalResidual - right.state.maximumPhysicalResidual;
    }
    return hashMusclePackingCanonicalJson(left.vector)
      .localeCompare(hashMusclePackingCanonicalJson(right.vector));
  });
  const accepted = admissible[0] || null;
  const byRadius = new Map(evaluatedCandidates.map(candidate => [candidate.radius, candidate]));
  const candidateReceipts = requestedConfig.trustRegionRadii.map(radius => {
    const candidate = byRadius.get(radius);
    return {
      radius,
      vector:[...candidate.vector],
      allRowSquaredViolationEnergy:candidate.energy,
      maximumPhysicalResidual:candidate.state.maximumPhysicalResidual,
      constraintFamilies:structuredClone(candidate.families),
      endpointDrift:candidate.state.metrics.endpointDrift,
      maximumRelativeVolumeError:candidate.state.metrics.maximumRelativeVolumeError,
      predictionBasis:'candidate-actual-clamped-displacement',
      admissible:candidate.rejectionReasons.length === 0,
      selected:candidate === accepted,
      rejectionReasons:candidate === accepted
        ? []
        : candidate.rejectionReasons.length > 0
          ? [...candidate.rejectionReasons]
          : ['higher-ranked-admissible-candidate'],
      rowLedger:candidate.rows.map((row, index) => ({
        key:row.key,
        kind:row.kind,
        beforeSignedGap:sourceRows[index].signedGap,
        predictedSignedGap:candidate.candidatePredictedGaps[index],
        predictedSlack:candidate.candidatePredictedSlacks[index],
        afterSignedGap:row.signedGap,
      })),
    };
  });
  const selectedState = accepted?.state || startState;
  const selectedVector = accepted?.vector || startVector;
  const core = {
    schema:NBODY_PACKING_ELASTIC_ALL_ROW_RESULT_SCHEMA,
    status:accepted
      ? 'elastic-all-row-trust-region-step-accepted'
      : converged
        ? 'elastic-all-row-nonlinear-admission-floor'
        : 'elastic-all-row-linearized-subproblem-failed',
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start:{
      vector:[...startVector],
      rowCount:sourceRows.length,
      violatedRowCount:sourceRows.filter(row => row.signedGap < 0).length,
      allRowSquaredViolationEnergy:sourceEnergy,
      maximumPhysicalResidual:startState.maximumPhysicalResidual,
      constraintFamilies:structuredClone(beforeFamilies),
      metrics:structuredClone(startState.metrics),
    },
    linearization:{
      rowCount:sourceRows.length,
      finiteDifferenceEvaluationCount:startVector.length * 2,
      predictionBasis:'full-radius-linearized-subproblem-displacement',
      rows:sourceRows.map((row, index) => ({
        key:row.key,
        kind:row.kind,
        beforeSignedGap:row.signedGap,
        gradient:gradients[index].map(value => rounded(value)),
        predictedSignedGap:predictedGaps[index],
        predictedSlack:predictedSlacks[index],
        activeAtSolution:predictedSlacks[index] > 0,
      })),
      subproblem:{
        algorithm:'deterministic-active-set-explicit-slack-normal-equations',
        displacement:displacement.map(value => rounded(value)),
        displacementNorm:rounded(normalizedDisplacement.norm),
        trustRegionMultiplier:rounded(multiplier),
        activeConstraintKeys:finalActiveSet.map(index => sourceRows[index].key),
        internalIterations,
        trustRegionIterations,
        normalEquationResidual:rounded(normalEquationResidual),
        converged,
        failureReason:converged ? null : 'active-set-or-trust-region-iteration-budget-exhausted',
      },
      direction:direction?.map(value => rounded(value)) || null,
    },
    selected:{
      vector:[...selectedVector],
      radius:accepted?.radius || 0,
      allRowSquaredViolationEnergy:accepted?.energy ?? sourceEnergy,
      maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
      constraintFamilies:constraintFamilyMetrics(selectedState),
      metrics:structuredClone(selectedState.metrics),
      muscles:structuredClone(selectedState.muscles),
    },
    work:{
      evaluationCount,
      candidateReceipts,
      terminalReason:accepted
        ? null
        : converged
          ? 'no-candidate-satisfies-frozen-nonlinear-admission-envelope'
          : 'linearized-subproblem-did-not-converge',
    },
    mechanism:{
      directionBasis:'all-compiled-row-explicit-slack-linearized-least-squares',
      nonlinearAcceptance:'lower-all-row-energy-with-bounded-family-tradeoff-envelope',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:true,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'one-step-source-bound-elastic-all-row-architecture-comparator-not-production-solver-or-global-convergence',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyActiveRowTrustRegionTrajectoryConfig({
  iterationBudget = 8,
  convergenceTolerance = 1e-7,
  step = createNBodyActiveRowTrustRegionConfig({
    activeSetPolicy:'family-maximum-relative-band',
    relativeActivationBand:0.01,
  }),
} = {}) {
  return {
    algorithm:ACTIVE_ROW_TRUST_REGION_TRAJECTORY_ALGORITHM,
    convergenceTolerance,
    iterationBudget,
    step:structuredClone(step),
  };
}

export function solveNBodyActiveRowTrustRegionTrajectory({
  problem,
  startVector,
  requestedConfig = createNBodyActiveRowTrustRegionTrajectoryConfig(),
} = {}) {
  const expectedKeys = ['algorithm', 'convergenceTolerance', 'iterationBudget', 'step'];
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `active-row trajectory requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== ACTIVE_ROW_TRUST_REGION_TRAJECTORY_ALGORITHM) {
    throw new Error('active-row trajectory algorithm identity is unsupported');
  }
  if (!Number.isInteger(requestedConfig.iterationBudget) || requestedConfig.iterationBudget <= 0) {
    throw new Error('active-row trajectory iterationBudget must be a positive integer');
  }
  if (
    !Number.isFinite(requestedConfig.convergenceTolerance) ||
    requestedConfig.convergenceTolerance <= 0
  ) {
    throw new Error('active-row trajectory convergenceTolerance must be positive and finite');
  }
  if (requestedConfig.step?.activeSetPolicy !== 'family-maximum-relative-band') {
    throw new Error('active-row trajectory requires family-maximum-relative-band step policy');
  }

  let currentVector = [...startVector];
  let firstStep = null;
  let finalStep = null;
  let terminalReason = null;
  let evaluationCount = 0;
  const rows = [];
  for (let iteration = 1; iteration <= requestedConfig.iterationBudget; iteration += 1) {
    const stepResult = solveNBodyActiveRowTrustRegionStep({
      problem,
      startVector:currentVector,
      requestedConfig:requestedConfig.step,
    });
    firstStep ||= stepResult;
    finalStep = stepResult;
    evaluationCount += stepResult.work.evaluationCount;
    const accepted = stepResult.status === 'active-row-trust-region-step-accepted';
    const before = {
      vector:[...stepResult.start.vector],
      maximumActiveRowViolation:stepResult.start.maximumActiveRowViolation,
      maximumPhysicalResidual:stepResult.start.maximumPhysicalResidual,
      metrics:structuredClone(stepResult.start.metrics),
    };
    const after = accepted ? {
      vector:[...stepResult.selected.vector],
      maximumActiveRowViolation:stepResult.selected.maximumActiveRowViolation,
      maximumPhysicalResidual:stepResult.selected.maximumPhysicalResidual,
      metrics:structuredClone(stepResult.selected.metrics),
    } : structuredClone(before);
    rows.push({
      iteration,
      accepted,
      before,
      after,
      directionConstruction:structuredClone(stepResult.directionConstruction),
      candidateReceipts:structuredClone(stepResult.work.candidateReceipts),
      certificate:structuredClone(stepResult.certificate),
      stepResultSha256:stepResult.identity.sha256,
    });
    if (!accepted) {
      terminalReason = stepResult.status;
      break;
    }
    currentVector = [...stepResult.selected.vector];
    if (stepResult.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance) {
      terminalReason = 'convergence-tolerance-satisfied';
      break;
    }
  }
  if (!firstStep || !finalStep) {
    throw new Error('active-row trajectory produced no step receipt');
  }
  const iterations = rows.filter(row => row.accepted).length;
  const selected = iterations > 0
    ? structuredClone(rows.filter(row => row.accepted).at(-1).after)
    : {
      vector:[...firstStep.start.vector],
      maximumActiveRowViolation:firstStep.start.maximumActiveRowViolation,
      maximumPhysicalResidual:firstStep.start.maximumPhysicalResidual,
      metrics:structuredClone(firstStep.start.metrics),
    };
  const selectedState = evaluateNBodyUnifiedKktState({ problem, vector:selected.vector });
  evaluationCount += 1;
  const status = terminalReason === 'convergence-tolerance-satisfied'
    ? 'active-row-trust-region-trajectory-feasible'
    : terminalReason
      ? 'active-row-trust-region-trajectory-local-floor'
      : 'active-row-trust-region-trajectory-budget-exhausted';
  const core = {
    schema:NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_TRAJECTORY_RESULT_SCHEMA,
    status,
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start:{
      vector:[...firstStep.start.vector],
      maximumActiveRowViolation:firstStep.start.maximumActiveRowViolation,
      maximumPhysicalResidual:firstStep.start.maximumPhysicalResidual,
      metrics:structuredClone(firstStep.start.metrics),
    },
    selected:{
      ...selected,
      muscles:structuredClone(selectedState.muscles),
    },
    work:{
      iterations,
      attempts:rows.length,
      evaluationCount,
      terminalReason,
      rows,
    },
    mechanism:{
      activeSetPolicy:'family-maximum-relative-band',
      directionBasis:'recomputed-minimum-norm-convex-combination-of-normalized-active-row-violation-gradients',
      nonlinearAcceptance:'lower-active-row-maximum-and-no-family-regression',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:true,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-repeated-family-maximum-active-row-progress-or-local-floor-not-global-feasibility-or-carrier-impossibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyFamilyGradientCommonDescentConfig() {
  return {
    algorithm:COMMON_DESCENT_ALGORITHM,
    candidateEnumeration:'canonical',
    directionalDerivativeTolerance:1e-10,
    familyRegressionTolerance:1e-12,
    finiteDifferenceStep:1e-5,
    translationBounds:[-0.3, 0.3],
    trustRegionRadii:[0.004, 0.002, 0.001, 0.0005, 0.00025, 0.000125, 0.0000625],
  };
}

export function solveNBodyFamilyGradientCommonDescent({
  problem,
  startVector,
  requestedConfig = createNBodyFamilyGradientCommonDescentConfig(),
} = {}) {
  const expectedKeys = [
    'algorithm',
    'candidateEnumeration',
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'translationBounds',
    'trustRegionRadii',
  ];
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`common descent requestedConfig requires exact keys: ${expectedKeys.join(', ')}`);
  }
  if (requestedConfig.algorithm !== COMMON_DESCENT_ALGORITHM) {
    throw new Error('common descent algorithm identity is unsupported');
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('common descent candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
  ]) {
    if (!Number.isFinite(requestedConfig[key]) || requestedConfig[key] <= 0) {
      throw new Error(`common descent ${key} must be positive and finite`);
    }
  }
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) throw new Error('common descent translationBounds must be an ordered finite pair');
  if (
    !Array.isArray(requestedConfig.trustRegionRadii) ||
    requestedConfig.trustRegionRadii.length === 0 ||
    requestedConfig.trustRegionRadii.some(value => !Number.isFinite(value) || value <= 0) ||
    requestedConfig.trustRegionRadii.some(
      (value, index) => index > 0 && value >= requestedConfig.trustRegionRadii[index - 1],
    )
  ) throw new Error('common descent trustRegionRadii must be strictly decreasing');
  validateStart(problem, startVector, requestedConfig.translationBounds);

  const startState = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  const beforeFamilies = Object.fromEntries(
    CONSTRAINT_FAMILY_METRIC_KEYS.map(key => [key, startState.metrics[key]]),
  );
  let evaluationCount = 1;
  const gradients = CONSTRAINT_FAMILY_METRIC_KEYS.map(key => {
    const values = [];
    for (let axis = 0; axis < startVector.length; axis += 1) {
      const positive = clampVector(startVector.map(
        (value, index) => index === axis
          ? value + requestedConfig.finiteDifferenceStep
          : value,
      ), requestedConfig.translationBounds);
      const negative = clampVector(startVector.map(
        (value, index) => index === axis
          ? value - requestedConfig.finiteDifferenceStep
          : value,
      ), requestedConfig.translationBounds);
      const span = positive[axis] - negative[axis];
      if (!(span > 0)) throw new Error(`common descent finite-difference span collapsed at ${axis}`);
      const positiveState = evaluateNBodyUnifiedKktState({ problem, vector:positive });
      const negativeState = evaluateNBodyUnifiedKktState({ problem, vector:negative });
      evaluationCount += 2;
      values.push((positiveState.metrics[key] - negativeState.metrics[key]) / span);
    }
    const unit = normalized(values);
    return {
      key,
      vector:values.map(value => rounded(value)),
      norm:rounded(unit.norm),
      normalizedVector:unit.vector?.map(value => rounded(value)) || null,
    };
  });
  const degenerateFamilies = gradients.filter(row => !row.normalizedVector).map(row => row.key);
  const combination = degenerateFamilies.length === 0
    ? minimumNormConvexCombination(gradients.map(row => row.normalizedVector))
    : null;
  const combined = combination ? normalized(combination.vector) : { norm:0, vector:null };
  const direction = combined.vector?.map(value => -value) || null;
  const predictedDirectionalDerivatives = direction
    ? Object.fromEntries(gradients.map(row => [row.key, rounded(dot(row.normalizedVector, direction))]))
    : Object.fromEntries(CONSTRAINT_FAMILY_METRIC_KEYS.map(key => [key, null]));
  const predictedCommonDescent = direction !== null &&
    Object.values(predictedDirectionalDerivatives).every(
      value => value < -requestedConfig.directionalDerivativeTolerance,
    );

  const enumeratedRadii = requestedConfig.candidateEnumeration === 'canonical'
    ? [...requestedConfig.trustRegionRadii]
    : [...requestedConfig.trustRegionRadii].reverse();
  const candidates = direction ? enumeratedRadii.map(radius => {
    const vector = clampVector(
      startVector.map((value, axis) => value + radius * direction[axis]),
      requestedConfig.translationBounds,
    );
    const state = evaluateNBodyUnifiedKktState({ problem, vector });
    evaluationCount += 1;
    const families = Object.fromEntries(
      CONSTRAINT_FAMILY_METRIC_KEYS.map(key => [key, state.metrics[key]]),
    );
    const regressedFamilies = CONSTRAINT_FAMILY_METRIC_KEYS.filter(
      key => families[key] > beforeFamilies[key] + requestedConfig.familyRegressionTolerance,
    );
    return {
      radius,
      vector,
      state,
      maximumPhysicalResidual:state.maximumPhysicalResidual,
      constraintFamilies:families,
      regressedFamilies,
    };
  }) : [];
  candidates.sort((left, right) => {
    if (left.maximumPhysicalResidual !== right.maximumPhysicalResidual) {
      return left.maximumPhysicalResidual - right.maximumPhysicalResidual;
    }
    return hashMusclePackingCanonicalJson(left.vector)
      .localeCompare(hashMusclePackingCanonicalJson(right.vector));
  });
  const accepted = predictedCommonDescent ? candidates.find(candidate =>
    candidate.maximumPhysicalResidual < startState.maximumPhysicalResidual - 1e-12 &&
    candidate.regressedFamilies.length === 0
  ) : null;
  const candidateReceipts = [...candidates]
    .sort((left, right) => right.radius - left.radius)
    .map(candidate => ({
      radius:candidate.radius,
      vector:[...candidate.vector],
      maximumPhysicalResidual:candidate.maximumPhysicalResidual,
      constraintFamilies:structuredClone(candidate.constraintFamilies),
      regressedFamilies:[...candidate.regressedFamilies],
      selected:candidate === accepted,
      rejectionReason:candidate === accepted
        ? null
        : !predictedCommonDescent
          ? 'no-predicted-common-descent-direction'
          : candidate.regressedFamilies.length > 0
            ? 'constraint-family-regression'
            : !(candidate.maximumPhysicalResidual < startState.maximumPhysicalResidual - 1e-12)
              ? 'non-improving-physical-residual'
              : 'higher-ranked-admissible-candidate',
    }));
  const selectedState = accepted?.state || startState;
  const selectedVector = accepted?.vector || startVector;
  const core = {
    schema:NBODY_PACKING_COMMON_DESCENT_RESULT_SCHEMA,
    status:accepted
      ? 'common-descent-step-accepted'
      : predictedCommonDescent
        ? 'nonlinear-common-descent-radius-floor'
        : 'local-family-gradient-cone-certificate',
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start:{
      vector:[...startVector],
      maximumPhysicalResidual:startState.maximumPhysicalResidual,
      metrics:structuredClone(startState.metrics),
    },
    directionConstruction:{
      familyKeys:[...CONSTRAINT_FAMILY_METRIC_KEYS],
      gradients,
      degenerateFamilies,
      convexWeights:combination?.weights.map(value => rounded(value)) || null,
      minimumNorm:rounded(combined.norm),
      direction:direction?.map(value => rounded(value)) || null,
      predictedDirectionalDerivatives,
      predictedCommonDescent,
    },
    selected:{
      vector:[...selectedVector],
      maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
      metrics:structuredClone(selectedState.metrics),
      muscles:structuredClone(selectedState.muscles),
    },
    work:{
      iterations:accepted ? 1 : 0,
      attempts:direction ? 1 : 0,
      evaluationCount,
      terminalReason:accepted
        ? null
        : predictedCommonDescent
          ? 'no-family-admissible-trust-region-candidate'
          : 'no-predicted-common-descent-direction',
      candidateReceipts,
    },
    mechanism:{
      directionBasis:'minimum-norm-convex-combination-of-normalized-family-gradients',
      nonlinearAcceptance:'no-family-regression-and-lower-maximum-physical-residual',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-local-family-gradient-direction-not-global-feasibility-or-carrier-impossibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyFamilyGradientAdaptiveStepConfig({
  initialRadius = 0.004,
  maximumRadius = 0.004,
  minimumRadius = 1e-10,
  maximumTrials = 24,
  refinementIterations = 6,
} = {}) {
  const oneStep = createNBodyFamilyGradientCommonDescentConfig();
  return {
    algorithm:ADAPTIVE_COMMON_DESCENT_STEP_ALGORITHM,
    candidateEnumeration:oneStep.candidateEnumeration,
    contractionFactor:0.5,
    directionalDerivativeTolerance:oneStep.directionalDerivativeTolerance,
    expansionFactor:2,
    familyRegressionTolerance:oneStep.familyRegressionTolerance,
    finiteDifferenceStep:oneStep.finiteDifferenceStep,
    improvementTolerance:1e-12,
    initialRadius,
    maximumRadius,
    maximumTrials,
    minimumRadius,
    refinementIterations,
    sufficientDecreaseFraction:0.01,
    translationBounds:[...oneStep.translationBounds],
  };
}

function rankAdaptiveTrial(left, right) {
  if (left.maximumPhysicalResidual !== right.maximumPhysicalResidual) {
    return left.maximumPhysicalResidual - right.maximumPhysicalResidual;
  }
  return hashMusclePackingCanonicalJson(left.vector)
    .localeCompare(hashMusclePackingCanonicalJson(right.vector));
}

function adaptiveAdmissibleBracket(trials) {
  const admissible = trials.filter(row => row.admissible).sort((a, b) => a.radius - b.radius);
  if (admissible.length < 3) return null;
  const best = [...admissible].sort(rankAdaptiveTrial)[0];
  const index = admissible.indexOf(best);
  if (index === 0 || index === admissible.length - 1) return null;
  return { lower:admissible[index - 1], best, upper:admissible[index + 1] };
}

function parabolicBracketMinimum({ lower, best, upper }) {
  const numerator =
    ((best.radius - lower.radius) ** 2) *
      (best.maximumPhysicalResidual - upper.maximumPhysicalResidual) -
    ((best.radius - upper.radius) ** 2) *
      (best.maximumPhysicalResidual - lower.maximumPhysicalResidual);
  const denominator =
    (best.radius - lower.radius) *
      (best.maximumPhysicalResidual - upper.maximumPhysicalResidual) -
    (best.radius - upper.radius) *
      (best.maximumPhysicalResidual - lower.maximumPhysicalResidual);
  const interpolated = denominator === 0
    ? Number.NaN
    : best.radius - (0.5 * numerator / denominator);
  const smallestGap = Math.min(
    best.radius - lower.radius,
    upper.radius - best.radius,
  );
  if (
    Number.isFinite(interpolated) &&
    interpolated > lower.radius + smallestGap * 1e-6 &&
    interpolated < upper.radius - smallestGap * 1e-6
  ) return interpolated;
  return upper.radius - best.radius > best.radius - lower.radius
    ? (best.radius + upper.radius) / 2
    : (lower.radius + best.radius) / 2;
}

export function adjudicateNBodyAdaptiveStepBoundary({ bracket, trialReceipts } = {}) {
  const reject = (classification, reason) => ({ admitted:false, classification, reason });
  if (!bracket || !Array.isArray(trialReceipts)) {
    return reject('malformed-boundary-receipt', 'bracket and trialReceipts are required');
  }
  if (bracket.boundary === 'unclosed-upper-boundary') {
    return reject(
      'unclosed-upper-boundary',
      'accepted step has no evaluated larger boundary trial',
    );
  }
  if (bracket.boundary === 'unclosed-lower-boundary') {
    return reject(
      'unclosed-lower-boundary',
      'accepted step has no evaluated smaller boundary trial',
    );
  }
  const sameRadius = (left, right) => Number.isFinite(left) && Number.isFinite(right) &&
    Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
  const atRadius = radius => trialReceipts.find(row => sameRadius(row.radius, radius)) || null;
  const selectedRows = trialReceipts.filter(row => row.selected);
  if (selectedRows.length !== 1) {
    return reject('malformed-boundary-receipt', 'exactly one selected trial is required');
  }
  const selected = selectedRows[0];
  if (!selected.admissible || !sameRadius(selected.radius, bracket.selectedRadius)) {
    return reject(
      'malformed-boundary-receipt',
      'selected trial must be admissible and match selectedRadius',
    );
  }
  const selectedVectorSha256 = hashMusclePackingCanonicalJson(selected.vector);
  const betterAdmissible = trialReceipts.find(row => row.admissible && (
    row.maximumPhysicalResidual < selected.maximumPhysicalResidual ||
    (
      row !== selected &&
      row.maximumPhysicalResidual === selected.maximumPhysicalResidual &&
      hashMusclePackingCanonicalJson(row.vector).localeCompare(selectedVectorSha256) < 0
    )
  ));
  if (betterAdmissible) {
    return reject('misranked-boundary-receipt', 'an admissible trial outranks the selected trial');
  }
  const lower = atRadius(bracket.lowerTrialRadius);
  const upper = atRadius(bracket.upperTrialRadius);
  if (bracket.boundary === 'global-maximum-radius') {
    if (!sameRadius(selected.radius, bracket.maximumRadius) || upper !== null) {
      return reject(
        'malformed-global-maximum-boundary',
        'global maximum selection must equal maximumRadius and have no upper trial',
      );
    }
    if (!lower || !lower.admissible || !(lower.radius < selected.radius)) {
      return reject(
        'malformed-global-maximum-boundary',
        'global maximum selection requires an admissible smaller trial',
      );
    }
    return { admitted:true, classification:'global-maximum-radius', reason:null };
  }
  if (bracket.boundary === 'minimum-radius') {
    if (!sameRadius(selected.radius, bracket.minimumRadius) || lower !== null) {
      return reject(
        'malformed-minimum-radius-boundary',
        'minimum-radius selection must equal minimumRadius and have no lower trial',
      );
    }
    if (!upper || !(selected.radius < upper.radius)) {
      return reject(
        'malformed-minimum-radius-boundary',
        'minimum-radius selection requires an evaluated larger trial',
      );
    }
    return { admitted:true, classification:'minimum-radius', reason:null };
  }
  if (!lower || !upper || !(lower.radius < selected.radius && selected.radius < upper.radius)) {
    return reject(
      'malformed-boundary-receipt',
      'selected trial requires evaluated smaller and larger neighbors',
    );
  }
  if (!lower.admissible || lower.maximumPhysicalResidual < selected.maximumPhysicalResidual) {
    return reject(
      'malformed-lower-boundary',
      'smaller boundary trial must be admissible and no better than selected',
    );
  }
  if (bracket.boundary === 'interior-bracket') {
    if (!upper.admissible || upper.maximumPhysicalResidual < selected.maximumPhysicalResidual) {
      return reject(
        'malformed-interior-bracket',
        'interior upper trial must be admissible and no better than selected',
      );
    }
    return { admitted:true, classification:'interior-bracket', reason:null };
  }
  if (bracket.boundary !== 'admissibility-boundary') {
    return reject('unsupported-boundary-classification', `unsupported boundary ${bracket.boundary}`);
  }
  if (upper.admissible) {
    return reject(
      'malformed-admissibility-boundary',
      'larger constrained-boundary trial must be explicitly inadmissible',
    );
  }
  if (!['constraint-family-regression', 'insufficient-decrease'].includes(
    upper.rejectionReason,
  )) {
    return reject(
      'malformed-admissibility-boundary',
      'larger constrained-boundary trial requires an acceptance-policy rejection',
    );
  }
  if (
    upper.rejectionReason === 'constraint-family-regression' &&
    (!Array.isArray(upper.regressedFamilies) || upper.regressedFamilies.length === 0)
  ) {
    return reject(
      'malformed-admissibility-boundary',
      'constraint-family-regression requires at least one named regressed family',
    );
  }
  if (
    upper.rejectionReason === 'insufficient-decrease' &&
    Array.isArray(upper.regressedFamilies) && upper.regressedFamilies.length > 0
  ) return reject(
    'malformed-admissibility-boundary',
    'insufficient-decrease boundary cannot conceal family regression',
  );
  return {
    admitted:true,
    classification:'constrained-admissibility-boundary',
    reason:null,
  };
}

export function solveNBodyFamilyGradientAdaptiveStep({
  problem,
  startVector,
  requestedConfig = createNBodyFamilyGradientAdaptiveStepConfig(),
} = {}) {
  const expectedKeys = [
    'algorithm',
    'candidateEnumeration',
    'contractionFactor',
    'directionalDerivativeTolerance',
    'expansionFactor',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'initialRadius',
    'maximumRadius',
    'maximumTrials',
    'minimumRadius',
    'refinementIterations',
    'sufficientDecreaseFraction',
    'translationBounds',
  ];
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `adaptive common descent requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== ADAPTIVE_COMMON_DESCENT_STEP_ALGORITHM) {
    throw new Error('adaptive common descent algorithm identity is unsupported');
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('adaptive common descent candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'initialRadius',
    'maximumRadius',
    'minimumRadius',
    'sufficientDecreaseFraction',
  ]) {
    if (!Number.isFinite(requestedConfig[key]) || requestedConfig[key] <= 0) {
      throw new Error(`adaptive common descent ${key} must be positive and finite`);
    }
  }
  if (
    !(requestedConfig.contractionFactor > 0 && requestedConfig.contractionFactor < 1)
  ) throw new Error('adaptive common descent contractionFactor must be between zero and one');
  if (!(requestedConfig.expansionFactor > 1)) {
    throw new Error('adaptive common descent expansionFactor must exceed one');
  }
  if (
    requestedConfig.minimumRadius > requestedConfig.initialRadius ||
    requestedConfig.initialRadius > requestedConfig.maximumRadius
  ) {
    throw new Error(
      'adaptive common descent radii must satisfy minimumRadius <= initialRadius <= maximumRadius',
    );
  }
  if (!Number.isInteger(requestedConfig.maximumTrials) || requestedConfig.maximumTrials <= 0) {
    throw new Error('adaptive common descent maximumTrials must be a positive integer');
  }
  if (
    !Number.isInteger(requestedConfig.refinementIterations) ||
    requestedConfig.refinementIterations < 0 ||
    requestedConfig.refinementIterations >= requestedConfig.maximumTrials
  ) throw new Error(
    'adaptive common descent refinementIterations must be a nonnegative integer below maximumTrials',
  );
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) throw new Error('adaptive common descent translationBounds must be an ordered finite pair');

  const baseConfig = createNBodyFamilyGradientCommonDescentConfig();
  baseConfig.candidateEnumeration = requestedConfig.candidateEnumeration;
  baseConfig.directionalDerivativeTolerance = requestedConfig.directionalDerivativeTolerance;
  baseConfig.familyRegressionTolerance = requestedConfig.familyRegressionTolerance;
  baseConfig.finiteDifferenceStep = requestedConfig.finiteDifferenceStep;
  baseConfig.translationBounds = [...requestedConfig.translationBounds];
  baseConfig.trustRegionRadii = [requestedConfig.initialRadius];
  const base = solveNBodyFamilyGradientCommonDescent({
    problem,
    startVector,
    requestedConfig:baseConfig,
  });
  const predictedRates = Object.values(
    base.directionConstruction.predictedDirectionalDerivatives,
  ).filter(Number.isFinite).map(value => -value);
  const minimumPredictedDecreaseRate = predictedRates.length > 0
    ? Math.min(...predictedRates)
    : 0;
  const evaluateRadius = (radius, stage) => {
    const vector = clampVector(
      startVector.map((value, axis) =>
        value + radius * base.directionConstruction.direction[axis]),
      requestedConfig.translationBounds,
    );
    const state = evaluateNBodyUnifiedKktState({ problem, vector });
    const families = Object.fromEntries(
      CONSTRAINT_FAMILY_METRIC_KEYS.map(key => [key, state.metrics[key]]),
    );
    const regressedFamilies = CONSTRAINT_FAMILY_METRIC_KEYS.filter(
      key => families[key] >
        base.start.metrics[key] + requestedConfig.familyRegressionTolerance,
    );
    const actualDecrease = rounded(
      base.start.maximumPhysicalResidual - state.maximumPhysicalResidual,
    );
    const requiredDecrease = rounded(Math.max(
      requestedConfig.improvementTolerance,
      requestedConfig.sufficientDecreaseFraction * radius *
        minimumPredictedDecreaseRate,
    ));
    const admissible = base.directionConstruction.predictedCommonDescent &&
      regressedFamilies.length === 0 &&
      actualDecrease >= requiredDecrease;
    return {
      stage,
      radius,
      vector,
      maximumPhysicalResidual:state.maximumPhysicalResidual,
      constraintFamilies:families,
      regressedFamilies,
      actualDecrease,
      requiredDecrease,
      admissible,
    };
  };
  const trials = [];
  let radius = requestedConfig.initialRadius;
  let exhaustedMinimumRadius = false;
  let exhaustedMaximumRadius = false;
  const sameRadius = (left, right) => Math.abs(left - right) <=
    Number.EPSILON * Math.max(1, left, right);
  const nextUntriedRadius = candidate => trials.some(row => sameRadius(row.radius, candidate))
    ? null
    : candidate;
  while (trials.length < requestedConfig.maximumTrials - requestedConfig.refinementIterations) {
    const stage = trials.length === 0
      ? 'continuation-seed'
      : radius < Math.min(...trials.map(row => row.radius))
        ? 'geometric-contraction'
        : 'geometric-expansion';
    trials.push(evaluateRadius(radius, stage));
    if (adaptiveAdmissibleBracket(trials)) break;
    const admissible = trials.filter(row => row.admissible).sort(rankAdaptiveTrial);
    const best = admissible[0] || null;
    const hasSmallerTrial = best
      ? trials.some(row => row.radius < best.radius && !sameRadius(row.radius, best.radius))
      : false;
    const hasLargerTrial = best
      ? trials.some(row => row.radius > best.radius && !sameRadius(row.radius, best.radius))
      : false;
    let nextRadius = null;

    if (trials.length === 1 || !best || !hasSmallerTrial) {
      const smallestTriedRadius = Math.min(...trials.map(row => row.radius));
      const contracted = Math.max(
        requestedConfig.minimumRadius,
        smallestTriedRadius * requestedConfig.contractionFactor,
      );
      nextRadius = nextUntriedRadius(contracted);
      exhaustedMinimumRadius = sameRadius(contracted, requestedConfig.minimumRadius);
    } else if (!hasLargerTrial) {
      const largestTriedRadius = Math.max(...trials.map(row => row.radius));
      const expanded = Math.min(
        requestedConfig.maximumRadius,
        largestTriedRadius * requestedConfig.expansionFactor,
      );
      nextRadius = nextUntriedRadius(expanded);
      exhaustedMaximumRadius = sameRadius(expanded, requestedConfig.maximumRadius);
    }

    if (nextRadius === null) break;
    radius = nextRadius;
  }
  let refinementCount = 0;
  while (
    refinementCount < requestedConfig.refinementIterations &&
    trials.length < requestedConfig.maximumTrials
  ) {
    const bracket = adaptiveAdmissibleBracket(trials);
    if (!bracket) break;
    const refinedRadius = parabolicBracketMinimum(bracket);
    if (
      trials.some(row => sameRadius(row.radius, refinedRadius))
    ) break;
    trials.push(evaluateRadius(refinedRadius, 'bracket-refinement'));
    refinementCount += 1;
  }
  const rankedAdmissible = trials.filter(row => row.admissible).sort(rankAdaptiveTrial);
  const accepted = rankedAdmissible[0] || null;
  const selectedState = accepted
    ? evaluateNBodyUnifiedKktState({ problem, vector:accepted.vector })
    : evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  const trialReceipts = [...trials]
    .sort((left, right) => requestedConfig.candidateEnumeration === 'canonical'
      ? right.radius - left.radius
      : left.radius - right.radius)
    .map(row => ({
      ...row,
      selected:row === accepted,
      rejectionReason:row === accepted
        ? null
        : !base.directionConstruction.predictedCommonDescent
          ? 'no-predicted-common-descent-direction'
          : row.regressedFamilies.length > 0
            ? 'constraint-family-regression'
            : row.actualDecrease < row.requiredDecrease
              ? 'insufficient-decrease'
              : 'higher-ranked-admissible-candidate',
    }));
  const finalBracket = adaptiveAdmissibleBracket(trials);
  const largerTrials = accepted
    ? trials.filter(row => row.radius > accepted.radius).sort((a, b) => a.radius - b.radius)
    : [];
  const smallerTrials = accepted
    ? trials.filter(row => row.radius < accepted.radius).sort((a, b) => b.radius - a.radius)
    : [];
  const boundary = !accepted
    ? null
    : finalBracket
      ? 'interior-bracket'
      : sameRadius(accepted.radius, requestedConfig.maximumRadius)
        ? 'global-maximum-radius'
        : sameRadius(accepted.radius, requestedConfig.minimumRadius)
          ? 'minimum-radius'
          : largerTrials.length === 0
            ? 'unclosed-upper-boundary'
            : smallerTrials.length === 0
              ? 'unclosed-lower-boundary'
              : 'admissibility-boundary';
  const core = {
    schema:NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_STEP_RESULT_SCHEMA,
    status:accepted
      ? 'adaptive-common-descent-step-accepted'
      : base.directionConstruction.predictedCommonDescent
        ? 'adaptive-common-descent-radius-floor'
        : 'local-family-gradient-cone-certificate',
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start:structuredClone(base.start),
    directionConstruction:structuredClone(base.directionConstruction),
    selected:{
      vector:[...(accepted?.vector || startVector)],
      maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
      metrics:structuredClone(selectedState.metrics),
      muscles:structuredClone(selectedState.muscles),
    },
    work:{
      attempts:trialReceipts.length,
      evaluationCount:base.work.evaluationCount + trials.length + 1,
      terminalReason:accepted
        ? null
        : base.directionConstruction.predictedCommonDescent
          ? 'no-family-admissible-sufficient-decrease-radius'
          : 'no-predicted-common-descent-direction',
      bracket:{
        initialRadius:requestedConfig.initialRadius,
        maximumRadius:requestedConfig.maximumRadius,
        minimumRadius:requestedConfig.minimumRadius,
        lowerTrialRadius:finalBracket?.lower.radius || smallerTrials[0]?.radius || null,
        selectedRadius:accepted?.radius || null,
        upperTrialRadius:finalBracket?.upper.radius || largerTrials[0]?.radius || null,
        refinementIterations:refinementCount,
        boundary,
        exhaustedMinimumRadius,
        exhaustedMaximumRadius,
      },
      trialReceipts,
    },
    mechanism:{
      directionBasis:'minimum-norm-convex-combination-of-normalized-family-gradients',
      stepControl:
        'bidirectional-geometric-bracket-search-plus-parabolic-refinement-with-family-filter-and-sufficient-decrease',
      nonlinearAcceptance:'no-family-regression-and-sufficient-maximum-residual-decrease',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-adaptive-common-descent-step-not-global-feasibility-or-line-search-optimality',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyFamilyGradientAdaptiveTrajectoryConfig({
  iterationBudget = 8,
} = {}) {
  const step = createNBodyFamilyGradientAdaptiveStepConfig();
  return {
    algorithm:ADAPTIVE_COMMON_DESCENT_TRAJECTORY_ALGORITHM,
    candidateEnumeration:step.candidateEnumeration,
    contractionFactor:step.contractionFactor,
    convergenceTolerance:1e-7,
    directionalDerivativeTolerance:step.directionalDerivativeTolerance,
    expansionFactor:step.expansionFactor,
    familyRegressionTolerance:step.familyRegressionTolerance,
    finiteDifferenceStep:step.finiteDifferenceStep,
    improvementTolerance:step.improvementTolerance,
    initialRadius:step.initialRadius,
    maximumRadius:step.maximumRadius,
    iterationBudget,
    maximumTrials:step.maximumTrials,
    minimumRadius:step.minimumRadius,
    radiusContinuationExpansion:2,
    refinementIterations:step.refinementIterations,
    sufficientDecreaseFraction:step.sufficientDecreaseFraction,
    translationBounds:[...step.translationBounds],
  };
}

export function solveNBodyFamilyGradientAdaptiveTrajectory({
  problem,
  startVector,
  requestedConfig = createNBodyFamilyGradientAdaptiveTrajectoryConfig(),
} = {}) {
  const expectedKeys = [
    'algorithm',
    'candidateEnumeration',
    'contractionFactor',
    'convergenceTolerance',
    'directionalDerivativeTolerance',
    'expansionFactor',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'improvementTolerance',
    'initialRadius',
    'iterationBudget',
    'maximumRadius',
    'maximumTrials',
    'minimumRadius',
    'radiusContinuationExpansion',
    'refinementIterations',
    'sufficientDecreaseFraction',
    'translationBounds',
  ];
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `adaptive common descent trajectory requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== ADAPTIVE_COMMON_DESCENT_TRAJECTORY_ALGORITHM) {
    throw new Error('adaptive common descent trajectory algorithm identity is unsupported');
  }
  if (!Number.isInteger(requestedConfig.iterationBudget) || requestedConfig.iterationBudget <= 0) {
    throw new Error('adaptive common descent trajectory iterationBudget must be a positive integer');
  }
  if (
    !Number.isFinite(requestedConfig.convergenceTolerance) ||
    requestedConfig.convergenceTolerance <= 0
  ) throw new Error(
    'adaptive common descent trajectory convergenceTolerance must be positive and finite',
  );
  if (
    !Number.isFinite(requestedConfig.radiusContinuationExpansion) ||
    requestedConfig.radiusContinuationExpansion < 1
  ) throw new Error(
    'adaptive common descent trajectory radiusContinuationExpansion must be finite and at least one',
  );
  if (
    !Number.isFinite(requestedConfig.maximumRadius) ||
    requestedConfig.maximumRadius < requestedConfig.initialRadius
  ) throw new Error(
    'adaptive common descent trajectory maximumRadius must be finite and at least initialRadius',
  );
  validateStart(problem, startVector, requestedConfig.translationBounds);

  let currentVector = [...startVector];
  let requestedInitialRadius = requestedConfig.initialRadius;
  let start = null;
  let selected = null;
  let acceptedIterations = 0;
  let evaluationCount = 0;
  let terminalReason = null;
  const rows = [];
  for (let iteration = 1; iteration <= requestedConfig.iterationBudget; iteration += 1) {
    const stepConfig = {
      algorithm:ADAPTIVE_COMMON_DESCENT_STEP_ALGORITHM,
      candidateEnumeration:requestedConfig.candidateEnumeration,
      contractionFactor:requestedConfig.contractionFactor,
      directionalDerivativeTolerance:requestedConfig.directionalDerivativeTolerance,
      expansionFactor:requestedConfig.expansionFactor,
      familyRegressionTolerance:requestedConfig.familyRegressionTolerance,
      finiteDifferenceStep:requestedConfig.finiteDifferenceStep,
      improvementTolerance:requestedConfig.improvementTolerance,
      initialRadius:requestedInitialRadius,
      maximumRadius:requestedConfig.maximumRadius,
      maximumTrials:requestedConfig.maximumTrials,
      minimumRadius:requestedConfig.minimumRadius,
      refinementIterations:requestedConfig.refinementIterations,
      sufficientDecreaseFraction:requestedConfig.sufficientDecreaseFraction,
      translationBounds:[...requestedConfig.translationBounds],
    };
    const step = solveNBodyFamilyGradientAdaptiveStep({
      problem,
      startVector:currentVector,
      requestedConfig:stepConfig,
    });
    start ||= structuredClone(step.start);
    selected = structuredClone(step.selected);
    evaluationCount += step.work.evaluationCount;
    const accepted = step.status === 'adaptive-common-descent-step-accepted';
    rows.push({
      iteration,
      accepted,
      requestedInitialRadius,
      before:structuredClone(step.start),
      directionConstruction:structuredClone(step.directionConstruction),
      bracket:structuredClone(step.work.bracket),
      trialReceipts:structuredClone(step.work.trialReceipts),
      after:structuredClone(step.selected),
      terminalReason:accepted ? null : step.work.terminalReason,
      stepResultSha256:step.identity.sha256,
    });
    if (!accepted) {
      terminalReason = step.work.terminalReason;
      break;
    }
    acceptedIterations += 1;
    currentVector = [...step.selected.vector];
    if (step.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance) {
      terminalReason = 'convergence-tolerance-reached';
      break;
    }
    requestedInitialRadius = Math.min(
      requestedConfig.maximumRadius,
      step.work.bracket.selectedRadius * requestedConfig.radiusContinuationExpansion,
    );
  }
  const feasible = selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance;
  const stalled = terminalReason !== null && terminalReason !== 'convergence-tolerance-reached';
  const core = {
    schema:NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA,
    status:feasible
      ? 'adaptive-common-descent-trajectory-feasible'
      : stalled
        ? 'adaptive-common-descent-trajectory-local-floor'
        : 'adaptive-common-descent-trajectory-budget-exhausted',
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    start,
    selected,
    work:{
      iterations:acceptedIterations,
      attempts:rows.length,
      evaluationCount,
      terminalReason,
      rows,
    },
    mechanism:{
      directionBasis:'recomputed-minimum-norm-convex-combination-of-normalized-family-gradients',
      stepControl:
        'continued-seed-bidirectional-geometric-bracketing-plus-parabolic-refinement',
      nonlinearAcceptance:'no-family-regression-and-sufficient-maximum-residual-decrease',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-adaptive-common-descent-trajectory-not-global-feasibility-or-line-search-optimality',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function createNBodyFamilyGradientCommonDescentTrajectoryConfig({
  iterationBudget = 8,
  trustRegionRadii = null,
} = {}) {
  const oneStep = createNBodyFamilyGradientCommonDescentConfig();
  return {
    algorithm:COMMON_DESCENT_TRAJECTORY_ALGORITHM,
    candidateEnumeration:oneStep.candidateEnumeration,
    convergenceTolerance:1e-7,
    directionalDerivativeTolerance:oneStep.directionalDerivativeTolerance,
    familyRegressionTolerance:oneStep.familyRegressionTolerance,
    finiteDifferenceStep:oneStep.finiteDifferenceStep,
    iterationBudget,
    translationBounds:[...oneStep.translationBounds],
    trustRegionRadii:trustRegionRadii
      ? [...trustRegionRadii]
      : [...oneStep.trustRegionRadii],
  };
}

export function solveNBodyFamilyGradientCommonDescentTrajectory({
  problem,
  startVector,
  requestedConfig = createNBodyFamilyGradientCommonDescentTrajectoryConfig(),
} = {}) {
  const expectedKeys = [
    'algorithm',
    'candidateEnumeration',
    'convergenceTolerance',
    'directionalDerivativeTolerance',
    'familyRegressionTolerance',
    'finiteDifferenceStep',
    'iterationBudget',
    'translationBounds',
    'trustRegionRadii',
  ];
  if (JSON.stringify(Object.keys(requestedConfig || {}).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `common descent trajectory requestedConfig requires exact keys: ${expectedKeys.join(', ')}`,
    );
  }
  if (requestedConfig.algorithm !== COMMON_DESCENT_TRAJECTORY_ALGORITHM) {
    throw new Error('common descent trajectory algorithm identity is unsupported');
  }
  if (!Number.isInteger(requestedConfig.iterationBudget) || requestedConfig.iterationBudget <= 0) {
    throw new Error('common descent trajectory iterationBudget must be a positive integer');
  }
  if (
    !Number.isFinite(requestedConfig.convergenceTolerance) ||
    requestedConfig.convergenceTolerance <= 0
  ) {
    throw new Error('common descent trajectory convergenceTolerance must be positive and finite');
  }
  const oneStepConfig = {
    algorithm:COMMON_DESCENT_ALGORITHM,
    candidateEnumeration:requestedConfig.candidateEnumeration,
    directionalDerivativeTolerance:requestedConfig.directionalDerivativeTolerance,
    familyRegressionTolerance:requestedConfig.familyRegressionTolerance,
    finiteDifferenceStep:requestedConfig.finiteDifferenceStep,
    translationBounds:[...requestedConfig.translationBounds],
    trustRegionRadii:[...requestedConfig.trustRegionRadii],
  };
  validateStart(problem, startVector, requestedConfig.translationBounds);

  let currentVector = [...startVector];
  let start = null;
  let selected = null;
  let evaluationCount = 0;
  let acceptedIterations = 0;
  let terminalReason = null;
  const rows = [];

  for (let iteration = 1; iteration <= requestedConfig.iterationBudget; iteration += 1) {
    const step = solveNBodyFamilyGradientCommonDescent({
      problem,
      startVector:currentVector,
      requestedConfig:oneStepConfig,
    });
    start ||= structuredClone(step.start);
    selected = structuredClone(step.selected);
    evaluationCount += step.work.evaluationCount;
    const accepted = step.status === 'common-descent-step-accepted';
    if (accepted) {
      acceptedIterations += 1;
      currentVector = [...step.selected.vector];
    } else {
      terminalReason = step.work.terminalReason;
    }
    rows.push({
      iteration,
      accepted,
      before:structuredClone(step.start),
      directionConstruction:structuredClone(step.directionConstruction),
      candidateReceipts:structuredClone(step.work.candidateReceipts),
      after:structuredClone(step.selected),
      terminalReason:accepted ? null : step.work.terminalReason,
      stepResultSha256:step.identity.sha256,
    });
    if (!accepted || step.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance) {
      if (accepted) terminalReason = 'convergence-tolerance-reached';
      break;
    }
  }

  const feasible = selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance;
  const stalled = terminalReason !== null && terminalReason !== 'convergence-tolerance-reached';
  const core = {
    schema:NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA,
    status:feasible
      ? 'common-descent-trajectory-feasible'
      : stalled
        ? 'common-descent-trajectory-local-floor'
        : 'common-descent-trajectory-budget-exhausted',
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{
      requested:structuredClone(requestedConfig),
      effective:structuredClone(requestedConfig),
    },
    start,
    selected,
    work:{
      iterations:acceptedIterations,
      attempts:rows.length,
      evaluationCount,
      terminalReason,
      rows,
    },
    mechanism:{
      directionBasis:'recomputed-minimum-norm-convex-combination-of-normalized-family-gradients',
      nonlinearAcceptance:'no-family-regression-and-lower-maximum-physical-residual',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-repeated-common-descent-trajectory-not-global-feasibility-or-carrier-impossibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function solveEnumeration(problem, startVector, config) {
  let currentState = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  let current = stateReceipt(currentState, config);
  const start = structuredClone(current);
  const workRows = [];
  let evaluationCount = 1;

  for (let iteration = 1; iteration <= config.iterationBudget; iteration += 1) {
    if (current.maximumPhysicalResidual <= config.convergenceTolerance) break;
    const gradient = Array(current.vector.length).fill(0);
    for (let axis = 0; axis < current.vector.length; axis += 1) {
      const positive = clampVector(current.vector.map(
        (value, index) => index === axis ? value + config.finiteDifferenceStep : value,
      ), config.translationBounds);
      const negative = clampVector(current.vector.map(
        (value, index) => index === axis ? value - config.finiteDifferenceStep : value,
      ), config.translationBounds);
      const finiteDifferenceSpan = positive[axis] - negative[axis];
      if (!(finiteDifferenceSpan > 0)) {
        throw new Error(`restoration finite-difference span collapsed at axis ${axis}`);
      }
      const positiveReceipt = stateReceipt(
        evaluateNBodyUnifiedKktState({ problem, vector:positive }),
        config,
      );
      const negativeReceipt = stateReceipt(
        evaluateNBodyUnifiedKktState({ problem, vector:negative }),
        config,
      );
      evaluationCount += 2;
      gradient[axis] = (positiveReceipt.merit - negativeReceipt.merit) /
        finiteDifferenceSpan;
    }
    const gradientNorm = Math.hypot(...gradient);
    if (!(gradientNorm > 0) || !Number.isFinite(gradientNorm)) {
      workRows.push({
        iteration,
        accepted:false,
        acceptedTrustRegionRadius:null,
        terminalReason:'zero-or-nonfinite-merit-gradient',
        gradientNorm:Number.isFinite(gradientNorm) ? rounded(gradientNorm) : null,
        directionNonzeroCoordinateCount:0,
        allConstraintRowCount:current.rowCount,
        violatedConstraintKeys:[...current.violatedConstraintKeys],
        violatedKinds:[...current.violatedKinds],
        before:{
          maximumPhysicalResidual:current.maximumPhysicalResidual,
          merit:current.merit,
          violationEnergy:current.violationEnergy,
        },
        after:{
          maximumPhysicalResidual:current.maximumPhysicalResidual,
          merit:current.merit,
          violationEnergy:current.violationEnergy,
        },
        candidateReceipts:[],
      });
      break;
    }
    const direction = gradient.map(value => -value / gradientNorm);
    const enumeratedRadii = config.candidateEnumeration === 'canonical'
      ? [...config.trustRegionRadii]
      : [...config.trustRegionRadii].reverse();
    const candidates = enumeratedRadii.map(radius => {
      const vector = clampVector(
        current.vector.map((value, axis) => value + radius * direction[axis]),
        config.translationBounds,
      );
      const state = evaluateNBodyUnifiedKktState({ problem, vector });
      evaluationCount += 1;
      return { radius, state, receipt:stateReceipt(state, config) };
    });
    candidates.sort((left, right) => compareReceipts(left.receipt, right.receipt));
    const accepted = candidates.find(candidate => {
      const improvesResidual = candidate.receipt.maximumPhysicalResidual <
        current.maximumPhysicalResidual - 1e-12;
      const improvesMerit = candidate.receipt.merit < current.merit - 1e-15;
      const passesFamilyFilter = config.acceptancePolicy === 'scalar-merit' ||
        familyRegressions(
          current,
          candidate.receipt,
          config.familyRegressionTolerance,
        ).length === 0;
      return improvesResidual && improvesMerit && passesFamilyFilter;
    });
    const before = structuredClone(current);
    const candidateReceipts = [...candidates]
      .sort((left, right) => right.radius - left.radius)
      .map(candidate => {
        const improvesResidual = candidate.receipt.maximumPhysicalResidual <
          before.maximumPhysicalResidual - 1e-12;
        const improvesMerit = candidate.receipt.merit < before.merit - 1e-15;
        const regressedFamilies = familyRegressions(
          before,
          candidate.receipt,
          config.familyRegressionTolerance,
        );
        return {
          radius:candidate.radius,
          vector:[...candidate.receipt.vector],
          maximumPhysicalResidual:candidate.receipt.maximumPhysicalResidual,
          merit:candidate.receipt.merit,
          violationEnergy:candidate.receipt.violationEnergy,
          constraintFamilies:constraintFamilyMetrics(candidate.receipt),
          regressedFamilies,
          selected:candidate === accepted,
          rejectionReason:candidate === accepted
            ? null
            : config.acceptancePolicy === 'family-pareto-no-resurrection' &&
                regressedFamilies.length > 0
              ? 'constraint-family-regression'
            : !improvesResidual
              ? 'non-improving-physical-residual'
              : !improvesMerit
                ? 'non-improving-merit'
                : 'higher-ranked-admissible-candidate',
        };
      });
    if (!accepted) {
      workRows.push({
        iteration,
        accepted:false,
        acceptedTrustRegionRadius:null,
        terminalReason:'no-admissible-trust-region-candidate',
        gradientNorm:rounded(gradientNorm),
        directionNonzeroCoordinateCount:direction.filter(
          value => Math.abs(value) > 1e-12,
        ).length,
        allConstraintRowCount:before.rowCount,
        violatedConstraintKeys:[...before.violatedConstraintKeys],
        violatedKinds:[...before.violatedKinds],
        before:{
          maximumPhysicalResidual:before.maximumPhysicalResidual,
          merit:before.merit,
          violationEnergy:before.violationEnergy,
        },
        after:{
          maximumPhysicalResidual:before.maximumPhysicalResidual,
          merit:before.merit,
          violationEnergy:before.violationEnergy,
        },
        candidateReceipts,
      });
      break;
    }
    currentState = accepted.state;
    current = accepted.receipt;
    workRows.push({
      iteration,
      accepted:true,
      acceptedTrustRegionRadius:accepted.radius,
      terminalReason:null,
      gradientNorm:rounded(gradientNorm),
      directionNonzeroCoordinateCount:direction.filter(value => Math.abs(value) > 1e-12).length,
      allConstraintRowCount:before.rowCount,
      violatedConstraintKeys:[...before.violatedConstraintKeys],
      violatedKinds:[...before.violatedKinds],
      before:{
        maximumPhysicalResidual:before.maximumPhysicalResidual,
        merit:before.merit,
        violationEnergy:before.violationEnergy,
      },
      after:{
        maximumPhysicalResidual:current.maximumPhysicalResidual,
        merit:current.merit,
        violationEnergy:current.violationEnergy,
      },
      candidateReceipts,
    });
  }
  const acceptedIterations = workRows.filter(row => row.accepted).length;
  return {
    start,
    selected:{
      ...structuredClone(current),
      muscles:structuredClone(currentState.muscles),
    },
    work:{
      iterations:acceptedIterations,
      attempts:workRows.length,
      evaluationCount,
      rows:workRows,
    },
  };
}

function equivalenceRow(enumeration, result) {
  return {
    enumeration,
    vector:result.selected.vector,
    maximumPhysicalResidual:result.selected.maximumPhysicalResidual,
    metrics:result.selected.metrics,
    work:result.work.rows,
  };
}

export function createNBodyAllNeighborRestorationConfig({
  acceptancePolicy = 'scalar-merit',
} = {}) {
  const algorithm = acceptancePolicy === 'family-pareto-no-resurrection'
    ? FAMILY_FILTER_ALGORITHM
    : ALGORITHM;
  return {
    acceptancePolicy,
    algorithm,
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-7,
    familyRegressionTolerance:1e-12,
    finiteDifferenceStep:1e-5,
    iterationBudget:1,
    meritNormOrder:8,
    translationBounds:[-0.3, 0.3],
    trustRegionRadii:[0.004, 0.002, 0.001, 0.0005, 0.00025, 0.000125, 0.0000625],
    violationWeight:0.05,
  };
}

export function solveNBodyAllNeighborRestoration({
  problem,
  startVector,
  requestedConfig,
} = {}) {
  validateConfig(requestedConfig);
  validateStart(problem, startVector, requestedConfig.translationBounds);
  const primary = solveEnumeration(problem, startVector, structuredClone(requestedConfig));
  const alternateConfig = {
    ...structuredClone(requestedConfig),
    candidateEnumeration:requestedConfig.candidateEnumeration === 'canonical'
      ? 'reverse'
      : 'canonical',
  };
  const alternate = solveEnumeration(problem, startVector, alternateConfig);
  const maximumVectorDifference = Math.max(...primary.selected.vector.map(
    (value, index) => Math.abs(value - alternate.selected.vector[index]),
  ));
  const maximumMetricsDifference = Math.max(...Object.keys(primary.selected.metrics).map(key => {
    const left = primary.selected.metrics[key];
    const right = alternate.selected.metrics[key];
    return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) : Infinity;
  }));
  const status = primary.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance
    ? 'converged-all-neighbor-restoration'
    : primary.selected.maximumPhysicalResidual < primary.start.maximumPhysicalResidual - 1e-12
      ? requestedConfig.acceptancePolicy === 'family-pareto-no-resurrection'
        ? 'family-filter-floor-improved'
        : 'restoration-floor-improved'
      : requestedConfig.acceptancePolicy === 'family-pareto-no-resurrection'
        ? 'stalled-family-filter-restoration'
        : 'stalled-all-neighbor-restoration';
  const core = {
    schema:NBODY_PACKING_RESTORATION_RESULT_SCHEMA,
    status,
    route:{
      requested:requestedConfig.algorithm,
      effective:requestedConfig.algorithm,
      fallbackUsed:false,
    },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    mechanism: {
      updateMode:'one-state-all-row-finite-difference-merit-direction',
      objective:'p8-hard-residual-plus-weighted-all-row-violation-energy',
      trustRegionPolicy:'bounded-simultaneous-all-coordinate-line-search',
      constraintKinds:['pairwise-clearance', 'skeletal-clearance', 'compartment-clearance'],
      acceptancePolicy:requestedConfig.acceptancePolicy,
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    start:primary.start,
    selected:primary.selected,
    work:primary.work,
    invariance: {
      candidateEnumeration:
        maximumVectorDifference === 0 && maximumMetricsDifference === 0 ? 'passed' : 'failed',
      maximumVectorDifference,
      maximumMetricsDifference,
      rows:[
        equivalenceRow(requestedConfig.candidateEnumeration, primary),
        equivalenceRow(alternateConfig.candidateEnumeration, alternate),
      ],
    },
    claimCeiling:requestedConfig.acceptancePolicy === 'family-pareto-no-resurrection'
      ? 'bounded-severity-0.32-no-family-regression-filter-not-global-feasibility-or-optimality'
      : 'bounded-severity-0.32-restoration-direction-not-global-feasibility-or-optimality',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}
