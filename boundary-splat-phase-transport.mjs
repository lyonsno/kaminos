const POSITION_PRECISION = 6;

function finiteVector(values, length, label) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) throw new Error(`${label} must be an array`);
  const result = Array.from(values, Number);
  if (result.length !== length || result.some(value => !Number.isFinite(value))) {
    throw new Error(`${label} must contain exactly ${length} finite values`);
  }
  return result;
}

function stableKey(position) {
  return finiteVector(position, 3, 'site position').map(value => value.toFixed(POSITION_PRECISION)).join(',');
}

function validateSites(sites, label) {
  if (!Array.isArray(sites)) throw new Error(`${label} sites must be an array`);
  const keys = new Set();
  return sites.map((site, index) => {
    const position = finiteVector(site?.position, 3, `${label}[${index}].position`);
    const candidate = finiteVector(site?.candidate, 16, `${label}[${index}].candidate`);
    const splat = finiteVector(site?.splat, 12, `${label}[${index}].splat`);
    const key = stableKey(position);
    if (keys.has(key)) throw new Error(`${label} contains duplicate world-position key ${key}`);
    keys.add(key);
    return { index, key, position, candidate, splat };
  });
}

function featureDistance(left, right) {
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    squared += delta * delta;
  }
  return Math.sqrt(squared / left.length);
}

function displacement(source, target, gridStep) {
  const deltaCells = target.position.map((value, index) => Math.round((value - source.position[index]) / gridStep));
  const residual = target.position.map((value, index) => value - source.position[index] - deltaCells[index] * gridStep);
  if (residual.some(value => Math.abs(value) > 10 ** (-POSITION_PRECISION))) return null;
  return {
    deltaCells,
    distanceCells: Math.sqrt(deltaCells.reduce((sum, value) => sum + value * value, 0)),
    chebyshevCells: Math.max(...deltaCells.map(Math.abs)),
  };
}

export function buildBoundedTransportCorrespondence(sourceSites, targetSites, options = {}) {
  const gridStep = Number(options.gridStep);
  const radiusCells = Math.floor(Number(options.radiusCells ?? 1));
  const ambiguityEpsilon = Math.max(0, Number(options.ambiguityEpsilon ?? 1e-9));
  if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('gridStep must be positive');
  if (!Number.isInteger(radiusCells) || radiusCells <= 0) throw new Error('radiusCells must be a positive integer');
  const source = validateSites(sourceSites, 'source');
  const target = validateSites(targetSites, 'target');
  const sourceByKey = new Map(source.map(row => [row.key, row]));
  const targetByKey = new Map(target.map(row => [row.key, row]));
  const matchedSource = new Set();
  const matchedTarget = new Set();
  const matches = [];

  for (const sourceRow of source) {
    const targetRow = targetByKey.get(sourceRow.key);
    if (!targetRow) continue;
    matchedSource.add(sourceRow.index);
    matchedTarget.add(targetRow.index);
    matches.push({
      sourceIndex: sourceRow.index,
      targetIndex: targetRow.index,
      kind: 'stable',
      deltaCells: [0, 0, 0],
      distanceCells: 0,
      featureDistance: featureDistance(sourceRow.candidate, targetRow.candidate),
      ambiguous: false,
    });
  }

  const edges = [];
  const scoresBySource = new Map();
  for (const sourceRow of source) {
    if (matchedSource.has(sourceRow.index)) continue;
    for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
      for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
        for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const targetKey = stableKey([
            sourceRow.position[0] + dx * gridStep,
            sourceRow.position[1] + dy * gridStep,
            sourceRow.position[2] + dz * gridStep,
          ]);
          const targetRow = targetByKey.get(targetKey);
          if (!targetRow || matchedTarget.has(targetRow.index)) continue;
      const delta = displacement(sourceRow, targetRow, gridStep);
      if (!delta || delta.chebyshevCells > radiusCells) continue;
      const distance = featureDistance(sourceRow.candidate, targetRow.candidate);
      const score = distance + delta.distanceCells * 1e-6;
      const edge = {
        sourceIndex: sourceRow.index,
        targetIndex: targetRow.index,
        sourceKey: sourceRow.key,
        targetKey: targetRow.key,
        kind: 'transported',
        deltaCells: delta.deltaCells,
        distanceCells: delta.distanceCells,
        featureDistance: distance,
        score,
        ambiguous: false,
      };
      edges.push(edge);
      const scores = scoresBySource.get(sourceRow.index) ?? [];
      scores.push(score);
      scoresBySource.set(sourceRow.index, scores);
        }
      }
    }
  }
  const ambiguousSources = new Set();
  for (const [sourceIndex, scores] of scoresBySource) {
    scores.sort((left, right) => left - right);
    if (scores.length > 1 && Math.abs(scores[0] - scores[1]) <= ambiguityEpsilon) ambiguousSources.add(sourceIndex);
  }
  edges.sort((left, right) => (
    left.score - right.score
      || left.sourceKey.localeCompare(right.sourceKey)
      || left.targetKey.localeCompare(right.targetKey)
  ));
  for (const edge of edges) {
    if (matchedSource.has(edge.sourceIndex) || matchedTarget.has(edge.targetIndex)) continue;
    matchedSource.add(edge.sourceIndex);
    matchedTarget.add(edge.targetIndex);
    matches.push({
      sourceIndex: edge.sourceIndex,
      targetIndex: edge.targetIndex,
      kind: edge.kind,
      deltaCells: edge.deltaCells,
      distanceCells: edge.distanceCells,
      featureDistance: edge.featureDistance,
      ambiguous: ambiguousSources.has(edge.sourceIndex),
    });
  }

  return {
    authority: 'stable-site-first-bounded-local-grid-feature-correspondence-v0',
    gridStep,
    radiusCells,
    supportSemantics: {
      stable: 'same world-position site is reserved before displaced matching',
      transported: 'one source carrier is assigned to one unmatched target within the bounded local grid',
      birth: 'target support has no assigned source carrier inside the bounded local grid',
      death: 'source support has no assigned target inside the bounded local grid',
    },
    matches,
    stableCount: matches.filter(match => match.kind === 'stable').length,
    transportedCount: matches.filter(match => match.kind === 'transported').length,
    ambiguityCount: matches.filter(match => match.ambiguous).length,
    births: target.filter(row => !matchedTarget.has(row.index)).map(row => row.index),
    deaths: source.filter(row => !matchedSource.has(row.index)).map(row => row.index),
  };
}

