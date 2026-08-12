import { createHash } from 'node:crypto';

export const ROW_DISTINCT_FIELD_ASSAY_SCHEMA =
  'kaminos.row-distinct-scalar-anisotropic-result.v0';
export const TARGET_SDF_FULL_SURFACE_SWEEP_SCHEMA =
  'kaminos.target-sdf-full-surface-sweep-result.v0';

const ASSAY_CARD_SCHEMA = 'kaminos.row-distinct-scalar-anisotropic-assay.v0';
const TARGET_SCHEMA = 'kaminos.row-distinct-boundary-response-target.v0';
const FULL_SURFACE_CARD_SCHEMA = 'kaminos.target-sdf-full-surface-sweep-assay.v0';
const SCALAR_ROW = Object.freeze({
  id: 'scalar-metaball-control',
  role: 'undifferentiated-interior-control',
  compilerId: 'scalar-metaball-sdf-v0',
  extractorId: 'marching-tetrahedra-zero-isosurface-v0',
  identityMode: 'none',
  evidenceDisposition: 'control-observation',
});
const ANISOTROPIC_ROW = Object.freeze({
  id: 'anisotropic-identity-challenger',
  role: 'identity-bearing-interior-challenger',
  compilerId: 'anisotropic-tissue-field-v0',
  extractorId: 'identity-carrying-marching-tetrahedra-v0',
  identityMode: 'mixture-weights',
  evidenceDisposition: 'candidate-evidence',
});
const ROW_BINDINGS = Object.freeze({
  [SCALAR_ROW.id]: SCALAR_ROW,
  [ANISOTROPIC_ROW.id]: ANISOTROPIC_ROW,
});
const CUBE_CORNERS = Object.freeze([
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]);
const TETRAHEDRA = Object.freeze([
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
]);
const TETRA_EDGES = Object.freeze([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateInputs(assayCard, target) {
  if (assayCard?.schema !== ASSAY_CARD_SCHEMA || target?.schema !== TARGET_SCHEMA) {
    throw new Error('row-distinct assay card and target schemas are required');
  }
  if (assayCard.targetRef !== 'fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json') {
    throw new Error('assay target reference does not match the closed assay card');
  }
  if (target.authority?.sourceKind !== 'independently-authored-synthetic-observation') {
    throw new Error('candidate-independent synthetic target authority is required');
  }
  const expectedIds = Object.keys(ROW_BINDINGS);
  if (assayCard.rows?.length !== expectedIds.length || !expectedIds.every((rowId) => {
    const row = assayCard.rows.find((candidate) => candidate?.id === rowId);
    return row && Object.entries(ROW_BINDINGS[rowId]).every(([field, value]) => row[field] === value);
  })) {
    throw new Error('row compiler identity does not match the closed assay card');
  }
  if (target.stations?.length < 5) throw new Error('target requires boundary stations');
  if (!Number.isInteger(assayCard.extraction?.longitudinalClosureCells)
    || assayCard.extraction.longitudinalClosureCells < 1) {
    throw new Error('assay requires an explicit longitudinal closure band');
  }
  if (assayCard.camera?.id !== 'right-sagittal-boundary-observation-v0'
    || target.frame?.cameraId !== assayCard.camera.id
    || canonicalJson(assayCard.camera.bounds) !== canonicalJson(assayCard.grid.bounds)) {
    throw new Error('assay camera must preserve the frozen grid bounds');
  }
  if (assayCard.promotion !== 'none') throw new Error('assay cannot carry promotion authority');
}

function stationSpacing(target, index) {
  if (index === 0) return target.stations[1].anterior - target.stations[0].anterior;
  if (index === target.stations.length - 1) {
    return target.stations[index].anterior - target.stations[index - 1].anterior;
  }
  return (target.stations[index + 1].anterior - target.stations[index - 1].anterior) * 0.5;
}

function baselinePrimitives(target, mode) {
  const isolatedIsoRadius = Math.sqrt(1 - Math.sqrt(0.22));
  return target.stations.flatMap((station, index) => {
    const centerY = (station.baseline.top + station.baseline.bottom) * 0.5;
    const radiusY = (station.baseline.top - station.baseline.bottom) * 0.5;
    const radiusX = station.baseline.halfWidth;
    const radiusZ = stationSpacing(target, index) * 0.78;
    if (mode === 'scalar') {
      const physicalRadius = Math.min(0.095, stationSpacing(target, index) * 0.72);
      const supportRadius = physicalRadius / isolatedIsoRadius;
      const centerExtentX = Math.max(0, radiusX - physicalRadius);
      const centerExtentY = Math.max(0, radiusY - physicalRadius);
      const centerSpacing = physicalRadius * 1.45;
      const axisCenters = (extent) => {
        if (extent === 0) return [0];
        const minimumCount = Math.max(3, Math.ceil((extent * 2) / centerSpacing) + 1);
        const count = minimumCount % 2 === 0 ? minimumCount + 1 : minimumCount;
        return Array.from(
          { length: count },
          (_, centerIndex) => -extent + centerIndex * extent * 2 / (count - 1),
        );
      };
      const centersX = axisCenters(centerExtentX);
      const centersY = axisCenters(centerExtentY);
      const packed = [];
      for (const offsetY of centersY) {
        for (const offsetX of centersX) {
          const normalizedX = centerExtentX === 0 ? 0 : offsetX / centerExtentX;
          const normalizedY = centerExtentY === 0 ? 0 : offsetY / centerExtentY;
          if (normalizedX * normalizedX + normalizedY * normalizedY > 1.000001) continue;
          packed.push({
            id: `metaball-${index}-${packed.length}`,
            componentId: null,
            center: [offsetX, centerY + offsetY, station.anterior],
            sectionCenterY: centerY,
            radii: [supportRadius, supportRadius, supportRadius],
            strength: 1,
          });
        }
      }
      return packed;
    }
    return [{
      id: `anisotropic-${index}`,
      componentId: station.targetComponentId,
      center: [0, centerY, station.anterior],
      radii: [
        radiusX / isolatedIsoRadius,
        radiusY / isolatedIsoRadius,
        radiusZ / isolatedIsoRadius,
      ],
      strength: 1,
    }];
  });
}

function perturbPrimitives(primitives, mode, delta) {
  return primitives.map((primitive) => {
    const next = {
      ...primitive,
      center: [...primitive.center],
      radii: [...primitive.radii],
    };
    if (mode === 'scalar') {
      const support = Math.max(0, 1 - Math.abs(primitive.center[2] + 0.22) / 0.42);
      const scaleX = 1 + delta * 0.9 * support;
      const scaleY = 1 + delta * 1.05 * support;
      next.center[0] *= scaleX;
      next.center[1] = primitive.sectionCenterY
        + (primitive.center[1] - primitive.sectionCenterY) * scaleY
        + delta * 0.1 * support;
      next.radii = next.radii.map((radius) => radius * (1 + delta * 0.15 * support));
      return next;
    }
    if (primitive.componentId === 'gluteal-carrier') {
      next.radii[0] *= 1 + delta * 1.0;
      next.radii[1] *= 1 + delta * 1.35;
      next.center[1] += delta * 0.15;
    } else if (primitive.componentId === 'haunch-bulk') {
      next.radii[0] *= 1 + delta * 0.3;
      next.radii[1] *= 1 + delta * 0.2;
    } else if (primitive.componentId === 'ischial-tether') {
      next.center[1] -= delta * 0.12;
      next.radii[1] *= 1 + delta * 0.15;
    }
    return next;
  });
}

function contributionAt(point, primitive) {
  const q = point.reduce((sum, coordinate, axis) => {
    const normalized = (coordinate - primitive.center[axis]) / primitive.radii[axis];
    return sum + normalized * normalized;
  }, 0);
  if (q >= 1) return 0;
  return primitive.strength * (1 - q) ** 2;
}

function createField(primitives, grid, extraction) {
  const [low, high] = grid.bounds.anterior;
  const step = (high - low) / (grid.resolution[2] - 1);
  const margin = step * extraction.longitudinalClosureCells;
  const smoothstep = (value) => value * value * (3 - 2 * value);
  const longitudinalWeight = (anterior) => {
    if (anterior <= low || anterior >= high) return 0;
    if (anterior < low + margin) return smoothstep((anterior - low) / margin);
    if (anterior > high - margin) return smoothstep((high - anterior) / margin);
    return 1;
  };
  return {
    primitives,
    evaluate(point) {
      const contribution = primitives.reduce(
        (sum, primitive) => sum + contributionAt(point, primitive),
        0,
      );
      return contribution * longitudinalWeight(point[2]) - 0.22;
    },
    contributions(point) {
      return primitives.map((primitive) => ({
        componentId: primitive.componentId,
        value: contributionAt(point, primitive),
      })).filter((entry) => entry.value > 0);
    },
  };
}

function interpolateIso(a, b, valueA, valueB) {
  const denominator = valueA - valueB;
  const t = Math.abs(denominator) < 1e-12 ? 0.5 : valueA / denominator;
  return a.map((coordinate, axis) => coordinate + (b[axis] - coordinate) * t);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function orderPolygon(points) {
  if (points.length <= 3) return points;
  const center = [0, 1, 2].map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  );
  const u = normalize(points[0].map((value, axis) => value - center[axis]));
  const first = points[1].map((value, axis) => value - points[0][axis]);
  const second = points[2].map((value, axis) => value - points[0][axis]);
  const normal = normalize(cross(first, second));
  const v = normalize(cross(normal, u));
  return [...points].sort((left, right) => {
    const leftDelta = left.map((value, axis) => value - center[axis]);
    const rightDelta = right.map((value, axis) => value - center[axis]);
    return Math.atan2(dot(leftDelta, v), dot(leftDelta, u))
      - Math.atan2(dot(rightDelta, v), dot(rightDelta, u));
  });
}

function extractMesh(field, grid) {
  const axes = ['right', 'dorsal', 'anterior'];
  const coordinates = axes.map((axis, axisIndex) => {
    const [low, high] = grid.bounds[axis];
    return Array.from({ length: grid.resolution[axisIndex] }, (_, index) => (
      low + (high - low) * index / (grid.resolution[axisIndex] - 1)
    ));
  });
  const values = new Float64Array(grid.resolution[0] * grid.resolution[1] * grid.resolution[2]);
  const offset = (x, y, z) => x + grid.resolution[0] * (y + grid.resolution[1] * z);
  for (let z = 0; z < grid.resolution[2]; z += 1) {
    for (let y = 0; y < grid.resolution[1]; y += 1) {
      for (let x = 0; x < grid.resolution[0]; x += 1) {
        values[offset(x, y, z)] = field.evaluate([
          coordinates[0][x], coordinates[1][y], coordinates[2][z],
        ]);
      }
    }
  }

  const vertices = [];
  const faces = [];
  const vertexIndex = new Map();
  const addVertex = (point) => {
    const key = point.map((value) => value.toFixed(8)).join(':');
    if (!vertexIndex.has(key)) {
      vertexIndex.set(key, vertices.length);
      vertices.push(point);
    }
    return vertexIndex.get(key);
  };

  for (let z = 0; z < grid.resolution[2] - 1; z += 1) {
    for (let y = 0; y < grid.resolution[1] - 1; y += 1) {
      for (let x = 0; x < grid.resolution[0] - 1; x += 1) {
        const cubePoints = CUBE_CORNERS.map(([dx, dy, dz]) => [
          coordinates[0][x + dx], coordinates[1][y + dy], coordinates[2][z + dz],
        ]);
        const cubeValues = CUBE_CORNERS.map(([dx, dy, dz]) => values[offset(x + dx, y + dy, z + dz)]);
        for (const tetrahedron of TETRAHEDRA) {
          const points = [];
          for (const [edgeA, edgeB] of TETRA_EDGES) {
            const a = tetrahedron[edgeA];
            const b = tetrahedron[edgeB];
            if ((cubeValues[a] >= 0) === (cubeValues[b] >= 0)) continue;
            points.push(interpolateIso(cubePoints[a], cubePoints[b], cubeValues[a], cubeValues[b]));
          }
          const unique = [...new Map(points.map((point) => [
            point.map((value) => value.toFixed(8)).join(':'), point,
          ])).values()];
          if (unique.length < 3) continue;
          const ordered = orderPolygon(unique);
          const indices = ordered.map(addVertex);
          for (let index = 1; index < indices.length - 1; index += 1) {
            const face = [indices[0], indices[index], indices[index + 1]];
            if (new Set(face).size === 3) faces.push(face);
          }
        }
      }
    }
  }
  return { vertices, faces };
}

function observeBoundary(field, target, stateId) {
  const bounds = { right: [-0.8, 0.8], dorsal: [-0.75, 0.75] };
  const samplePositiveExtent = (axis, fixed, low, high) => {
    const samples = 801;
    const positive = [];
    for (let index = 0; index < samples; index += 1) {
      const coordinate = low + (high - low) * index / (samples - 1);
      const point = axis === 0
        ? [coordinate, fixed.dorsal, fixed.anterior]
        : [0, coordinate, fixed.anterior];
      if (field.evaluate(point) >= 0) positive.push(coordinate);
    }
    if (positive.length === 0) return null;
    return [Math.min(...positive), Math.max(...positive)];
  };
  return target.stations.map((station) => {
    const targetState = station[stateId];
    const centerY = (targetState.top + targetState.bottom) * 0.5;
    const widthExtent = samplePositiveExtent(
      0,
      { dorsal: centerY, anterior: station.anterior },
      ...bounds.right,
    );
    const dorsalExtent = samplePositiveExtent(
      1,
      { anterior: station.anterior },
      ...bounds.dorsal,
    );
    if (!widthExtent || !dorsalExtent) return { anterior: station.anterior, observed: false };
    return {
      anterior: station.anterior,
      observed: true,
      top: dorsalExtent[1],
      bottom: dorsalExtent[0],
      halfWidth: Math.max(Math.abs(widthExtent[0]), Math.abs(widthExtent[1])),
    };
  });
}

function rmse(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function baselineFit(observed, target, assayCard) {
  const errors = [];
  for (let index = 0; index < target.stations.length; index += 1) {
    if (!observed[index].observed) continue;
    for (const field of ['top', 'bottom', 'halfWidth']) {
      errors.push((observed[index][field] - target.stations[index].baseline[field]) / target.normalizationSpan);
    }
  }
  const observedStationFraction = observed.filter((entry) => entry.observed).length / target.stations.length;
  const normalizedRmse = errors.length > 0 ? rmse(errors) : Number.POSITIVE_INFINITY;
  return {
    observedStationFraction,
    normalizedRmse,
    passed: observedStationFraction >= assayCard.baselineFit.minimumObservedStationFraction
      && normalizedRmse <= assayCard.baselineFit.maximumNormalizedRmse,
  };
}

function responseLedger(baseline, perturbed, target, assayCard) {
  const comparisons = {};
  const errors = [];
  const candidateMagnitudes = [];
  const inside = [];
  const outside = [];
  let directions = 0;
  let matchingDirections = 0;
  const topDeltas = [];
  for (let index = 0; index < target.stations.length; index += 1) {
    const station = target.stations[index];
    const candidate = {};
    const expected = {};
    for (const field of ['top', 'bottom', 'halfWidth']) {
      candidate[field] = perturbed[index][field] - baseline[index][field];
      expected[field] = station.perturbed[field] - station.baseline[field];
      errors.push((candidate[field] - expected[field]) / target.normalizationSpan);
      if (Math.abs(expected[field]) > 1e-9) {
        directions += 1;
        if (Math.sign(candidate[field]) === Math.sign(expected[field])) matchingDirections += 1;
      }
    }
    const magnitude = Math.hypot(candidate.top, candidate.bottom, candidate.halfWidth);
    candidateMagnitudes.push(magnitude);
    topDeltas.push(candidate.top);
    if (station.anterior >= assayCard.control.support[0]
      && station.anterior <= assayCard.control.support[1]) inside.push(magnitude);
    else outside.push(magnitude);
    comparisons[station.anterior] = { expected, candidate };
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const maxSecondDifference = Math.max(...topDeltas.slice(1, -1).map(
    (value, index) => Math.abs(topDeltas[index] - value * 2 + topDeltas[index + 2]),
  ));
  return {
    stationComparisons: comparisons,
    normalizedRmse: rmse(errors),
    directionAgreement: matchingDirections / Math.max(directions, 1),
    localityRatio: mean(inside) / Math.max(mean(outside), 1e-12),
    maxSecondDifference,
    candidateMagnitudes,
  };
}

function surfaceEvidence(field, mesh, identityMode) {
  if (identityMode === 'none') {
    return { identityMode, sampledVertexCount: mesh.vertices.length, componentFractions: {} };
  }
  const totals = new Map();
  let total = 0;
  for (const vertex of mesh.vertices) {
    for (const contribution of field.contributions(vertex)) {
      if (!contribution.componentId) continue;
      totals.set(
        contribution.componentId,
        (totals.get(contribution.componentId) ?? 0) + contribution.value,
      );
      total += contribution.value;
    }
  }
  return {
    identityMode,
    sampledVertexCount: mesh.vertices.length,
    componentFractions: Object.fromEntries(
      [...totals.entries()].map(([componentId, value]) => [componentId, value / Math.max(total, 1e-12)]),
    ),
  };
}

function topologyClosed(mesh) {
  const edges = new Map();
  for (const face of mesh.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return mesh.faces.length > 0 && [...edges.values()].every((count) => count === 2);
}

function topologyEvidence(mesh) {
  const adjacency = new Map();
  const connect = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  for (const face of mesh.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      connect(a, b);
      connect(b, a);
    }
  }
  const visited = new Set();
  let componentCount = 0;
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    componentCount += 1;
    const stack = [start];
    while (stack.length > 0) {
      const vertex = stack.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const neighbor of adjacency.get(vertex) ?? []) stack.push(neighbor);
    }
  }
  return {
    closed: topologyClosed(mesh),
    componentCount,
    vertexCount: mesh.vertices.length,
    faceCount: mesh.faces.length,
  };
}

function meshAreaAndVolume(mesh) {
  const center = [0, 1, 2].map((axis) => (
    mesh.vertices.reduce((sum, vertex) => sum + vertex[axis], 0)
      / Math.max(mesh.vertices.length, 1)
  ));
  let area = 0;
  let signedVolume = 0;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((index) => mesh.vertices[index]);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    let normal = cross(ab, ac);
    const faceCenter = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
    const outward = faceCenter.map((value, axis) => value - center[axis]);
    if (dot(normal, outward) < 0) normal = normal.map((value) => -value);
    area += Math.hypot(...normal) * 0.5;
    signedVolume += dot(a, cross(b, c)) * (dot(cross(ab, ac), outward) < 0 ? -1 : 1) / 6;
  }
  return { area, volume: Math.abs(signedVolume) };
}

function targetStationState(target, station, stateId, amplitude, referenceAmplitude) {
  if (stateId === 'baseline') return station.baseline;
  const scale = amplitude / referenceAmplitude;
  return Object.fromEntries(['top', 'bottom', 'halfWidth'].map((field) => [
    field,
    station.baseline[field] + (station.perturbed[field] - station.baseline[field]) * scale,
  ]));
}

function createIndependentTargetField(target, grid, stateId, amplitude, referenceAmplitude) {
  const stationParameters = target.stations.map((station) => {
    const state = targetStationState(target, station, stateId, amplitude, referenceAmplitude);
    return {
      anterior: station.anterior,
      centerY: (state.top + state.bottom) * 0.5,
      radiusY: (state.top - state.bottom) * 0.5,
      radiusX: state.halfWidth,
    };
  });
  const first = stationParameters[0];
  const last = stationParameters.at(-1);
  const firstSpacing = stationParameters[1].anterior - first.anterior;
  const lastSpacing = last.anterior - stationParameters.at(-2).anterior;
  const closureLow = Math.max(grid.bounds.anterior[0], first.anterior - firstSpacing * 0.5);
  const closureHigh = Math.min(grid.bounds.anterior[1], last.anterior + lastSpacing * 0.5);
  const parametersAt = (anterior) => {
    if (anterior <= first.anterior) return first;
    if (anterior >= last.anterior) return last;
    const upperIndex = stationParameters.findIndex((station) => station.anterior >= anterior);
    const lower = stationParameters[upperIndex - 1];
    const upper = stationParameters[upperIndex];
    const t = (anterior - lower.anterior) / (upper.anterior - lower.anterior);
    return {
      centerY: lower.centerY + (upper.centerY - lower.centerY) * t,
      radiusY: lower.radiusY + (upper.radiusY - lower.radiusY) * t,
      radiusX: lower.radiusX + (upper.radiusX - lower.radiusX) * t,
    };
  };
  return {
    authority: 'independent-frozen-station-loft',
    evaluate(point) {
      const [right, dorsal, anterior] = point;
      const section = parametersAt(anterior);
      const normalizedRadius = Math.hypot(
        right / section.radiusX,
        (dorsal - section.centerY) / section.radiusY,
      );
      const radialDistance = (1 - normalizedRadius) * Math.min(
        section.radiusX,
        section.radiusY,
      );
      return Math.min(radialDistance, anterior - closureLow, closureHigh - anterior);
    },
  };
}

function fullSurfaceEvidence(mesh, referenceField, normalizationSpan) {
  let weightedSquaredError = 0;
  let totalArea = 0;
  let maximumError = 0;
  let sampledTriangleCount = 0;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((index) => mesh.vertices[index]);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const triangleArea = Math.hypot(...cross(ab, ac)) * 0.5;
    if (triangleArea <= 1e-14) continue;
    const centroid = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
    const error = Math.abs(referenceField.evaluate(centroid)) / normalizationSpan;
    weightedSquaredError += triangleArea * error * error;
    totalArea += triangleArea;
    maximumError = Math.max(maximumError, error);
    sampledTriangleCount += 1;
  }
  const geometry = meshAreaAndVolume(mesh);
  return {
    normalizedRmse: Math.sqrt(weightedSquaredError / Math.max(totalArea, 1e-12)),
    maximumNormalizedError: maximumError,
    sampledTriangleCount,
    area: geometry.area,
    volume: geometry.volume,
  };
}

