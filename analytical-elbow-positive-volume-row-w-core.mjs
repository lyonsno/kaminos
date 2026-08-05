import { createHash } from 'node:crypto';

import { createSleeve } from './analytical-elbow-collar-assay-core.mjs';

export const ANALYTICAL_ELBOW_ROW_W_INPUT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-row-w-input.v0';
export const ANALYTICAL_ELBOW_ROW_W_REPORT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-row-w-report.v0';
export const ANALYTICAL_ELBOW_ROW_W_BUNDLE_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-row-w-bundle.v0';

const ROUTE = 'analytical-elbow-positive-volume-row-w';
const SOURCE_ID = 'synthetic-mammalian-elbow-v0:sleeve-40x24';
const OUTPUT_ID = 'analytical-elbow-row-w-v0';
const COLLAR_HALF_WIDTH = 0.72;
const FLEXION_DEGREES = 35;
const CENTERLINE_SAMPLE_COUNT = 257;
const EPSILON = 1e-12;
const ORIENTATION_EPSILON = 1e-10;
const SELF_INTERSECTION_EPSILON = 1e-10;

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
  return vectors[0].map((_, index) =>
    vectors.reduce((sum, vector) => sum + vector[index], 0)
  );
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale(vector, scalar) {
  return vector.map(value => value * scalar);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
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

function normalize(vector) {
  const magnitude = length(vector);
  if (!(magnitude > EPSILON)) throw new Error('Row W frame tangent collapsed');
  return scale(vector, 1 / magnitude);
}

function rotateAroundZ(point, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    point[0] * cosine - point[1] * sine,
    point[0] * sine + point[1] * cosine,
    point[2],
  ];
}

function hermitePosition(t, start, startDerivative, end, endDerivative) {
  const t2 = t * t;
  const t3 = t2 * t;
  return add(
    scale(start, 2 * t3 - 3 * t2 + 1),
    scale(startDerivative, t3 - 2 * t2 + t),
    scale(end, -2 * t3 + 3 * t2),
    scale(endDerivative, t3 - t2),
  );
}

function hermiteDerivative(t, start, startDerivative, end, endDerivative) {
  const t2 = t * t;
  return add(
    scale(start, 6 * t2 - 6 * t),
    scale(startDerivative, 3 * t2 - 4 * t + 1),
    scale(end, -6 * t2 + 6 * t),
    scale(endDerivative, 3 * t2 - 2 * t),
  );
}

function hermiteSecondDerivative(t, start, startDerivative, end, endDerivative) {
  return add(
    scale(start, 12 * t - 6),
    scale(startDerivative, 6 * t - 4),
    scale(end, -12 * t + 6),
    scale(endDerivative, 6 * t - 2),
  );
}

function constructionParameters() {
  const radians = FLEXION_DEGREES * Math.PI / 180;
  const start = rotateAroundZ([0, -COLLAR_HALF_WIDTH, 0], radians);
  const end = [0, COLLAR_HALF_WIDTH, 0];
  const derivativeMagnitude = 2 * COLLAR_HALF_WIDTH;
  const startDerivative = rotateAroundZ([0, derivativeMagnitude, 0], radians);
  const endDerivative = [0, derivativeMagnitude, 0];
  return { radians, start, end, startDerivative, endDerivative };
}

function frameAt(t, parameters) {
  const position = hermitePosition(
    t,
    parameters.start,
    parameters.startDerivative,
    parameters.end,
    parameters.endDerivative,
  );
  const derivative = hermiteDerivative(
    t,
    parameters.start,
    parameters.startDerivative,
    parameters.end,
    parameters.endDerivative,
  );
  const secondDerivative = hermiteSecondDerivative(
    t,
    parameters.start,
    parameters.startDerivative,
    parameters.end,
    parameters.endDerivative,
  );
  const tangent = normalize(derivative);
  const radial = [tangent[1], -tangent[0], 0];
  const binormal = [0, 0, 1];
  const curvature = length(cross(derivative, secondDerivative)) /
    Math.pow(length(derivative), 3);
  return { position, tangent, radial, binormal, curvature };
}

function sourceCoordinate(vertex) {
  return {
    axial: vertex.axial,
    radial: Math.hypot(vertex.rest[0], vertex.rest[2]),
    theta: Math.atan2(vertex.rest[2], vertex.rest[0]),
  };
}

function regionForAxial(axial) {
  if (axial >= COLLAR_HALF_WIDTH) return 'parent-rigid';
  if (axial <= -COLLAR_HALF_WIDTH) return 'child-rigid';
  return 'collar';
}

