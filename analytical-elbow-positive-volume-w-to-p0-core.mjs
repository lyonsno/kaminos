import { createHash } from 'node:crypto';

import { createAnalyticalElbowP0CageManifest } from
  './analytical-elbow-positive-volume-cage-preflight-core.mjs';
import {
  createAnalyticalElbowRowWInput,
  evaluateAnalyticalElbowRowW,
  trianglesIntersect,
} from './analytical-elbow-positive-volume-row-w-core.mjs';
import { validatePositiveVolumeCageManifest } from './positive-volume-cage-core.mjs';

export const ANALYTICAL_ELBOW_W_TO_P0_INPUT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-w-to-p0-input.v0';
export const ANALYTICAL_ELBOW_W_TO_P0_REPORT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-w-to-p0-report.v0';
export const ANALYTICAL_ELBOW_W_TO_P0_BUNDLE_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-w-to-p0-bundle.v0';

const ROUTE = 'analytical-elbow-positive-volume-w-to-p0';
const OUTPUT_ID = 'analytical-elbow-w-to-p0-v0';
const PROJECTION_METHOD = 'row-w-map-at-cage-nodes/fixed-rest-embedding';
const COLLAR_HALF_WIDTH = 0.72;
const BOUNDARY_TOLERANCE = 1e-12;
const ORIENTATION_EPSILON = 1e-10;
const INTERSECTION_EPSILON = 1e-10;
const MINIMUM_CELL_RATIO = 1e-6;
const MINIMUM_CROSS_SECTION_RATIO = 0.10;
const SIGNED_VOLUME_RANGE = [0.50, 1.50];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function semanticHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function add(...vectors) {
  return vectors[0].map((_, axis) =>
    vectors.reduce((sum, vector) => sum + vector[axis], 0)
  );
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function scale(vector, scalar) {
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

function normalize(vector) {
  const magnitude = length(vector);
  if (!(magnitude > ORIENTATION_EPSILON)) {
    throw new Error('Row W projection tangent collapsed');
  }
  return scale(vector, 1 / magnitude);
}

function distance(left, right) {
  return length(subtract(left, right));
}

function hermitePosition(t, control) {
  const t2 = t * t;
  const t3 = t2 * t;
  return add(
    scale(control.start, 2 * t3 - 3 * t2 + 1),
    scale(control.startDerivative, t3 - 2 * t2 + t),
    scale(control.end, -2 * t3 + 3 * t2),
    scale(control.endDerivative, t3 - t2),
  );
}

function hermiteDerivative(t, control) {
  const t2 = t * t;
  return add(
    scale(control.start, 6 * t2 - 6 * t),
    scale(control.startDerivative, 3 * t2 - 4 * t + 1),
    scale(control.end, -6 * t2 + 6 * t),
    scale(control.endDerivative, 3 * t2 - 2 * t),
  );
}

function posePointThroughRecordedRowW(rest, rowWInput) {
  const t = (rest[1] + COLLAR_HALF_WIDTH) / (2 * COLLAR_HALF_WIDTH);
  const control = rowWInput.construction.centerlineControl;
  const center = hermitePosition(t, control);
  const tangent = normalize(hermiteDerivative(t, control));
  const radial = [tangent[1], -tangent[0], 0];
  return add(center, scale(radial, rest[0]), [0, 0, rest[2]]);
}

function createProjection(rowWInput, cageManifest) {
  const posedNodes = cageManifest.nodes.map(node => ({
    id: node.id,
    position: posePointThroughRecordedRowW(node.rest, rowWInput),
  }));
  return {
    method: PROJECTION_METHOD,
    posedNodes,
    semanticHash: semanticHash({ method: PROJECTION_METHOD, posedNodes }),
  };
}

function config() {
  return {
    parameterization: 'P0',
    projectionMethod: PROJECTION_METHOD,
    boundaryTolerance: BOUNDARY_TOLERANCE,
    minimumSignedCellVolumeRatio: MINIMUM_CELL_RATIO,
    minimumCrossSectionAreaRatio: MINIMUM_CROSS_SECTION_RATIO,
    signedVolumeRatioRange: [...SIGNED_VOLUME_RANGE],
    optimizer: null,
    objective: null,
    budget: 0,
  };
}

export function createAnalyticalElbowWToP0Input() {
  const rowWInput = createAnalyticalElbowRowWInput();
  const cageManifest = createAnalyticalElbowP0CageManifest();
  const effectiveConfig = config();
  return {
    schema: ANALYTICAL_ELBOW_W_TO_P0_INPUT_SCHEMA,
    id: OUTPUT_ID,
    parameterization: 'P0',
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    requestedConfig: structuredClone(effectiveConfig),
    effectiveConfig: structuredClone(effectiveConfig),
    rowWInput,
    cageManifest,
    projection: createProjection(rowWInput, cageManifest),
  };
}

function failureReport(input, failurePhase, code, lastTrustworthyEvidence) {
  return {
    schema: ANALYTICAL_ELBOW_W_TO_P0_REPORT_SCHEMA,
    status: 'W_P0_INVALID',
    requestedRoute: input?.requestedRoute ?? ROUTE,
    effectiveRoute: input?.effectiveRoute ?? null,
    fallbackUsed: input?.fallbackUsed ?? null,
    requestedConfig: structuredClone(input?.requestedConfig ?? null),
    effectiveConfig: structuredClone(input?.effectiveConfig ?? null),
    failurePhase,
    lastTrustworthyEvidence,
    predecessor: null,
    identities: null,
    projection: null,
    cellOrientation: null,
    surface: null,
    hardVetoes: {},
    primaryOutput: null,
    error: { code },
    claimCeiling:
      'invalid W-to-P0 receipt; no representation, solver, transfer, visual, or production claim',
  };
}

function validateOuterIdentity(input) {
  if (!input || input.schema !== ANALYTICAL_ELBOW_W_TO_P0_INPUT_SCHEMA ||
      input.id !== OUTPUT_ID || input.parameterization !== 'P0') {
    throw new Error('W-to-P0 input identity mismatch');
  }
  if (input.requestedRoute !== ROUTE || input.effectiveRoute !== ROUTE ||
      input.fallbackUsed !== false) {
    throw new Error('W-to-P0 route identity mismatch');
  }
  const expectedConfig = config();
  if (semanticHash(input.requestedConfig) !== semanticHash(expectedConfig) ||
      semanticHash(input.effectiveConfig) !== semanticHash(expectedConfig)) {
    throw new Error('W-to-P0 config identity mismatch');
  }
}

function validateCanonicalManifest(manifest) {
  const canonical = createAnalyticalElbowP0CageManifest();
  if (semanticHash(manifest) !== semanticHash(canonical)) {
    throw new Error('W-to-P0 canonical P0 manifest identity mismatch');
  }
  return validatePositiveVolumeCageManifest(manifest);
}

function validateSourceBridge(rowWInput, manifest) {
  const rowWById = new Map(rowWInput.source.vertices.map(vertex => [vertex.id, vertex]));
  const collar = rowWInput.source.vertices.filter(vertex =>
    Math.abs(vertex.axial) <= COLLAR_HALF_WIDTH + BOUNDARY_TOLERANCE
  );
  if (manifest.source.fullSourceId !== rowWInput.source.fullSourceId ||
      semanticHash(manifest.source.vertexIds) !== semanticHash(collar.map(v => v.id))) {
    throw new Error('W-to-P0 source vertex identity mismatch');
  }
  for (const sourcePosition of manifest.source.vertexPositions) {
    const rowWVertex = rowWById.get(sourcePosition.id);
    if (!rowWVertex || distance(sourcePosition.rest, rowWVertex.rest) > BOUNDARY_TOLERANCE) {
      throw new Error('W-to-P0 source rest geometry mismatch');
    }
  }
}

function validateProjectionRecord(input) {
  const expected = createProjection(input.rowWInput, input.cageManifest);
  if (input.projection?.method !== PROJECTION_METHOD ||
      input.projection?.semanticHash !== semanticHash({
        method: input.projection?.method,
        posedNodes: input.projection?.posedNodes,
      }) || semanticHash(input.projection) !== semanticHash(expected)) {
    throw new Error('W-to-P0 projection record mismatch');
  }
}

function signedTetrahedronVolume(a, b, c, d) {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function applyEmbedding(embedding, posedNodesById) {
  const position = [0, 0, 0];
  embedding.nodeIds.forEach((nodeId, index) => {
    const node = posedNodesById.get(nodeId);
    for (let axis = 0; axis < 3; axis += 1) {
      position[axis] += node[axis] * embedding.weights[index];
    }
  });
  return position;
}

function polygonAreaVector(points) {
  let area = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    area = add(area, cross(points[index], points[(index + 1) % points.length]));
  }
  return scale(area, 0.5);
}

function signedSurfaceVolume(vertices, triangles, field) {
  return triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.vertexIndices.map(index => vertices[index][field]);
    return sum + dot(a, cross(b, c)) / 6;
  }, 0);
}

