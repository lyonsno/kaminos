import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from './muscle-compartment-ring-cage-core.mjs';
import {
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  hashMusclePackingCanonicalJson,
} from './muscle-compartment-packing-core.mjs';

export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-contact-measurement.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-contact-result.v0';

const EPSILON = 1e-10;

function add(left, right) {
  return left.map((value, axis) => value + right[axis]);
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(vector) {
  return Math.hypot(...vector);
}

function distance(left, right) {
  return length(subtract(left, right));
}

function requirePoint(point, label) {
  if (!Array.isArray(point) || point.length !== 3 ||
      !point.every(Number.isFinite)) {
    throw new Error(`${label} must be a finite 3D point`);
  }
}

function signedTetrahedronVolume(points) {
  const [a, b, c, d] = points;
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function tetrahedronContainsPoint(point, tetrahedron) {
  const [a, b, c, d] = tetrahedron;
  const ba = subtract(b, a);
  const ca = subtract(c, a);
  const da = subtract(d, a);
  const pa = subtract(point, a);
  const determinant = dot(ba, cross(ca, da));
  if (Math.abs(determinant) <= EPSILON) return false;
  const barycentric = [
    dot(pa, cross(ca, da)) / determinant,
    dot(ba, cross(pa, da)) / determinant,
    dot(ba, cross(ca, pa)) / determinant,
  ];
  barycentric.push(1 - barycentric.reduce((sum, value) => sum + value, 0));
  return barycentric.every(value => value >= -EPSILON && value <= 1 + EPSILON);
}

function closestPointOnTriangle(point, triangle) {
  const [a, b, c] = triangle;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ap = subtract(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = subtract(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const amount = d1 / (d1 - d3);
    return add(a, scale(ab, amount));
  }

  const cp = subtract(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const amount = d2 / (d2 - d6);
    return add(a, scale(ac, amount));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const amount = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return add(b, scale(subtract(c, b), amount));
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return add(a, add(scale(ab, v), scale(ac, w)));
}

function closestPointOnSegment(point, start, end) {
  const span = subtract(end, start);
  const denominator = dot(span, span);
  const amount = denominator <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, dot(subtract(point, start), span) / denominator));
  return add(start, scale(span, amount));
}

function faceKey(nodeIds) {
  return [...nodeIds].sort().join('|');
}

function edgeKey(left, right) {
  return [left, right].sort().join('|');
}

function cellFaces(nodeIds) {
  return [
    [nodeIds[0], nodeIds[2], nodeIds[1]],
    [nodeIds[0], nodeIds[1], nodeIds[3]],
    [nodeIds[0], nodeIds[3], nodeIds[2]],
    [nodeIds[1], nodeIds[2], nodeIds[3]],
  ];
}

export function extractMuscleCompartmentRingCageBoundary(manifest) {
  if (!manifest || !Array.isArray(manifest.nodes) || !Array.isArray(manifest.cells)) {
    throw new Error('ring cage boundary extraction requires nodes and tetrahedral cells');
  }
  const nodeIds = new Set(manifest.nodes.map(node => node.id));
  if (nodeIds.size !== manifest.nodes.length) throw new Error('ring cage nodes must be unique');
  const faceIncidence = new Map();
  for (const cell of manifest.cells) {
    if (cell?.kind !== undefined && cell.kind !== 'tetrahedron') {
      throw new Error(`ring cage cell ${cell.id || '<unknown>'} must be tetrahedral`);
    }
    if (!Array.isArray(cell.nodeIds) || cell.nodeIds.length !== 4 ||
        new Set(cell.nodeIds).size !== 4 ||
        cell.nodeIds.some(nodeId => !nodeIds.has(nodeId))) {
      throw new Error(`ring cage cell ${cell.id || '<unknown>'} has invalid node incidence`);
    }
    for (const face of cellFaces(cell.nodeIds)) {
      const key = faceKey(face);
      const row = faceIncidence.get(key) || { key, count: 0, nodeIds: face };
      row.count += 1;
      faceIncidence.set(key, row);
    }
  }
  const nonManifoldFaceCount = [...faceIncidence.values()].filter(
    row => row.count > 2,
  ).length;
  const faces = [...faceIncidence.values()]
    .filter(row => row.count === 1)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(row => ({ key: row.key, nodeIds: [...row.nodeIds] }));
  const boundaryNodeIds = [...new Set(faces.flatMap(face => face.nodeIds))].sort();
  const boundaryNodeIdSet = new Set(boundaryNodeIds);
  const interiorNodeIds = [...nodeIds].filter(nodeId => !boundaryNodeIdSet.has(nodeId)).sort();
  const maskByNodeId = new Map(
    (manifest.constraints?.boundaryMasks || []).map(mask => [mask.nodeId, mask]),
  );
  const fixedBoundaryNodeIds = boundaryNodeIds.filter(
    nodeId => maskByNodeId.get(nodeId)?.fixed === true,
  );
  const edgeCounts = new Map();
  for (const face of faces) {
    for (let index = 0; index < 3; index += 1) {
      const key = edgeKey(face.nodeIds[index], face.nodeIds[(index + 1) % 3]);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }
  const openBoundaryEdgeCount = [...edgeCounts.values()].filter(count => count !== 2).length;
  return {
    faceCount: faces.length,
    faces,
    boundaryNodeIds,
    interiorNodeIds,
    fixedBoundaryNodeIds,
    nonManifoldFaceCount,
    openBoundaryEdgeCount,
    closed: nonManifoldFaceCount === 0 && openBoundaryEdgeCount === 0,
  };
}

function prepareCage(cage) {
  const manifest = cage.manifest;
  const nodeById = new Map();
  for (const node of manifest.nodes || []) {
    requirePoint(node.currentPosition, `${node.id} currentPosition`);
    requirePoint(node.restPosition, `${node.id} restPosition`);
    nodeById.set(node.id, node);
  }
  const boundary = extractMuscleCompartmentRingCageBoundary(manifest);
  const fixedNodeIds = new Set(
    (manifest.constraints?.boundaryMasks || [])
      .filter(mask => mask.fixed === true)
      .map(mask => mask.nodeId),
  );
  const cellGeometry = manifest.cells.map(cell => {
    const points = cell.nodeIds.map(nodeId => nodeById.get(nodeId).currentPosition);
    const rawSignedVolume = signedTetrahedronVolume(points);
    const orientationParity = cell.restOrientationParity;
    return {
      id: cell.id,
      points,
      orientedVolume: rawSignedVolume * orientationParity,
    };
  });
  const boundaryTriangles = boundary.faces.map(face =>
    face.nodeIds.map(nodeId => nodeById.get(nodeId).currentPosition));
  return {
    cageId: cage.cageId,
    constructionId: cage.constructionId,
    manifest,
    nodeById,
    boundary,
    fixedNodeIds,
    cellGeometry,
    boundaryTriangles,
  };
}

function pointInsideCage(point, cage) {
  return cage.cellGeometry.some(cell =>
    cell.orientedVolume > EPSILON && tetrahedronContainsPoint(point, cell.points));
}

function penetrationToBoundary(point, cage) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const triangle of cage.boundaryTriangles) {
    minimum = Math.min(minimum, distance(point, closestPointOnTriangle(point, triangle)));
  }
  return minimum;
}

function emptyPenetrationMetrics() {
  return {
    penetratingBoundaryNodeCount: 0,
    fixedPenetratingBoundaryNodeCount: 0,
    maximumPenetration: 0,
    totalPenetration: 0,
    movableMaximumPenetration: 0,
    movableTotalPenetration: 0,
    fixedMaximumPenetration: 0,
    fixedTotalPenetration: 0,
  };
}

function recordPenetration(metrics, penetration, fixed) {
  if (!(penetration > EPSILON)) return;
  metrics.penetratingBoundaryNodeCount += 1;
  metrics.maximumPenetration = Math.max(metrics.maximumPenetration, penetration);
  metrics.totalPenetration += penetration;
  if (fixed) {
    metrics.fixedPenetratingBoundaryNodeCount += 1;
    metrics.fixedMaximumPenetration = Math.max(
      metrics.fixedMaximumPenetration,
      penetration,
    );
    metrics.fixedTotalPenetration += penetration;
  } else {
    metrics.movableMaximumPenetration = Math.max(
      metrics.movableMaximumPenetration,
      penetration,
    );
    metrics.movableTotalPenetration += penetration;
  }
}

function measurePairwise(cages) {
  const metrics = emptyPenetrationMetrics();
  for (let leftIndex = 0; leftIndex < cages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cages.length; rightIndex += 1) {
      for (const [subject, obstacle] of [
        [cages[leftIndex], cages[rightIndex]],
        [cages[rightIndex], cages[leftIndex]],
      ]) {
        for (const nodeId of subject.boundary.boundaryNodeIds) {
          const point = subject.nodeById.get(nodeId).currentPosition;
          if (!pointInsideCage(point, obstacle)) continue;
          recordPenetration(
            metrics,
            penetrationToBoundary(point, obstacle),
            subject.fixedNodeIds.has(nodeId),
          );
        }
      }
    }
  }
  return metrics;
}

