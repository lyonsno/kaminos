import {
  ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA,
  ANALYTICAL_ELBOW_EXPORT_SCHEMA,
  ANALYTICAL_ELBOW_POSE_SCHEMA,
} from './analytical-elbow-core.mjs';

export const COLLAR_ASSAY_SCHEMA = 'kaminos.shape-bearing-collar-assay.v0';
export const COLLAR_WITNESS_DATA_SCHEMA =
  'kaminos.shape-bearing-collar-witness-data.v0';

const ROUTE = 'analytical-elbow-graded-collar';
const EPSILON = 1e-12;
const MAXIMUM_EDGE_STRETCH_RATIO = 1.15;
const MAXIMUM_AREA_STRETCH_RATIO = 1.3;
const MAXIMUM_RELATIVE_VOLUME_DRIFT = 0.15;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
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

function length(vector) {
  return Math.hypot(...vector);
}

function distance(left, right) {
  return length(subtract(left, right));
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

function createSleeve({ axialSegments = 40, radialSegments = 24 } = {}) {
  if (!Number.isInteger(axialSegments) || axialSegments < 12) {
    throw new Error('sleeve axialSegments must be an integer of at least 12');
  }
  if (!Number.isInteger(radialSegments) || radialSegments < 8) {
    throw new Error('sleeve radialSegments must be an integer of at least 8');
  }
  const parentLength = 1.35;
  const childLength = 1.2;
  const vertices = [];
  for (let ring = 0; ring <= axialSegments; ring += 1) {
    const fraction = ring / axialSegments;
    const y = parentLength - fraction * (parentLength + childLength);
    const jointProximity = 1 - Math.min(1, Math.abs(y) / 0.75);
    const radius = 0.22 + 0.12 * jointProximity;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = 2 * Math.PI * radial / radialSegments;
      vertices.push({
        id: `sleeve:${ring}:${radial}`,
        rest: [radius * Math.cos(theta), y, radius * Math.sin(theta)],
        axial: y,
      });
    }
  }
  const triangles = [];
  for (let ring = 0; ring < axialSegments; ring += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      const a = ring * radialSegments + radial;
      const b = (ring + 1) * radialSegments + radial;
      const c = (ring + 1) * radialSegments + next;
      const d = ring * radialSegments + next;
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  const parentCap = vertices.length;
  vertices.push({ id: 'sleeve:parent-cap', rest: [0, parentLength, 0], axial: parentLength });
  const childCap = vertices.length;
  vertices.push({ id: 'sleeve:child-cap', rest: [0, -childLength, 0], axial: -childLength });
  const lastRing = axialSegments * radialSegments;
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    triangles.push([parentCap, next, radial]);
    triangles.push([childCap, lastRing + radial, lastRing + next]);
  }
  return { axialSegments, radialSegments, vertices, triangles };
}

function collarWeight(axial, halfWidth) {
  if (halfWidth === 0) return axial < 0 ? 1 : 0;
  return smoothstep((halfWidth - axial) / (2 * halfWidth));
}

function deformSleeve(mesh, flexionDegrees, collarHalfWidth) {
  const radians = flexionDegrees * Math.PI / 180;
  return mesh.vertices.map(vertex => ({
    ...vertex,
    weight: collarWeight(vertex.axial, collarHalfWidth),
    posed: rotateAroundZ(
      vertex.rest,
      radians * collarWeight(vertex.axial, collarHalfWidth),
    ),
  }));
}

function triangleArea(vertices, triangle, field) {
  const [a, b, c] = triangle.map(index => vertices[index][field]);
  return 0.5 * length(cross(subtract(b, a), subtract(c, a)));
}

function signedVolume(vertices, triangles, field) {
  return Math.abs(triangles.reduce((sum, [a, b, c]) => {
    const pa = vertices[a][field];
    const pb = vertices[b][field];
    const pc = vertices[c][field];
    return sum + dot(pa, cross(pb, pc)) / 6;
  }, 0));
}