function bounds(points) {
  return {
    minimum: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))),
    maximum: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))),
  };
}

function boundsOverlap(left, right) {
  return [0, 1, 2].every(axis =>
    left.minimum[axis] <= right.maximum[axis] + INTERSECTION_EPSILON &&
    right.minimum[axis] <= left.maximum[axis] + INTERSECTION_EPSILON
  );
}

function surfaceIntersectionDiagnostics(rowWInput, posedVertices) {
  const triangles = rowWInput.source.triangles.map(triangle => {
    const points = triangle.vertexIndices.map(index => posedVertices[index].position);
    return {
      indices: new Set(triangle.vertexIndices),
      points,
      bounds: bounds(points),
      transition: triangle.vertexIndices.some(index =>
        Math.abs(rowWInput.source.vertices[index].axial) < COLLAR_HALF_WIDTH
      ),
    };
  });
  let globalIntersectionCount = 0;
  let transitionIntersectionCount = 0;
  let testedPairCount = 0;
  for (let leftIndex = 0; leftIndex < triangles.length; leftIndex += 1) {
    const left = triangles[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < triangles.length; rightIndex += 1) {
      const right = triangles[rightIndex];
      if ([...left.indices].some(index => right.indices.has(index))) continue;
      if (!boundsOverlap(left.bounds, right.bounds)) continue;
      testedPairCount += 1;
      if (!trianglesIntersect(left, right)) continue;
      globalIntersectionCount += 1;
      if (left.transition || right.transition) transitionIntersectionCount += 1;
    }
  }
  return { globalIntersectionCount, transitionIntersectionCount, testedPairCount };
}

