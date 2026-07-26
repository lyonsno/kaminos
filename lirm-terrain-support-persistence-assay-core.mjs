export const TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE =
  'kaminos/lirm-719024/terrain-support-persistence-assay-v0';

export const SUPPORT_IDS = ['front-left', 'front-right', 'rear-left', 'rear-right'];

const EPSILON = 1e-12;

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return value.map((component, index) => requireFinite(component, `${label}[${index}]`));
}

function add3(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract3(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale3(vector, scalar) {
  return vector.map(value => value * scalar);
}

function dot3(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function magnitude3(vector) {
  return Math.hypot(...vector);
}

function normalize3(vector, label) {
  const magnitude = magnitude3(vector);
  if (!(magnitude > EPSILON)) throw new Error(`${label} must have non-zero length`);
  return scale3(vector, 1 / magnitude);
}

function centroid3(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('centroid requires at least one vector');
  }
  return scale3(vectors.reduce(add3, [0, 0, 0]), 1 / vectors.length);
}

function clampMagnitude(vector, maximum) {
  const magnitude = magnitude3(vector);
  return magnitude > maximum ? scale3(vector, maximum / magnitude) : [...vector];
}

function mix3(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

function periodicPhase(value) {
  return ((requireFinite(value, 'phase') % 1) + 1) % 1;
}

function ordinaryMedian(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('median requires at least one value');
  }
  const sorted = values.map((value, index) => requireFinite(value, `median[${index}]`))
    .sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('quantile requires at least one value');
  }
  const sorted = values.map((value, index) => requireFinite(value, `quantile[${index}]`))
    .sort((left, right) => left - right);
  const coordinate = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(coordinate);
  const upper = Math.ceil(coordinate);
  const weight = coordinate - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function contactStateAtUnitPhase(phase, phaseOffset) {
  const cycle = periodicPhase(
    requireFinite(phase, 'phase') + requireFinite(phaseOffset, 'phase offset'),
  );
  return {
    cycle,
    state: cycle < 0.5 ? 'stance' : cycle < 0.58 ? 'release' : 'swing',
  };
}

export function enumerateSupportPermutations(supportIds = SUPPORT_IDS) {
  if (!Array.isArray(supportIds) || supportIds.length === 0
      || new Set(supportIds).size !== supportIds.length) {
    throw new Error('support ids must be a non-empty unique list');
  }
  const permutations = [];
  const visit = (prefix, remaining) => {
    if (remaining.length === 0) {
      const mapping = Object.fromEntries(supportIds.map((id, index) => [id, prefix[index]]));
      permutations.push({
        mapping,
        mappingKey: supportIds.map(id => `${id}>${mapping[id]}`).join('|'),
        identity: supportIds.every(id => mapping[id] === id),
      });
      return;
    }
    for (let index = 0; index < remaining.length; index += 1) {
      visit(
        [...prefix, remaining[index]],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      );
    }
  };
  visit([], [...supportIds]);
  return permutations;
}

function farthestCorrespondencePair(correspondences) {
  let selected = null;
  let selectedDistance = -1;
  for (let left = 0; left < correspondences.length; left += 1) {
    for (let right = left + 1; right < correspondences.length; right += 1) {
      const distance = magnitude3(subtract3(
        correspondences[right].current,
        correspondences[left].current,
      ));
      if (distance > selectedDistance) {
        selected = [correspondences[left], correspondences[right]];
        selectedDistance = distance;
      }
    }
  }
  return selected;
}

function minimalRotationVector(currentVector, targetVector) {
  const current = normalize3(currentVector, 'current support baseline');
  const target = normalize3(targetVector, 'target support baseline');
  const axisNumerator = cross3(current, target);
  const sine = magnitude3(axisNumerator);
  const cosine = Math.max(-1, Math.min(1, dot3(current, target)));
  if (sine <= EPSILON) {
    if (cosine >= 0) return [0, 0, 0];
    const candidate = Math.abs(current[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    return scale3(normalize3(cross3(current, candidate), 'antiparallel rotation axis'), Math.PI);
  }
  return scale3(axisNumerator, Math.atan2(sine, cosine) / sine);
}

export function solveRootCorrection({
  correspondences,
  translationBudget,
  rotationBudget,
} = {}) {
  if (!Array.isArray(correspondences)) {
    throw new Error('root correction correspondences must be an array');
  }
  const admitted = correspondences.map((item, index) => ({
    supportId: String(item?.supportId || `support-${index}`),
    current: requireVector3(item?.current, `correspondence ${index} current`),
    target: requireVector3(item?.target, `correspondence ${index} target`),
  }));
  const admittedTranslationBudget = requireFinite(translationBudget, 'translation budget');
  const admittedRotationBudget = requireFinite(rotationBudget, 'rotation budget');
  if (!(admittedTranslationBudget > 0) || !(admittedRotationBudget > 0)) {
    throw new Error('root budgets must be positive');
  }
  if (admitted.length === 0) {
    return {
      supportIds: [],
      pivot: [0, 0, 0],
      rawTranslation: [0, 0, 0],
      rawRotationVector: [0, 0, 0],
      translation: [0, 0, 0],
      rotationVector: [0, 0, 0],
      translationBudgetUtilization: 0,
      rotationBudgetUtilization: 0,
      capHit: false,
      capHits: { translation: false, rotation: false },
    };
  }

  const currentCentroid = centroid3(admitted.map(item => item.current));
  const targetCentroid = centroid3(admitted.map(item => item.target));
  let rawRotationVector = [0, 0, 0];
  if (admitted.length > 1) {
    const pair = farthestCorrespondencePair(admitted);
    const currentBaseline = subtract3(pair[1].current, pair[0].current);
    const targetBaseline = subtract3(pair[1].target, pair[0].target);
    if (magnitude3(currentBaseline) > EPSILON && magnitude3(targetBaseline) > EPSILON) {
      rawRotationVector = minimalRotationVector(currentBaseline, targetBaseline);
    }
  }
  const centroidTranslation = subtract3(targetCentroid, currentCentroid);
  const rawTranslation = subtract3(
    centroidTranslation,
    cross3(rawRotationVector, currentCentroid),
  );
  const translationMagnitude = magnitude3(rawTranslation);
  const rotationMagnitude = magnitude3(rawRotationVector);
  const translationCapHit = translationMagnitude > admittedTranslationBudget;
  const rotationCapHit = rotationMagnitude > admittedRotationBudget;
  return {
    supportIds: admitted.map(item => item.supportId),
    pivot: currentCentroid,
    rawTranslation,
    rawRotationVector,
    translation: clampMagnitude(rawTranslation, admittedTranslationBudget),
    rotationVector: clampMagnitude(rawRotationVector, admittedRotationBudget),
    translationBudgetUtilization: translationMagnitude / admittedTranslationBudget,
    rotationBudgetUtilization: rotationMagnitude / admittedRotationBudget,
    capHit: translationCapHit || rotationCapHit,
    capHits: {
      translation: translationCapHit,
      rotation: rotationCapHit,
    },
  };
}

export function applyRootCorrection(point, rootState) {
  const admittedPoint = requireVector3(point, 'root-corrected point');
  const translation = requireVector3(rootState?.translation, 'root translation');
  const rotation = requireVector3(rootState?.rotationVector, 'root rotation vector');
  return add3(add3(admittedPoint, translation), cross3(rotation, admittedPoint));
}

export function interpolatePeriodicRootState({
  heldoutSampleId,
  heldoutPhase,
  fitStates,
} = {}) {
  if (!Array.isArray(fitStates) || fitStates.length < 2) {
    throw new Error('periodic root interpolation requires at least two fit states');
  }
  const heldout = periodicPhase(heldoutPhase);
  const sorted = fitStates.map((state, index) => ({
    ...state,
    sampleId: String(state?.sampleId || `fit-${index}`),
    phase: periodicPhase(state?.phase),
    translation: requireVector3(state?.translation, `fit ${index} translation`),
    rotationVector: requireVector3(state?.rotationVector, `fit ${index} rotation`),
  })).sort((left, right) => left.phase - right.phase);
  let previousIndex = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].phase < heldout || Math.abs(sorted[index].phase - heldout) <= EPSILON) {
      previousIndex = index;
    }
  }
  if (previousIndex >= 0
      && Math.abs(sorted[previousIndex].phase - heldout) <= EPSILON) {
    throw new Error(`held-out sample ${heldoutSampleId} overlaps fit sample ${sorted[previousIndex].sampleId}`);
  }
  const previous = previousIndex >= 0 ? sorted[previousIndex] : sorted.at(-1);
  const next = previousIndex >= 0 && previousIndex + 1 < sorted.length
    ? sorted[previousIndex + 1]
    : sorted[0];
  let previousPhase = previous.phase;
  let nextPhase = next.phase;
  let heldoutCoordinate = heldout;
  let periodicWrap = false;
  if (nextPhase <= previousPhase) {
    nextPhase += 1;
    periodicWrap = true;
    if (heldoutCoordinate < previousPhase) heldoutCoordinate += 1;
  }
  const denominator = nextPhase - previousPhase;
  if (!(denominator > EPSILON)) throw new Error('fit samples do not bracket held-out phase');
  const weight = (heldoutCoordinate - previousPhase) / denominator;
  if (weight < -EPSILON || weight > 1 + EPSILON) {
    throw new Error('fit samples do not immediately bracket held-out phase');
  }
  return {
    sampleId: String(heldoutSampleId),
    phase: heldout,
    translation: mix3(previous.translation, next.translation, weight),
    rotationVector: mix3(previous.rotationVector, next.rotationVector, weight),
    capHit: false,
    capHits: { translation: false, rotation: false },
    translationBudgetUtilization:
      previous.translationBudgetUtilization
      + (next.translationBudgetUtilization - previous.translationBudgetUtilization) * weight,
    rotationBudgetUtilization:
      previous.rotationBudgetUtilization
      + (next.rotationBudgetUtilization - previous.rotationBudgetUtilization) * weight,
    reconstruction: {
      previousFitSampleId: previous.sampleId,
      nextFitSampleId: next.sampleId,
      weight,
      periodicWrap,
    },
  };
}

function admitSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 4 || samples.length % 2 !== 0) {
    throw new Error('assay requires an even cycle of at least four unique samples');
  }
  return samples.map((sample, index) => {
    const probes = SUPPORT_IDS.map(id => {
      const probe = sample?.probes?.find(candidate => candidate?.id === id);
      if (!probe) throw new Error(`sample ${index} is missing support ${id}`);
      return {
        id,
        phaseOffset: requireFinite(probe.phaseOffset, `${id} phase offset`),
        worldPosition: requireVector3(probe.worldPosition, `${id} world position`),
      };
    });
    return {
      sampleId: String(sample.sampleId || `sample-${String(index).padStart(2, '0')}`),
      sampleIndex: index,
      phase: periodicPhase(sample.phase),
      probes,
    };
  });
}