function poseVertex(vertex, parameters) {
  const region = regionForAxial(vertex.axial);
  if (region === 'parent-rigid') return [...vertex.rest];
  if (region === 'child-rigid') return rotateAroundZ(vertex.rest, parameters.radians);
  const t = (vertex.axial + COLLAR_HALF_WIDTH) / (2 * COLLAR_HALF_WIDTH);
  const frame = frameAt(t, parameters);
  return add(
    frame.position,
    scale(frame.radial, vertex.rest[0]),
    scale(frame.binormal, vertex.rest[2]),
  );
}

function centerlineSamples(parameters) {
  return Array.from({ length: CENTERLINE_SAMPLE_COUNT }, (_, index) => {
    const t = index / (CENTERLINE_SAMPLE_COUNT - 1);
    const frame = frameAt(t, parameters);
    return {
      index,
      t,
      sourceAxial: -COLLAR_HALF_WIDTH + 2 * COLLAR_HALF_WIDTH * t,
      position: frame.position,
      tangent: frame.tangent,
      radial: frame.radial,
      binormal: frame.binormal,
      curvature: frame.curvature,
      radialScale: 1,
      binormalScale: 1,
      orientationConvention: 'cross(radial,binormal)=-tangent',
    };
  });
}

function sourceRecords(mesh) {
  return mesh.vertices.map((vertex, index) => ({
    id: vertex.id,
    index,
    axial: vertex.axial,
    rest: [...vertex.rest],
    region: regionForAxial(vertex.axial),
    sourceCoordinate: sourceCoordinate(vertex),
  }));
}

function triangleRecords(mesh) {
  return mesh.triangles.map((indices, index) => ({
    id: `sleeve:triangle:${index}`,
    index,
    vertexIndices: [...indices],
    vertexIds: indices.map(vertexIndex => mesh.vertices[vertexIndex].id),
  }));
}

export function createAnalyticalElbowRowWInput() {
  const mesh = createSleeve({ axialSegments: 40, radialSegments: 24 });
  const parameters = constructionParameters();
  const vertices = sourceRecords(mesh);
  const triangles = triangleRecords(mesh);
  const posedVertices = vertices.map(vertex => ({
    id: vertex.id,
    index: vertex.index,
    region: vertex.region,
    sourceCoordinate: structuredClone(vertex.sourceCoordinate),
    position: poseVertex(vertex, parameters),
  }));
  const config = {
    construction: 'cubic-hermite-transported-cross-section',
    flexionDegrees: FLEXION_DEGREES,
    collarHalfWidth: COLLAR_HALF_WIDTH,
    centerlineSampleCount: CENTERLINE_SAMPLE_COUNT,
    selfIntersectionMethod: 'indexed-mesh-aabb-segment-triangle',
    orientationEpsilon: ORIENTATION_EPSILON,
    selfIntersectionEpsilon: SELF_INTERSECTION_EPSILON,
  };
  return {
    schema: ANALYTICAL_ELBOW_ROW_W_INPUT_SCHEMA,
    id: OUTPUT_ID,
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    requestedConfig: structuredClone(config),
    effectiveConfig: structuredClone(config),
    source: {
      id: SOURCE_ID,
      fullSourceId: 'synthetic-mammalian-elbow-v0',
      axialSegments: mesh.axialSegments,
      radialSegments: mesh.radialSegments,
      vertices,
      triangles,
      semanticHash: semanticHash({ vertices, triangles }),
    },
    boundaryFrames: {
      child: {
        sourceAxial: -COLLAR_HALF_WIDTH,
        restOrigin: [0, -COLLAR_HALF_WIDTH, 0],
        targetOrigin: [...parameters.start],
        targetTangent: normalize(parameters.startDerivative),
        targetRadial: rotateAroundZ([1, 0, 0], parameters.radians),
        targetBinormal: [0, 0, 1],
      },
      parent: {
        sourceAxial: COLLAR_HALF_WIDTH,
        restOrigin: [0, COLLAR_HALF_WIDTH, 0],
        targetOrigin: [...parameters.end],
        targetTangent: normalize(parameters.endDerivative),
        targetRadial: [1, 0, 0],
        targetBinormal: [0, 0, 1],
      },
    },
    construction: {
      kind: 'cubic-hermite-transported-cross-section',
      centerlineControl: {
        start: parameters.start,
        startDerivative: parameters.startDerivative,
        end: parameters.end,
        endDerivative: parameters.endDerivative,
      },
      centerlineSamples: centerlineSamples(parameters),
      crossSectionMap: 'source-x-along-transported-radial; source-z-along-fixed-binormal',
      scaleField: 'radial=1; binormal=1',
      collarExtent: [-COLLAR_HALF_WIDTH, COLLAR_HALF_WIDTH],
      posedVertices,
      semanticHash: semanticHash({ posedVertices }),
    },
  };
}