function measureSkeletal(cages, source) {
  const metrics = {
    ...emptyPenetrationMetrics(),
    penetratingAxisSampleCount: 0,
    axisSampleCount: 0,
  };
  for (const cage of cages) {
    for (const nodeId of cage.boundary.boundaryNodeIds) {
      const point = cage.nodeById.get(nodeId).currentPosition;
      for (const obstacle of source.obstacles || []) {
        if (obstacle.kind !== 'capsule') {
          throw new Error(`unsupported skeletal obstacle kind ${obstacle.kind}`);
        }
        const closest = closestPointOnSegment(point, obstacle.start, obstacle.end);
        const required = obstacle.radius + (obstacle.clearance || 0);
        recordPenetration(
          metrics,
          required - distance(point, closest),
          cage.fixedNodeIds.has(nodeId),
        );
      }
    }
    for (const obstacle of source.obstacles || []) {
      if (obstacle.kind !== 'capsule') continue;
      const required = obstacle.radius + (obstacle.clearance || 0);
      const sampleCount = 33;
      for (let index = 0; index < sampleCount; index += 1) {
        const amount = index / (sampleCount - 1);
        const point = add(
          obstacle.start,
          scale(subtract(obstacle.end, obstacle.start), amount),
        );
        const surfaceDistance = penetrationToBoundary(point, cage);
        const penetration = pointInsideCage(point, cage)
          ? required + surfaceDistance
          : required - surfaceDistance;
        metrics.axisSampleCount += 1;
        if (!(penetration > EPSILON)) continue;
        metrics.penetratingAxisSampleCount += 1;
        recordPenetration(metrics, penetration, false);
      }
    }
  }
  return metrics;
}