function sliceMeshAtAnterior(mesh, anterior) {
  const epsilon = 1e-9;
  const segments = [];
  for (const face of mesh.faces) {
    const vertices = face.map((index) => mesh.vertices[index]);
    const intersections = [];
    for (const [leftIndex, rightIndex] of [[0, 1], [1, 2], [2, 0]]) {
      const left = vertices[leftIndex];
      const right = vertices[rightIndex];
      const leftDistance = left[2] - anterior;
      const rightDistance = right[2] - anterior;
      if (Math.abs(leftDistance) <= epsilon) intersections.push([left[0], left[1]]);
      if (leftDistance * rightDistance < -epsilon * epsilon) {
        const t = leftDistance / (leftDistance - rightDistance);
        intersections.push([
          left[0] + (right[0] - left[0]) * t,
          left[1] + (right[1] - left[1]) * t,
        ]);
      }
    }
    const unique = [...new Map(intersections.map((point) => [
      point.map((value) => value.toFixed(8)).join(':'), point,
    ])).values()];
    if (unique.length < 2) continue;
    let pair = [unique[0], unique[1]];
    let greatestDistance = 0;
    for (let a = 0; a < unique.length; a += 1) {
      for (let b = a + 1; b < unique.length; b += 1) {
        const distance = Math.hypot(
          unique[a][0] - unique[b][0],
          unique[a][1] - unique[b][1],
        );
        if (distance > greatestDistance) {
          greatestDistance = distance;
          pair = [unique[a], unique[b]];
        }
      }
    }
    if (greatestDistance > epsilon) segments.push(pair);
  }
  return {
    anterior,
    source: 'extracted-mesh-triangle-plane-intersections',
    segments,
  };
}