function triangleArea(a, b, c) {
  return 0.5 * length(cross(subtract(b, a), subtract(c, a)));
}

function signedSurfaceVolume(vertices, triangles, field) {
  return triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.vertexIndices.map(index => vertices[index][field]);
    return sum + dot(a, cross(b, c)) / 6;
  }, 0);
}

function edgeKey(left, right) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function surfaceDiagnostics(input) {
  const restVertices = input.source.vertices;
  const posedVertices = input.construction.posedVertices;
  const strains = [];
  const edgeSet = new Set();
  for (const triangle of input.source.triangles) {
    for (let index = 0; index < 3; index += 1) {
      edgeSet.add(edgeKey(
        triangle.vertexIndices[index],
        triangle.vertexIndices[(index + 1) % 3],
      ));
    }
  }
  for (const key of edgeSet) {
    const [left, right] = key.split(':').map(Number);
    const restLength = distance(restVertices[left].rest, restVertices[right].rest);
    const posedLength = distance(
      posedVertices[left].position,
      posedVertices[right].position,
    );
    strains.push(Math.abs(Math.log(posedLength / restLength)));
  }
  strains.sort((left, right) => left - right);
  const q95Index = Math.min(strains.length - 1, Math.floor(0.95 * strains.length));

  let invertedTriangleCount = 0;
  let minimumPosedAreaRatio = Infinity;
  for (const triangle of input.source.triangles) {
    const indices = triangle.vertexIndices;
    const rest = indices.map(index => restVertices[index].rest);
    const posed = indices.map(index => posedVertices[index].position);
    const restNormal = cross(subtract(rest[1], rest[0]), subtract(rest[2], rest[0]));
    const posedNormal = cross(subtract(posed[1], posed[0]), subtract(posed[2], posed[0]));
    const restArea = 0.5 * length(restNormal);
    const posedArea = 0.5 * length(posedNormal);
    minimumPosedAreaRatio = Math.min(minimumPosedAreaRatio, posedArea / restArea);

    const isParentCap = triangle.vertexIds.includes('sleeve:parent-cap');
    const isChildCap = triangle.vertexIds.includes('sleeve:child-cap');
    let restReference;
    let posedReference;
    if (isParentCap) {
      restReference = [0, 1, 0];
      posedReference = [0, 1, 0];
    } else if (isChildCap) {
      restReference = [0, -1, 0];
      posedReference = rotateAroundZ(
        [0, -1, 0],
        FLEXION_DEGREES * Math.PI / 180,
      );
    } else {
      const restCentroid = scale(add(...rest), 1 / 3);
      restReference = [restCentroid[0], 0, restCentroid[2]];
      const averageAxial = indices.reduce(
        (sum, index) => sum + restVertices[index].axial,
        0,
      ) / 3;
      const posedCentroid = scale(add(...posed), 1 / 3);
      let center;
      if (averageAxial >= COLLAR_HALF_WIDTH) {
        center = [0, averageAxial, 0];
      } else if (averageAxial <= -COLLAR_HALF_WIDTH) {
        center = rotateAroundZ(
          [0, averageAxial, 0],
          FLEXION_DEGREES * Math.PI / 180,
        );
      } else {
        center = frameAt(
          (averageAxial + COLLAR_HALF_WIDTH) / (2 * COLLAR_HALF_WIDTH),
          constructionParameters(),
        ).position;
      }
      posedReference = subtract(posedCentroid, center);
    }
    const restOrientation = dot(restNormal, restReference);
    const posedOrientation = dot(posedNormal, posedReference);
    if (!(Math.abs(restOrientation) > ORIENTATION_EPSILON) ||
        !(restOrientation * posedOrientation > ORIENTATION_EPSILON)) {
      invertedTriangleCount += 1;
    }
  }
  return {
    maximumAbsoluteLogEdgeStrain: strains.at(-1),
    q95AbsoluteLogEdgeStrain: strains[q95Index],
    minimumPosedAreaRatio,
    invertedTriangleCount,
  };
}

