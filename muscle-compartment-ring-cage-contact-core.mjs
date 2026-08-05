import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from './muscle-compartment-ring-cage-core.mjs';
import {
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  hashMusclePackingCanonicalJson,
} from './muscle-compartment-packing-core.mjs';

export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-contact-measurement.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESIDUAL_LEDGER_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-contact-residual-ledger.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-contact-result.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_SECTION_ANISOTROPY_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-section-anisotropy.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_PRESSURE_ANISOTROPY_SELECTION_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-pressure-anisotropy-selection.v0';

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

function pairwiseResidualContacts(cages) {
  const contacts = [];
  for (let leftIndex = 0; leftIndex < cages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cages.length; rightIndex += 1) {
      for (const [subject, obstacle] of [
        [cages[leftIndex], cages[rightIndex]],
        [cages[rightIndex], cages[leftIndex]],
      ]) {
        for (const nodeId of subject.boundary.boundaryNodeIds) {
          const point = subject.nodeById.get(nodeId).currentPosition;
          if (!pointInsideCage(point, obstacle)) continue;
          const closest = closestBoundaryPoint(point, obstacle);
          contacts.push({
            kind: 'pairwise-boundary-inside-cage',
            subjectCageId: subject.cageId,
            subjectConstructionId: subject.constructionId,
            obstacleCageId: obstacle.cageId,
            obstacleConstructionId: obstacle.constructionId,
            nodeId,
            sectionId: sectionIdForNode(nodeId),
            fixed: subject.fixedNodeIds.has(nodeId),
            point: [...point],
            closestObstacleBoundaryPoint: [...closest.point],
            penetration: closest.distance,
          });
        }
      }
    }
  }
  return contacts;
}

function skeletalResidualContacts(cages, source) {
  const contacts = [];
  let axisSampleCount = 0;
  for (const cage of cages) {
    for (const nodeId of cage.boundary.boundaryNodeIds) {
      const point = cage.nodeById.get(nodeId).currentPosition;
      for (const obstacle of source.obstacles || []) {
        if (obstacle.kind !== 'capsule') {
          throw new Error(`unsupported skeletal obstacle kind ${obstacle.kind}`);
        }
        const closest = closestPointOnSegment(point, obstacle.start, obstacle.end);
        const required = obstacle.radius + (obstacle.clearance || 0);
        const penetration = required - distance(point, closest);
        if (!(penetration > EPSILON)) continue;
        contacts.push({
          kind: 'cage-boundary-inside-capsule-clearance',
          subjectCageId: cage.cageId,
          subjectConstructionId: cage.constructionId,
          nodeId,
          sectionId: sectionIdForNode(nodeId),
          fixed: cage.fixedNodeIds.has(nodeId),
          obstacleId: obstacle.id,
          point: [...point],
          closestObstacleAxisPoint: [...closest],
          penetration,
        });
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
        const closest = closestBoundaryPoint(point, cage);
        const penetration = pointInsideCage(point, cage)
          ? required + closest.distance
          : required - closest.distance;
        axisSampleCount += 1;
        if (!(penetration > EPSILON)) continue;
        contacts.push({
          kind: 'capsule-axis-inside-cage-clearance',
          subjectCageId: cage.cageId,
          subjectConstructionId: cage.constructionId,
          nodeId: null,
          sectionId: null,
          fixed: false,
          obstacleId: obstacle.id,
          axisSampleIndex: index,
          axisSampleAmount: amount,
          point: [...point],
          closestCageBoundaryPoint: [...closest.point],
          penetration,
        });
      }
    }
  }
  return { contacts, axisSampleCount };
}