function admitPlantTargets(plantTargets) {
  return Object.fromEntries(SUPPORT_IDS.map(id => {
    const target = plantTargets?.[id];
    if (!target) throw new Error(`plant target ${id} is missing`);
    return [id, {
      ...target,
      supportId: id,
      plantSampleId: String(target.plantSampleId),
      releaseSampleId: String(target.releaseSampleId),
      plantPhase: target.plantPhase === undefined ? null : periodicPhase(target.plantPhase),
      worldPoint: requireVector3(target.worldPoint, `${id} plant point`),
      normal: normalize3(requireVector3(target.normal, `${id} plant normal`), `${id} plant normal`),
      tangent: normalize3(requireVector3(target.tangent, `${id} plant tangent`), `${id} plant tangent`),
      bitangent: normalize3(
        requireVector3(target.bitangent, `${id} plant bitangent`),
        `${id} plant bitangent`,
      ),
    }];
  }));
}

function activeProbes(sample) {
  return sample.probes.filter(probe => (
    contactStateAtUnitPhase(sample.phase, probe.phaseOffset).state === 'stance'
  ));
}

function correctionTarget({
  family,
  supportId,
  current,
  plantTargets,
  permutation,
  terrainSampler,
}) {
  if (family === 'absent') return null;
  if (family === 'transient') {
    const terrain = terrainSampler(current[0], current[2]);
    if (terrain?.inBounds !== true) throw new Error(`transient target ${supportId} is out of bounds`);
    return requireVector3(terrain.world, `transient target ${supportId}`);
  }
  const targetId = family === 'permuted' ? permutation[supportId] : supportId;
  return plantTargets[targetId].worldPoint;
}