function finitePositiveScale(values, length, label) {
  const scale = finiteVector(values ?? Array(length).fill(1), length, label);
  if (scale.some(value => value <= 0)) throw new Error(`${label} must be positive`);
  return scale;
}

function normalizedStateMse(source, target, candidateScale, splatScale) {
  let squared = 0;
  let count = 0;
  for (let index = 0; index < 16; index += 1) {
    const delta = (source.candidate[index] - target.candidate[index]) / candidateScale[index];
    squared += delta * delta;
    count += 1;
  }
  for (let index = 3; index < 12; index += 1) {
    const delta = (source.splat[index] - target.splat[index]) / splatScale[index - 3];
    squared += delta * delta;
    count += 1;
  }
  return squared / count;
}

export function partitionMotionCohorts(sourceSites, targetSites, options = {}) {
  const gridStep = Number(options.gridStep);
  const stableChangeBinCount = Math.floor(Number(options.stableChangeBinCount ?? 4));
  if (!Number.isInteger(stableChangeBinCount) || stableChangeBinCount < 2) {
    throw new Error('stable change bin count must be an integer of at least two');
  }
  const candidateScale = finitePositiveScale(options.candidateScale, 16, 'candidate scale');
  const splatScale = finitePositiveScale(options.splatScale, 9, 'splat scale');
  const source = validateSites(sourceSites, 'source');
  const target = validateSites(targetSites, 'target');
  const correspondence = buildBoundedTransportCorrespondence(sourceSites, targetSites, {
    gridStep,
    radiusCells: options.radiusCells ?? 1,
  });
  const stableRows = correspondence.matches
    .filter(match => match.kind === 'stable')
    .map(match => ({
      ...match,
      changeScore: Math.sqrt(normalizedStateMse(
        source[match.sourceIndex], target[match.targetIndex], candidateScale, splatScale,
      )),
      targetKey: target[match.targetIndex].key,
    }))
    .sort((left, right) => left.changeScore - right.changeScore || left.targetKey.localeCompare(right.targetKey));
  const targetCohorts = Array.from({ length: stableChangeBinCount }, (_, index) => ({
    id: `stable-q${index + 1}`,
    semantics: `stable world-position sites in exact state-change rank bin ${index + 1}/${stableChangeBinCount}`,
    targetIndices: [],
    sourceIndices: [],
    changeScores: [],
  }));
  for (let rank = 0; rank < stableRows.length; rank += 1) {
    const row = stableRows[rank];
    const bin = Math.min(stableChangeBinCount - 1, Math.floor(rank * stableChangeBinCount / stableRows.length));
    targetCohorts[bin].targetIndices.push(row.targetIndex);
    targetCohorts[bin].sourceIndices.push(row.sourceIndex);
    targetCohorts[bin].changeScores.push(row.changeScore);
  }
  const transported = correspondence.matches.filter(match => match.kind === 'transported');
  targetCohorts.push({
    id: 'transported',
    semantics: 'exact target sites assigned a source carrier displaced within the bounded local grid',
    targetIndices: transported.map(match => match.targetIndex),
    sourceIndices: transported.map(match => match.sourceIndex),
    changeScores: transported.map(match => match.distanceCells),
  });
  targetCohorts.push({
    id: 'birth',
    semantics: 'exact target support with no assigned source carrier inside the bounded local grid',
    targetIndices: [...correspondence.births],
    sourceIndices: [],
    changeScores: [],
  });
  for (const cohort of targetCohorts) {
    cohort.count = cohort.targetIndices.length;
    cohort.minimumChangeScore = cohort.changeScores.length
      ? cohort.changeScores.reduce((minimum, value) => Math.min(minimum, value), Infinity)
      : null;
    cohort.maximumChangeScore = cohort.changeScores.length
      ? cohort.changeScores.reduce((maximum, value) => Math.max(maximum, value), -Infinity)
      : null;
    delete cohort.changeScores;
  }
  const targetIndexToCohort = Array(target.length).fill(null);
  for (const cohort of targetCohorts) {
    for (const targetIndex of cohort.targetIndices) {
      if (targetIndexToCohort[targetIndex] !== null) throw new Error('motion target cohorts overlap');
      targetIndexToCohort[targetIndex] = cohort.id;
    }
  }
  if (targetIndexToCohort.some(value => value === null)) throw new Error('motion target cohorts are incomplete');
  const firstMotionBin = Math.floor(stableChangeBinCount / 2) + 1;
  return {
    authority: 'exact-adjacent-state-change-and-bounded-transport-cohorts-v0',
    correspondenceAuthority: correspondence.authority,
    gridStep,
    stableChangeBinCount,
    normalization: {
      authority: 'caller-declared-positive-channel-scale-v0',
      candidateScale,
      splatScale,
    },
    targetCohorts,
    targetIndexToCohort,
    targetKeys: target.map(row => row.key),
    motionBearingCohortIds: [
      ...Array.from(
        { length: stableChangeBinCount - firstMotionBin + 1 },
        (_, index) => `stable-q${firstMotionBin + index}`,
      ),
      'transported',
      'birth',
    ],
    death: {
      id: 'death',
      semantics: 'exact source support with no assigned target inside the bounded local grid',
      sourceIndices: [...correspondence.deaths],
      count: correspondence.deaths.length,
    },
    counts: {
      source: source.length,
      target: target.length,
      stable: correspondence.stableCount,
      transported: correspondence.transportedCount,
      birth: correspondence.births.length,
      death: correspondence.deaths.length,
    },
  };
}