function measureCompartment(cages, source) {
  if (source.compartment?.kind !== 'box') {
    throw new Error('ring cage contact measurement requires a box compartment');
  }
  const clearance = source.compartment.clearance || 0;
  const minimum = source.compartment.minimum.map(value => value + clearance);
  const maximum = source.compartment.maximum.map(value => value - clearance);
  let escapingBoundaryNodeCount = 0;
  let fixedEscapingBoundaryNodeCount = 0;
  let maximumEscape = 0;
  for (const cage of cages) {
    for (const nodeId of cage.boundary.boundaryNodeIds) {
      const point = cage.nodeById.get(nodeId).currentPosition;
      const escape = Math.max(0, ...point.flatMap((value, axis) => [
        minimum[axis] - value,
        value - maximum[axis],
      ]));
      if (!(escape > EPSILON)) continue;
      escapingBoundaryNodeCount += 1;
      if (cage.fixedNodeIds.has(nodeId)) fixedEscapingBoundaryNodeCount += 1;
      maximumEscape = Math.max(maximumEscape, escape);
    }
  }
  return {
    escapingBoundaryNodeCount,
    fixedEscapingBoundaryNodeCount,
    maximumEscape,
  };
}

function validateInputs(solverCarrier, source) {
  if (!solverCarrier || solverCarrier.schema !==
      'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('ring cage contact requires the admitted solver carrier schema');
  }
  const { identity: _recordedIdentity, ...carrierIdentityDomain } = solverCarrier;
  const actualCarrierSha256 = hashMuscleCompartmentRingCageCanonicalJson(
    carrierIdentityDomain,
  );
  if (solverCarrier.identity?.sha256 !== actualCarrierSha256) {
    throw new Error(
      `solver carrier identity mismatch: recorded ${solverCarrier.identity?.sha256 || 'missing'}, ` +
      `actual ${actualCarrierSha256}`,
    );
  }
  if (!source || source.schema !== MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA) {
    throw new Error('ring cage contact requires the muscle packing source schema');
  }
  const { input, ...sourceIdentityDomain } = source;
  const actualSourceSha256 = hashMusclePackingCanonicalJson(sourceIdentityDomain);
  if (
    input?.requested?.kind !== 'synthetic-fixture' ||
    input?.effective?.kind !== 'synthetic-fixture' ||
    input.requested.id !== input.effective.id ||
    input.requested.sha256 !== input.effective.sha256 ||
    input.effective.id !== source.id ||
    input.effective.sha256 !== actualSourceSha256
  ) {
    throw new Error(
      `ring cage contact source input identity mismatch: recorded ` +
      `${input?.effective?.sha256 || 'missing'}, actual ${actualSourceSha256}`,
    );
  }
  const sourceOrder = source.muscles.map(muscle => muscle.identity?.constructionId);
  if (JSON.stringify(sourceOrder) !== JSON.stringify(solverCarrier.orderedConstructionIds)) {
    throw new Error('solver carrier and source construction order mismatch');
  }
  for (const [index, cage] of solverCarrier.cages.entries()) {
    if (JSON.stringify(cage.sourceIdentity) !== JSON.stringify(source.muscles[index].identity)) {
      throw new Error(
        `solver carrier and source muscle identity mismatch at ${cage.constructionId}`,
      );
    }
  }
}