function solveSampleState({
  sample,
  family,
  plantTargets,
  permutation,
  terrainSampler,
  translationBudget,
  rotationBudget,
  excludedSupportId = null,
}) {
  const correspondences = activeProbes(sample)
    .filter(probe => probe.id !== excludedSupportId)
    .map(probe => ({
      supportId: probe.id,
      current: probe.worldPosition,
      target: correctionTarget({
        family,
        supportId: probe.id,
        current: probe.worldPosition,
        plantTargets,
        permutation,
        terrainSampler,
      }),
    }))
    .filter(item => item.target !== null);
  return {
    sampleId: sample.sampleId,
    sampleIndex: sample.sampleIndex,
    phase: sample.phase,
    ...solveRootCorrection({ correspondences, translationBudget, rotationBudget }),
  };
}

function targetAgeAtSample(sample, probe, plantTarget) {
  const plantPhase = plantTarget.plantPhase ?? periodicPhase(-probe.phaseOffset);
  return periodicPhase(sample.phase - plantPhase);
}

function evaluateSampleSet({
  sampleIndices,
  stride,
  samples,
  rootStates,
  plantTargets,
  terrainSampler,
  includedSupportId = null,
  excludedSupportId = null,
}) {
  const phaseWeight = stride / samples.length;
  let tangentialIntegral = 0;
  let normalIntegral = 0;
  let minimumSwingClearance = Infinity;
  const targetAges = [];
  const sampleMetrics = [];
  for (const sampleIndex of sampleIndices) {
    const sample = samples[sampleIndex];
    const rootState = rootStates[sampleIndex];
    const active = activeProbes(sample).filter(probe => (
      (includedSupportId === null || probe.id === includedSupportId)
      && probe.id !== excludedSupportId
    ));
    const tangentialErrors = [];
    const normalErrors = [];
    for (const probe of active) {
      const target = plantTargets[probe.id];
      const corrected = applyRootCorrection(probe.worldPosition, rootState);
      const residual = subtract3(corrected, target.worldPoint);
      const signedNormal = dot3(residual, target.normal);
      const tangential = subtract3(residual, scale3(target.normal, signedNormal));
      tangentialErrors.push(magnitude3(tangential));
      normalErrors.push(Math.abs(signedNormal));
      targetAges.push(targetAgeAtSample(sample, probe, target));
    }
    if (tangentialErrors.length > 0) {
      const tangentialMean = tangentialErrors.reduce((sum, value) => sum + value, 0)
        / tangentialErrors.length;
      const normalMean = normalErrors.reduce((sum, value) => sum + value, 0)
        / normalErrors.length;
      tangentialIntegral += tangentialMean * phaseWeight;
      normalIntegral += normalMean * phaseWeight;
      sampleMetrics.push({
        sampleId: sample.sampleId,
        phase: sample.phase,
        includedSupportIds: active.map(probe => probe.id),
        tangentialMean,
        normalMean,
      });
    }
    for (const probe of sample.probes) {
      if (contactStateAtUnitPhase(sample.phase, probe.phaseOffset).state !== 'swing') continue;
      const corrected = applyRootCorrection(probe.worldPosition, rootState);
      const terrain = terrainSampler(corrected[0], corrected[2]);
      if (terrain?.inBounds !== true) {
        minimumSwingClearance = -Infinity;
        continue;
      }
      const point = requireVector3(terrain.world, `${probe.id} swing terrain point`);
      const normal = normalize3(
        requireVector3(terrain.normal, `${probe.id} swing terrain normal`),
        `${probe.id} swing terrain normal`,
      );
      minimumSwingClearance = Math.min(
        minimumSwingClearance,
        dot3(subtract3(corrected, point), normal),
      );
    }
  }
  return {
    integratedTangentialSlip: tangentialIntegral,
    integratedNormalSeparation: normalIntegral,
    minimumSwingClearance: minimumSwingClearance === Infinity ? null : minimumSwingClearance,
    targetAge: {
      median: targetAges.length > 0 ? ordinaryMedian(targetAges) : null,
      maximum: targetAges.length > 0 ? Math.max(...targetAges) : null,
    },
    sampleMetrics,
  };
}