function meshEdges(triangles) {
  const counts = new Map();
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const edge = [triangle[index], triangle[(index + 1) % 3]].sort((a, b) => a - b);
      const key = `${edge[0]}:${edge[1]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function measure(mesh, vertices, flexionDegrees, collarHalfWidth) {
  let maximumAbsoluteLogEdgeStrain = 0;
  const edges = meshEdges(mesh.triangles);
  for (const key of edges.keys()) {
    const [a, b] = key.split(':').map(Number);
    const restLength = distance(vertices[a].rest, vertices[b].rest);
    const posedLength = distance(vertices[a].posed, vertices[b].posed);
    maximumAbsoluteLogEdgeStrain = Math.max(
      maximumAbsoluteLogEdgeStrain,
      Math.abs(Math.log(posedLength / restLength)),
    );
  }
  let maximumAbsoluteLogAreaStrain = 0;
  let invertedTriangleCount = 0;
  for (const triangle of mesh.triangles) {
    const restArea = triangleArea(vertices, triangle, 'rest');
    const posedArea = triangleArea(vertices, triangle, 'posed');
    maximumAbsoluteLogAreaStrain = Math.max(
      maximumAbsoluteLogAreaStrain,
      Math.abs(Math.log(posedArea / restArea)),
    );
    const [a, b, c] = triangle;
    const restNormal = cross(
      subtract(vertices[b].rest, vertices[a].rest),
      subtract(vertices[c].rest, vertices[a].rest),
    );
    const posedNormal = cross(
      subtract(vertices[b].posed, vertices[a].posed),
      subtract(vertices[c].posed, vertices[a].posed),
    );
    const transportedNormal = rotateAroundZ(
      restNormal,
      flexionDegrees * Math.PI / 180 *
        (vertices[a].weight + vertices[b].weight + vertices[c].weight) / 3,
    );
    if (dot(transportedNormal, posedNormal) <= 0) invertedTriangleCount += 1;
  }
  const radians = flexionDegrees * Math.PI / 180;
  let maximumParentRigidError = 0;
  let maximumChildRigidError = 0;
  let parentRigidSampleCount = 0;
  let childRigidSampleCount = 0;
  for (const vertex of vertices) {
    if (vertex.axial >= collarHalfWidth) {
      parentRigidSampleCount += 1;
      maximumParentRigidError = Math.max(
        maximumParentRigidError,
        distance(vertex.rest, vertex.posed),
      );
    }
    if (vertex.axial <= -collarHalfWidth) {
      childRigidSampleCount += 1;
      maximumChildRigidError = Math.max(
        maximumChildRigidError,
        distance(rotateAroundZ(vertex.rest, radians), vertex.posed),
      );
    }
  }
  const restVolume = signedVolume(vertices, mesh.triangles, 'rest');
  const posedVolume = signedVolume(vertices, mesh.triangles, 'posed');
  return {
    maximumAbsoluteLogEdgeStrain,
    maximumAbsoluteLogAreaStrain,
    relativeVolumeDrift: Math.abs(posedVolume - restVolume) / restVolume,
    maximumParentRigidError,
    maximumChildRigidError,
    parentRigidSampleCount,
    childRigidSampleCount,
    invertedTriangleCount,
    openBoundaryEdgeCount: [...edges.values()].filter(count => count !== 2).length,
    nonFiniteVertexCount: vertices.filter(vertex =>
      vertex.posed.some(value => !Number.isFinite(value))).length,
  };
}

function measureTriangle(vertices, triangle, flexionDegrees) {
  let maximumAbsoluteLogEdgeStrain = 0;
  for (let index = 0; index < 3; index += 1) {
    const a = triangle[index];
    const b = triangle[(index + 1) % 3];
    const restLength = distance(vertices[a].rest, vertices[b].rest);
    const posedLength = distance(vertices[a].posed, vertices[b].posed);
    maximumAbsoluteLogEdgeStrain = Math.max(
      maximumAbsoluteLogEdgeStrain,
      Math.abs(Math.log(posedLength / restLength)),
    );
  }
  const restArea = triangleArea(vertices, triangle, 'rest');
  const posedArea = triangleArea(vertices, triangle, 'posed');
  const [a, b, c] = triangle;
  const restNormal = cross(
    subtract(vertices[b].rest, vertices[a].rest),
    subtract(vertices[c].rest, vertices[a].rest),
  );
  const posedNormal = cross(
    subtract(vertices[b].posed, vertices[a].posed),
    subtract(vertices[c].posed, vertices[a].posed),
  );
  const transportedNormal = rotateAroundZ(
    restNormal,
    flexionDegrees * Math.PI / 180 *
      (vertices[a].weight + vertices[b].weight + vertices[c].weight) / 3,
  );
  return {
    indices: [...triangle],
    maximumAbsoluteLogEdgeStrain,
    absoluteLogAreaStrain: Math.abs(Math.log(posedArea / restArea)),
    inverted: dot(transportedNormal, posedNormal) <= 0,
  };
}

function validateSource(source) {
  if (!source || source.effectiveRoute !== 'analytical-cage') {
    throw new Error('shape-bearing collar assay requires effective analytical-cage source route');
  }
  const hasReviewedIdentity = source?.schema === ANALYTICAL_ELBOW_EXPORT_SCHEMA &&
    source.sourceSchema === ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA &&
    source.requestedRoute === 'analytical-cage' &&
    source.effectiveRoute === 'analytical-cage' &&
    source.fallbackUsed === false &&
    source.sourceAuthority?.kind === 'synthetic-proxy' &&
    source.sourceAuthority?.anatomicalAdmission === 'structural-hypothesis';
  if (!hasReviewedIdentity) {
    throw new Error('shape-bearing collar assay requires reviewed analytical elbow source identity');
  }
  if (source.sourceId !== 'synthetic-mammalian-elbow-v0') {
    throw new Error('shape-bearing collar assay requires the reviewed analytical elbow source');
  }
  if (!Array.isArray(source.poses) || source.poses.length === 0) {
    throw new Error('shape-bearing collar assay requires at least one source pose');
  }
  for (const pose of source.poses) {
    if (pose.schema !== ANALYTICAL_ELBOW_POSE_SCHEMA ||
        pose.sourceSchema !== ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA ||
        pose.sourceAuthority !== 'synthetic-proxy') {
      throw new Error('shape-bearing collar assay requires reviewed analytical elbow source identity');
    }
    if (!Number.isFinite(pose.effectiveFlexionDegrees)) {
      throw new Error('shape-bearing collar assay source pose must be finite');
    }
    if (pose.sourceId !== source.sourceId) {
      throw new Error('shape-bearing collar assay source pose identity mismatch');
    }
  }
}

export function runShapeBearingCollarAssay({ source, collarHalfWidths }) {
  validateSource(source);
  if (!Array.isArray(collarHalfWidths) || collarHalfWidths.length === 0) {
    throw new Error('shape-bearing collar assay requires collar half-widths');
  }
  for (const width of collarHalfWidths) {
    if (!Number.isFinite(width) || width < 0) {
      throw new Error('collar half-width must be finite and nonnegative');
    }
  }
  const mesh = createSleeve();
  const minimumRigidZoneSampleCount = mesh.radialSegments + 1;
  const rows = source.poses.flatMap(pose => collarHalfWidths.map(collarHalfWidth => {
    const vertices = deformSleeve(
      mesh,
      pose.effectiveFlexionDegrees,
      collarHalfWidth,
    );
    const metrics = measure(
      mesh,
      vertices,
      pose.effectiveFlexionDegrees,
      collarHalfWidth,
    );
    const qualifies = metrics.invertedTriangleCount === 0 &&
      metrics.openBoundaryEdgeCount === 0 &&
      metrics.nonFiniteVertexCount === 0 &&
      metrics.maximumAbsoluteLogEdgeStrain <= Math.log(MAXIMUM_EDGE_STRETCH_RATIO) &&
      metrics.maximumAbsoluteLogAreaStrain <= Math.log(MAXIMUM_AREA_STRETCH_RATIO) &&
      metrics.relativeVolumeDrift <= MAXIMUM_RELATIVE_VOLUME_DRIFT &&
      metrics.maximumParentRigidError <= EPSILON &&
      metrics.maximumChildRigidError <= EPSILON &&
      metrics.parentRigidSampleCount >= minimumRigidZoneSampleCount &&
      metrics.childRigidSampleCount >= minimumRigidZoneSampleCount;
    return {
      flexionDegrees: pose.effectiveFlexionDegrees,
      collarHalfWidth,
      qualifies,
      metrics,
    };
  }));
  const positiveWidths = collarHalfWidths.filter(width => width > 0);
  const survivingWidths = positiveWidths.filter(width =>
    rows.filter(row => row.collarHalfWidth === width).every(row => row.qualifies));
  return {
    schema: COLLAR_ASSAY_SCHEMA,
    status: 'complete',
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    source: {
      id: source.sourceId,
      schema: source.sourceSchema,
      requestedRoute: source.requestedRoute,
      effectiveRoute: source.effectiveRoute,
      fallbackUsed: source.fallbackUsed,
      authority: structuredClone(source.sourceAuthority),
    },
    poseDegrees: source.poses.map(pose => pose.effectiveFlexionDegrees),
    collarHalfWidths: [...collarHalfWidths],
    thresholds: {
      maximumEdgeStretchRatio: MAXIMUM_EDGE_STRETCH_RATIO,
      maximumAreaStretchRatio: MAXIMUM_AREA_STRETCH_RATIO,
      maximumRelativeVolumeDrift: MAXIMUM_RELATIVE_VOLUME_DRIFT,
      maximumRigidZoneError: EPSILON,
      minimumRigidZoneSampleCount,
    },
    sleeve: {
      vertexCount: mesh.vertices.length,
      triangleCount: mesh.triangles.length,
      watertight: [...meshEdges(mesh.triangles).values()].every(count => count === 2),
    },
    rows,
    disposition: survivingWidths.length > 0
      ? 'ADVANCE_GRADED_SURFACE_COLLAR'
      : 'PROMOTE_VOLUMETRIC_OR_CORRECTIVE_CAGE',
    survivingWidths,
    claimCeiling: 'provisional-clean-topology-shape-bearing-collar-mechanism',
  };
}

export function createShapeBearingCollarWitnessDataset({ source }) {
  const collarHalfWidths = [0, 0.72];
  const assay = runShapeBearingCollarAssay({ source, collarHalfWidths });
  const requestedCases = [
    [35, 0],
    [35, 0.72],
    [80, 0],
    [80, 0.72],
  ];
  const availablePoses = new Set(
    source.poses.map(pose => pose.effectiveFlexionDegrees),
  );
  for (const [flexionDegrees] of requestedCases) {
    if (!availablePoses.has(flexionDegrees)) {
      throw new Error(
        `shape-bearing collar witness requires source pose ${flexionDegrees}`,
      );
    }
  }

  const mesh = createSleeve();
  const cases = requestedCases.map(([flexionDegrees, collarHalfWidth]) => {
    const vertices = deformSleeve(mesh, flexionDegrees, collarHalfWidth);
    const row = assay.rows.find(candidate =>
      candidate.flexionDegrees === flexionDegrees &&
      candidate.collarHalfWidth === collarHalfWidth
    );
    return {
      id: `flexion-${flexionDegrees}-collar-${collarHalfWidth}`,
      flexionDegrees,
      collarHalfWidth,
      qualifies: row.qualifies,
      metrics: structuredClone(row.metrics),
      vertices: vertices.map((vertex, index) => ({
        id: vertex.id,
        index,
        axial: vertex.axial,
        rest: [...vertex.rest],
        posed: [...vertex.posed],
        weight: vertex.weight,
        region: collarHalfWidth > 0 && Math.abs(vertex.axial) < collarHalfWidth
          ? 'collar'
          : vertex.axial >= collarHalfWidth
            ? 'parent-rigid'
            : 'child-rigid',
      })),
      triangles: mesh.triangles.map(triangle =>
        measureTriangle(vertices, triangle, flexionDegrees)
      ),
    };
  });

  return {
    schema: COLLAR_WITNESS_DATA_SCHEMA,
    status: 'complete',
    requestedRoute: 'analytical-elbow-collar-failure-witness',
    effectiveRoute: 'analytical-elbow-collar-failure-witness',
    fallbackUsed: false,
    source: structuredClone(assay.source),
    thresholds: structuredClone(assay.thresholds),
    visualContract: {
      startsPaused: true,
      animationActive: false,
      heatThresholdLogStrain: Math.log(MAXIMUM_EDGE_STRETCH_RATIO),
      cameraPresets: ['profile', 'three-quarter'],
      comparisonCases: requestedCases.map(([flexionDegrees, collarHalfWidth]) => ({
        flexionDegrees,
        collarHalfWidth,
      })),
    },
    assay,
    cases,
    claimCeiling:
      'diagnostic visualization of the reviewed synthetic sleeve control failure; no creature, corrective-cage, anatomical, or production claim',
  };
}
