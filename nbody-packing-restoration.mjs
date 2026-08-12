import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import { evaluateNBodyUnifiedKktState } from './nbody-packing-unified-kkt.mjs';

export const NBODY_PACKING_RESTORATION_RESULT_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-result.v0';
export const NBODY_PACKING_COMMON_DESCENT_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-result.v0';
export const NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-trajectory-result.v0';

const ALGORITHM = 'all-neighbor-p8-merit-trust-region-restoration-v0';
const FAMILY_FILTER_ALGORITHM = 'all-neighbor-p8-family-filter-restoration-v0';
const COMMON_DESCENT_ALGORITHM = 'family-gradient-minimum-norm-common-descent-v0';
const COMMON_DESCENT_TRAJECTORY_ALGORITHM =
  'family-gradient-minimum-norm-common-descent-trajectory-v0';
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