function rootTraceMetrics(rootStates, supportRadius) {
  let correctionTotalVariation = 0;
  for (let index = 0; index < rootStates.length; index += 1) {
    const current = rootStates[index];
    const next = rootStates[(index + 1) % rootStates.length];
    correctionTotalVariation += magnitude3(subtract3(next.translation, current.translation));
    correctionTotalVariation += supportRadius
      * magnitude3(subtract3(next.rotationVector, current.rotationVector));
  }
  return {
    maximumTranslation: Math.max(...rootStates.map(state => magnitude3(state.translation))),
    maximumRotationAngle: Math.max(...rootStates.map(state => magnitude3(state.rotationVector))),
    maximumRotationDisplacementAtR: supportRadius * Math.max(
      ...rootStates.map(state => magnitude3(state.rotationVector)),
    ),
    maximumTranslationBudgetUtilization: Math.max(
      ...rootStates.map(state => state.translationBudgetUtilization),
    ),
    maximumRotationBudgetUtilization: Math.max(
      ...rootStates.map(state => state.rotationBudgetUtilization),
    ),
    capHitCount: rootStates.filter(state => state.capHit).length,
    correctionTotalVariation,
  };
}

function traceForReport(rootStates) {
  return rootStates.map(state => ({
    sampleId: state.sampleId,
    phase: state.phase,
    translation: state.translation,
    rotationVector: state.rotationVector,
    rotationAngle: magnitude3(state.rotationVector),
    translationBudgetUtilization: state.translationBudgetUtilization,
    rotationBudgetUtilization: state.rotationBudgetUtilization,
    capHit: state.capHit,
  }));
}

