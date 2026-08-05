import { createSleeve } from './analytical-elbow-collar-assay-core.mjs';
import {
  POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA,
  runPositiveVolumeCagePreflight,
} from './positive-volume-cage-core.mjs';

export const ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-cage-preflight-bundle.v0';

const ROUTE = 'positive-volume-cage-preflight';
const COLLAR_HALF_WIDTH = 0.72;
const FLEXION_DEGREES = 35;
const P0_SECTION_COUNT = 7;
const P0_SECTOR_COUNT = 8;

function rotateAroundZ(point, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    point[0] * cosine - point[1] * sine,
    point[0] * sine + point[1] * cosine,
    point[2],
  ];
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function signedTetrahedronVolume(a, b, c, d) {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function sleeveRadius(axial) {
  const jointProximity = 1 - Math.min(1, Math.abs(axial) / 0.75);
  return 0.22 + 0.12 * jointProximity;
}

function cageRadius(axial) {
  return sleeveRadius(axial) + 0.04;
}

function sectionAxial(section) {
  return -COLLAR_HALF_WIDTH +
    2 * COLLAR_HALF_WIDTH * section / (P0_SECTION_COUNT - 1);
}

function centerNodeId(section) {
  return `p0:section:${section}:center`;
}

function boundaryNodeId(section, sector) {
  return `p0:section:${section}:boundary:${sector}`;
}

function createP0Nodes() {
  const nodes = [];
  for (let section = 0; section < P0_SECTION_COUNT; section += 1) {
    const axial = sectionAxial(section);
    nodes.push({ id: centerNodeId(section), rest: [0, axial, 0] });
    for (let sector = 0; sector < P0_SECTOR_COUNT; sector += 1) {
      const angle = 2 * Math.PI * sector / P0_SECTOR_COUNT;
      const radius = cageRadius(axial);
      nodes.push({
        id: boundaryNodeId(section, sector),
        rest: [radius * Math.cos(angle), axial, radius * Math.sin(angle)],
      });
    }
  }
  return nodes;
}

function orientCell(nodesById, nodeIds) {
  const [a, b, c, d] = nodeIds.map(nodeId => nodesById.get(nodeId).rest);
  if (signedTetrahedronVolume(a, b, c, d) > 0) return nodeIds;
  return [nodeIds[0], nodeIds[2], nodeIds[1], nodeIds[3]];
}

function createP0Cells(nodes) {
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const cells = [];
  for (let section = 0; section < P0_SECTION_COUNT - 1; section += 1) {
    for (let sector = 0; sector < P0_SECTOR_COUNT; sector += 1) {
      const next = (sector + 1) % P0_SECTOR_COUNT;
      const lower = [
        centerNodeId(section),
        boundaryNodeId(section, sector),
        boundaryNodeId(section, next),
      ];
      const upper = [
        centerNodeId(section + 1),
        boundaryNodeId(section + 1, sector),
        boundaryNodeId(section + 1, next),
      ];
      const tetrahedra = [
        [lower[0], lower[1], lower[2], upper[0]],
        [lower[1], upper[1], lower[2], upper[0]],
        [lower[2], upper[1], upper[2], upper[0]],
      ];
      tetrahedra.forEach((nodeIds, index) => {
        cells.push({
          id: `p0:cell:${section}:${sector}:${index}`,
          nodeIds: orientCell(nodesById, nodeIds),
        });
      });
    }
  }
  return cells;
}

function embeddingForVertex(vertex) {
  const sectionPosition = (vertex.axial + COLLAR_HALF_WIDTH) /
    (2 * COLLAR_HALF_WIDTH) * (P0_SECTION_COUNT - 1);
  const lowerSection = Math.min(
    P0_SECTION_COUNT - 2,
    Math.max(0, Math.floor(sectionPosition)),
  );
  const axialWeight = sectionPosition - lowerSection;
  const angle = (Math.atan2(vertex.rest[2], vertex.rest[0]) + 2 * Math.PI) %
    (2 * Math.PI);
  const sectorPosition = angle / (2 * Math.PI) * P0_SECTOR_COUNT;
  const lowerSector = Math.floor(sectorPosition) % P0_SECTOR_COUNT;
  const nextSector = (lowerSector + 1) % P0_SECTOR_COUNT;
  const lowerRadius = cageRadius(sectionAxial(lowerSection));
  const upperRadius = cageRadius(sectionAxial(lowerSection + 1));
  const interpolatedRadius =
    (1 - axialWeight) * lowerRadius + axialWeight * upperRadius;
  const lowerAngle = 2 * Math.PI * lowerSector / P0_SECTOR_COUNT;
  const upperAngle = 2 * Math.PI * nextSector / P0_SECTOR_COUNT;
  const lowerBoundary = [
    interpolatedRadius * Math.cos(lowerAngle),
    interpolatedRadius * Math.sin(lowerAngle),
  ];
  const upperBoundary = [
    interpolatedRadius * Math.cos(upperAngle),
    interpolatedRadius * Math.sin(upperAngle),
  ];
  const determinant = lowerBoundary[0] * upperBoundary[1] -
    lowerBoundary[1] * upperBoundary[0];
  const lowerSectorWeight =
    (vertex.rest[0] * upperBoundary[1] - vertex.rest[2] * upperBoundary[0]) /
    determinant;
  const upperSectorWeight =
    (lowerBoundary[0] * vertex.rest[2] - lowerBoundary[1] * vertex.rest[0]) /
    determinant;
  const centerWeight = 1 - lowerSectorWeight - upperSectorWeight;
  const lowerWeight = 1 - axialWeight;
  const upperWeight = axialWeight;
  return {
    surfaceVertexId: vertex.id,
    nodeIds: [
      centerNodeId(lowerSection),
      boundaryNodeId(lowerSection, lowerSector),
      boundaryNodeId(lowerSection, nextSector),
      centerNodeId(lowerSection + 1),
      boundaryNodeId(lowerSection + 1, lowerSector),
      boundaryNodeId(lowerSection + 1, nextSector),
    ],
    weights: [
      lowerWeight * centerWeight,
      lowerWeight * lowerSectorWeight,
      lowerWeight * upperSectorWeight,
      upperWeight * centerWeight,
      upperWeight * lowerSectorWeight,
      upperWeight * upperSectorWeight,
    ],
  };
}

function createP0SourceAndEmbedding() {
  const sleeve = createSleeve();
  const transitionVertices = sleeve.vertices.filter(vertex =>
    Math.abs(vertex.axial) <= COLLAR_HALF_WIDTH + 1e-12
  );
  const transitionVertexIds = new Set(transitionVertices.map(vertex => vertex.id));
  const triangleIds = sleeve.triangles
    .map((triangle, index) => ({ triangle, id: `sleeve:triangle:${index}` }))
    .filter(({ triangle }) => triangle.every(index =>
      transitionVertexIds.has(sleeve.vertices[index].id)
    ))
    .map(({ id }) => id);
  return {
    source: {
      id: 'synthetic-mammalian-elbow-v0:sleeve-collar-0.72',
      fullSourceId: 'synthetic-mammalian-elbow-v0',
      vertexIds: transitionVertices.map(vertex => vertex.id),
      vertexPositions: transitionVertices.map(vertex => ({
        id: vertex.id,
        rest: [...vertex.rest],
      })),
      triangleIds,
    },
    embedding: transitionVertices.map(embeddingForVertex),
  };
}

function preflightConfig() {
  return {
    objective: 'preflight-only',
    initialization: 'none',
    budget: 0,
    flexionDegrees: FLEXION_DEGREES,
    collarHalfWidth: COLLAR_HALF_WIDTH,
  };
}

export function createAsymmetricNonRingCageManifest() {
  const config = preflightConfig();
  return {
    schema: POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA,
    id: 'asymmetric-non-ring-contract-v0',
    fixture: {
      kind: 'asymmetric-non-ring-contract',
      ringIndexingUsed: false,
    },
    source: {
      id: 'asymmetric-wedge-surface-v0',
      vertexIds: ['surface:a'],
      vertexPositions: [
        { id: 'surface:a', rest: [0.3, 0.28, 0.28] },
      ],
      triangleIds: [],
    },
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    nodes: [
      { id: 'node:a', rest: [0, 0, 0] },
      { id: 'node:b', rest: [1.2, 0.1, 0] },
      { id: 'node:c', rest: [0.2, 1.1, 0.1] },
      { id: 'node:d', rest: [0.1, 0.2, 1.3] },
    ],
    cells: [
      { id: 'cell:skew', nodeIds: ['node:a', 'node:b', 'node:c', 'node:d'] },
    ],
    constraints: [
      { nodeId: 'node:a', authority: 'fixture-anchor', position: [0, 0, 0] },
    ],
    embedding: [{
      surfaceVertexId: 'surface:a',
      nodeIds: ['node:a', 'node:b', 'node:c', 'node:d'],
      weights: [0.4, 0.2, 0.2, 0.2],
    }],
    requestedConfig: structuredClone(config),
    effectiveConfig: structuredClone(config),
  };
}

export function createAnalyticalElbowP0CageManifest() {
  const nodes = createP0Nodes();
  const sourceAndEmbedding = createP0SourceAndEmbedding();
  const radians = FLEXION_DEGREES * Math.PI / 180;
  const constraints = [];
  for (let section = 0; section < P0_SECTION_COUNT; section += 1) {
    if (section !== 0 && section !== P0_SECTION_COUNT - 1) continue;
    for (const node of nodes.filter(candidate =>
      candidate.id.startsWith(`p0:section:${section}:`)
    )) {
      constraints.push({
        nodeId: node.id,
        authority: section === 0 ? 'child-rigid-target' : 'parent-rigid-target',
        position: section === 0 ? rotateAroundZ(node.rest, radians) : [...node.rest],
      });
    }
  }
  const config = preflightConfig();
  return {
    schema: POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA,
    id: 'analytical-elbow-p0-v0',
    fixture: {
      kind: 'analytical-elbow-sleeve-p0',
      ringIndexingUsed: true,
      axialSectionCount: P0_SECTION_COUNT,
      circumferentialSectorCount: P0_SECTOR_COUNT,
      collarHalfWidth: COLLAR_HALF_WIDTH,
      flexionDegrees: FLEXION_DEGREES,
    },
    source: sourceAndEmbedding.source,
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    nodes,
    cells: createP0Cells(nodes),
    constraints,
    embedding: sourceAndEmbedding.embedding,
    requestedConfig: structuredClone(config),
    effectiveConfig: structuredClone(config),
  };
}

export function createAnalyticalElbowRowSBundle() {
  const manifest = createAnalyticalElbowP0CageManifest();
  manifest.id = 'analytical-elbow-row-s-v0';
  const sentinelNodeId = boundaryNodeId(0, 0);
  const sentinelNode = manifest.nodes.find(node => node.id === sentinelNodeId);
  manifest.constraints.push({
    nodeId: sentinelNodeId,
    authority: 'row-s-source-frozen-sentinel',
    position: [...sentinelNode.rest],
  });
  return {
    schema: ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA,
    status: 'complete',
    case: 'row-s',
    claimCeiling: 'pre-geometry contradictory-constraint harness evidence only',
    manifest,
    report: runPositiveVolumeCagePreflight(manifest),
  };
}

export function createAsymmetricNonRingBundle() {
  const manifest = createAsymmetricNonRingCageManifest();
  return {
    schema: ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA,
    status: 'complete',
    case: 'asymmetric-non-ring',
    claimCeiling: 'generic cage API-shape contract evidence only',
    manifest,
    report: runPositiveVolumeCagePreflight(manifest),
  };
}