export function measureMuscleCompartmentRingCageContactState(solverCarrier, source) {
  validateInputs(solverCarrier, source);
  const cages = solverCarrier.cages.map(prepareCage);
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA,
    sourceCarrierSha256: solverCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    orderedConstructionIds: [...solverCarrier.orderedConstructionIds],
    cages: cages.map(cage => {
      const referenceVolume = cage.manifest.cells.reduce(
        (sum, cell) => sum + cell.restRawSignedVolume * cell.restOrientationParity,
        0,
      );
      const currentVolume = cage.cellGeometry.reduce(
        (sum, cell) => sum + Math.max(0, cell.orientedVolume),
        0,
      );
      return {
        cageId: cage.cageId,
        constructionId: cage.constructionId,
        boundaryFaceCount: cage.boundary.faceCount,
        boundaryNodeCount: cage.boundary.boundaryNodeIds.length,
        fixedBoundaryNodeCount: cage.boundary.fixedBoundaryNodeIds.length,
        referenceVolume,
        currentVolume,
        relativeVolumeError: Math.abs(currentVolume - referenceVolume) / referenceVolume,
        nonPositiveCellCount: cage.cellGeometry.filter(
          cell => !(cell.orientedVolume > EPSILON),
        ).length,
      };
    }),
    pairwise: measurePairwise(cages),
    skeletal: measureSkeletal(cages, source),
    compartment: measureCompartment(cages, source),
  };
}

function sectionIdForNode(nodeId) {
  const match = /^(.*:section:\d{4}):(?:axis|vertex:\d+)$/.exec(nodeId);
  if (!match) throw new Error(`ring cage node ${nodeId} has no stable section identity`);
  return match[1];
}

function sectionRows(cage) {
  const rows = new Map();
  for (const node of cage.manifest.nodes) {
    const sectionId = sectionIdForNode(node.id);
    const row = rows.get(sectionId) || {
      sectionId,
      nodeIds: [],
      axisNodeId: null,
      fixed: false,
    };
    row.nodeIds.push(node.id);
    if (node.id.endsWith(':axis')) row.axisNodeId = node.id;
    if (cage.fixedNodeIds.has(node.id)) row.fixed = true;
    rows.set(sectionId, row);
  }
  for (const row of rows.values()) {
    row.nodeIds.sort();
    if (!row.axisNodeId) throw new Error(`ring cage section ${row.sectionId} lacks axis node`);
  }
  return rows;
}