function runSupportHoldout({
  family,
  heldoutSupportId,
  samples,
  plantTargets,
  permutation,
  terrainSampler,
  supportRadius,
  translationBudget,
  rotationBudget,
}) {
  const rootStates = samples.map(sample => solveSampleState({
    sample,
    family,
    plantTargets,
    permutation,
    terrainSampler,
    translationBudget,
    rotationBudget,
    excludedSupportId: heldoutSupportId,
  }));
  const heldoutIndices = samples
    .filter(sample => activeProbes(sample).some(probe => probe.id === heldoutSupportId))
    .map(sample => sample.sampleIndex);
  const fit = evaluateSampleSet({
    sampleIndices: heldoutIndices,
    stride: 1,
    samples,
    rootStates,
    plantTargets,
    terrainSampler,
    excludedSupportId: heldoutSupportId,
  });
  const heldout = evaluateSampleSet({
    sampleIndices: heldoutIndices,
    stride: 1,
    samples,
    rootStates,
    plantTargets,
    terrainSampler,
    includedSupportId: heldoutSupportId,
  });
  return {
    foldId: `leave-${heldoutSupportId}-out`,
    holdoutFamily: 'leave-one-support-out',
    heldoutSupportId,
    fit,
    heldout,
    root: rootTraceMetrics(rootStates, supportRadius),
    rootTrace: traceForReport(rootStates),
    reconstructions: [],
    targetReplacementCount: family === 'transient'
      ? rootStates.reduce((sum, state) => sum + state.supportIds.length, 0)
      : 0,
    routeProgressDeviation: 0,
    sourcePhaseDeviation: 0,
  };
}