function evaluateTargetCohort(cohort, target, candidate, candidateScale, splatScale) {
  const byKey = new Map(candidate.map(row => [row.key, row]));
  let squared = 0;
  let matched = 0;
  for (const targetIndex of cohort.targetIndices) {
    const targetRow = target[targetIndex];
    const candidateRow = byKey.get(targetRow.key);
    if (!candidateRow) continue;
    squared += normalizedStateMse(candidateRow, targetRow, candidateScale, splatScale);
    matched += 1;
  }
  return {
    supportCount: matched,
    supportRecall: matched / Math.max(1, cohort.count),
    meanStateMse: matched ? squared / matched : null,
  };
}

function cohortBeatsControl(prediction, control) {
  if (prediction.supportRecall !== control.supportRecall) return prediction.supportRecall > control.supportRecall;
  if (prediction.meanStateMse === null) return false;
  if (control.meanStateMse === null) return true;
  return prediction.meanStateMse < control.meanStateMse;
}

export function evaluateMotionCohorts(partition, sourceSites, targetSites, predictionSites, controlSites) {
  if (partition?.authority !== 'exact-adjacent-state-change-and-bounded-transport-cohorts-v0') {
    throw new Error('motion cohort partition authority mismatch');
  }
  validateSites(sourceSites, 'source');
  const target = validateSites(targetSites, 'target');
  const prediction = validateSites(predictionSites, 'prediction');
  const control = validateSites(controlSites, 'control');
  const candidateScale = finitePositiveScale(partition.normalization?.candidateScale, 16, 'candidate scale');
  const splatScale = finitePositiveScale(partition.normalization?.splatScale, 9, 'splat scale');
  const cohorts = {};
  for (const cohort of partition.targetCohorts) {
    const predictionMetrics = evaluateTargetCohort(cohort, target, prediction, candidateScale, splatScale);
    const controlMetrics = evaluateTargetCohort(cohort, target, control, candidateScale, splatScale);
    cohorts[cohort.id] = {
      count: cohort.count,
      prediction: predictionMetrics,
      control: controlMetrics,
      predictionBeatsControl: cohortBeatsControl(predictionMetrics, controlMetrics),
    };
  }
  const evaluatedMotionCohorts = partition.motionBearingCohortIds.filter(id => cohorts[id]?.count > 0);
  const predictionBeatsControlOnMotionBearingCohorts = evaluatedMotionCohorts.length > 0
    && evaluatedMotionCohorts.every(id => cohorts[id].predictionBeatsControl);
  return {
    authority: 'paired-exact-key-motion-cohort-prediction-versus-control-v0',
    cohorts,
    death: partition.death,
    claimGate: {
      authority: 'motion-bearing-cohorts-cannot-be-closed-by-aggregate-support-v0',
      evaluatedMotionCohorts,
      predictionBeatsControlOnMotionBearingCohorts,
      aggregateSupportCanCloseClaim: false,
      reason: predictionBeatsControlOnMotionBearingCohorts
        ? 'prediction beats control on every populated motion-bearing cohort; visual rollout evidence remains required'
        : 'aggregate support cannot close the claim because one or more motion-bearing cohorts fail to beat control',
    },
  };
}

