import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import { evaluateNBodyUnifiedKktState } from './nbody-packing-unified-kkt.mjs';

export const NBODY_PACKING_RESTORATION_RESULT_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-result.v0';

const ALGORITHM = 'all-neighbor-p8-merit-trust-region-restoration-v0';
const CONFIG_KEYS = Object.freeze([
  'algorithm',
  'candidateEnumeration',
  'convergenceTolerance',
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
  if (config.algorithm !== ALGORITHM) {
    throw new Error(`restoration algorithm must be ${ALGORITHM}`);
  }
  if (!['canonical', 'reverse'].includes(config.candidateEnumeration)) {
    throw new Error('restoration candidateEnumeration must be canonical or reverse');
  }
  for (const key of ['convergenceTolerance', 'finiteDifferenceStep', 'violationWeight']) {
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
    if (!(gradientNorm > 0) || !Number.isFinite(gradientNorm)) break;
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
    const accepted = candidates.find(candidate =>
      candidate.receipt.maximumPhysicalResidual <
        current.maximumPhysicalResidual - 1e-12 &&
      candidate.receipt.merit < current.merit - 1e-15);
    if (!accepted) break;
    const before = structuredClone(current);
    currentState = accepted.state;
    current = accepted.receipt;
    workRows.push({
      iteration,
      acceptedTrustRegionRadius:accepted.radius,
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
    });
  }
  return {
    start,
    selected:{
      ...structuredClone(current),
      muscles:structuredClone(currentState.muscles),
    },
    work:{ iterations:workRows.length, evaluationCount, rows:workRows },
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

export function createNBodyAllNeighborRestorationConfig() {
  return {
    algorithm:ALGORITHM,
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-7,
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
      ? 'restoration-floor-improved'
      : 'stalled-all-neighbor-restoration';
  const core = {
    schema:NBODY_PACKING_RESTORATION_RESULT_SCHEMA,
    status,
    route:{ requested:ALGORITHM, effective:ALGORITHM, fallbackUsed:false },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(requestedConfig) },
    mechanism: {
      updateMode:'one-state-all-row-finite-difference-merit-direction',
      objective:'p8-hard-residual-plus-weighted-all-row-violation-energy',
      trustRegionPolicy:'bounded-simultaneous-all-coordinate-line-search',
      constraintKinds:['pairwise-clearance', 'skeletal-clearance', 'compartment-clearance'],
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
    claimCeiling:
      'bounded-severity-0.32-restoration-direction-not-global-feasibility-or-optimality',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}
