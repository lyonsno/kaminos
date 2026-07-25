export const SUPPORT_VELOCITY_ASSAY_ROUTE = 'kaminos/lirm-719024/support-velocity-assay-v0';
export const SUPPORT_IDS = ['front-left', 'front-right', 'rear-left', 'rear-right'];
export const METRIC_IDS = [
  'sign-agreement',
  'support-compatibility',
  'signed-displacement',
  'continuity',
];

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

export function ordinaryMedian(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('median requires at least one value');
  }
  const sorted = values.map((value, index) => requireFinite(value, `median value ${index}`))
    .sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

export function periodicCentralDifference(values, dt) {
  if (!Array.isArray(values) || values.length < 3) {
    throw new Error('periodic central difference requires at least three samples');
  }
  const step = requireFinite(dt, 'sample interval');
  if (step <= 0) throw new Error('sample interval must be positive');
  const admitted = values.map((value, index) => requireFinite(value, `sample ${index}`));
  return admitted.map((_, index) => {
    const previous = admitted[(index - 1 + admitted.length) % admitted.length];
    const next = admitted[(index + 1) % admitted.length];
    return (next - previous) / (2 * step);
  });
}

export function empiricalMidrankPercentiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('midrank percentiles require at least one value');
  }
  const admitted = values.map((value, index) => requireFinite(value, `metric value ${index}`));
  return admitted.map(value => {
    let less = 0;
    let equal = 0;
    for (const candidate of admitted) {
      if (candidate < value) less += 1;
      if (Object.is(candidate, value) || candidate === value) equal += 1;
    }
    return (less + 0.5 * equal) / admitted.length;
  });
}

export function computeWeightedRmsPatchRadius(positions, vertexIndices, weights) {
  if (!positions || positions.length % 3 !== 0) {
    throw new Error('normalized positions must be a packed vec3 array');
  }
  if (!Array.isArray(vertexIndices) || !Array.isArray(weights)
      || vertexIndices.length === 0 || vertexIndices.length !== weights.length) {
    throw new Error('patch vertices and weights must be non-empty and shape-matched');
  }
  const weightSum = weights.reduce(
    (sum, weight, index) => sum + requireFinite(weight, `patch weight ${index}`),
    0,
  );
  if (weightSum <= 0) throw new Error('patch weights must have positive total mass');
  const centroid = [0, 0, 0];
  for (let index = 0; index < vertexIndices.length; index += 1) {
    const vertex = Number(vertexIndices[index]);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex * 3 + 2 >= positions.length) {
      throw new Error(`patch vertex ${index} is out of range`);
    }
    const weight = weights[index] / weightSum;
    centroid[0] += positions[vertex * 3] * weight;
    centroid[1] += positions[vertex * 3 + 1] * weight;
    centroid[2] += positions[vertex * 3 + 2] * weight;
  }
  let squaredRadius = 0;
  for (let index = 0; index < vertexIndices.length; index += 1) {
    const vertex = vertexIndices[index];
    const weight = weights[index] / weightSum;
    const x = positions[vertex * 3] - centroid[0];
    const y = positions[vertex * 3 + 1] - centroid[1];
    const z = positions[vertex * 3 + 2] - centroid[2];
    squaredRadius += weight * (x * x + y * y + z * z);
  }
  return { centroid, rmsRadius: Math.sqrt(Math.max(0, squaredRadius)), weightSum };
}

export function contactStateAtUnitPhase(phase, phaseOffset) {
  const cycle = ((requireFinite(phase, 'phase') + requireFinite(phaseOffset, 'phase offset')) % 1 + 1) % 1;
  return {
    cycle,
    state: cycle < 0.5 ? 'stance' : cycle < 0.58 ? 'release' : 'swing',
  };
}