function summarizeResidualContacts(contacts, extra = {}) {
  const metrics = { ...emptyPenetrationMetrics(), ...extra };
  for (const contact of contacts) {
    recordPenetration(metrics, contact.penetration, contact.fixed);
  }
  return { ...metrics, contacts };
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
        centerline: measureCenterlineShape(cage),
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

export function measureMuscleCompartmentRingCageContactResidualLedger(
  solverCarrier,
  source,
) {
  validateInputs(solverCarrier, source);
  const cages = solverCarrier.cages.map(prepareCage);
  const pairwiseContacts = pairwiseResidualContacts(cages);
  const skeletal = skeletalResidualContacts(cages, source);
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESIDUAL_LEDGER_SCHEMA,
    sourceCarrierSha256: solverCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    orderedConstructionIds: [...solverCarrier.orderedConstructionIds],
    pairwise: summarizeResidualContacts(pairwiseContacts),
    skeletal: summarizeResidualContacts(skeletal.contacts, {
      penetratingAxisSampleCount: skeletal.contacts.filter(
        contact => contact.kind === 'capsule-axis-inside-cage-clearance',
      ).length,
      axisSampleCount: skeletal.axisSampleCount,
    }),
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

function measureCenterlineShape(cage) {
  const rows = [...sectionRows(cage).values()]
    .sort((left, right) => left.sectionId.localeCompare(right.sectionId));
  const axis = rows.map(row => cage.nodeById.get(row.axisNodeId).currentPosition);
  const turningAngles = [];
  for (let index = 1; index < axis.length - 1; index += 1) {
    const incoming = subtract(axis[index], axis[index - 1]);
    const outgoing = subtract(axis[index + 1], axis[index]);
    const incomingLength = length(incoming);
    const outgoingLength = length(outgoing);
    if (!(incomingLength > EPSILON) || !(outgoingLength > EPSILON)) {
      throw new Error(`ring cage ${cage.cageId} has a collapsed centerline segment`);
    }
    const cosine = dot(incoming, outgoing) / (incomingLength * outgoingLength);
    turningAngles.push(Math.acos(Math.max(-1, Math.min(1, cosine))));
  }
  return {
    turningAngles,
    maximumTurningAngle: Math.max(0, ...turningAngles),
    totalTurningAngle: turningAngles.reduce((sum, value) => sum + value, 0),
    bendingEnergy: turningAngles.reduce((sum, value) => sum + value * value, 0),
  };
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

function solveLinearSystem(matrix, rightHandSide) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (!(Math.abs(augmented[pivot][column]) > EPSILON)) {
      throw new Error('ring cage curvature system is singular');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const pivotValue = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) <= EPSILON) continue;
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map(row => row[size]);
}

function curvatureRegularizedSectionDeltas(sections, ordered, raw, regularization) {
  const size = ordered.length;
  const matrix = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
  for (let index = 1; index < size - 1; index += 1) {
    const indices = [index - 1, index, index + 1];
    const coefficients = [1, -2, 1];
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = 0; right < indices.length; right += 1) {
        matrix[indices[left]][indices[right]] +=
          regularization * coefficients[left] * coefficients[right];
      }
    }
  }
  const fixedIndices = new Set(ordered
    .map((sectionId, index) => sections.get(sectionId).fixed ? index : -1)
    .filter(index => index >= 0));
  for (const fixedIndex of fixedIndices) {
    for (let index = 0; index < size; index += 1) {
      matrix[fixedIndex][index] = 0;
      matrix[index][fixedIndex] = 0;
    }
    matrix[fixedIndex][fixedIndex] = 1;
  }
  const coordinates = [0, 1, 2].map(coordinate => {
    const rightHandSide = ordered.map((sectionId, index) =>
      fixedIndices.has(index) ? 0 : raw.get(sectionId)[coordinate]);
    return solveLinearSystem(matrix, rightHandSide);
  });
  return new Map(ordered.map((sectionId, index) => [
    sectionId,
    coordinates.map(values => values[index]),
  ]));
}

function sectionContactDeltas(cages, source, curvatureRegularization) {
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
    return curvatureRegularizedSectionDeltas(
      sections,
      ordered,
      raw,
      curvatureRegularization,
    );
  });
}