function scaledTarget(target, amplitude, referenceAmplitude) {
  const scaled = structuredClone(target);
  scaled.stations = scaled.stations.map((station) => ({
    ...station,
    perturbed: targetStationState(target, station, 'perturbed', amplitude, referenceAmplitude),
  }));
  scaled.authority = {
    ...scaled.authority,
    derivation: `frozen displacement scaled by ${amplitude / referenceAmplitude}`,
  };
  return scaled;
}

function validateFullSurfaceInputs(sweepCard, assayCard, target) {
  validateInputs(assayCard, target);
  if (sweepCard?.schema !== FULL_SURFACE_CARD_SCHEMA) {
    throw new Error('target-SDF full-surface sweep card is required');
  }
  if (sweepCard.sourceAssayCardRef
      !== 'fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json'
    || sweepCard.targetRef !== assayCard.targetRef) {
    throw new Error('full-surface sweep source references do not match the reviewed assay');
  }
  if (sweepCard.extractorId !== 'marching-tetrahedra-zero-isosurface-v0') {
    throw new Error('full-surface sweep extractor substitution is not allowed');
  }
  if (!Array.isArray(sweepCard.amplitudes) || sweepCard.amplitudes.length < 3
    || sweepCard.amplitudes.some((value, index) => (
      !Number.isFinite(value) || value <= 0 || (index > 0 && value <= sweepCard.amplitudes[index - 1])
    ))) {
    throw new Error('full-surface sweep requires three or more increasing positive amplitudes');
  }
  if (sweepCard.referenceAmplitude !== assayCard.control.delta) {
    throw new Error('full-surface reference amplitude must match the reviewed target displacement');
  }
  const sourceBoundsCovered = ['right', 'dorsal', 'anterior'].every((axis) => (
    sweepCard.grid.bounds[axis][0] <= assayCard.grid.bounds[axis][0]
      && sweepCard.grid.bounds[axis][1] >= assayCard.grid.bounds[axis][1]
  ));
  if (!sourceBoundsCovered) {
    throw new Error('full-surface sweep observation volume must cover the reviewed bounds');
  }
  if (!Array.isArray(sweepCard.sectionPlanes) || sweepCard.sectionPlanes.length < 1) {
    throw new Error('full-surface sweep requires diagnostic section planes');
  }
  if (sweepCard.promotion !== 'none') throw new Error('full-surface sweep cannot promote a formulation');
}