function surfaceDiagnostics(rowWInput, posedVertices) {
  const reference = rowWInput.construction.posedVertices;
  let invertedTriangleCount = 0;
  let minimumPosedAreaRatio = Infinity;
  for (const triangle of rowWInput.source.triangles) {
    const rest = triangle.vertexIndices.map(index => rowWInput.source.vertices[index].rest);
    const posed = triangle.vertexIndices.map(index => posedVertices[index].position);
    const expected = triangle.vertexIndices.map(index => reference[index].position);
    const restNormal = cross(subtract(rest[1], rest[0]), subtract(rest[2], rest[0]));
    const posedNormal = cross(subtract(posed[1], posed[0]), subtract(posed[2], posed[0]));
    const expectedNormal = cross(
      subtract(expected[1], expected[0]),
      subtract(expected[2], expected[0]),
    );
    const restArea = 0.5 * length(restNormal);
    const posedArea = 0.5 * length(posedNormal);
    minimumPosedAreaRatio = Math.min(minimumPosedAreaRatio, posedArea / restArea);
    if (!(dot(posedNormal, expectedNormal) > ORIENTATION_EPSILON)) {
      invertedTriangleCount += 1;
    }
  }

  const crossSectionRatios = [];
  const radialSegments = rowWInput.source.radialSegments;
  for (let ring = 0; ring <= rowWInput.source.axialSegments; ring += 1) {
    const start = ring * radialSegments;
    const indices = Array.from({ length: radialSegments }, (_, index) => start + index);
    const restPoints = indices.map(index => rowWInput.source.vertices[index].rest);
    const posedPoints = indices.map(index => posedVertices[index].position);
    crossSectionRatios.push(
      length(polygonAreaVector(posedPoints)) / length(polygonAreaVector(restPoints)),
    );
  }

  const restVertices = rowWInput.source.vertices.map(vertex => ({ rest: vertex.rest }));
  const restSignedVolume = signedSurfaceVolume(
    restVertices,
    rowWInput.source.triangles,
    'rest',
  );
  const posedSignedVolume = signedSurfaceVolume(
    posedVertices,
    rowWInput.source.triangles,
    'position',
  );
  return {
    invertedTriangleCount,
    minimumPosedAreaRatio,
    minimumCrossSectionAreaRatio: Math.min(...crossSectionRatios),
    maximumCrossSectionAreaRatio: Math.max(...crossSectionRatios),
    restSignedVolume,
    posedSignedVolume,
    totalSignedVolumeRatio: posedSignedVolume / restSignedVolume,
    ...surfaceIntersectionDiagnostics(rowWInput, posedVertices),
  };
}