function ringCrossSectionArea(input, ring) {
  const radialSegments = input.source.radialSegments;
  const start = ring * radialSegments;
  const indices = Array.from({ length: radialSegments }, (_, index) => start + index);
  const sourceAxial = input.source.vertices[start].axial;
  let center;
  let tangent;
  if (sourceAxial >= COLLAR_HALF_WIDTH) {
    center = [0, sourceAxial, 0];
    tangent = [0, 1, 0];
  } else if (sourceAxial <= -COLLAR_HALF_WIDTH) {
    center = rotateAroundZ(
      [0, sourceAxial, 0],
      FLEXION_DEGREES * Math.PI / 180,
    );
    tangent = rotateAroundZ(
      [0, 1, 0],
      FLEXION_DEGREES * Math.PI / 180,
    );
  } else {
    const frame = frameAt(
      (sourceAxial + COLLAR_HALF_WIDTH) / (2 * COLLAR_HALF_WIDTH),
      constructionParameters(),
    );
    center = frame.position;
    tangent = frame.tangent;
  }
  let area = 0;
  for (let index = 0; index < indices.length; index += 1) {
    const current = subtract(
      input.construction.posedVertices[indices[index]].position,
      center,
    );
    const next = subtract(
      input.construction.posedVertices[indices[(index + 1) % indices.length]].position,
      center,
    );
    area += dot(cross(current, next), tangent) / 2;
  }
  const radius = input.source.vertices[start].sourceCoordinate.radial;
  const restPolygonArea = radialSegments * radius * radius *
    Math.sin(2 * Math.PI / radialSegments) / 2;
  return Math.abs(area) / restPolygonArea;
}

function aabb(points) {
  return {
    minimum: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))),
    maximum: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))),
  };
}

function aabbOverlaps(left, right) {
  return [0, 1, 2].every(axis =>
    left.minimum[axis] <= right.maximum[axis] + SELF_INTERSECTION_EPSILON &&
    right.minimum[axis] <= left.maximum[axis] + SELF_INTERSECTION_EPSILON
  );
}

function projectPoint(point, droppedAxis) {
  return point.filter((_, axis) => axis !== droppedAxis);
}

function orientation2d(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment2d(point, start, end) {
  return Math.abs(orientation2d(start, end, point)) <= SELF_INTERSECTION_EPSILON &&
    point[0] >= Math.min(start[0], end[0]) - SELF_INTERSECTION_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + SELF_INTERSECTION_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - SELF_INTERSECTION_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + SELF_INTERSECTION_EPSILON;
}

function segmentsIntersect2d(a, b, c, d) {
  const abC = orientation2d(a, b, c);
  const abD = orientation2d(a, b, d);
  const cdA = orientation2d(c, d, a);
  const cdB = orientation2d(c, d, b);
  if (((abC > SELF_INTERSECTION_EPSILON && abD < -SELF_INTERSECTION_EPSILON) ||
       (abC < -SELF_INTERSECTION_EPSILON && abD > SELF_INTERSECTION_EPSILON)) &&
      ((cdA > SELF_INTERSECTION_EPSILON && cdB < -SELF_INTERSECTION_EPSILON) ||
       (cdA < -SELF_INTERSECTION_EPSILON && cdB > SELF_INTERSECTION_EPSILON))) {
    return true;
  }
  return pointOnSegment2d(c, a, b) || pointOnSegment2d(d, a, b) ||
    pointOnSegment2d(a, c, d) || pointOnSegment2d(b, c, d);
}

function pointInTriangle2d(point, triangle) {
  const signs = triangle.map((vertex, index) =>
    orientation2d(vertex, triangle[(index + 1) % 3], point)
  );
  const hasPositive = signs.some(value => value > SELF_INTERSECTION_EPSILON);
  const hasNegative = signs.some(value => value < -SELF_INTERSECTION_EPSILON);
  return !(hasPositive && hasNegative);
}

function coplanarTrianglesIntersect(left, right) {
  const leftNormal = cross(
    subtract(left.points[1], left.points[0]),
    subtract(left.points[2], left.points[0]),
  );
  const rightNormal = cross(
    subtract(right.points[1], right.points[0]),
    subtract(right.points[2], right.points[0]),
  );
  const leftMagnitude = length(leftNormal);
  const rightMagnitude = length(rightNormal);
  if (!(leftMagnitude > SELF_INTERSECTION_EPSILON) ||
      !(rightMagnitude > SELF_INTERSECTION_EPSILON)) return false;
  if (length(cross(leftNormal, rightNormal)) >
      SELF_INTERSECTION_EPSILON * leftMagnitude * rightMagnitude) return false;
  if (Math.abs(dot(leftNormal, subtract(right.points[0], left.points[0]))) >
      SELF_INTERSECTION_EPSILON * leftMagnitude) return false;

  const droppedAxis = leftNormal.reduce(
    (best, value, axis, values) => Math.abs(value) > Math.abs(values[best]) ? axis : best,
    0,
  );
  const left2d = left.points.map(point => projectPoint(point, droppedAxis));
  const right2d = right.points.map(point => projectPoint(point, droppedAxis));
  for (let leftEdge = 0; leftEdge < 3; leftEdge += 1) {
    for (let rightEdge = 0; rightEdge < 3; rightEdge += 1) {
      if (segmentsIntersect2d(
        left2d[leftEdge],
        left2d[(leftEdge + 1) % 3],
        right2d[rightEdge],
        right2d[(rightEdge + 1) % 3],
      )) return true;
    }
  }
  return pointInTriangle2d(left2d[0], right2d) ||
    pointInTriangle2d(right2d[0], left2d);
}

function segmentIntersectsTriangle(start, end, a, b, c) {
  const direction = subtract(end, start);
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) <= SELF_INTERSECTION_EPSILON) return false;
  const inverse = 1 / determinant;
  const tVector = subtract(start, a);
  const u = dot(tVector, p) * inverse;
  if (u < -SELF_INTERSECTION_EPSILON || u > 1 + SELF_INTERSECTION_EPSILON) return false;
  const q = cross(tVector, edge1);
  const v = dot(direction, q) * inverse;
  if (v < -SELF_INTERSECTION_EPSILON || u + v > 1 + SELF_INTERSECTION_EPSILON) {
    return false;
  }
  const t = dot(edge2, q) * inverse;
  return t >= -SELF_INTERSECTION_EPSILON && t <= 1 + SELF_INTERSECTION_EPSILON;
}