function runTimeHoldout({
  family,
  fitParity,
  samples,
  plantTargets,
  permutation,
  terrainSampler,
  supportRadius,
  translationBudget,
  rotationBudget,
}) {
  const fitIndices = samples.filter(sample => sample.sampleIndex % 2 === fitParity)
    .map(sample => sample.sampleIndex);
  const heldoutIndices = samples.filter(sample => sample.sampleIndex % 2 !== fitParity)
    .map(sample => sample.sampleIndex);
  const fitStates = fitIndices.map(sampleIndex => solveSampleState({
    sample: samples[sampleIndex],
    family,
    plantTargets,
    permutation,
    terrainSampler,
    translationBudget,
    rotationBudget,
  }));
  const byIndex = new Map(fitStates.map(state => [state.sampleIndex, state]));
  const reconstructions = [];
  for (const sampleIndex of heldoutIndices) {
    const sample = samples[sampleIndex];
    const reconstructed = interpolatePeriodicRootState({
      heldoutSampleId: sample.sampleId,
      heldoutPhase: sample.phase,
      fitStates,
    });
    byIndex.set(sampleIndex, {
      ...reconstructed,
      sampleIndex,
    });
    reconstructions.push({
      sampleId: sample.sampleId,
      phase: sample.phase,
      ...reconstructed.reconstruction,
    });
  }
  const rootStates = samples.map(sample => byIndex.get(sample.sampleIndex));
  const fit = evaluateSampleSet({
    sampleIndices: fitIndices,
    stride: 2,
    samples,
    rootStates,
    plantTargets,
    terrainSampler,
  });
  const heldout = evaluateSampleSet({
    sampleIndices: heldoutIndices,
    stride: 2,
    samples,
    rootStates,
    plantTargets,
    terrainSampler,
  });
  return {
    foldId: `fit-${fitParity === 0 ? 'even' : 'odd'}-evaluate-${fitParity === 0 ? 'odd' : 'even'}`,
    holdoutFamily: 'alternating-time',
    fitParity,
    fit,
    heldout,
    root: rootTraceMetrics(rootStates, supportRadius),
    rootTrace: traceForReport(rootStates),
    reconstructions,
    targetReplacementCount: family === 'transient'
      ? fitStates.reduce((sum, state) => sum + state.supportIds.length, 0)
      : 0,
    routeProgressDeviation: 0,
    sourcePhaseDeviation: 0,
  };
}

function summarizeFoldFamily(folds, supportRadius) {
  return {
    foldCount: folds.length,
    medianHeldoutTangentialSlip: ordinaryMedian(
      folds.map(fold => fold.heldout.integratedTangentialSlip),
    ),
    medianHeldoutTangentialSlipR: ordinaryMedian(
      folds.map(fold => fold.heldout.integratedTangentialSlip / supportRadius),
    ),
    medianFitTangentialSlip: ordinaryMedian(
      folds.map(fold => fold.fit.integratedTangentialSlip),
    ),
    medianHeldoutNormalSeparation: ordinaryMedian(
      folds.map(fold => fold.heldout.integratedNormalSeparation),
    ),
    minimumSwingClearance: Math.min(
      ...folds.map(fold => fold.heldout.minimumSwingClearance ?? Infinity),
    ),
    maximumRootBudgetUtilization: Math.max(
      ...folds.map(fold => Math.max(
        fold.root.maximumTranslationBudgetUtilization,
        fold.root.maximumRotationBudgetUtilization,
      )),
    ),
    medianRootBudgetUtilization: ordinaryMedian(
      folds.map(fold => Math.max(
        fold.root.maximumTranslationBudgetUtilization,
        fold.root.maximumRotationBudgetUtilization,
      )),
    ),
    capHitCount: folds.reduce((sum, fold) => sum + fold.root.capHitCount, 0),
    medianCorrectionTotalVariation: ordinaryMedian(
      folds.map(fold => fold.root.correctionTotalVariation),
    ),
    routeProgressDeviation: Math.max(...folds.map(fold => fold.routeProgressDeviation)),
    sourcePhaseDeviation: Math.max(...folds.map(fold => fold.sourcePhaseDeviation)),
  };
}

