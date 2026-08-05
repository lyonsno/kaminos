import { createHash } from 'node:crypto';

import { createAnalyticalElbowCP0Input } from './analytical-elbow-positive-volume-c-p0-core.mjs';
import { trianglesIntersect } from './analytical-elbow-positive-volume-row-w-core.mjs';

export const M31_GENERATED_RELATION_TRANSFER_SCHEMA =
  'kaminos.m31-generated-relation-transfer.v0';
export const M31_GENERATED_RELATION_SOURCE_SCHEMA =
  'kaminos.m31-generated-relation-source-fixture.v0';

const ROUTE = 'm31-generated-relation-positive-volume-c-p0-transfer';
const SOURCE_SHA256 =
  'a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3';
const ROUTING_FIXTURE_SHA256 =
  'ed0b95da9cdb7560e877869ab7d1f92423f8ec343712dbf40986ed63e5b48075';
const C_P0_SHA256 =
  '4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005';
const C_P0_COMMIT = 'e5582ca92365d52a18a688a5b047d999651c64bd';
const SOURCE_FIXTURE_CONTRACT_SCHEMA = 'm31_m47_source_fixture_station_binding.v1';
const SOURCE_GRAPH_IDENTITY =
  'f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0';
const SOURCE_GRAPH_FILE_SHA256 =
  '8fe8eb8c65118102243b75c324638155a814f3c70095af5f8462326f2b4d68f6';
const COMPONENT_INSTANCE_IDS = {
  path: 'instance-4f1543af-4afe-4446-8d5d-7cd1e935ae3f',
  surface: 'instance-88a8fb11-9799-4085-a0e4-867f6490d451',
  originHandle: 'instance-172c5d64-554c-4d80-a9d7-f6309d720055',
  insertionHandle: 'instance-750005d7-28af-40e0-adbf-ca455aad50b2',
};
const TRANSFER_ANGLES = [0, 24];
const EPSILON = 1e-9;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function semanticHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function add(left, right) {
  return left.map((value, axis) => value + right[axis]);
}