export function trianglesIntersect(left, right) {
  if (coplanarTrianglesIntersect(left, right)) return true;
  for (let index = 0; index < 3; index += 1) {
    if (segmentIntersectsTriangle(
      left.points[index],
      left.points[(index + 1) % 3],
      ...right.points,
    )) return true;
    if (segmentIntersectsTriangle(
      right.points[index],
      right.points[(index + 1) % 3],
      ...left.points,
    )) return true;
  }
  return false;
}

function selfIntersectionDiagnostics(input) {
  const posed = input.construction.posedVertices;
  const triangles = input.source.triangles.map(triangle => {
    const points = triangle.vertexIndices.map(index => posed[index].position);
    return {
      id: triangle.id,
      indices: new Set(triangle.vertexIndices),
      points,
      bounds: aabb(points),
      transition: triangle.vertexIndices.some(index =>
        Math.abs(input.source.vertices[index].axial) < COLLAR_HALF_WIDTH
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
      if (!aabbOverlaps(left.bounds, right.bounds)) continue;
      testedPairCount += 1;
      if (!trianglesIntersect(left, right)) continue;
      globalIntersectionCount += 1;
      if (left.transition || right.transition) transitionIntersectionCount += 1;
    }
  }
  return { globalIntersectionCount, transitionIntersectionCount, testedPairCount };
}

function unevaluatedVeto() {
  return { pass: false, evaluated: false };
}

function failureReport(input, failurePhase, code, hardVetoes, lastTrustworthyEvidence) {
  return {
    schema: ANALYTICAL_ELBOW_ROW_W_REPORT_SCHEMA,
    status: 'W_INVALID',
    requestedRoute: input?.requestedRoute ?? ROUTE,
    effectiveRoute: input?.effectiveRoute ?? null,
    fallbackUsed: input?.fallbackUsed ?? false,
    requestedConfig: structuredClone(input?.requestedConfig ?? null),
    effectiveConfig: structuredClone(input?.effectiveConfig ?? null),
    failurePhase,
    lastTrustworthyEvidence,
    hardVetoes,
    metrics: null,
    primaryOutput: null,
    error: { code },
  };
}

function validateInputIdentity(input) {
  if (!input || input.schema !== ANALYTICAL_ELBOW_ROW_W_INPUT_SCHEMA) {
    throw new Error('Row W input schema mismatch');
  }
  if (input.requestedRoute !== ROUTE || input.effectiveRoute !== ROUTE ||
      input.fallbackUsed !== false) {
    throw new Error('Row W route identity mismatch');
  }
  const expected = createAnalyticalElbowRowWInput();
  if (semanticHash(input.requestedConfig) !== semanticHash(expected.requestedConfig) ||
      semanticHash(input.effectiveConfig) !== semanticHash(expected.effectiveConfig)) {
    throw new Error('Row W config identity mismatch');
  }
  if (input.source?.id !== SOURCE_ID || input.id !== OUTPUT_ID) {
    throw new Error('Row W source identity mismatch');
  }
  if (!Array.isArray(input.source?.vertices) ||
      !Array.isArray(input.source?.triangles) ||
      !Array.isArray(input.construction?.posedVertices) ||
      input.source.vertices.length !== input.construction.posedVertices.length) {
    throw new Error('Row W source correspondence mismatch');
  }
  const sourceIdentity = {
    id: input.source.id,
    fullSourceId: input.source.fullSourceId,
    axialSegments: input.source.axialSegments,
    radialSegments: input.source.radialSegments,
    vertices: input.source.vertices,
    triangles: input.source.triangles,
  };
  const expectedSourceIdentity = {
    id: expected.source.id,
    fullSourceId: expected.source.fullSourceId,
    axialSegments: expected.source.axialSegments,
    radialSegments: expected.source.radialSegments,
    vertices: expected.source.vertices,
    triangles: expected.source.triangles,
  };
  if (semanticHash(sourceIdentity) !== semanticHash(expectedSourceIdentity) ||
      input.source.semanticHash !== expected.source.semanticHash ||
      input.source.semanticHash !== semanticHash({
        vertices: input.source.vertices,
        triangles: input.source.triangles,
      })) {
    throw new Error('Row W frozen source identity mismatch');
  }
  const constructionDeclaration = {
    kind: input.construction.kind,
    centerlineControl: input.construction.centerlineControl,
    centerlineSamples: input.construction.centerlineSamples,
    crossSectionMap: input.construction.crossSectionMap,
    scaleField: input.construction.scaleField,
    collarExtent: input.construction.collarExtent,
    posedCorrespondence: input.construction.posedVertices.map(vertex => ({
      id: vertex.id,
      index: vertex.index,
      region: vertex.region,
      sourceCoordinate: vertex.sourceCoordinate,
    })),
    boundaryFrames: input.boundaryFrames,
  };
  const expectedConstructionDeclaration = {
    kind: expected.construction.kind,
    centerlineControl: expected.construction.centerlineControl,
    centerlineSamples: expected.construction.centerlineSamples,
    crossSectionMap: expected.construction.crossSectionMap,
    scaleField: expected.construction.scaleField,
    collarExtent: expected.construction.collarExtent,
    posedCorrespondence: expected.construction.posedVertices.map(vertex => ({
      id: vertex.id,
      index: vertex.index,
      region: vertex.region,
      sourceCoordinate: vertex.sourceCoordinate,
    })),
    boundaryFrames: expected.boundaryFrames,
  };
  if (semanticHash(constructionDeclaration) !==
      semanticHash(expectedConstructionDeclaration)) {
    throw new Error('Row W recorded construction identity mismatch');
  }
}

export function evaluateAnalyticalElbowRowW(input) {
  try {
    validateInputIdentity(input);
  } catch (error) {
    return failureReport(
      input,
      'identity-validation',
      'identity-invalid',
      {},
      error.message,
    );
  }

  const finite = input.construction.posedVertices.every(vertex =>
    Array.isArray(vertex.position) && vertex.position.length === 3 &&
    vertex.position.every(Number.isFinite)
  );
  if (!finite) {
    return failureReport(
      input,
      'hard-veto-evaluation',
      'nonfinite-geometry',
      {
        finiteGeometry: { pass: false, nonFiniteVertexCount: 1 },
        constructionRecordConsistency: unevaluatedVeto(),
        rigidBoundaryResidual: unevaluatedVeto(),
        rigidZoneLeakage: unevaluatedVeto(),
        collarRecruitment: unevaluatedVeto(),
        frameOrientation: unevaluatedVeto(),
        surfaceOrientation: unevaluatedVeto(),
        transitionSelfIntersection: unevaluatedVeto(),
        crossSectionAreaRatio: unevaluatedVeto(),
        totalVolumeRatio: unevaluatedVeto(),
      },
      'input identity and correspondence validated',
    );
  }

  const parameters = constructionParameters();
  const expectedConstruction = createAnalyticalElbowRowWInput().construction;
  const constructionHashMatches = input.construction.semanticHash ===
    semanticHash({ posedVertices: input.construction.posedVertices });
  let maximumDeclaredMapResidual = 0;
  for (const expectedVertex of expectedConstruction.posedVertices) {
    maximumDeclaredMapResidual = Math.max(
      maximumDeclaredMapResidual,
      distance(
        expectedVertex.position,
        input.construction.posedVertices[expectedVertex.index].position,
      ),
    );
  }
  const startFrame = frameAt(0, parameters);
  const endFrame = frameAt(1, parameters);
  const child = input.boundaryFrames.child;
  const parent = input.boundaryFrames.parent;
  const maximumBoundaryResidual = Math.max(
    distance(startFrame.position, child.targetOrigin),
    distance(startFrame.tangent, child.targetTangent),
    distance(startFrame.radial, child.targetRadial),
    distance(startFrame.binormal, child.targetBinormal),
    distance(endFrame.position, parent.targetOrigin),
    distance(endFrame.tangent, parent.targetTangent),
    distance(endFrame.radial, parent.targetRadial),
    distance(endFrame.binormal, parent.targetBinormal),
  );

  let maximumRigidZoneError = 0;
  let rigidLeakageCount = 0;
  let collarRecruitmentCount = 0;
  for (const source of input.source.vertices) {
    const posed = input.construction.posedVertices[source.index];
    if (posed.id !== source.id || posed.index !== source.index ||
        posed.region !== source.region) {
      collarRecruitmentCount += 1;
    }
    if (source.region === 'collar') continue;
    const expected = source.region === 'parent-rigid'
      ? source.rest
      : rotateAroundZ(source.rest, parameters.radians);
    const error = distance(expected, posed.position);
    maximumRigidZoneError = Math.max(maximumRigidZoneError, error);
    if (error > EPSILON) rigidLeakageCount += 1;
  }

  let minimumFrameOrientationMagnitude = Infinity;
  let maximumFrameOrthogonalityError = 0;
  let maximumCurvatureRadiusProduct = 0;
  for (const sample of input.construction.centerlineSamples) {
    minimumFrameOrientationMagnitude = Math.min(
      minimumFrameOrientationMagnitude,
      -dot(cross(sample.radial, sample.binormal), sample.tangent),
    );
    maximumFrameOrthogonalityError = Math.max(
      maximumFrameOrthogonalityError,
      Math.abs(dot(sample.radial, sample.tangent)),
      Math.abs(dot(sample.binormal, sample.tangent)),
      Math.abs(dot(sample.radial, sample.binormal)),
      Math.abs(length(sample.tangent) - 1),
      Math.abs(length(sample.radial) - 1),
      Math.abs(length(sample.binormal) - 1),
    );
    maximumCurvatureRadiusProduct = Math.max(
      maximumCurvatureRadiusProduct,
      sample.curvature * 0.34,
    );
  }
  const minimumLocalTubeJacobian = 1 - maximumCurvatureRadiusProduct;
  const surface = surfaceDiagnostics(input);
  const intersections = selfIntersectionDiagnostics(input);
  const areaRatios = Array.from(
    { length: input.source.axialSegments + 1 },
    (_, ring) => ringCrossSectionArea(input, ring),
  );
  const minimumCrossSectionAreaRatio = Math.min(...areaRatios);
  const maximumCrossSectionAreaRatio = Math.max(...areaRatios);
  const restVertices = input.source.vertices.map(vertex => ({ rest: vertex.rest }));
  const posedVertices = input.construction.posedVertices.map(vertex => ({
    position: vertex.position,
  }));
  const restSignedVolume = signedSurfaceVolume(
    restVertices,
    input.source.triangles,
    'rest',
  );
  const posedSignedVolume = signedSurfaceVolume(
    posedVertices,
    input.source.triangles,
    'position',
  );
  const totalSignedVolumeRatio = posedSignedVolume / restSignedVolume;

  const hardVetoes = {
    finiteGeometry: { pass: true, nonFiniteVertexCount: 0 },
    constructionRecordConsistency: {
      pass: constructionHashMatches && maximumDeclaredMapResidual <= EPSILON,
      constructionHashMatches,
      maximumDeclaredMapResidual,
      tolerance: EPSILON,
    },
    rigidBoundaryResidual: {
      pass: maximumBoundaryResidual <= EPSILON,
      maximumResidual: maximumBoundaryResidual,
      tolerance: EPSILON,
    },
    rigidZoneLeakage: {
      pass: rigidLeakageCount === 0,
      leakingVertexCount: rigidLeakageCount,
      maximumError: maximumRigidZoneError,
      tolerance: EPSILON,
    },
    collarRecruitment: {
      pass: collarRecruitmentCount === 0,
      mismatchedRecordCount: collarRecruitmentCount,
    },
    frameOrientation: {
      pass: minimumFrameOrientationMagnitude > 1 - ORIENTATION_EPSILON &&
        maximumFrameOrthogonalityError <= ORIENTATION_EPSILON &&
        minimumLocalTubeJacobian > ORIENTATION_EPSILON,
      sampleCount: input.construction.centerlineSamples.length,
      minimumOrientationMagnitude: minimumFrameOrientationMagnitude,
      maximumOrthogonalityError: maximumFrameOrthogonalityError,
      minimumLocalTubeJacobian,
    },
    surfaceOrientation: {
      pass: surface.invertedTriangleCount === 0 &&
        surface.minimumPosedAreaRatio > ORIENTATION_EPSILON,
      invertedTriangleCount: surface.invertedTriangleCount,
      minimumPosedAreaRatio: surface.minimumPosedAreaRatio,
    },
    transitionSelfIntersection: {
      pass: intersections.globalIntersectionCount === 0 &&
        intersections.transitionIntersectionCount === 0,
      method: 'indexed-mesh-aabb-segment-triangle',
      testedPairCount: intersections.testedPairCount,
      globalIntersectionCount: intersections.globalIntersectionCount,
      transitionIntersectionCount: intersections.transitionIntersectionCount,
    },
    crossSectionAreaRatio: {
      pass: minimumCrossSectionAreaRatio >= 0.10,
      minimum: minimumCrossSectionAreaRatio,
      maximum: maximumCrossSectionAreaRatio,
      minimumAllowed: 0.10,
    },
    totalVolumeRatio: {
      pass: Math.abs(restSignedVolume) > ORIENTATION_EPSILON &&
        restSignedVolume * posedSignedVolume > 0 &&
        totalSignedVolumeRatio >= 0.50 && totalSignedVolumeRatio <= 1.50,
      ratio: totalSignedVolumeRatio,
      restSignedVolume,
      posedSignedVolume,
      allowedRange: [0.50, 1.50],
    },
  };
  const passed = Object.values(hardVetoes).every(veto => veto.pass === true);
  const metrics = {
    maximumBoundaryResidual,
    maximumRigidZoneError,
    minimumFrameOrientationMagnitude,
    maximumFrameOrthogonalityError,
    maximumCurvatureRadiusProduct,
    minimumLocalTubeJacobian,
    minimumCrossSectionAreaRatio,
    maximumCrossSectionAreaRatio,
    restSignedVolume,
    posedSignedVolume,
    totalSignedVolumeRatio,
    ...surface,
    ...intersections,
  };
  return {
    schema: ANALYTICAL_ELBOW_ROW_W_REPORT_SCHEMA,
    status: passed ? 'W_VALID' : 'W_INVALID',
    requestedRoute: input.requestedRoute,
    effectiveRoute: input.effectiveRoute,
    fallbackUsed: input.fallbackUsed,
    requestedConfig: structuredClone(input.requestedConfig),
    effectiveConfig: structuredClone(input.effectiveConfig),
    sourceIdentity: {
      id: input.source.id,
      semanticHash: input.source.semanticHash,
      constructionSemanticHash: input.construction.semanticHash,
    },
    failurePhase: passed ? null : 'hard-veto-evaluation',
    lastTrustworthyEvidence: passed
      ? 'all recorded Row W hard predicates evaluated and passed'
      : 'input identity, correspondence, and all recorded hard predicates evaluated',
    hardVetoes,
    metrics,
    primaryOutput: passed ? input.id : null,
    error: passed ? null : { code: 'row-w-hard-veto-failed' },
    claimCeiling:
      'one deterministic constructive sleeve map under recorded sampling and mesh predicates; no cage representation, solver, transfer, anatomy, visual, or production claim',
  };
}

export function createAnalyticalElbowRowWBundle() {
  const input = createAnalyticalElbowRowWInput();
  return {
    schema: ANALYTICAL_ELBOW_ROW_W_BUNDLE_SCHEMA,
    status: 'complete',
    case: 'row-w',
    input,
    report: evaluateAnalyticalElbowRowW(input),
  };
}