function compileRow(row, assayCard, target) {
  const mode = row.id === SCALAR_ROW.id ? 'scalar' : 'anisotropic';
  const baselinePrimitivesForRow = baselinePrimitives(target, mode);
  const perturbedPrimitives = perturbPrimitives(
    baselinePrimitivesForRow,
    mode,
    assayCard.control.delta,
  );
  const baselineField = createField(baselinePrimitivesForRow, assayCard.grid, assayCard.extraction);
  const perturbedField = createField(perturbedPrimitives, assayCard.grid, assayCard.extraction);
  const baselineMesh = extractMesh(baselineField, assayCard.grid);
  const perturbedMesh = extractMesh(perturbedField, assayCard.grid);
  const baselineObservations = observeBoundary(baselineField, target, 'baseline');
  const perturbedObservations = observeBoundary(perturbedField, target, 'perturbed');
  const fit = baselineFit(baselineObservations, target, assayCard);
  const response = responseLedger(baselineObservations, perturbedObservations, target, assayCard);
  const surface = surfaceEvidence(perturbedField, perturbedMesh, row.identityMode);
  const failures = [];
  if (!fit.passed) failures.push({ code: 'unequal-baseline-fit' });
  if (!topologyClosed(baselineMesh) || !topologyClosed(perturbedMesh)) {
    failures.push({ code: 'surface-not-closed' });
  }
  if (fit.passed) {
    if (response.normalizedRmse > assayCard.response.maximumNormalizedRmse) {
      failures.push({ code: 'response-rmse-exceeded' });
    }
    if (response.directionAgreement < assayCard.response.minimumDirectionAgreement) {
      failures.push({ code: 'response-direction-mismatch' });
    }
    if (response.localityRatio < assayCard.response.minimumLocalityRatio) {
      failures.push({ code: 'response-not-localized' });
    }
    if (response.maxSecondDifference > assayCard.response.maximumSecondDifference) {
      failures.push({ code: 'response-not-smooth' });
    }
  }
  if (row.evidenceDisposition === 'control-observation') {
    failures.push({ code: 'control-row-only' });
  } else {
    const targetFraction = surface.componentFractions['gluteal-carrier'] ?? 0;
    if (surface.identityMode !== 'mixture-weights'
      || targetFraction < assayCard.surface.minimumAnisotropicTargetFraction) {
      failures.push({ code: 'consumed-surface-attribution-insufficient' });
    }
    for (const componentId of assayCard.surface.requiredComponentIds) {
      if (!(componentId in surface.componentFractions)) {
        failures.push({ code: 'consumed-surface-component-missing', componentId });
      }
    }
  }
  return {
    ...row,
    requestedCompilerId: row.compilerId,
    effectiveCompilerId: row.compilerId,
    requestedExtractorId: row.extractorId,
    effectiveExtractorId: row.extractorId,
    baseline: { mesh: baselineMesh, observations: baselineObservations },
    perturbed: { mesh: perturbedMesh, observations: perturbedObservations },
    baselineFit: fit,
    response,
    surface,
    verdict: { passed: failures.length === 0, failures },
  };
}