export function evaluateAnalyticalElbowWToP0(input) {
  try {
    validateOuterIdentity(input);
  } catch (error) {
    return failureReport(
      input,
      'identity-validation',
      'admission-identity-invalid',
      error.message,
    );
  }

  const rowWReport = evaluateAnalyticalElbowRowW(input.rowWInput);
  if (rowWReport.status !== 'W_VALID') {
    return failureReport(
      input,
      'predecessor-validation',
      'row-w-predecessor-invalid',
      `Row W predecessor classified ${rowWReport.status}`,
    );
  }

  let manifest;
  try {
    manifest = validateCanonicalManifest(input.cageManifest);
    validateSourceBridge(input.rowWInput, manifest);
  } catch (error) {
    return failureReport(
      input,
      'manifest-validation',
      'p0-manifest-invalid',
      error.message,
    );
  }

  try {
    validateProjectionRecord(input);
  } catch (error) {
    return failureReport(
      input,
      'projection-identity-validation',
      'projection-record-invalid',
      error.message,
    );
  }

  const posedNodesById = new Map(
    input.projection.posedNodes.map(node => [node.id, node.position]),
  );
  const restNodesById = new Map(manifest.nodes.map(node => [node.id, node.rest]));
  const rowWVertexById = new Map(
    input.rowWInput.construction.posedVertices.map(vertex => [vertex.id, vertex]),
  );
  const embeddingByVertexId = new Map(
    manifest.embedding.map(entry => [entry.surfaceVertexId, entry]),
  );

  let maximumRigidBoundaryResidual = 0;
  for (const constraint of manifest.constraints) {
    maximumRigidBoundaryResidual = Math.max(
      maximumRigidBoundaryResidual,
      distance(posedNodesById.get(constraint.nodeId), constraint.position),
    );
  }

  const cellRatios = manifest.cells.map(cell => {
    const rest = cell.nodeIds.map(nodeId => restNodesById.get(nodeId));
    const posed = cell.nodeIds.map(nodeId => posedNodesById.get(nodeId));
    return signedTetrahedronVolume(...posed) / signedTetrahedronVolume(...rest);
  });

  let maximumSurfaceProjectionError = 0;
  let maximumRigidSurfaceResidual = 0;
  const posedVertices = input.rowWInput.construction.posedVertices.map(vertex => ({
    id: vertex.id,
    position: [...vertex.position],
  }));
  for (const [vertexId, embedding] of embeddingByVertexId) {
    const projected = applyEmbedding(embedding, posedNodesById);
    const rowWVertex = rowWVertexById.get(vertexId);
    maximumSurfaceProjectionError = Math.max(
      maximumSurfaceProjectionError,
      distance(projected, rowWVertex.position),
    );
    posedVertices[rowWVertex.index] = { id: vertexId, position: projected };
    const source = input.rowWInput.source.vertices[rowWVertex.index];
    if (source.region !== 'collar') {
      maximumRigidSurfaceResidual = Math.max(
        maximumRigidSurfaceResidual,
        distance(projected, rowWVertex.position),
      );
    }
  }

  const surface = surfaceDiagnostics(input.rowWInput, posedVertices);
  const maximumRestReconstructionError = Math.max(
    ...manifest.embedding.map(entry => entry.restReconstructionError),
  );
  const finiteGeometry = input.projection.posedNodes.every(node =>
    node.position.every(Number.isFinite)
  ) && posedVertices.every(vertex => vertex.position.every(Number.isFinite));
  const minimumSignedVolumeRatio = Math.min(...cellRatios);
  const maximumSignedVolumeRatio = Math.max(...cellRatios);
  const hardVetoes = {
    finiteGeometry: { pass: finiteGeometry },
    exactRestEmbedding: {
      pass: maximumRestReconstructionError <= BOUNDARY_TOLERANCE,
      maximumError: maximumRestReconstructionError,
      tolerance: BOUNDARY_TOLERANCE,
    },
    rigidBoundaryResidual: {
      pass: maximumRigidBoundaryResidual <= BOUNDARY_TOLERANCE &&
        maximumRigidSurfaceResidual <= BOUNDARY_TOLERANCE,
      maximumCageNodeResidual: maximumRigidBoundaryResidual,
      maximumSurfaceResidual: maximumRigidSurfaceResidual,
      tolerance: BOUNDARY_TOLERANCE,
    },
    positiveCellOrientation: {
      pass: minimumSignedVolumeRatio > MINIMUM_CELL_RATIO,
      minimumSignedVolumeRatio,
      threshold: MINIMUM_CELL_RATIO,
    },
    surfaceOrientation: {
      pass: surface.invertedTriangleCount === 0 &&
        surface.minimumPosedAreaRatio > ORIENTATION_EPSILON,
      invertedTriangleCount: surface.invertedTriangleCount,
      minimumPosedAreaRatio: surface.minimumPosedAreaRatio,
    },
    transitionSelfIntersection: {
      pass: surface.globalIntersectionCount === 0 &&
        surface.transitionIntersectionCount === 0,
      globalIntersectionCount: surface.globalIntersectionCount,
      transitionIntersectionCount: surface.transitionIntersectionCount,
    },
    crossSectionAreaRatio: {
      pass: surface.minimumCrossSectionAreaRatio >= MINIMUM_CROSS_SECTION_RATIO,
      minimum: surface.minimumCrossSectionAreaRatio,
      threshold: MINIMUM_CROSS_SECTION_RATIO,
    },
    totalSignedVolumeRatio: {
      pass: surface.restSignedVolume * surface.posedSignedVolume > 0 &&
        surface.totalSignedVolumeRatio >= SIGNED_VOLUME_RANGE[0] &&
        surface.totalSignedVolumeRatio <= SIGNED_VOLUME_RANGE[1],
      ratio: surface.totalSignedVolumeRatio,
      allowedRange: [...SIGNED_VOLUME_RANGE],
    },
  };
  const admitted = Object.values(hardVetoes).every(veto => veto.pass === true);
  return {
    schema: ANALYTICAL_ELBOW_W_TO_P0_REPORT_SCHEMA,
    status: admitted ? 'W_P0_ADMITTED' : 'W_P0_UNREPRESENTABLE',
    requestedRoute: input.requestedRoute,
    effectiveRoute: input.effectiveRoute,
    fallbackUsed: input.fallbackUsed,
    requestedConfig: structuredClone(input.requestedConfig),
    effectiveConfig: structuredClone(input.effectiveConfig),
    failurePhase: admitted ? null : 'hard-veto-evaluation',
    lastTrustworthyEvidence:
      'canonical Row W, P0, fixed embedding, projection, and all admission predicates evaluated',
    predecessor: {
      rowWStatus: rowWReport.status,
      rowWSourceHash: rowWReport.sourceIdentity.semanticHash,
      rowWConstructionHash: rowWReport.sourceIdentity.constructionSemanticHash,
    },
    identities: {
      source: manifest.semanticHashes.source,
      topology: manifest.semanticHashes.topology,
      constraints: manifest.semanticHashes.constraints,
      embedding: manifest.semanticHashes.embedding,
      projection: input.projection.semanticHash,
    },
    projection: {
      method: input.projection.method,
      posedNodeCount: input.projection.posedNodes.length,
      embeddedSurfaceVertexCount: manifest.embedding.length,
      maximumSurfaceProjectionError,
      maximumRestReconstructionError,
      maximumRigidBoundaryResidual: Math.max(
        maximumRigidBoundaryResidual,
        maximumRigidSurfaceResidual,
      ),
    },
    cellOrientation: {
      cellCount: manifest.cells.length,
      minimumSignedVolumeRatio,
      maximumSignedVolumeRatio,
      negativeOrCollapsedCellCount: cellRatios.filter(
        ratio => !(ratio > MINIMUM_CELL_RATIO)
      ).length,
    },
    surface,
    hardVetoes,
    primaryOutput: admitted ? OUTPUT_ID : null,
    error: admitted ? null : { code: 'w-to-p0-hard-veto-failed' },
    claimCeiling:
      'P0 representation admission for one exact Row W state; no optimizer, visual improvement, transfer, anatomy, motion, or production claim',
  };
}

export function createAnalyticalElbowWToP0Bundle() {
  const input = createAnalyticalElbowWToP0Input();
  return {
    schema: ANALYTICAL_ELBOW_W_TO_P0_BUNDLE_SCHEMA,
    status: 'complete',
    case: 'w-to-p0',
    input,
    report: evaluateAnalyticalElbowWToP0(input),
  };
}