function closestBoundaryPoint(point, cage) {
  let closest = null;
  let minimum = Number.POSITIVE_INFINITY;
  for (const triangle of cage.boundaryTriangles) {
    const candidate = closestPointOnTriangle(point, triangle);
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < minimum) {
      minimum = candidateDistance;
      closest = candidate;
    }
  }
  return { point: closest, distance: minimum };
}

function normalizedOrFallback(vector, seed) {
  const magnitude = length(vector);
  if (magnitude > EPSILON) return scale(vector, 1 / magnitude);
  const angle = (seed + 1) * 2.399963229728653;
  const fallback = [Math.cos(angle), Math.sin(angle * 0.5), Math.sin(angle)];
  return scale(fallback, 1 / length(fallback));
}

function addSectionCorrection(accumulator, sectionId, correction, weight = 1) {
  if (!(weight > 0) || length(correction) <= EPSILON) return;
  const row = accumulator.get(sectionId) || { sum: [0, 0, 0], weight: 0 };
  row.sum = add(row.sum, scale(correction, weight));
  row.weight += weight;
  accumulator.set(sectionId, row);
}

function pairwiseSectionCorrections(cages, accumulators) {
  for (let leftIndex = 0; leftIndex < cages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cages.length; rightIndex += 1) {
      for (const [subjectIndex, obstacleIndex] of [
        [leftIndex, rightIndex],
        [rightIndex, leftIndex],
      ]) {
        const subject = cages[subjectIndex];
        const obstacle = cages[obstacleIndex];
        const subjectSections = sectionRows(subject);
        for (const nodeId of subject.boundary.boundaryNodeIds) {
          const sectionId = sectionIdForNode(nodeId);
          if (subjectSections.get(sectionId).fixed) continue;
          const point = subject.nodeById.get(nodeId).currentPosition;
          if (!pointInsideCage(point, obstacle)) continue;
          const closest = closestBoundaryPoint(point, obstacle);
          const direction = normalizedOrFallback(
            subtract(closest.point, point),
            subjectIndex * 1009 + obstacleIndex * 9176 +
              subject.boundary.boundaryNodeIds.indexOf(nodeId),
          );
          addSectionCorrection(
            accumulators[subjectIndex],
            sectionId,
            scale(direction, closest.distance + 1e-5),
          );
        }
      }
    }
  }
}

function skeletalSectionCorrections(cages, source, accumulators) {
  for (const [cageIndex, cage] of cages.entries()) {
    for (const row of sectionRows(cage).values()) {
      if (row.fixed) continue;
      const axis = cage.nodeById.get(row.axisNodeId).currentPosition;
      const ringNodeIds = row.nodeIds.filter(nodeId => nodeId !== row.axisNodeId);
      const ringRadius = ringNodeIds.reduce(
        (sum, nodeId) => sum + distance(
          cage.nodeById.get(nodeId).currentPosition,
          axis,
        ),
        0,
      ) / ringNodeIds.length;
      for (const [obstacleIndex, obstacle] of (source.obstacles || []).entries()) {
        if (obstacle.kind !== 'capsule') continue;
        const closest = closestPointOnSegment(axis, obstacle.start, obstacle.end);
        const offset = subtract(axis, closest);
        const required = ringRadius + obstacle.radius + (obstacle.clearance || 0);
        const penetration = required - length(offset);
        if (!(penetration > EPSILON)) continue;
        addSectionCorrection(
          accumulators[cageIndex],
          row.sectionId,
          scale(
            normalizedOrFallback(offset, cageIndex * 101 + obstacleIndex),
            penetration,
          ),
          2,
        );
      }
    }
  }
}