function multiply(vector, scalar) {
  return vector.map(value => value * scalar);
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

function mean(points) {
  return points.reduce((sum, point) => add(sum, point), [0, 0, 0])
    .map(value => value / points.length);
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function rotateAroundAxis(point, pivot, axisInput, radians) {
  const axisLength = length(axisInput);
  if (!(axisLength > EPSILON)) throw new Error('hinge axis must have positive length');
  const axis = multiply(axisInput, 1 / axisLength);
  const vector = subtract(point, pivot);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return add(pivot, add(
    add(multiply(vector, cosine), multiply(cross(axis, vector), sine)),
    multiply(axis, dot(axis, vector) * (1 - cosine)),
  ));
}

function signedTetrahedronVolume(a, b, c, d) {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function determinant3(columns) {
  return dot(columns[0], cross(columns[1], columns[2]));
}

function tetrahedronWeights(point, points) {
  const [a, b, c, d] = points;
  const columns = [subtract(b, a), subtract(c, a), subtract(d, a)];
  const denominator = determinant3(columns);
  if (Math.abs(denominator) <= EPSILON) return null;
  const offset = subtract(point, a);
  const u = determinant3([offset, columns[1], columns[2]]) / denominator;
  const v = determinant3([columns[0], offset, columns[2]]) / denominator;
  const w = determinant3([columns[0], columns[1], offset]) / denominator;
  return [1 - u - v - w, u, v, w];
}

function failure(sourceFixture, phase, evidence, code) {
  return {
    schema: M31_GENERATED_RELATION_TRANSFER_SCHEMA,
    status: 'M31_TRANSFER_FAILED',
    requestedRoute: sourceFixture?.requestedRoute ?? ROUTE,
    effectiveRoute: sourceFixture?.effectiveRoute ?? null,
    fallbackUsed: sourceFixture?.fallbackUsed ?? null,
    failurePhase: phase,
    lastTrustworthyEvidence: evidence,
    primaryOutput: null,
    error: { code },
    claimCeiling: 'failed transfer receipt; no deformation or semantic carry-through claim',
  };
}

function validateSourceFixture(sourceFixture) {
  if (!sourceFixture || sourceFixture.schema !== M31_GENERATED_RELATION_SOURCE_SCHEMA) {
    return failure(sourceFixture, 'source-authentication',
      'source fixture schema was absent or mismatched', 'source-schema-mismatch');
  }
  if (sourceFixture.requestedRoute !== ROUTE || sourceFixture.effectiveRoute !== ROUTE ||
      sourceFixture.fallbackUsed !== false) {
    return failure(sourceFixture, 'route-validation',
      'requested/effective transfer route or fallback identity mismatched',
      'transfer-route-mismatch');
  }
  if (sourceFixture.source?.assetSha256 !== SOURCE_SHA256 ||
      sourceFixture.source?.byteLength !== 549819 ||
      sourceFixture.source?.routingFixtureSha256 !== ROUTING_FIXTURE_SHA256 ||
      sourceFixture.source?.cP0ArtifactSha256 !== C_P0_SHA256 ||
      sourceFixture.source?.fixtureContractSchema !== SOURCE_FIXTURE_CONTRACT_SCHEMA ||
      sourceFixture.source?.graphIdentity !== SOURCE_GRAPH_IDENTITY ||
      sourceFixture.source?.graphFileSha256 !== SOURCE_GRAPH_FILE_SHA256) {
    return failure(sourceFixture, 'source-authentication',
      'authenticated source, routing fixture, or C(P0) artifact identity mismatched',
      'source-identity-mismatch');
  }
  if (sourceFixture.selection?.constructionId !== 'muscle-31' ||
      sourceFixture.selection?.frozenBeforeOutput !== true ||
      sourceFixture.selection?.eligibilityStatus !== 'eligible' ||
      semanticHash(sourceFixture.selection.supportFamily) !==
        semanticHash(['Cube.002', 'Cube.003'])) {
    return failure(sourceFixture, 'selection-validation',
      'M31 was not frozen eligible on Cube.002 -> Cube.003 before output',
      'selection-not-frozen');
  }
  const identities = sourceFixture.identities ?? {};
  const expectedIdentities = {
    path: 'Muscle 31 | Path',
    surface: 'Muscle 31 | Surface',
    originHandle: 'Muscle 31 | Origin',
    insertionHandle: 'Muscle 31 | Insertion',
    fixedSupport: 'Cube.002',
    movingSupport: 'Cube.003',
  };
  if (semanticHash(identities) !== semanticHash(expectedIdentities)) {
    return failure(sourceFixture, 'selection-validation',
      'selected M31 component or support identity mismatched',
      'selected-identity-mismatch');
  }
  if (semanticHash(sourceFixture.componentInstanceIds) !== semanticHash(COMPONENT_INSTANCE_IDS) ||
      !sourceFixture.selection?.observedAt ||
      !Number.isFinite(Date.parse(sourceFixture.selection.observedAt))) {
    return failure(sourceFixture, 'selection-validation',
      'selected M31 instance identities or pre-output observation time mismatched',
      'selected-instance-identity-mismatch');
  }
  const vertices = sourceFixture.vertices;
  const triangles = sourceFixture.triangles;
  const sections = sourceFixture.sections;
  if (!Array.isArray(vertices) || !Array.isArray(triangles) ||
      !Array.isArray(sections) || vertices.length === 0 || triangles.length === 0 ||
      sections.length < 3 || !(sourceFixture.profileSideCount > 2)) {
    return failure(sourceFixture, 'source-geometry-validation',
      'ordered M31 vertices, triangles, sections, or profile count were missing',
      'source-geometry-missing');
  }
  const vertexIds = vertices.map(vertex => vertex.id);
  const triangleIds = triangles.map(triangle => triangle.id);
  if (new Set(vertexIds).size !== vertexIds.length ||
      new Set(triangleIds).size !== triangleIds.length ||
      vertices.some((vertex, index) => vertex.index !== index ||
        !Array.isArray(vertex.rest) || vertex.rest.length !== 3 ||
        vertex.rest.some(value => !Number.isFinite(value))) ||
      triangles.some((triangle, index) => triangle.index !== index ||
        triangle.vertexIndices.length !== 3 || triangle.vertexIndices.some(vertexIndex =>
          !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length))) {
    return failure(sourceFixture, 'source-geometry-validation',
      'source ids, indices, coordinates, or triangle references were invalid',
      'source-geometry-invalid');
  }
  const sectionIds = sections.flatMap(section => section.vertexIds);
  if (sectionIds.length !== vertices.length || new Set(sectionIds).size !== vertices.length ||
      sectionIds.some(id => !vertexIds.includes(id)) ||
      sections.some(section => section.vertexIds.length !== sourceFixture.profileSideCount)) {
    return failure(sourceFixture, 'source-geometry-validation',
      'source section ordering was not a total partition of M31 vertices',
      'source-section-partition-invalid');
  }
  return null;
}

function selectedSectionIndices(sectionCount) {
  const cageSectionCount = Math.min(7, sectionCount);
  const indices = [];
  for (let index = 0; index < cageSectionCount; index += 1) {
    indices.push(Math.round(index * (sectionCount - 1) / (cageSectionCount - 1)));
  }
  return [...new Set(indices)];
}

function buildCageManifest(sourceFixture) {
  const vertexById = new Map(sourceFixture.vertices.map(vertex => [vertex.id, vertex]));
  const sectionIndices = selectedSectionIndices(sourceFixture.sections.length);
  const profileSides = sourceFixture.profileSideCount;
  const sourceSectionCount = sourceFixture.sections.length;
  const rigidSourceSectionCount = Math.max(2, Math.floor(sourceSectionCount * 0.2));
  const cageSegmentForSourceSection = sourceSectionIndex => {
    if (sourceSectionIndex < rigidSourceSectionCount) return 0;
    if (sourceSectionIndex >= sourceSectionCount - rigidSourceSectionCount) {
      return sectionIndices.length - 2;
    }
    const segment = sectionIndices.findIndex((upper, index) =>
      index > 0 && sourceSectionIndex <= upper) - 1;
    return Math.max(0, Math.min(sectionIndices.length - 2, segment));
  };
  const cageAtScale = envelopeScale => {
    const nodes = [];
    const sectionNodeIds = [];
    for (let cageSection = 0; cageSection < sectionIndices.length; cageSection += 1) {
      const sourceSection = sourceFixture.sections[sectionIndices[cageSection]];
      const points = sourceSection.vertexIds.map(id => vertexById.get(id).rest);
      const center = mean(points);
      const centerId = `m31:cage:section:${cageSection}:center`;
      const boundaryIds = [];
      nodes.push({ id: centerId, rest: center, cageSection, role: 'center' });
      points.forEach((point, profileIndex) => {
        const id = `m31:cage:section:${cageSection}:boundary:${profileIndex}`;
        nodes.push({
          id,
          rest: add(center, multiply(subtract(point, center), envelopeScale)),
          cageSection,
          profileIndex,
          role: 'boundary',
        });
        boundaryIds.push(id);
      });
      sectionNodeIds.push({ centerId, boundaryIds });
    }
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const cells = [];
    for (let section = 0; section < sectionNodeIds.length - 1; section += 1) {
      for (let profile = 0; profile < profileSides; profile += 1) {
        const next = (profile + 1) % profileSides;
        const lower = sectionNodeIds[section];
        const upper = sectionNodeIds[section + 1];
        const candidates = [
          [lower.centerId, lower.boundaryIds[profile], lower.boundaryIds[next], upper.centerId],
          [lower.boundaryIds[profile], upper.boundaryIds[profile], lower.boundaryIds[next], upper.centerId],
          [lower.boundaryIds[next], upper.boundaryIds[profile], upper.boundaryIds[next], upper.centerId],
        ];
        candidates.forEach((candidate, split) => {
          const restVolume = signedTetrahedronVolume(
            ...candidate.map(id => nodeById.get(id).rest));
          if (Math.abs(restVolume) <= EPSILON) {
            throw new Error(`collapsed rest cage cell at ${section}:${profile}:${split}`);
          }
          const nodeIds = restVolume > 0
            ? candidate
            : [candidate[0], candidate[2], candidate[1], candidate[3]];
          cells.push({
            id: `m31:cage:cell:${section}:${profile}:${split}`,
            segmentIndex: section,
            nodeIds,
            restVolume: Math.abs(restVolume),
          });
        });
      }
    }
    const embedding = [];
    for (const vertex of sourceFixture.vertices) {
      let selected = null;
      let bestMinimum = -Infinity;
      const cageSegment = cageSegmentForSourceSection(vertex.sectionIndex);
      for (const cell of cells.filter(cell => cell.segmentIndex === cageSegment)) {
        const weights = tetrahedronWeights(vertex.rest,
          cell.nodeIds.map(id => nodeById.get(id).rest));
        if (!weights) continue;
        const minimum = Math.min(...weights);
        const maximum = Math.max(...weights);
        if (minimum >= -1e-7 && maximum <= 1 + 1e-7 && minimum > bestMinimum) {
          selected = { cell, weights };
          bestMinimum = minimum;
        }
      }
      if (!selected) return { nodes, cells, embedding: null, failedVertexId: vertex.id };
      const reconstruction = selected.cell.nodeIds.reduce((point, nodeId, index) =>
        add(point, multiply(nodeById.get(nodeId).rest, selected.weights[index])), [0, 0, 0]);
      embedding.push({
        surfaceVertexId: vertex.id,
        cellId: selected.cell.id,
        nodeIds: [...selected.cell.nodeIds],
        weights: selected.weights,
        restReconstructionError: distance(reconstruction, vertex.rest),
      });
    }
    return { nodes, cells, embedding, failedVertexId: null };
  };
  const containmentAttempts = [];
  let envelopeScale = 1.25;
  let geometry;
  while (Number.isFinite(envelopeScale)) {
    geometry = cageAtScale(envelopeScale);
    containmentAttempts.push({ envelopeScale, failedVertexId: geometry.failedVertexId });
    if (geometry.embedding) break;
    envelopeScale *= 1.25;
  }
  if (!geometry?.embedding) {
    throw new Error('source-covering cage envelope scale became non-finite before containment');
  }
  const { nodes, cells, embedding } = geometry;
  const sourceContainmentEnvelope = {
    initialScale: 1.25,
    growthFactor: 1.25,
    selectedScale: envelopeScale,
    attempts: containmentAttempts,
    selectionBasis: 'first neutral-source scale with a containing positive-volume cell for every source vertex',
  };
  const boundaryRoles = {
    originAttachmentCap: {
      sourceSectionIndices: Array.from({ length: rigidSourceSectionCount }, (_, index) => index),
      cageSectionIndices: [0, 1],
    },
    transitionBelly: {
      sourceSectionIndices: Array.from(
        { length: sourceSectionCount - rigidSourceSectionCount * 2 },
        (_, index) => index + rigidSourceSectionCount,
      ),
      cageSectionIndices: Array.from(
        { length: Math.max(0, sectionIndices.length - 4) }, (_, index) => index + 2),
    },
    insertionAttachmentCap: {
      sourceSectionIndices: Array.from(
        { length: rigidSourceSectionCount },
        (_, index) => sourceSectionCount - rigidSourceSectionCount + index,
      ),
      cageSectionIndices: [sectionIndices.length - 2, sectionIndices.length - 1],
    },
  };
  const targetTransforms = TRANSFER_ANGLES.map(angleDegrees => ({
    id: `m31:pose:${angleDegrees}`,
    angleDegrees,
    fixedSupport: sourceFixture.identities.fixedSupport,
    movingSupport: sourceFixture.identities.movingSupport,
    hinge: structuredClone(sourceFixture.hinge),
  }));
  const manifest = {
    schema: 'kaminos.positive-volume-cage-manifest.v0',
    id: 'm31-generated-relation-c-p0-cage-v0',
    source: structuredClone(sourceFixture.source),
    sectionIndices,
    nodes,
    cells,
    embedding,
    sourceContainmentEnvelope,
    boundaryRoles,
    targetTransforms,
  };
  manifest.semanticHashes = Object.fromEntries([
    ['nodes', nodes],
    ['cells', cells.map(({ restVolume: _restVolume, ...cell }) => cell)],
    ['embedding', embedding],
    ['sourceContainmentEnvelope', sourceContainmentEnvelope],
    ['boundaryRoles', boundaryRoles],
    ['targetTransforms', targetTransforms],
  ].map(([key, value]) => [key, semanticHash(value)]));
  manifest.semanticHash = semanticHash({ ...manifest, semanticHash: undefined });
  return manifest;
}

function edgeKey(left, right) {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function solverGeometry(manifest) {
  const nodeById = new Map(manifest.nodes.map(node => [node.id, node]));
  const edges = new Map();
  for (const cell of manifest.cells) {
    for (let left = 0; left < cell.nodeIds.length; left += 1) {
      for (let right = left + 1; right < cell.nodeIds.length; right += 1) {
        const leftId = cell.nodeIds[left];
        const rightId = cell.nodeIds[right];
        const key = edgeKey(leftId, rightId);
        if (!edges.has(key)) {
          edges.set(key, {
            leftId,
            rightId,
            restLength: distance(nodeById.get(leftId).rest, nodeById.get(rightId).rest),
          });
        }
      }
    }
  }
  return { edges: [...edges.values()], cells: manifest.cells };
}

function objectiveFor(posedNodes, geometry, config) {
  const positions = new Map(posedNodes.map(node => [node.id, node.position]));
  let edgeEnergy = 0;
  for (const edge of geometry.edges) {
    const strain = Math.log(
      distance(positions.get(edge.leftId), positions.get(edge.rightId)) / edge.restLength);
    edgeEnergy += strain * strain;
  }
  edgeEnergy /= geometry.edges.length;
  const ratios = geometry.cells.map(cell =>
    signedTetrahedronVolume(...cell.nodeIds.map(id => positions.get(id))) / cell.restVolume);
  let barrierEnergy = 0;
  for (const ratio of ratios) {
    const violation = Math.max(0, config.volumeBarrierFloor - ratio);
    barrierEnergy += violation * violation;
  }
  barrierEnergy = config.volumeBarrierWeight * barrierEnergy / ratios.length;
  return {
    total: edgeEnergy + barrierEnergy,
    edgeEnergy,
    barrierEnergy,
    minimumSignedCellVolumeRatio: Math.min(...ratios),
  };
}

function poseNode(node, manifest, sourceFixture, angleDegrees) {
  if (angleDegrees === 0) return [...node.rest];
  const originSections = manifest.boundaryRoles.originAttachmentCap.cageSectionIndices;
  const insertionSections = manifest.boundaryRoles.insertionAttachmentCap.cageSectionIndices;
  if (originSections.includes(node.cageSection)) return [...node.rest];
  const fullAngle = angleDegrees * Math.PI / 180;
  if (insertionSections.includes(node.cageSection)) {
    return rotateAroundAxis(node.rest, sourceFixture.hinge.pivotWorld,
      sourceFixture.hinge.axisWorld, fullAngle);
  }
  const transitionStart = Math.max(...originSections);
  const transitionEnd = Math.min(...insertionSections);
  const t = (node.cageSection - transitionStart) / (transitionEnd - transitionStart);
  return rotateAroundAxis(
    node.rest,
    sourceFixture.hinge.pivotWorld,
    sourceFixture.hinge.axisWorld,
    fullAngle * smoothstep(t),
  );
}

function constrainedIds(manifest) {
  const constrainedSections = new Set([
    ...manifest.boundaryRoles.originAttachmentCap.cageSectionIndices,
    ...manifest.boundaryRoles.insertionAttachmentCap.cageSectionIndices,
  ]);
  return new Set(manifest.nodes.filter(node =>
    constrainedSections.has(node.cageSection)).map(node => node.id));
}

function solvePose(manifest, sourceFixture, angleDegrees, config) {
  const geometry = solverGeometry(manifest);
  const constrained = constrainedIds(manifest);
  let posedNodes = manifest.nodes.map(node => ({
    id: node.id,
    position: poseNode(node, manifest, sourceFixture, angleDegrees),
  }));
  if (angleDegrees === 0) {
    return { posedNodes, iterationHistory: [], objective: objectiveFor(posedNodes, geometry, config) };
  }
  const freeCoordinates = [];
  manifest.nodes.forEach((node, nodeIndex) => {
    if (constrained.has(node.id)) return;
    for (let axis = 0; axis < 3; axis += 1) freeCoordinates.push([nodeIndex, axis]);
  });
  let objective = objectiveFor(posedNodes, geometry, config);
  const iterationHistory = [{ iteration: 0, ...objective, acceptedStep: 0 }];
  let step = config.initialStep;
  for (let iteration = 1; iteration <= config.budget; iteration += 1) {
    const gradient = freeCoordinates.map(([nodeIndex, axis]) => {
      const plus = structuredClone(posedNodes);
      const minus = structuredClone(posedNodes);
      plus[nodeIndex].position[axis] += config.finiteDifferenceStep;
      minus[nodeIndex].position[axis] -= config.finiteDifferenceStep;
      return (objectiveFor(plus, geometry, config).total -
        objectiveFor(minus, geometry, config).total) / (2 * config.finiteDifferenceStep);
    });
    if (!(Math.hypot(...gradient) > 1e-10)) break;
    let trialStep = step;
    let accepted = null;
    while (trialStep >= config.minimumStep) {
      const candidate = structuredClone(posedNodes);
      freeCoordinates.forEach(([nodeIndex, axis], index) => {
        candidate[nodeIndex].position[axis] -= trialStep * gradient[index];
      });
      const candidateObjective = objectiveFor(candidate, geometry, config);
      if (Number.isFinite(candidateObjective.total) && candidateObjective.total < objective.total) {
        accepted = { candidate, candidateObjective };
        break;
      }
      trialStep *= 0.5;
    }
    if (!accepted) break;
    posedNodes = accepted.candidate;
    objective = accepted.candidateObjective;
    step = Math.min(config.initialStep, trialStep * 1.25);
    iterationHistory.push({ iteration, ...objective, acceptedStep: trialStep });
  }
  return { posedNodes, iterationHistory, objective };
}

function applyEmbedding(entry, positions) {
  return entry.nodeIds.reduce((point, nodeId, index) =>
    add(point, multiply(positions.get(nodeId), entry.weights[index])), [0, 0, 0]);
}

function q95EdgeStrain(restVertices, posedVertices, triangles) {
  const edges = new Set();
  triangles.forEach(triangle => {
    for (let index = 0; index < 3; index += 1) {
      const left = triangle.vertexIndices[index];
      const right = triangle.vertexIndices[(index + 1) % 3];
      edges.add(left < right ? `${left}:${right}` : `${right}:${left}`);
    }
  });
  const strains = [...edges].map(key => {
    const [left, right] = key.split(':').map(Number);
    return Math.abs(Math.log(
      distance(posedVertices[left], posedVertices[right]) /
      distance(restVertices[left], restVertices[right])));
  }).sort((left, right) => left - right);
  return strains[Math.min(strains.length - 1, Math.floor(strains.length * 0.95))];
}

function poseDiagnostics(sourceFixture, manifest, solution, angleDegrees) {
  const positions = new Map(solution.posedNodes.map(node => [node.id, node.position]));
  const restVertices = sourceFixture.vertices.map(vertex => vertex.rest);
  const outputPositions = manifest.embedding.map(entry => applyEmbedding(entry, positions));
  const cellJacobians = manifest.cells.map(cell => ({
    cellId: cell.id,
    signedVolumeRatio: signedTetrahedronVolume(
      ...cell.nodeIds.map(id => positions.get(id))) / cell.restVolume,
  }));
  const surfaceInversions = sourceFixture.triangles.filter(triangle => {
    const [a, b, c] = triangle.vertexIndices;
    const restNormal = cross(subtract(restVertices[b], restVertices[a]),
      subtract(restVertices[c], restVertices[a]));
    const posedNormal = cross(subtract(outputPositions[b], outputPositions[a]),
      subtract(outputPositions[c], outputPositions[a]));
    return length(posedNormal) <= EPSILON || dot(restNormal, posedNormal) <= 0;
  }).map(triangle => triangle.id);
  const intersections = [];
  for (let left = 0; left < sourceFixture.triangles.length; left += 1) {
    const leftTriangle = sourceFixture.triangles[left];
    for (let right = left + 1; right < sourceFixture.triangles.length; right += 1) {
      const rightTriangle = sourceFixture.triangles[right];
      if (leftTriangle.vertexIndices.some(index => rightTriangle.vertexIndices.includes(index))) continue;
      if (trianglesIntersect(
        { points: leftTriangle.vertexIndices.map(index => outputPositions[index]) },
        { points: rightTriangle.vertexIndices.map(index => outputPositions[index]) },
      )) intersections.push([leftTriangle.id, rightTriangle.id]);
    }
  }
  const roleVertices = role => manifest.boundaryRoles[role].sourceSectionIndices
    .flatMap(sectionIndex => sourceFixture.sections[sectionIndex].vertexIds)
    .map(id => sourceFixture.vertices.find(vertex => vertex.id === id));
  const originLeakage = Math.max(...roleVertices('originAttachmentCap').map(vertex =>
    distance(vertex.rest, outputPositions[vertex.index])));
  const insertionLeakage = Math.max(...roleVertices('insertionAttachmentCap').map(vertex =>
    distance(
      rotateAroundAxis(vertex.rest, sourceFixture.hinge.pivotWorld,
        sourceFixture.hinge.axisWorld, angleDegrees * Math.PI / 180),
      outputPositions[vertex.index],
    )));
  const distortion = q95EdgeStrain(restVertices, outputPositions, sourceFixture.triangles);
  const scalarPositions = restVertices.map((point, index) => {
    const sectionIndex = sourceFixture.vertices[index].sectionIndex;
    const t = sectionIndex / (sourceFixture.sections.length - 1);
    return rotateAroundAxis(point, sourceFixture.hinge.pivotWorld,
      sourceFixture.hinge.axisWorld,
      angleDegrees * Math.PI / 180 * smoothstep(t));
  });
  const scalarDistortion = q95EdgeStrain(restVertices, scalarPositions, sourceFixture.triangles);
  const minimumJacobian = Math.min(...cellJacobians.map(cell => cell.signedVolumeRatio));
  const hardVetoes = {
    positiveCellOrientation: {
      pass: minimumJacobian > 1e-6,
      minimumSignedVolumeRatio: minimumJacobian,
    },
    surfaceInversion: { pass: surfaceInversions.length === 0, triangleIds: surfaceInversions },
    selfIntersection: { pass: intersections.length === 0, trianglePairs: intersections },
    rigidLeakage: {
      pass: originLeakage <= 1e-7 && insertionLeakage <= 1e-6,
      originMaximumDisplacement: originLeakage,
      insertionMaximumResidual: insertionLeakage,
    },
  };
  return {
    outputPositions,
    cellJacobians,
    surfaceInversions,
    selfIntersections: intersections,
    rigidLeakage: hardVetoes.rigidLeakage,
    matchedDistortion: {
      q95AbsoluteLogEdgeStrain: distortion,
      scalarControlQ95AbsoluteLogEdgeStrain: scalarDistortion,
    },
    hardVetoes,
  };
}

function memberships(sourceFixture, manifest, identityMap) {
  return Object.fromEntries(Object.entries(manifest.boundaryRoles).map(([role, record]) => {
    const sourceVertexIds = record.sourceSectionIndices
      .flatMap(sectionIndex => sourceFixture.sections[sectionIndex].vertexIds);
    const sourceVertexIdSet = new Set(sourceVertexIds);
    const sourceTriangleIds = sourceFixture.triangles
      .filter(triangle => triangle.vertexIds.every(id => sourceVertexIdSet.has(id)))
      .map(triangle => triangle.id);
    const outputBySource = new Map(identityMap.vertexMap.map(entry =>
      [entry.sourceVertexId, entry.outputVertexId]));
    const outputTriangleBySource = new Map(identityMap.triangleMap.map(entry =>
      [entry.sourceTriangleId, entry.outputTriangleId]));
    return [role, {
      sourceSectionIndices: [...record.sourceSectionIndices],
      sourceVertexIds,
      sourceTriangleIds,
      outputVertexIds: sourceVertexIds.map(id => outputBySource.get(id)),
      outputTriangleIds: sourceTriangleIds.map(id => outputTriangleBySource.get(id)),
      derivation: 'frozen-positive-volume-cage-manifest-boundary-role',
    }];
  }));
}

function producerEnvelope(sourceFixture, manifest, identityMap, semanticMemberships, poses,
  allHardVetoesPass) {
  const selectionReceipt = {
    constructionId: sourceFixture.selection.constructionId,
    eligibilityStatus: sourceFixture.selection.eligibilityStatus,
    eligibilityAuthority: sourceFixture.selection.authority,
    supportFamily: sourceFixture.selection.supportFamily,
    componentInstanceIds: sourceFixture.componentInstanceIds,
    observedAt: sourceFixture.selection.observedAt,
    frozenBeforeOutput: sourceFixture.selection.frozenBeforeOutput,
  };
  const selectionReceiptHash = semanticHash(selectionReceipt);
  const selectionObservedAtMs = Date.parse(sourceFixture.selection.observedAt);
  const transferRequestedAt = new Date(Math.max(Date.now(), selectionObservedAtMs + 1))
    .toISOString();
  const geometryRecord = pose => ({
    outputVertices: pose.outputVertices,
    outputTriangles: pose.outputTriangles,
  });
  const neutralGeometryHash = semanticHash(geometryRecord(poses[0]));
  const plus24GeometryHash = semanticHash(geometryRecord(poses[1]));
  const membershipHash = semanticHash(semanticMemberships);
  const transferIdentity = {
    schema: 'm31-generated-relation-transfer-identity.v1',
    selectionReceiptHash,
    sourceAssetSha256: sourceFixture.source.assetSha256,
    sourceGraphIdentity: sourceFixture.source.graphIdentity,
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    cageManifestHash: manifest.semanticHash,
    identityMapHash: semanticHash(identityMap),
    neutralGeometryHash,
    plus24GeometryHash,
    membershipHash,
  };
  const transferHash = semanticHash(transferIdentity);
  const outputVertexIds = [...identityMap.outputVertexIds];
  const outputTriangleIds = [...identityMap.outputTriangleIds];
  const role = name => semanticMemberships[name];
  return {
    schema: 'm31_m47_experimental_transfer_producer.v1',
    transfer_id: `m31-transfer:${transferHash}`,
    transfer_hash: transferHash,
    selection_receipt_id: `m31-selection:${selectionReceiptHash}`,
    selection_receipt_hash: selectionReceiptHash,
    selection_observed_at: sourceFixture.selection.observedAt,
    transfer_requested_at: transferRequestedAt,
    source_fixture_schema: sourceFixture.source.fixtureContractSchema,
    extracted_source_fixture_schema: sourceFixture.schema,
    source_asset_sha256: sourceFixture.source.assetSha256,
    source_graph_identity: sourceFixture.source.graphIdentity,
    source_graph_file_sha256: sourceFixture.source.graphFileSha256,
    selected_construction_id: sourceFixture.selection.constructionId,
    selected_path_instance_id: sourceFixture.componentInstanceIds.path,
    selected_surface_instance_id: sourceFixture.componentInstanceIds.surface,
    origin_handle_instance_id: sourceFixture.componentInstanceIds.originHandle,
    origin_support_id: sourceFixture.identities.fixedSupport,
    insertion_handle_instance_id: sourceFixture.componentInstanceIds.insertionHandle,
    insertion_support_id: sourceFixture.identities.movingSupport,
    requested_deformation_route: ROUTE,
    effective_deformation_route: ROUTE,
    deformation_core_identity:
      'analytical-elbow-positive-volume-c-p0-core.mjs:createAnalyticalElbowCP0Input',
    deformation_core_commit: C_P0_COMMIT,
    fixture_builder_identity: 'm31-generated-relation-transfer-core.mjs:buildCageManifest@v0',
    cage_manifest_id: manifest.id,
    cage_manifest_hash: manifest.semanticHash,
    embedding_manifest_id: `${manifest.id}:embedding`,
    embedding_manifest_hash: manifest.semanticHashes.embedding,
    boundary_role_manifest_id: `${manifest.id}:boundary-roles`,
    boundary_role_manifest_hash: manifest.semanticHashes.boundaryRoles,
    target_transform_manifest_id: `${manifest.id}:target-transforms`,
    target_transform_manifest_hash: manifest.semanticHashes.targetTransforms,
    ordered_source_vertex_ids: [...identityMap.sourceVertexIds],
    ordered_source_triangle_ids: [...identityMap.sourceTriangleIds],
    ordered_neutral_output_vertex_ids: outputVertexIds,
    ordered_neutral_output_triangle_ids: outputTriangleIds,
    ordered_plus24_output_vertex_ids: [...outputVertexIds],
    ordered_plus24_output_triangle_ids: [...outputTriangleIds],
    source_to_neutral_vertex_map: structuredClone(identityMap.vertexMap),
    source_to_neutral_triangle_map: structuredClone(identityMap.triangleMap),
    source_to_plus24_vertex_map: structuredClone(identityMap.vertexMap),
    source_to_plus24_triangle_map: structuredClone(identityMap.triangleMap),
    origin_cap_source_vertex_ids: [...role('originAttachmentCap').sourceVertexIds],
    origin_cap_source_triangle_ids: [...role('originAttachmentCap').sourceTriangleIds],
    belly_source_vertex_ids: [...role('transitionBelly').sourceVertexIds],
    belly_source_triangle_ids: [...role('transitionBelly').sourceTriangleIds],
    insertion_cap_source_vertex_ids: [...role('insertionAttachmentCap').sourceVertexIds],
    insertion_cap_source_triangle_ids: [...role('insertionAttachmentCap').sourceTriangleIds],
    neutral_output_geometry_ref: 'transfer.json#/poses/0',
    neutral_output_geometry_hash: neutralGeometryHash,
    plus24_output_geometry_ref: 'transfer.json#/poses/1',
    plus24_output_geometry_hash: plus24GeometryHash,
    requested_pose_identity: ['neutral', 'source-bound-positive-plus24-degrees'],
    effective_pose_identity: ['neutral', 'source-bound-positive-plus24-degrees'],
    producer_geometry_receipt_ref: 'transfer.json',
    failure_phase: allHardVetoesPass ? null : 'final-hard-veto-evaluation',
    last_trustworthy_evidence:
      'source identity, selection parent, manifests, total maps, semantic memberships, and geometry vetoes evaluated',
    inventory_hashes: {
      sourceVertexIds: semanticHash(identityMap.sourceVertexIds),
      sourceTriangleIds: semanticHash(identityMap.sourceTriangleIds),
      outputVertexIds: semanticHash(identityMap.outputVertexIds),
      outputTriangleIds: semanticHash(identityMap.outputTriangleIds),
    },
    mapping_hashes: {
      neutralVertexMap: semanticHash(identityMap.vertexMap),
      neutralTriangleMap: semanticHash(identityMap.triangleMap),
      plus24VertexMap: semanticHash(identityMap.vertexMap),
      plus24TriangleMap: semanticHash(identityMap.triangleMap),
    },
    membership_hashes: { neutral: membershipHash, plus24: membershipHash },
  };
}

export function validateM31GeneratedRelationTransfer(bundle) {
  const invalid = phase => ({
    schema: M31_GENERATED_RELATION_TRANSFER_SCHEMA,
    status: 'M31_TRANSFER_INVALID',
    failurePhase: phase,
    primaryOutput: null,
  });
  if (!bundle || bundle.status !== 'M31_TRANSFER_COMPLETE' ||
      bundle.requestedRoute !== ROUTE || bundle.effectiveRoute !== ROUTE ||
      bundle.fallbackUsed !== false) return invalid('route-validation');
  const map = bundle.identityMap;
  if (!map || map.total !== true || map.bijective !== true ||
      new Set(map.sourceVertexIds).size !== map.sourceVertexIds.length ||
      new Set(map.outputVertexIds).size !== map.outputVertexIds.length ||
      new Set(map.sourceTriangleIds).size !== map.sourceTriangleIds.length ||
      new Set(map.outputTriangleIds).size !== map.outputTriangleIds.length ||
      map.vertexMap.length !== map.sourceVertexIds.length ||
      map.triangleMap.length !== map.sourceTriangleIds.length) {
    return invalid('identity-map-validation');
  }
  const roles = ['originAttachmentCap', 'transitionBelly', 'insertionAttachmentCap'];
  const sets = roles.map(role => new Set(bundle.semanticMemberships?.[role]?.sourceVertexIds ?? []));
  if (sets.some(set => set.size === 0) || sets.some((set, index) =>
    sets.slice(index + 1).some(other => [...set].some(id => other.has(id))))) {
    return invalid('semantic-membership-validation');
  }
  if (!Array.isArray(bundle.poses) ||
      semanticHash(bundle.poses.map(pose => pose.angleDegrees)) !== semanticHash(TRANSFER_ANGLES) ||
      bundle.poses.some(pose => semanticHash(pose.semanticMemberships) !==
        semanticHash(bundle.semanticMemberships))) return invalid('pose-validation');
  return {
    schema: M31_GENERATED_RELATION_TRANSFER_SCHEMA,
    status: 'M31_TRANSFER_VALID',
    failurePhase: null,
    primaryOutput: bundle.id,
  };
}

export function createM31GeneratedRelationTransfer(sourceFixture) {
  const sourceFailure = validateSourceFixture(sourceFixture);
  if (sourceFailure) return sourceFailure;
  let manifest;
  try {
    manifest = buildCageManifest(sourceFixture);
  } catch (error) {
    return failure(sourceFixture, 'generated-fixture-construction', error.message,
      'generated-fixture-invalid');
  }
  const cP0Config = createAnalyticalElbowCP0Input().effectiveConfig;
  const vertexMap = sourceFixture.vertices.map(vertex => ({
    sourceVertexId: vertex.id,
    outputVertexId: `m31:transfer:output:${vertex.id}`,
  }));
  const triangleMap = sourceFixture.triangles.map(triangle => ({
    sourceTriangleId: triangle.id,
    outputTriangleId: `m31:transfer:output:${triangle.id}`,
  }));
  const identityMap = {
    sourceVertexIds: vertexMap.map(entry => entry.sourceVertexId),
    outputVertexIds: vertexMap.map(entry => entry.outputVertexId),
    sourceTriangleIds: triangleMap.map(entry => entry.sourceTriangleId),
    outputTriangleIds: triangleMap.map(entry => entry.outputTriangleId),
    vertexMap,
    triangleMap,
    total: true,
    bijective: true,
  };
  const semanticMemberships = memberships(sourceFixture, manifest, identityMap);
  const poses = TRANSFER_ANGLES.map(angleDegrees => {
    const solution = solvePose(manifest, sourceFixture, angleDegrees, cP0Config);
    const diagnostics = poseDiagnostics(sourceFixture, manifest, solution, angleDegrees);
    return {
      id: `m31:transfer:pose:${angleDegrees}`,
      angleDegrees,
      requestedRoute: ROUTE,
      effectiveRoute: ROUTE,
      fallbackUsed: false,
      outputVertices: diagnostics.outputPositions.map((position, index) => ({
        id: identityMap.outputVertexIds[index],
        sourceVertexId: identityMap.sourceVertexIds[index],
        position,
      })),
      outputTriangles: sourceFixture.triangles.map((triangle, index) => ({
        id: identityMap.outputTriangleIds[index],
        sourceTriangleId: triangle.id,
        vertexIndices: [...triangle.vertexIndices],
        vertexIds: triangle.vertexIndices.map(vertexIndex =>
          identityMap.outputVertexIds[vertexIndex]),
      })),
      posedCageNodes: solution.posedNodes,
      iterationHistory: solution.iterationHistory,
      cellJacobians: diagnostics.cellJacobians,
      surfaceInversions: diagnostics.surfaceInversions,
      selfIntersections: diagnostics.selfIntersections,
      rigidLeakage: diagnostics.rigidLeakage,
      matchedDistortion: diagnostics.matchedDistortion,
      hardVetoes: diagnostics.hardVetoes,
      semanticMemberships: structuredClone(semanticMemberships),
    };
  });
  const allHardVetoesPass = poses.every(pose =>
    Object.values(pose.hardVetoes).every(veto => veto.pass === true));
  const consumerEnvelope = producerEnvelope(sourceFixture, manifest, identityMap,
    semanticMemberships, poses, allHardVetoesPass);
  const bundle = {
    schema: M31_GENERATED_RELATION_TRANSFER_SCHEMA,
    id: 'm31-generated-relation-positive-volume-c-p0-transfer-v0',
    status: allHardVetoesPass ? 'M31_TRANSFER_COMPLETE' : 'M31_TRANSFER_HARD_VETO',
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    failurePhase: allHardVetoesPass ? null : 'final-hard-veto-evaluation',
    lastTrustworthyEvidence:
      'source identity, frozen selection, cage, embedding, map, memberships, poses, and hard vetoes evaluated',
    source: structuredClone(sourceFixture.source),
    selection: structuredClone(sourceFixture.selection),
    identities: structuredClone(sourceFixture.identities),
    coreIdentity: {
      cP0ArtifactSha256: C_P0_SHA256,
      requestedConfig: structuredClone(cP0Config),
      effectiveConfig: structuredClone(cP0Config),
      configSemanticHash: semanticHash(cP0Config),
      solver: cP0Config.solver,
      objective: cP0Config.objective,
    },
    manifest,
    identityMap,
    semanticMemberships,
    poses,
    producerEnvelope: consumerEnvelope,
    primaryOutput: allHardVetoesPass
      ? 'm31-generated-relation-positive-volume-c-p0-transfer-v0'
      : null,
    error: allHardVetoesPass ? null : { code: 'm31-transfer-hard-veto' },
    claimCeiling:
      'experimental shape retention and identity-preserving semantic carry-through on one preselected relation',
  };
  const validation = validateM31GeneratedRelationTransfer(bundle);
  if (bundle.status === 'M31_TRANSFER_COMPLETE' && validation.status !== 'M31_TRANSFER_VALID') {
    return failure(sourceFixture, validation.failurePhase,
      'post-build transfer validation rejected the bundle', 'transfer-validation-failed');
  }
  return bundle;
}