function summarizeRealization(supportFolds, timeFolds, supportRadius) {
  const support = summarizeFoldFamily(supportFolds, supportRadius);
  const time = summarizeFoldFamily(timeFolds, supportRadius);
  return {
    supportHoldouts: support,
    timeHoldouts: time,
    worstFamilyMedianHeldoutTangentialSlip: Math.max(
      support.medianHeldoutTangentialSlip,
      time.medianHeldoutTangentialSlip,
    ),
    allFoldMedianHeldoutTangentialSlip: ordinaryMedian([
      ...supportFolds,
      ...timeFolds,
    ].map(fold => fold.heldout.integratedTangentialSlip)),
    allFoldMedianFitTangentialSlip: ordinaryMedian([
      ...supportFolds,
      ...timeFolds,
    ].map(fold => fold.fit.integratedTangentialSlip)),
    allFoldMedianHeldoutNormalSeparation: ordinaryMedian([
      ...supportFolds,
      ...timeFolds,
    ].map(fold => fold.heldout.integratedNormalSeparation)),
    allFoldMedianRootBudgetUtilization: ordinaryMedian([
      ...supportFolds,
      ...timeFolds,
    ].map(fold => Math.max(
      fold.root.maximumTranslationBudgetUtilization,
      fold.root.maximumRotationBudgetUtilization,
    ))),
    allFoldMedianCorrectionTotalVariation: ordinaryMedian([
      ...supportFolds,
      ...timeFolds,
    ].map(fold => fold.root.correctionTotalVariation)),
  };
}

function runRealization({
  family,
  samples,
  plantTargets,
  permutation,
  terrainSampler,
  supportRadius,
  translationBudget,
  rotationBudget,
}) {
  const supportFolds = SUPPORT_IDS.map(heldoutSupportId => runSupportHoldout({
    family,
    heldoutSupportId,
    samples,
    plantTargets,
    permutation,
    terrainSampler,
    supportRadius,
    translationBudget,
    rotationBudget,
  }));
  const timeFolds = [0, 1].map(fitParity => runTimeHoldout({
    family,
    fitParity,
    samples,
    plantTargets,
    permutation,
    terrainSampler,
    supportRadius,
    translationBudget,
    rotationBudget,
  }));
  return {
    supportFolds,
    timeFolds,
    summary: summarizeRealization(supportFolds, timeFolds, supportRadius),
  };
}