export function buildRowDistinctScalarAnisotropicAssay({ assayCard, target } = {}) {
  validateInputs(assayCard, target);
  const rows = assayCard.rows.map((row) => compileRow(row, assayCard, target));
  const baselineRmseGap = Math.abs(
    rows[0].baselineFit.normalizedRmse - rows[1].baselineFit.normalizedRmse,
  );
  const comparison = {
    baselineRmseGap,
    maximumBaselineRmseGap: assayCard.baselineFit.maximumBetweenRowNormalizedRmseGap,
    baselineParityPassed:
      baselineRmseGap <= assayCard.baselineFit.maximumBetweenRowNormalizedRmseGap,
  };
  const verdictFailures = [];
  if (!comparison.baselineParityPassed) {
    verdictFailures.push({
      code: 'between-row-baseline-parity-failed',
      observedGap: comparison.baselineRmseGap,
      maximumGap: comparison.maximumBaselineRmseGap,
    });
  }
  if (!rows.some(
    (row) => row.evidenceDisposition === 'candidate-evidence' && row.verdict.passed,
  )) {
    verdictFailures.push({ code: 'no-candidate-row-admitted' });
  }
  const assay = {
    schema: ROW_DISTINCT_FIELD_ASSAY_SCHEMA,
    status: 'completed',
    claimCeiling: assayCard.claimCeiling,
    targetId: target.id,
    targetHash: hashValue(target),
    assayCardId: assayCard.id,
    assayCardHash: hashValue(assayCard),
    grid: structuredClone(assayCard.grid),
    camera: structuredClone(assayCard.camera),
    control: structuredClone(assayCard.control),
    comparison,
    verdict: { passed: verdictFailures.length === 0, failures: verdictFailures },
    rows,
  };
  return { ...assay, assayHash: hashValue(assay) };
}