function measureCenterlineShapeChanges(measurement, reference) {
  let maximumLocalTurningAngleChange = 0;
  let maximumTotalTurningAngleChange = 0;
  for (const [cageIndex, cage] of measurement.cages.entries()) {
    const referenceAngles = reference.cages[cageIndex].centerline.turningAngles;
    const candidateAngles = cage.centerline.turningAngles;
    const changes = candidateAngles.map((angle, index) =>
      Math.abs(angle - referenceAngles[index]));
    maximumLocalTurningAngleChange = Math.max(
      maximumLocalTurningAngleChange,
      ...changes,
    );
    maximumTotalTurningAngleChange = Math.max(
      maximumTotalTurningAngleChange,
      changes.reduce((sum, value) => sum + value, 0),
    );
  }
  return { maximumLocalTurningAngleChange, maximumTotalTurningAngleChange };
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

function axisNodeReference(carrier) {
  return new Map(carrier.cages.flatMap(cage => cage.manifest.nodes
    .filter(node => node.id.endsWith(':axis'))
    .map(node => [node.id, [...node.currentPosition]])));
}

function measureAxisNodeMaximumDrift(carrier, reference) {
  let maximum = 0;
  for (const cage of carrier.cages) {
    for (const node of cage.manifest.nodes) {
      const prior = reference.get(node.id);
      if (prior) maximum = Math.max(maximum, distance(node.currentPosition, prior));
    }
  }
  return maximum;
}

function sectionPlaneGeometry(cage, row) {
  const axis = cage.nodeById.get(row.axisNodeId).currentPosition;
  const ringNodes = row.nodeIds
    .filter(nodeId => nodeId !== row.axisNodeId)
    .map(nodeId => cage.nodeById.get(nodeId));
  if (ringNodes.length < 3) {
    throw new Error(`ring cage section ${row.sectionId} requires at least three ring vertices`);
  }
  const offsets = ringNodes.map(node => subtract(node.currentPosition, axis));
  const doubledAreaVector = offsets.reduce((sum, offset, index) => add(
    sum,
    cross(offset, offsets[(index + 1) % offsets.length]),
  ), [0, 0, 0]);
  const doubledArea = length(doubledAreaVector);
  if (!(doubledArea > EPSILON)) {
    throw new Error(`ring cage section ${row.sectionId} has degenerate transverse area`);
  }
  return {
    axis,
    area: doubledArea / 2,
    normal: scale(doubledAreaVector, 1 / doubledArea),
    ringNodes,
  };
}

export function derivePressureAlignedRingCageSectionAnisotropy(
  solverCarrier,
  residualLedger,
  requestedConfig,
) {
  if (!solverCarrier || solverCarrier.schema !==
      'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('pressure-aligned anisotropy requires the admitted solver carrier schema');
  }
  const { identity: _recordedIdentity, ...identityDomain } = solverCarrier;
  const actualCarrierSha256 = hashMuscleCompartmentRingCageCanonicalJson(identityDomain);
  if (solverCarrier.identity?.sha256 !== actualCarrierSha256) {
    throw new Error(
      `pressure-aligned anisotropy source carrier identity mismatch: recorded ` +
      `${solverCarrier.identity?.sha256 || 'missing'}, actual ${actualCarrierSha256}`,
    );
  }
  if (!residualLedger || residualLedger.schema !==
      MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESIDUAL_LEDGER_SCHEMA) {
    throw new Error('pressure-aligned anisotropy requires the residual ledger schema');
  }
  if (residualLedger.sourceCarrierSha256 !== solverCarrier.identity.sha256) {
    throw new Error(
      `pressure-aligned anisotropy source carrier identity mismatch: ledger ` +
      `${residualLedger.sourceCarrierSha256 || 'missing'}, carrier ` +
      `${solverCarrier.identity.sha256}`,
    );
  }
  if (JSON.stringify(residualLedger.orderedConstructionIds) !==
      JSON.stringify(solverCarrier.orderedConstructionIds)) {
    throw new Error('pressure-aligned anisotropy construction order mismatch');
  }
  const configKeys = [
    'compressionScale',
    'obstacleConstructionId',
    'subjectConstructionId',
  ];
  if (!requestedConfig || typeof requestedConfig !== 'object' ||
      Array.isArray(requestedConfig) ||
      JSON.stringify(Object.keys(requestedConfig).sort()) !== JSON.stringify(configKeys)) {
    throw new Error(
      `pressure-aligned anisotropy config requires exactly ${configKeys.join(', ')}`,
    );
  }
  if (typeof requestedConfig.subjectConstructionId !== 'string' ||
      typeof requestedConfig.obstacleConstructionId !== 'string' ||
      requestedConfig.subjectConstructionId === requestedConfig.obstacleConstructionId ||
      !Number.isFinite(requestedConfig.compressionScale) ||
      !(requestedConfig.compressionScale > 0 && requestedConfig.compressionScale <= 1)) {
    throw new Error('pressure-aligned anisotropy config contains an invalid value');
  }
  const cage = solverCarrier.cages.find(
    row => row.constructionId === requestedConfig.subjectConstructionId,
  );
  if (!cage) {
    throw new Error(
      `pressure-aligned anisotropy lacks construction ` +
      `${requestedConfig.subjectConstructionId}`,
    );
  }
  const prepared = prepareCage(cage);
  const rows = sectionRows(prepared);
  const contacts = residualLedger.pairwise.contacts.filter(contact =>
    contact.fixed === false &&
    contact.subjectConstructionId === requestedConfig.subjectConstructionId &&
    contact.obstacleConstructionId === requestedConfig.obstacleConstructionId);
  if (contacts.length === 0) {
    throw new Error(
      `pressure-aligned anisotropy has no movable ` +
      `${requestedConfig.subjectConstructionId}->${requestedConfig.obstacleConstructionId} ` +
      `contacts`,
    );
  }
  const contactsBySection = new Map();
  for (const contact of contacts) {
    const row = rows.get(contact.sectionId);
    if (!row || row.fixed || !row.nodeIds.includes(contact.nodeId)) {
      throw new Error(
        `pressure-aligned anisotropy contact ${contact.nodeId || 'missing'} ` +
        `does not resolve to a movable subject section`,
      );
    }
    const sectionContacts = contactsBySection.get(contact.sectionId) || [];
    sectionContacts.push(contact);
    contactsBySection.set(contact.sectionId, sectionContacts);
  }
  const adjustments = [...contactsBySection.keys()].sort().map(sectionId => {
    const row = rows.get(sectionId);
    const geometry = sectionPlaneGeometry(prepared, row);
    const sectionContacts = contactsBySection.get(sectionId);
    const strongestContact = [...sectionContacts].sort((left, right) =>
      right.penetration - left.penetration || left.nodeId.localeCompare(right.nodeId))[0];
    const strongestOffset = subtract(
      prepared.nodeById.get(strongestContact.nodeId).currentPosition,
      geometry.axis,
    );
    const strongestTransverse = subtract(
      strongestOffset,
      scale(geometry.normal, dot(strongestOffset, geometry.normal)),
    );
    const strongestMagnitude = length(strongestTransverse);
    if (!(strongestMagnitude > EPSILON)) {
      throw new Error(
        `pressure-aligned anisotropy contact ${strongestContact.nodeId} ` +
        `has no transverse radial direction`,
      );
    }
    const basisU = scale(strongestTransverse, 1 / strongestMagnitude);
    const basisV = normalizedOrFallback(cross(geometry.normal, basisU), row.nodeIds.length);
    let doubledCosine = 0;
    let doubledSine = 0;
    for (const contact of sectionContacts) {
      const offset = subtract(
        prepared.nodeById.get(contact.nodeId).currentPosition,
        geometry.axis,
      );
      const angle = Math.atan2(dot(offset, basisV), dot(offset, basisU));
      doubledCosine += contact.penetration * Math.cos(2 * angle);
      doubledSine += contact.penetration * Math.sin(2 * angle);
    }
    const principalAngle = 0.5 * Math.atan2(doubledSine, doubledCosine);
    const pressureDirection = add(
      scale(basisU, Math.cos(principalAngle)),
      scale(basisV, Math.sin(principalAngle)),
    );
    return {
      constructionId: requestedConfig.subjectConstructionId,
      sectionId,
      pressureDirection,
      compressionScale: requestedConfig.compressionScale,
    };
  });
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_PRESSURE_ANISOTROPY_SELECTION_SCHEMA,
    status: 'completed',
    sourceCarrierSha256: solverCarrier.identity.sha256,
    residualLedgerSha256: hashMuscleCompartmentRingCageCanonicalJson(residualLedger),
    requested: structuredClone(requestedConfig),
    effective: structuredClone(requestedConfig),
    fallbackUsed: false,
    contactCount: contacts.length,
    totalPenetration: contacts.reduce((sum, contact) => sum + contact.penetration, 0),
    adjustments,
  };
}