function compartmentSectionCorrections(cages, source, accumulators) {
  const clearance = source.compartment.clearance || 0;
  const minimum = source.compartment.minimum.map(value => value + clearance);
  const maximum = source.compartment.maximum.map(value => value - clearance);
  for (const [cageIndex, cage] of cages.entries()) {
    for (const row of sectionRows(cage).values()) {
      if (row.fixed) continue;
      for (const nodeId of row.nodeIds) {
        const point = cage.nodeById.get(nodeId).currentPosition;
        const correction = point.map((value, axis) =>
          value < minimum[axis]
            ? minimum[axis] - value
            : value > maximum[axis] ? maximum[axis] - value : 0);
        addSectionCorrection(
          accumulators[cageIndex],
          row.sectionId,
          correction,
          4,
        );
      }
    }
  }
}

function sectionContactDeltas(cages, source, smoothness) {
  const accumulators = cages.map(() => new Map());
  pairwiseSectionCorrections(cages, accumulators);
  skeletalSectionCorrections(cages, source, accumulators);
  compartmentSectionCorrections(cages, source, accumulators);
  return cages.map((cage, cageIndex) => {
    const sections = sectionRows(cage);
    const ordered = [...sections.keys()].sort();
    const raw = new Map(ordered.map(sectionId => {
      const accumulated = accumulators[cageIndex].get(sectionId);
      return [sectionId, !accumulated || sections.get(sectionId).fixed
        ? [0, 0, 0]
        : scale(accumulated.sum, 1 / accumulated.weight)];
    }));
    return new Map(ordered.map((sectionId, index) => {
      if (sections.get(sectionId).fixed) return [sectionId, [0, 0, 0]];
      const own = raw.get(sectionId);
      const prior = raw.get(ordered[Math.max(0, index - 1)]);
      const next = raw.get(ordered[Math.min(ordered.length - 1, index + 1)]);
      return [sectionId, add(
        scale(own, 1 - smoothness),
        scale(add(prior, next), smoothness * 0.5),
      )];
    }));
  });
}

function applySectionDeltas(carrier, deltas, amount) {
  for (const [cageIndex, cage] of carrier.cages.entries()) {
    for (const node of cage.manifest.nodes) {
      const delta = deltas[cageIndex].get(sectionIdForNode(node.id));
      node.currentPosition = add(node.currentPosition, scale(delta, amount));
    }
  }
}

function reidentifySolverCarrier(carrier) {
  const { identity: _priorIdentity, ...identityDomain } = carrier;
  carrier.identity = {
    domain: 'canonical-json-self-excluding-top-level-identity',
    sha256: hashMuscleCompartmentRingCageCanonicalJson(identityDomain),
  };
}

function fixedNodeReference(carrier) {
  const reference = new Map();
  for (const cage of carrier.cages) {
    const fixedIds = new Set(
      cage.manifest.constraints.boundaryMasks
        .filter(mask => mask.fixed)
        .map(mask => mask.nodeId),
    );
    for (const node of cage.manifest.nodes) {
      if (fixedIds.has(node.id)) reference.set(node.id, [...node.currentPosition]);
    }
  }
  return reference;
}

function measureFixedNodeMaximumDrift(carrier, reference) {
  let maximum = 0;
  for (const cage of carrier.cages) {
    for (const node of cage.manifest.nodes) {
      const prior = reference.get(node.id);
      if (prior) maximum = Math.max(maximum, distance(node.currentPosition, prior));
    }
  }
  return maximum;
}