function metricValuesForShift({ supports, sampleCount, dt, shift }) {
  const medianImpliedSpeedTrace = [];
  const signedDisagreementTrace = [];
  const activeSupportIdsTrace = [];
  let intendedForward = 0;
  let activeOccurrenceCount = 0;
  let absoluteDeviationSum = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const shiftedPhase = ((index + shift) % sampleCount) / sampleCount;
    const active = supports.filter(support => (
      contactStateAtUnitPhase(shiftedPhase, support.phaseOffset).state === 'stance'
    ));
    if (active.length === 0) throw new Error(`shift ${shift} sample ${index} has no active supports`);
    const speeds = active.map(support => support.impliedSpeedTrace[index]);
    const medianSpeed = ordinaryMedian(speeds);
    const disagreements = active.map((support, activeIndex) => ({
      supportId: support.id,
      residual: speeds[activeIndex] - medianSpeed,
    }));
    medianImpliedSpeedTrace.push(medianSpeed);
    signedDisagreementTrace.push(disagreements);
    activeSupportIdsTrace.push(active.map(support => support.id));
    intendedForward += speeds.filter(speed => speed > 0).length;
    activeOccurrenceCount += speeds.length;
    absoluteDeviationSum += disagreements.reduce((sum, item) => sum + Math.abs(item.residual), 0);
  }

  let periodicTotalVariation = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    periodicTotalVariation += Math.abs(
      medianImpliedSpeedTrace[(index + 1) % sampleCount] - medianImpliedSpeedTrace[index],
    );
  }
  return {
    shift,
    activeSupportIdsTrace,
    medianImpliedSpeedTrace,
    signedDisagreementTrace,
    metrics: {
      signAgreement: intendedForward / activeOccurrenceCount,
      supportCompatibility: -absoluteDeviationSum / activeOccurrenceCount,
      signedDisplacement: medianImpliedSpeedTrace.reduce((sum, speed) => sum + speed * dt, 0),
      continuity: -periodicTotalVariation,
    },
  };
}

export function runSupportVelocityAssay({
  supports,
  sampleCount,
  dt,
  medianActivePatchRmsRadius,
}) {
  if (!Array.isArray(supports) || supports.length !== SUPPORT_IDS.length) {
    throw new Error('support velocity assay requires exactly four supports');
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 3) {
    throw new Error('sample count must be an integer of at least three');
  }
  const admittedSupports = SUPPORT_IDS.map(id => {
    const support = supports.find(candidate => candidate?.id === id);
    if (!support || support.impliedSpeedTrace?.length !== sampleCount) {
      throw new Error(`support ${id} must provide the complete speed trace`);
    }
    return {
      ...support,
      phaseOffset: requireFinite(support.phaseOffset, `${id} phase offset`),
      impliedSpeedTrace: support.impliedSpeedTrace.map(
        (value, index) => requireFinite(value, `${id} speed ${index}`),
      ),
    };
  });
  const radius = requireFinite(medianActivePatchRmsRadius, 'median active patch RMS radius');
  if (radius <= 0) throw new Error('median active patch RMS radius must be positive');
  const shifts = Array.from({ length: sampleCount }, (_, shift) => metricValuesForShift({
    supports: admittedSupports,
    sampleCount,
    dt,
    shift,
  }));
  const metricColumns = [
    shifts.map(item => item.metrics.signAgreement),
    shifts.map(item => item.metrics.supportCompatibility),
    shifts.map(item => item.metrics.signedDisplacement),
    shifts.map(item => item.metrics.continuity),
  ];
  const percentileColumns = metricColumns.map(empiricalMidrankPercentiles);
  for (let shift = 0; shift < shifts.length; shift += 1) {
    shifts[shift].componentPercentiles = METRIC_IDS.map((metricId, metricIndex) => ({
      metricId,
      percentile: percentileColumns[metricIndex][shift],
    }));
    shifts[shift].score = Math.min(
      ...shifts[shift].componentPercentiles.map(component => component.percentile),
    );
  }
  const unshifted = shifts[0];
  const relativeGatePassed = unshifted.score >= 0.95;
  const positiveDisplacement = unshifted.metrics.signedDisplacement > 0;
  const magnitudeGatePassed = unshifted.metrics.signedDisplacement >= radius;
  const classification = relativeGatePassed
    ? positiveDisplacement && magnitudeGatePassed ? 'strong' : 'weak'
    : 'fail';
  return {
    shifts,
    result: {
      classification,
      visualAbEarned: classification === 'strong',
      unshiftedScore: unshifted.score,
      unshiftedMetrics: unshifted.metrics,
      componentPercentiles: unshifted.componentPercentiles,
      relativeGatePassed,
      positiveDisplacement,
      magnitudeGatePassed,
      displacementToPatchRadiusRatio: unshifted.metrics.signedDisplacement / radius,
      medianActivePatchRmsRadius: radius,
    },
  };
}