export function applyConstantAreaRingCageSectionAnisotropy(
  solverCarrier,
  requestedAdjustments,
) {
  if (!solverCarrier || solverCarrier.schema !==
      'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('constant-area anisotropy requires the admitted solver carrier schema');
  }
  const { identity: _recordedIdentity, ...identityDomain } = solverCarrier;
  const actualCarrierSha256 = hashMuscleCompartmentRingCageCanonicalJson(identityDomain);
  if (solverCarrier.identity?.sha256 !== actualCarrierSha256) {
    throw new Error(
      `constant-area anisotropy source carrier identity mismatch: recorded ` +
      `${solverCarrier.identity?.sha256 || 'missing'}, actual ${actualCarrierSha256}`,
    );
  }
  if (!Array.isArray(requestedAdjustments) || requestedAdjustments.length === 0) {
    throw new Error('constant-area anisotropy requires at least one section adjustment');
  }
  const requested = structuredClone(requestedAdjustments);
  const outputCarrier = structuredClone(solverCarrier);
  const fixedReference = fixedNodeReference(outputCarrier);
  const axisReference = axisNodeReference(outputCarrier);
  const sectionReceipts = [];
  const seen = new Set();
  for (const adjustment of requestedAdjustments) {
    if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment) ||
        JSON.stringify(Object.keys(adjustment).sort()) !== JSON.stringify([
          'compressionScale',
          'constructionId',
          'pressureDirection',
          'sectionId',
        ])) {
      throw new Error(
        'constant-area anisotropy adjustment requires exactly constructionId, ' +
        'sectionId, pressureDirection, compressionScale',
      );
    }
    if (typeof adjustment.constructionId !== 'string' ||
        typeof adjustment.sectionId !== 'string') {
      throw new Error('constant-area anisotropy constructionId and sectionId must be strings');
    }
    requirePoint(adjustment.pressureDirection, 'constant-area anisotropy pressureDirection');
    if (!Number.isFinite(adjustment.compressionScale) ||
        !(adjustment.compressionScale > 0 && adjustment.compressionScale <= 1)) {
      throw new Error('constant-area anisotropy compressionScale must be in (0, 1]');
    }
    const adjustmentKey = `${adjustment.constructionId}|${adjustment.sectionId}`;
    if (seen.has(adjustmentKey)) {
      throw new Error(`duplicate constant-area anisotropy section ${adjustmentKey}`);
    }
    seen.add(adjustmentKey);
    const cageIndex = outputCarrier.cages.findIndex(
      cage => cage.constructionId === adjustment.constructionId,
    );
    if (cageIndex < 0) {
      throw new Error(`constant-area anisotropy lacks construction ${adjustment.constructionId}`);
    }
    const cage = prepareCage(outputCarrier.cages[cageIndex]);
    const row = sectionRows(cage).get(adjustment.sectionId);
    if (!row) {
      throw new Error(
        `constant-area anisotropy lacks section ${adjustment.sectionId} ` +
        `on ${adjustment.constructionId}`,
      );
    }
    if (row.fixed) {
      throw new Error(`constant-area anisotropy refuses fixed section ${adjustment.sectionId}`);
    }
    const before = sectionPlaneGeometry(cage, row);
    const requestedDirectionMagnitude = length(adjustment.pressureDirection);
    if (!(requestedDirectionMagnitude > EPSILON)) {
      throw new Error('constant-area anisotropy pressureDirection must be nonzero');
    }
    const normalComponent = dot(adjustment.pressureDirection, before.normal);
    const transverse = subtract(
      adjustment.pressureDirection,
      scale(before.normal, normalComponent),
    );
    const transverseMagnitude = length(transverse);
    if (!(transverseMagnitude > EPSILON)) {
      throw new Error(
        `constant-area anisotropy pressureDirection is normal to ${adjustment.sectionId}`,
      );
    }
    const compressionAxis = scale(transverse, 1 / transverseMagnitude);
    const expansionAxis = normalizedOrFallback(
      cross(before.normal, compressionAxis),
      cageIndex,
    );
    for (const node of before.ringNodes) {
      const offset = subtract(node.currentPosition, before.axis);
      const compressed = scale(
        compressionAxis,
        dot(offset, compressionAxis) * adjustment.compressionScale,
      );
      const expanded = scale(
        expansionAxis,
        dot(offset, expansionAxis) / adjustment.compressionScale,
      );
      const normal = scale(before.normal, dot(offset, before.normal));
      node.currentPosition = add(before.axis, add(compressed, add(expanded, normal)));
    }
    const afterCage = prepareCage(outputCarrier.cages[cageIndex]);
    const after = sectionPlaneGeometry(
      afterCage,
      sectionRows(afterCage).get(adjustment.sectionId),
    );
    sectionReceipts.push({
      constructionId: adjustment.constructionId,
      sectionId: adjustment.sectionId,
      requestedCompressionScale: adjustment.compressionScale,
      effectiveCompressionScale: adjustment.compressionScale,
      effectiveCompressionAxis: compressionAxis,
      effectiveExpansionAxis: expansionAxis,
      areaBefore: before.area,
      areaAfter: after.area,
      relativeAreaError: Math.abs(after.area - before.area) / before.area,
    });
  }
  reidentifySolverCarrier(outputCarrier);
  const fixedNodeMaximumDrift = measureFixedNodeMaximumDrift(
    outputCarrier,
    fixedReference,
  );
  const centerlineMaximumDrift = measureAxisNodeMaximumDrift(
    outputCarrier,
    axisReference,
  );
  if (fixedNodeMaximumDrift !== 0 || centerlineMaximumDrift !== 0) {
    throw new Error(
      'constant-area anisotropy violated fixed-node or centerline immutability',
    );
  }
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_SECTION_ANISOTROPY_SCHEMA,
    status: 'completed',
    sourceCarrierSha256: solverCarrier.identity.sha256,
    outputCarrierSha256: outputCarrier.identity.sha256,
    requested,
    effective: structuredClone(requested),
    fallbackUsed: false,
    centerlineMaximumDrift,
    fixedNodeMaximumDrift,
    sectionReceipts,
    outputCarrier,
  };
}