export function interpolateTransportRows(sourceSites, targetSites, matches, fraction) {
  const amount = Number(fraction);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
    throw new Error('interpolation fraction must be finite and inside [0, 1]');
  }
  const source = validateSites(sourceSites, 'source');
  const target = validateSites(targetSites, 'target');
  if (!Array.isArray(matches)) throw new Error('transport matches must be an array');
  const usedSource = new Set();
  const usedTarget = new Set();
  return matches.map((match, index) => {
    const sourceRow = source[match.sourceIndex];
    const targetRow = target[match.targetIndex];
    if (!sourceRow || !targetRow) throw new Error(`transport match ${index} references an absent site`);
    if (usedSource.has(sourceRow.index) || usedTarget.has(targetRow.index)) {
      throw new Error(`transport match ${index} violates one-to-one carrier assignment`);
    }
    usedSource.add(sourceRow.index);
    usedTarget.add(targetRow.index);
    const row = sourceRow.splat.map((value, channel) => value + (targetRow.splat[channel] - value) * amount);
    for (let axis = 0; axis < 3; axis += 1) {
      row[axis] = sourceRow.position[axis] + (targetRow.position[axis] - sourceRow.position[axis]) * amount;
    }
    return row;
  });
}

export function validateMovingPhaseWitness(witness) {
  if (witness?.schema !== 'kaminos-boundary-splat-moving-phase-witness-v0' || witness.status !== 'completed') {
    throw new Error('moving phase witness must be completed under the expected schema');
  }
  const playback = witness.playback;
  if (playback?.authority !== 'finite-forward-heldout-phase-sequence-v0') throw new Error('moving phase witness authority mismatch');
  if (playback.loops !== false) throw new Error('moving phase witness must not loop');
  const frameCount = Math.floor(Number(playback.frameCount));
  const effectiveFps = Number(playback.effectiveFps);
  if (frameCount < 3 || !Number.isFinite(effectiveFps) || effectiveFps <= 0) throw new Error('moving phase witness cadence is invalid');
  for (const roleName of ['reference', 'control', 'predicted']) {
    const role = witness.roles?.[roleName];
    if (!role?.authority || !Array.isArray(role.frameHashes) || role.frameHashes.length !== frameCount) {
      throw new Error(`moving phase witness ${roleName} role is incomplete`);
    }
    if (role.frameHashes.some(hash => typeof hash !== 'string' || !hash)) throw new Error(`${roleName} frame hash is missing`);
  }
  if (new Set(witness.roles.reference.frameHashes).size < 2) throw new Error('reference motion is a copied frame');
  if (new Set(witness.roles.predicted.frameHashes).size < 2) throw new Error('predicted motion is a copied frame');
  const debug = witness.partialFlowDebug;
  if (debug?.authority !== 'display-only-support-flow-debug-mix-v0') throw new Error('partial flow debug must be display-only');
  if (Number(debug.requestedGain) !== 0.625 || Number(debug.effectiveGain) !== 0.625) {
    throw new Error('partial flow debug gain mismatch');
  }
  if (debug.roles?.join(',') !== 'reference,control,predicted') throw new Error('partial flow debug roles are incomplete');
  if (Number(debug.frameCount) !== frameCount || Number(debug.effectiveFps) !== effectiveFps) {
    throw new Error('partial flow debug cadence mismatch');
  }
  return true;
}