export function solveMuscleCompartmentRingCageContact(
  solverCarrier,
  source,
  requestedConfig = {},
) {
  validateInputs(solverCarrier, source);
  const configKeys = [
    'convergenceTolerance',
    'maxIterations',
    'maximumRelativeVolumeError',
    'relaxationStep',
    'smoothness',
  ];
  if (!requestedConfig || typeof requestedConfig !== 'object' ||
      Array.isArray(requestedConfig) ||
      JSON.stringify(Object.keys(requestedConfig).sort()) !== JSON.stringify(configKeys)) {
    throw new Error(`ring cage contact config requires exactly ${configKeys.join(', ')}`);
  }
  if (!Number.isInteger(requestedConfig.maxIterations) || requestedConfig.maxIterations <= 0 ||
      !Number.isFinite(requestedConfig.relaxationStep) ||
      !(requestedConfig.relaxationStep > 0 && requestedConfig.relaxationStep <= 1) ||
      !Number.isFinite(requestedConfig.smoothness) ||
      !(requestedConfig.smoothness >= 0 && requestedConfig.smoothness <= 1) ||
      !Number.isFinite(requestedConfig.convergenceTolerance) ||
      !(requestedConfig.convergenceTolerance > 0) ||
      !Number.isFinite(requestedConfig.maximumRelativeVolumeError) ||
      !(requestedConfig.maximumRelativeVolumeError > 0)) {
    throw new Error('ring cage contact config contains an invalid numeric value');
  }
  const config = structuredClone(requestedConfig);
  const packedCarrier = structuredClone(solverCarrier);
  const initial = measureMuscleCompartmentRingCageContactState(packedCarrier, source);
  const fixedReference = fixedNodeReference(packedCarrier);
  const iterationHistory = [];
  let packed = initial;
  let iterations = 0;
  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const prepared = packedCarrier.cages.map(prepareCage);
    const deltas = sectionContactDeltas(prepared, source, config.smoothness);
    const maximumRequestedDelta = Math.max(
      0,
      ...deltas.flatMap(rows => [...rows.values()].map(row => length(row))),
    );
    if (maximumRequestedDelta <= config.convergenceTolerance) break;
    let lineSearchScale = config.relaxationStep;
    let acceptedCarrier = null;
    let acceptedMeasurement = null;
    while (lineSearchScale >= 1 / 1024) {
      const candidate = structuredClone(packedCarrier);
      applySectionDeltas(candidate, deltas, lineSearchScale);
      reidentifySolverCarrier(candidate);
      const measurement = measureMuscleCompartmentRingCageContactState(candidate, source);
      const maximumVolumeError = Math.max(
        ...measurement.cages.map(cage => cage.relativeVolumeError),
      );
      if (measurement.cages.every(cage => cage.nonPositiveCellCount === 0) &&
          maximumVolumeError <= config.maximumRelativeVolumeError &&
          measurement.compartment.maximumEscape <= config.convergenceTolerance) {
        acceptedCarrier = candidate;
        acceptedMeasurement = measurement;
        break;
      }
      lineSearchScale *= 0.5;
    }
    if (!acceptedCarrier) break;
    packedCarrier.identity = acceptedCarrier.identity;
    packedCarrier.cages = acceptedCarrier.cages;
    packed = acceptedMeasurement;
    iterations = iteration;
    iterationHistory.push({
      iteration,
      lineSearchScale,
      maximumRequestedDelta,
      pairwiseMovableTotalPenetration: packed.pairwise.movableTotalPenetration,
      skeletalMovableTotalPenetration: packed.skeletal.movableTotalPenetration,
      maximumRelativeVolumeError: Math.max(
        ...packed.cages.map(cage => cage.relativeVolumeError),
      ),
    });
    if (packed.pairwise.movableMaximumPenetration <= config.convergenceTolerance &&
        packed.skeletal.movableMaximumPenetration <= config.convergenceTolerance &&
        packed.compartment.maximumEscape <= config.convergenceTolerance) {
      break;
    }
  }
  const fixedNodeMaximumDrift = measureFixedNodeMaximumDrift(
    packedCarrier,
    fixedReference,
  );
  const converged =
    packed.pairwise.movableMaximumPenetration <= config.convergenceTolerance &&
    packed.skeletal.movableMaximumPenetration <= config.convergenceTolerance &&
    packed.compartment.maximumEscape <= config.convergenceTolerance;
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA,
    status: converged ? 'completed' : 'residual-constraint',
    sourceCarrierSha256: solverCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    config: {
      requested: structuredClone(config),
      effective: structuredClone(config),
      fallbackUsed: false,
    },
    iterations,
    fixedNodeMaximumDrift,
    metrics: { initial, packed },
    iterationHistory,
    packedCarrier,
  };
}