export function solveMuscleCompartmentRingCageContact(
  solverCarrier,
  source,
  requestedConfig = {},
) {
  validateInputs(solverCarrier, source);
  const configKeys = [
    'convergenceTolerance',
    'curvatureRegularization',
    'maxIterations',
    'maximumLocalTurningAngleChange',
    'maximumRelativeVolumeError',
    'maximumTotalTurningAngleChange',
    'relaxationStep',
  ];
  if (!requestedConfig || typeof requestedConfig !== 'object' ||
      Array.isArray(requestedConfig) ||
      JSON.stringify(Object.keys(requestedConfig).sort()) !== JSON.stringify(configKeys)) {
    throw new Error(`ring cage contact config requires exactly ${configKeys.join(', ')}`);
  }
  if (!Number.isInteger(requestedConfig.maxIterations) || requestedConfig.maxIterations <= 0 ||
      !Number.isFinite(requestedConfig.relaxationStep) ||
      !(requestedConfig.relaxationStep > 0 && requestedConfig.relaxationStep <= 1) ||
      !Number.isFinite(requestedConfig.curvatureRegularization) ||
      !(requestedConfig.curvatureRegularization > 0) ||
      !Number.isFinite(requestedConfig.maximumLocalTurningAngleChange) ||
      !(requestedConfig.maximumLocalTurningAngleChange > 0) ||
      !Number.isFinite(requestedConfig.maximumTotalTurningAngleChange) ||
      !(requestedConfig.maximumTotalTurningAngleChange > 0) ||
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
  const lineSearchHistory = [];
  let packed = initial;
  let iterations = 0;
  let termination = null;
  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const prepared = packedCarrier.cages.map(prepareCage);
    const deltas = sectionContactDeltas(
      prepared,
      source,
      config.curvatureRegularization,
    );
    const maximumRequestedDelta = Math.max(
      0,
      ...deltas.flatMap(rows => [...rows.values()].map(row => length(row))),
    );
    if (maximumRequestedDelta <= config.convergenceTolerance) {
      termination = {
        reason: 'requested-delta-within-tolerance',
        attemptedIteration: iteration,
        lineSearchAttempts: [],
      };
      break;
    }
    let lineSearchScale = config.relaxationStep;
    let acceptedCarrier = null;
    let acceptedMeasurement = null;
    const lineSearchAttempts = [];
    while (lineSearchScale >= 1 / 1024) {
      const candidate = structuredClone(packedCarrier);
      applySectionDeltas(candidate, deltas, lineSearchScale);
      reidentifySolverCarrier(candidate);
      const measurement = measureMuscleCompartmentRingCageContactState(candidate, source);
      const maximumVolumeError = Math.max(
        ...measurement.cages.map(cage => cage.relativeVolumeError),
      );
      const nonPositiveCellCount = measurement.cages.reduce(
        (sum, cage) => sum + cage.nonPositiveCellCount,
        0,
      );
      const shapeChanges = measureCenterlineShapeChanges(measurement, initial);
      const rejectionReasons = [];
      if (nonPositiveCellCount !== 0) rejectionReasons.push('non-positive-cell');
      if (maximumVolumeError > config.maximumRelativeVolumeError) {
        rejectionReasons.push('maximum-relative-volume-error');
      }
      if (shapeChanges.maximumLocalTurningAngleChange >
          config.maximumLocalTurningAngleChange) {
        rejectionReasons.push('maximum-local-turning-angle-change');
      }
      if (shapeChanges.maximumTotalTurningAngleChange >
          config.maximumTotalTurningAngleChange) {
        rejectionReasons.push('maximum-total-turning-angle-change');
      }
      if (measurement.compartment.maximumEscape > config.convergenceTolerance) {
        rejectionReasons.push('compartment-escape');
      }
      const attempt = {
        scale: lineSearchScale,
        accepted: rejectionReasons.length === 0,
        rejectionReasons,
        nonPositiveCellCount,
        maximumRelativeVolumeError: maximumVolumeError,
        maximumLocalTurningAngleChange:
          shapeChanges.maximumLocalTurningAngleChange,
        maximumTotalTurningAngleChange:
          shapeChanges.maximumTotalTurningAngleChange,
        compartmentMaximumEscape: measurement.compartment.maximumEscape,
      };
      lineSearchAttempts.push(attempt);
      if (attempt.accepted) {
        acceptedCarrier = candidate;
        acceptedMeasurement = measurement;
        break;
      }
      lineSearchScale *= 0.5;
    }
    lineSearchHistory.push({ iteration, attempts: lineSearchAttempts });
    if (!acceptedCarrier) {
      termination = {
        reason: 'line-search-exhausted',
        attemptedIteration: iteration,
        lineSearchAttempts,
      };
      break;
    }
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
      termination = {
        reason: 'converged',
        attemptedIteration: iteration,
        lineSearchAttempts,
      };
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
  termination ||= {
    reason: converged ? 'converged' : 'iteration-limit',
    attemptedIteration: null,
    lineSearchAttempts: [],
  };
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
    lineSearchHistory,
    termination,
    packedCarrier,
  };
}