export function buildTargetSdfFullSurfaceSweep({ sweepCard, assayCard, target } = {}) {
  validateFullSurfaceInputs(sweepCard, assayCard, target);
  const effectiveAssayCard = structuredClone(assayCard);
  effectiveAssayCard.grid = structuredClone(sweepCard.grid);
  effectiveAssayCard.camera.bounds = structuredClone(sweepCard.grid.bounds);
  const baselineField = createIndependentTargetField(
    target,
    sweepCard.grid,
    'baseline',
    sweepCard.referenceAmplitude,
    sweepCard.referenceAmplitude,
  );
  const baselineMesh = extractMesh(baselineField, sweepCard.grid);
  const baselineTopology = topologyEvidence(baselineMesh);
  const baselineFullSurface = fullSurfaceEvidence(
    baselineMesh,
    baselineField,
    target.normalizationSpan,
  );
  const amplitudeResults = sweepCard.amplitudes.map((amplitude) => {
    const amplitudeTarget = scaledTarget(target, amplitude, sweepCard.referenceAmplitude);
    const referenceField = createIndependentTargetField(
      target,
      sweepCard.grid,
      'perturbed',
      amplitude,
      sweepCard.referenceAmplitude,
    );
    const referenceMesh = extractMesh(referenceField, sweepCard.grid);
    const card = structuredClone(effectiveAssayCard);
    card.control.delta = amplitude;
    const candidateAssay = buildRowDistinctScalarAnisotropicAssay({
      assayCard: card,
      target: amplitudeTarget,
    });
    return {
      amplitude,
      reference: {
        mesh: referenceMesh,
        topology: topologyEvidence(referenceMesh),
        fullSurface: fullSurfaceEvidence(
          referenceMesh,
          referenceField,
          target.normalizationSpan,
        ),
        sections: sweepCard.sectionPlanes.map(
          (anterior) => sliceMeshAtAnterior(referenceMesh, anterior),
        ),
      },
      rows: candidateAssay.rows.map((row) => ({
        id: row.id,
        role: row.role,
        requestedCompilerId: row.requestedCompilerId,
        effectiveCompilerId: row.effectiveCompilerId,
        sourceRowExtractorId: row.effectiveExtractorId,
        requestedExtractorId: sweepCard.extractorId,
        effectiveExtractorId: sweepCard.extractorId,
        identityMode: row.identityMode,
        controlComplexity: {
          primitiveCount: baselinePrimitives(
            amplitudeTarget,
            row.id === SCALAR_ROW.id ? 'scalar' : 'anisotropic',
          ).length,
        },
        mesh: row.perturbed.mesh,
        topology: topologyEvidence(row.perturbed.mesh),
        fullSurface: fullSurfaceEvidence(
          row.perturbed.mesh,
          referenceField,
          target.normalizationSpan,
        ),
        sections: sweepCard.sectionPlanes.map(
          (anterior) => sliceMeshAtAnterior(row.perturbed.mesh, anterior),
        ),
        profileResponse: row.response,
        surfaceIdentity: row.surface,
      })),
    };
  });
  const failures = [];
  if (!baselineTopology.closed || baselineTopology.componentCount !== 1
    || baselineMesh.vertices.length < sweepCard.evidence.minimumReferenceVertices) {
    failures.push({ code: 'reference-surface-invalid' });
  }
  if (baselineFullSurface.normalizedRmse
    > sweepCard.evidence.maximumReferenceSelfNormalizedRmse) {
    failures.push({ code: 'reference-extraction-error-exceeded' });
  }
  if (amplitudeResults.some((entry) => (
    !entry.reference.topology.closed || entry.reference.topology.componentCount !== 1
  ))) {
    failures.push({ code: 'perturbed-reference-topology-invalid' });
  }
  if (amplitudeResults.some((entry) => (
    [...entry.rows, entry.reference].some((surface) => surface.sections.some(
      (section) => section.segments.length < sweepCard.evidence.minimumSectionSegments,
    ))
  ))) {
    failures.push({ code: 'mesh-derived-section-empty' });
  }
  const result = {
    schema: TARGET_SDF_FULL_SURFACE_SWEEP_SCHEMA,
    status: 'completed',
    claimCeiling: sweepCard.claimCeiling,
    promotion: sweepCard.promotion,
    targetId: target.id,
    targetHash: hashValue(target),
    sourceAssayCardId: assayCard.id,
    sourceAssayCardHash: hashValue(assayCard),
    sweepCardId: sweepCard.id,
    sweepCardHash: hashValue(sweepCard),
    grid: structuredClone(sweepCard.grid),
    sectionPlanes: structuredClone(sweepCard.sectionPlanes),
    reference: {
      authority: baselineField.authority,
      requestedExtractorId: sweepCard.extractorId,
      effectiveExtractorId: sweepCard.extractorId,
      baseline: {
        mesh: baselineMesh,
        topology: baselineTopology,
        fullSurface: baselineFullSurface,
        sections: sweepCard.sectionPlanes.map(
          (anterior) => sliceMeshAtAnterior(baselineMesh, anterior),
        ),
      },
    },
    amplitudes: amplitudeResults,
    verdict: { passed: failures.length === 0, failures },
  };
  return { ...result, assayHash: hashValue(result) };
}
