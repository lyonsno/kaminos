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