export function runTerrainSupportPersistenceAssay({
  samples,
  plantTargets,
  terrainSampler,
  supportRadius,
  translationBudget,
  rotationBudget,
} = {}) {
  if (typeof terrainSampler !== 'function') throw new Error('terrain sampler must be a function');
  const admittedSamples = admitSamples(samples);
  const admittedTargets = admitPlantTargets(plantTargets);
  const radius = requireFinite(supportRadius, 'support radius');
  if (!(radius > 0)) throw new Error('support radius must be positive');
  const budgets = {
    translationBudget: requireFinite(translationBudget, 'translation budget'),
    rotationBudget: requireFinite(rotationBudget, 'rotation budget'),
  };
  const common = {
    samples: admittedSamples,
    plantTargets: admittedTargets,
    terrainSampler,
    supportRadius: radius,
    ...budgets,
  };
  const persistent = runRealization({ family: 'persistent', permutation: null, ...common });
  const transient = runRealization({ family: 'transient', permutation: null, ...common });
  const absent = runRealization({ family: 'absent', permutation: null, ...common });
  const permutationDefinitions = enumerateSupportPermutations();
  const permutations = permutationDefinitions.map(definition => {
    const realization = runRealization({
      family: 'permuted',
      permutation: definition.mapping,
      ...common,
    });
    return {
      ...definition,
      ...realization,
    };
  });

  const pairedReductions = [
    ...persistent.supportFolds.map((fold, index) => (
      transient.supportFolds[index].heldout.integratedTangentialSlip
      - fold.heldout.integratedTangentialSlip
    )),
    ...persistent.timeFolds.map((fold, index) => (
      transient.timeFolds[index].heldout.integratedTangentialSlip
      - fold.heldout.integratedTangentialSlip
    )),
  ];
  const permutationFifthPercentile = quantile(
    permutations.map(item => item.summary.worstFamilyMedianHeldoutTangentialSlip),
    0.05,
  );
  const persistentBetterBothFamilies = (
    persistent.summary.supportHoldouts.medianHeldoutTangentialSlip
      < transient.summary.supportHoldouts.medianHeldoutTangentialSlip
    && persistent.summary.timeHoldouts.medianHeldoutTangentialSlip
      < transient.summary.timeHoldouts.medianHeldoutTangentialSlip
  );
  const medianReduction = ordinaryMedian(pairedReductions);
  const noMoreBudget = (
    persistent.summary.allFoldMedianRootBudgetUtilization
      <= transient.summary.allFoldMedianRootBudgetUtilization + EPSILON
  );
  const noMoreVariation = (
    persistent.summary.allFoldMedianCorrectionTotalVariation
      <= transient.summary.allFoldMedianCorrectionTotalVariation + EPSILON
  );
  const criteria = {
    zeroRouteAndPhaseDeviation: [
      persistent,
      transient,
      absent,
      ...permutations,
    ].every(item => (
      item.summary.supportHoldouts.routeProgressDeviation === 0
      && item.summary.supportHoldouts.sourcePhaseDeviation === 0
      && item.summary.timeHoldouts.routeProgressDeviation === 0
      && item.summary.timeHoldouts.sourcePhaseDeviation === 0
    )),
    positiveSwingClearanceEveryFold: [
      ...persistent.supportFolds,
      ...persistent.timeFolds,
    ].every(fold => fold.heldout.minimumSwingClearance > 0),
    noRootCapHit: (
      persistent.summary.supportHoldouts.capHitCount === 0
      && persistent.summary.timeHoldouts.capHitCount === 0
    ),
    persistentBetterBothFamilies,
    medianReductionAtLeastOneR: medianReduction >= radius,
    atOrBelowPermutationFifthPercentile: (
      persistent.summary.worstFamilyMedianHeldoutTangentialSlip
      <= permutationFifthPercentile + EPSILON
    ),
    normalSeparationNonWorse: (
      persistent.summary.allFoldMedianHeldoutNormalSeparation
      <= transient.summary.allFoldMedianHeldoutNormalSeparation + EPSILON
    ),
    noMoreRootBudgetOrVariation: noMoreBudget && noMoreVariation,
  };
  const strong = Object.values(criteria).every(Boolean);
  let classification = 'reject-support-family';
  if (strong) {
    classification = 'strong';
  } else if (
    persistent.summary.allFoldMedianFitTangentialSlip
      < transient.summary.allFoldMedianFitTangentialSlip
    && persistent.summary.allFoldMedianHeldoutTangentialSlip
      >= transient.summary.allFoldMedianHeldoutTangentialSlip
  ) {
    classification = 'reject-root-overfit';
  } else if (
    persistent.summary.allFoldMedianHeldoutTangentialSlip
      >= transient.summary.allFoldMedianHeldoutTangentialSlip
  ) {
    classification = 'prefer-transient';
  } else if (!noMoreBudget || !noMoreVariation) {
    classification = 'reject-root-carried-treadmill';
  }

  return {
    routeProgressDeviation: 0,
    sourcePhaseDeviation: 0,
    supportRadius: radius,
    supportHoldouts: {
      persistent: persistent.supportFolds,
      transient: transient.supportFolds,
      absent: absent.supportFolds,
    },
    timeHoldouts: {
      persistent: persistent.timeFolds,
      transient: transient.timeFolds,
      absent: absent.timeFolds,
    },
    summaries: {
      persistent: persistent.summary,
      transient: transient.summary,
      absent: absent.summary,
    },
    permutations,
    result: {
      classification,
      dynamicWitnessEarned: strong,
      hypothesisGate: strong ? 'earned' : 'rejected',
      criteria,
      pairedHeldoutTangentialSlipReductions: pairedReductions,
      medianHeldoutTangentialSlipReduction: medianReduction,
      medianHeldoutTangentialSlipReductionR: medianReduction / radius,
      permutationFifthPercentile,
      permutationFifthPercentileR: permutationFifthPercentile / radius,
    },
  };
}
