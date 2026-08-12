import { createHash } from 'node:crypto';

export const ROW_DISTINCT_FIELD_ASSAY_SCHEMA =
  'kaminos.row-distinct-scalar-anisotropic-result.v0';
export const TARGET_SDF_FULL_SURFACE_SWEEP_SCHEMA =
  'kaminos.target-sdf-full-surface-sweep-result.v0';
export const OVERLAPPING_ANISOTROPIC_TISSUE_CONTROL_SCHEMA =
  'kaminos.overlapping-anisotropic-tissue-control-result.v0';
export const OVERLAPPING_ANISOTROPIC_TISSUE_COMPILER_ID =
  'overlapping-anisotropic-tissue-field-v0';
const AUTHORITATIVE_OVERLAP_CARD_ID =
  'bounded-hindquarter-overlapping-anisotropic-tissue-control-v0';
const AUTHORITATIVE_OVERLAP_CARD_HASH =
  'afd862ca3012267e9fad0bf22153f0bf56503ea0f8df960771ca777b9a6527da';
const AUTHORITATIVE_OVERLAP_TARGET_ID =
  'bounded-hindquarter-overlapping-muscle-fat-response-v0';
const AUTHORITATIVE_OVERLAP_TARGET_HASH =
  'f20e3244f8f243514e62ae418bcd06b04f599e3daa6b4108e98b02ca9c0112e6';
const AUTHORITATIVE_OVERLAP_DESCRIPTOR_ID =
  'bounded-hindquarter-muscle-fat-overlap-v0';
const AUTHORITATIVE_OVERLAP_DESCRIPTOR_HASH =
  '45a34c1350566d064f8fa9d466e579069e834cf6ad0e853b32ceac6fc113f3a4';
const OVERLAP_INTERACTION_CARD_SCHEMA =
  'kaminos.overlapping-anisotropic-interaction-law-assay.v0';
const AUTHORITATIVE_OVERLAP_INTERACTION_CARD_ID =
  'bounded-hindquarter-overlap-interaction-law-v0';
const AUTHORITATIVE_OVERLAP_INTERACTION_CARD_HASH =
  '0da2e331b45bae438c0cd089c40b4d9a1ecaa9d297e564d1a401acb6806880b3';
const AUTHORITATIVE_OVERLAP_SOURCE_ASSAY_HASH =
  'eb23f78ae2a8692431b923798068411b77cd1a36756da8fa0229fc3454e4ff66';

const ASSAY_CARD_SCHEMA = 'kaminos.row-distinct-scalar-anisotropic-assay.v0';
const TARGET_SCHEMA = 'kaminos.row-distinct-boundary-response-target.v0';
const FULL_SURFACE_CARD_SCHEMA = 'kaminos.target-sdf-full-surface-sweep-assay.v0';
const OVERLAP_CARD_SCHEMA = 'kaminos.overlapping-anisotropic-tissue-control-assay.v0';
const OVERLAP_TARGET_SCHEMA = 'kaminos.overlapping-tissue-boundary-response-target.v0';
const OVERLAP_DESCRIPTOR_SCHEMA = 'kaminos.overlapping-anisotropic-tissue-descriptor.v0';
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

function createField(primitives, grid, extraction, isoValue = 0.22, interaction = null) {
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
      const componentTotals = new Map();
      let contribution = 0;
      for (const primitive of primitives) {
        const value = contributionAt(point, primitive);
        contribution += value;
        if (primitive.componentId) {
          componentTotals.set(
            primitive.componentId,
            (componentTotals.get(primitive.componentId) ?? 0) + value,
          );
        }
      }
      if (interaction?.law === 'signed-normalized-product-v0') {
        const muscle = componentTotals.get('muscle') ?? 0;
        const fat = componentTotals.get('fat') ?? 0;
        contribution += interaction.coefficient * muscle * fat / Math.max(isoValue, 1e-12);
      }
      return contribution * longitudinalWeight(point[2]) - isoValue;
    },
    contributions(point) {
      return primitives.map((primitive) => ({
        componentId: primitive.componentId,
        value: contributionAt(point, primitive),
      })).filter((entry) => entry.value > 0);
    },
  };
}

export function validateOverlappingAnisotropicTissueInteractionCard(interactionCard) {
  if (interactionCard?.schema !== OVERLAP_INTERACTION_CARD_SCHEMA
    || interactionCard.id !== AUTHORITATIVE_OVERLAP_INTERACTION_CARD_ID
    || hashValue(interactionCard) !== AUTHORITATIVE_OVERLAP_INTERACTION_CARD_HASH) {
    throw new Error('overlap interaction card identity does not match authoritative assay');
  }
  if (interactionCard.sourceAssayHash !== AUTHORITATIVE_OVERLAP_SOURCE_ASSAY_HASH
    || interactionCard.sourceCardRef
      !== 'fixtures/analytical-tissue/overlapping-anisotropic-tissue-control-assay.v0.json'
    || interactionCard.targetRef
      !== 'fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json'
    || interactionCard.descriptorRef
      !== 'fixtures/analytical-tissue/overlapping-anisotropic-tissue-descriptor.v0.json') {
    throw new Error('overlap interaction assay does not bind the admitted source surfaces');
  }
  if (interactionCard.baselineLaw?.id !== 'additive-field-sum-v0'
    || interactionCard.candidates?.length !== 16
    || interactionCard.candidates.some((candidate) => (
      candidate.law !== 'signed-normalized-product-v0'
      || !Number.isFinite(candidate.coefficient)
      || candidate.coefficient === 0
    ))) {
    throw new Error('overlap interaction candidate family does not match the closed discriminator');
  }
  if (interactionCard.decision?.stressAmplitude !== 0.5
    || interactionCard.decision.maximumCombinedFullSurfaceNormalizedRmse
      !== 0.12
    || interactionCard.decision.requireClosedSingleComponent !== true
    || interactionCard.decision.requireIndependentControlAssayHashUnchanged !== true
    || interactionCard.decision.requireConclusivePassOrObservedLimit !== true
    || interactionCard.decision.surfaceQualityFollowup?.status
      !== 'post-visual-falsifier-before-result-admission'
    || interactionCard.decision.surfaceQualityFollowup?.comparison
      !== 'nonregression-against-unchanged-additive-row-at-every-amplitude'
    || canonicalJson(interactionCard.decision.surfaceQualityFollowup?.metrics)
      !== canonicalJson(['surfaceAreaRelativeError', 'volumeRelativeError'])
    || interactionCard.promotion !== 'none') {
    throw new Error('overlap interaction decision predicate or promotion changed');
  }
}

function validateOverlapInteractionCard(interactionCard, sourceAssay) {
  validateOverlappingAnisotropicTissueInteractionCard(interactionCard);
  if (sourceAssay.assayHash !== AUTHORITATIVE_OVERLAP_SOURCE_ASSAY_HASH
    || interactionCard.sourceAssayHash !== sourceAssay.assayHash
    || interactionCard.targetRef !== sourceAssay.requestedTargetRef
    || interactionCard.descriptorRef !== sourceAssay.requestedDescriptorRef) {
    throw new Error('overlap interaction assay source execution identity changed');
  }
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

export function validateOverlappingAnisotropicTissueControlInputs({
  overlapCard,
  overlapTarget,
  descriptor,
  frozenSweepCard,
  frozenAssayCard,
  frozenTarget,
}) {
  if (overlapCard?.schema !== OVERLAP_CARD_SCHEMA
    || overlapTarget?.schema !== OVERLAP_TARGET_SCHEMA
    || descriptor?.schema !== OVERLAP_DESCRIPTOR_SCHEMA) {
    throw new Error('overlapping tissue assay card, target, and descriptor schemas are required');
  }
  if (overlapCard.id !== AUTHORITATIVE_OVERLAP_CARD_ID
    || hashValue(overlapCard) !== AUTHORITATIVE_OVERLAP_CARD_HASH) {
    throw new Error('overlap assay card identity does not match authoritative route');
  }
  if (overlapTarget.authority?.sourceKind !== 'independently-authored-synthetic-observation') {
    throw new Error('candidate-independent overlapping tissue target authority is required');
  }
  if (overlapCard.targetRef
      !== 'fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json'
    || overlapCard.descriptorRef
      !== 'fixtures/analytical-tissue/overlapping-anisotropic-tissue-descriptor.v0.json') {
    throw new Error('overlapping tissue source references do not match the closed assay');
  }
  if (overlapCard.compilerId !== OVERLAPPING_ANISOTROPIC_TISSUE_COMPILER_ID) {
    throw new Error('overlap compiler identity does not match executed implementation');
  }
  if (overlapTarget.id !== AUTHORITATIVE_OVERLAP_TARGET_ID
    || hashValue(overlapTarget) !== AUTHORITATIVE_OVERLAP_TARGET_HASH) {
    throw new Error('overlap target identity does not match closed fixture');
  }
  if (descriptor.id !== AUTHORITATIVE_OVERLAP_DESCRIPTOR_ID
    || hashValue(descriptor) !== AUTHORITATIVE_OVERLAP_DESCRIPTOR_HASH) {
    throw new Error('overlap descriptor identity does not match closed fixture');
  }
  const tissueIds = descriptor.tissues?.map((tissue) => tissue.id) ?? [];
  if (tissueIds.length !== 2
    || new Set(tissueIds).size !== 2
    || !tissueIds.includes('muscle')
    || !tissueIds.includes('fat')) {
    throw new Error('distinct muscle and fat tissue identities are required');
  }
  if (descriptor.promotion !== 'none' || overlapCard.promotion !== 'none') {
    throw new Error('overlapping tissue assay cannot promote a representation');
  }
  if (!Array.isArray(overlapCard.amplitudes) || overlapCard.amplitudes.length < 3
    || overlapCard.amplitudes.some((value, index) => (
      !Number.isFinite(value) || value <= 0
        || (index > 0 && value <= overlapCard.amplitudes[index - 1])
    ))) {
    throw new Error('overlapping tissue assay requires increasing small, medium, and stress amplitudes');
  }
  if (overlapCard.extractorId !== 'marching-tetrahedra-zero-isosurface-v0') {
    throw new Error('overlapping tissue extractor substitution is not allowed');
  }
  for (const [controlId, control] of Object.entries(overlapCard.controls ?? {})) {
    if (!tissueIds.includes(control.targetTissueId)
      || !overlapTarget.stations?.every((station) => station[control.targetStateId])) {
      throw new Error(`control ${controlId} does not bind a target tissue and authored response state`);
    }
  }
  validateFullSurfaceInputs(frozenSweepCard, frozenAssayCard, frozenTarget);
}

function overlapBaselinePrimitives(target, descriptor) {
  const isolatedIsoRadius = Math.sqrt(1 - Math.sqrt(descriptor.isoValue));
  return target.stations.flatMap((station, stationIndex) => {
    const centerY = (station.baseline.top + station.baseline.bottom) * 0.5;
    const radii = [
      station.baseline.halfWidth,
      (station.baseline.top - station.baseline.bottom) * 0.5,
      stationSpacing(target, stationIndex) * 0.78,
    ];
    return descriptor.tissues.map((tissue) => ({
      id: `${tissue.id}-${stationIndex}`,
      componentId: tissue.id,
      center: [0, centerY, station.anterior],
      radii: radii.map(
        (radius, axis) => radius * tissue.radiusScale[axis] / isolatedIsoRadius,
      ),
      strength: tissue.strength,
    }));
  });
}

function supportWeight(anterior, support) {
  const [low, high] = support;
  if (anterior < low || anterior > high) return 0;
  const t = (anterior - low) / Math.max(high - low, 1e-12);
  return 0.25 + Math.sin(Math.PI * t) * 0.75;
}

function perturbOverlapPrimitives(primitives, descriptor, control, amplitude) {
  const tissue = descriptor.tissues.find((entry) => entry.id === control.targetTissueId);
  const modifiedIds = [];
  const next = primitives.map((primitive) => {
    const copy = {
      ...primitive,
      center: [...primitive.center],
      radii: [...primitive.radii],
    };
    if (primitive.componentId !== control.targetTissueId) return copy;
    const weight = supportWeight(primitive.center[2], control.support);
    if (weight <= 0) return copy;
    copy.radii = copy.radii.map(
      (radius, axis) => radius * (1 + amplitude * tissue.control.radiusRate[axis] * weight),
    );
    copy.center[1] += amplitude * tissue.control.dorsalTranslationRate * weight;
    modifiedIds.push(copy.id);
    return copy;
  });
  return {
    primitives: next,
    mutation: {
      targetTissueId: control.targetTissueId,
      targetPrimitiveCount: modifiedIds.length,
      nonTargetPrimitiveCount: 0,
      modifiedPrimitiveIds: modifiedIds,
    },
  };
}

function scaleOverlapTarget(target, stateId, amplitude, referenceAmplitude) {
  const scaled = structuredClone(target);
  const scale = amplitude / referenceAmplitude;
  scaled.stations = scaled.stations.map((station) => ({
    ...station,
    perturbed: Object.fromEntries(['top', 'bottom', 'halfWidth'].map((field) => [
      field,
      station.baseline[field] + (station[stateId][field] - station.baseline[field]) * scale,
    ])),
  }));
  scaled.authority = {
    ...scaled.authority,
    derivation: `${stateId} displacement scaled by ${scale}`,
  };
  return scaled;
}

function overlapReferenceField(target, grid, stateId, amplitude, referenceAmplitude) {
  return createIndependentTargetField(
    scaleOverlapTarget(target, stateId, amplitude, referenceAmplitude),
    grid,
    'perturbed',
    referenceAmplitude,
    referenceAmplitude,
  );
}

function overlapResponseLedger(baseline, perturbed, scaledTarget, control) {
  return responseLedger(baseline, perturbed, scaledTarget, {
    control: { support: control.support },
  });
}

function boundaryFitEvidence(observations, target, stateId) {
  const errors = [];
  for (let index = 0; index < target.stations.length; index += 1) {
    for (const field of ['top', 'bottom', 'halfWidth']) {
      errors.push(
        (observations[index][field] - target.stations[index][stateId][field])
          / target.normalizationSpan,
      );
    }
  }
  return { normalizedRmse: rmse(errors) };
}

function contributionTotals(field, point) {
  const totals = new Map();
  for (const contribution of field.contributions(point)) {
    if (!contribution.componentId) continue;
    totals.set(
      contribution.componentId,
      (totals.get(contribution.componentId) ?? 0) + contribution.value,
    );
  }
  return totals;
}

function causalSurfaceAttribution(baselineField, perturbedField, mesh, targetTissueId) {
  let targetAbsoluteDelta = 0;
  let nonTargetAbsoluteDelta = 0;
  for (const vertex of mesh.vertices) {
    const baseline = contributionTotals(baselineField, vertex);
    const perturbed = contributionTotals(perturbedField, vertex);
    for (const tissueId of new Set([...baseline.keys(), ...perturbed.keys()])) {
      const delta = Math.abs((perturbed.get(tissueId) ?? 0) - (baseline.get(tissueId) ?? 0));
      if (tissueId === targetTissueId) targetAbsoluteDelta += delta;
      else nonTargetAbsoluteDelta += delta;
    }
  }
  return {
    sampleCount: mesh.vertices.length,
    targetTissueId,
    targetAbsoluteDelta,
    nonTargetAbsoluteDelta,
    targetCausalFraction: targetAbsoluteDelta
      / Math.max(targetAbsoluteDelta + nonTargetAbsoluteDelta, 1e-12),
  };
}

function responseSuperposition(baseline, muscle, fat, combined, normalizationSpan) {
  const errors = [];
  for (let index = 0; index < baseline.length; index += 1) {
    for (const field of ['top', 'bottom', 'halfWidth']) {
      const expected = muscle[index][field] + fat[index][field] - baseline[index][field];
      errors.push((combined[index][field] - expected) / normalizationSpan);
    }
  }
  return { normalizedRmse: rmse(errors) };
}

function overlapControlAmplitude({
  amplitude,
  controlId,
  control,
  overlapCard,
  overlapTarget,
  descriptor,
  baselinePrimitivesForAssay,
  baselineField,
  baselineObservations,
}) {
  const perturbation = perturbOverlapPrimitives(
    baselinePrimitivesForAssay,
    descriptor,
    control,
    amplitude,
  );
  const field = createField(
    perturbation.primitives,
    overlapCard.grid,
    { longitudinalClosureCells: 2 },
    descriptor.isoValue,
  );
  const mesh = extractMesh(field, overlapCard.grid);
  const scaledTarget = scaleOverlapTarget(
    overlapTarget,
    control.targetStateId,
    amplitude,
    overlapCard.referenceAmplitude,
  );
  const referenceField = overlapReferenceField(
    overlapTarget,
    overlapCard.grid,
    control.targetStateId,
    amplitude,
    overlapCard.referenceAmplitude,
  );
  const referenceMesh = extractMesh(referenceField, overlapCard.grid);
  const observations = observeBoundary(field, scaledTarget, 'perturbed');
  const response = overlapResponseLedger(
    baselineObservations,
    observations,
    scaledTarget,
    control,
  );
  return {
    controlId,
    amplitude,
    mutation: perturbation.mutation,
    mesh,
    topology: topologyEvidence(mesh),
    fullSurface: fullSurfaceEvidence(mesh, referenceField, overlapTarget.normalizationSpan),
    surfaceIdentity: surfaceEvidence(field, mesh, 'mixture-weights'),
    causalSurfaceAttribution: causalSurfaceAttribution(
      baselineField,
      field,
      mesh,
      control.targetTissueId,
    ),
    response,
    spatialCrosstalkRatio: 1 / Math.max(response.localityRatio, 1e-12),
    observations,
    reference: {
      mesh: referenceMesh,
      topology: topologyEvidence(referenceMesh),
      fullSurface: fullSurfaceEvidence(
        referenceMesh,
        referenceField,
        overlapTarget.normalizationSpan,
      ),
    },
    sections: overlapCard.sectionPlanes.map(
      (anterior) => sliceMeshAtAnterior(mesh, anterior),
    ),
    referenceSections: overlapCard.sectionPlanes.map(
      (anterior) => sliceMeshAtAnterior(referenceMesh, anterior),
    ),
  };
}

export function buildOverlappingAnisotropicTissueControlAssay({
  overlapCard,
  overlapTarget,
  descriptor,
  frozenSweepCard,
  frozenAssayCard,
  frozenTarget,
} = {}) {
  validateOverlappingAnisotropicTissueControlInputs({
    overlapCard,
    overlapTarget,
    descriptor,
    frozenSweepCard,
    frozenAssayCard,
    frozenTarget,
  });
  const frozenSweep = buildTargetSdfFullSurfaceSweep({
    sweepCard: frozenSweepCard,
    assayCard: frozenAssayCard,
    target: frozenTarget,
  });
  if (frozenSweep.assayHash !== overlapCard.frozenScalarControl.sourceAssayHash
    || overlapCard.frozenScalarControl.compilerId !== SCALAR_ROW.compilerId) {
    throw new Error('frozen scalar control identity does not match the reviewed source assay');
  }

  const baselinePrimitivesForAssay = overlapBaselinePrimitives(overlapTarget, descriptor);
  const baselineField = createField(
    baselinePrimitivesForAssay,
    overlapCard.grid,
    { longitudinalClosureCells: 2 },
    descriptor.isoValue,
  );
  const baselineMesh = extractMesh(baselineField, overlapCard.grid);
  const baselineObservations = observeBoundary(baselineField, overlapTarget, 'baseline');
  const baselineReferenceField = createIndependentTargetField(
    overlapTarget,
    overlapCard.grid,
    'baseline',
    overlapCard.referenceAmplitude,
    overlapCard.referenceAmplitude,
  );
  const baselineReferenceMesh = extractMesh(baselineReferenceField, overlapCard.grid);
  const baselineReferenceFullSurface = fullSurfaceEvidence(
    baselineReferenceMesh,
    baselineReferenceField,
    overlapTarget.normalizationSpan,
  );
  const baselineFullSurface = fullSurfaceEvidence(
    baselineMesh,
    baselineReferenceField,
    overlapTarget.normalizationSpan,
  );
  const baseline = {
    mesh: baselineMesh,
    topology: topologyEvidence(baselineMesh),
    fullSurface: baselineFullSurface,
    reference: {
      mesh: baselineReferenceMesh,
      topology: topologyEvidence(baselineReferenceMesh),
      fullSurface: baselineReferenceFullSurface,
    },
    boundaryFit: boundaryFitEvidence(baselineObservations, overlapTarget, 'baseline'),
    volumeRelativeError: Math.abs(
      baselineFullSurface.volume - baselineReferenceFullSurface.volume
    ) / Math.max(baselineReferenceFullSurface.volume, 1e-12),
    observations: baselineObservations,
    surfaceIdentity: surfaceEvidence(baselineField, baselineMesh, 'mixture-weights'),
    primitiveCount: baselinePrimitivesForAssay.length,
  };

  const controls = Object.fromEntries(Object.entries(overlapCard.controls).map(
    ([controlId, control]) => [controlId, {
      targetTissueId: control.targetTissueId,
      targetStateId: control.targetStateId,
      requestedCompilerId: overlapCard.compilerId,
      effectiveCompilerId: OVERLAPPING_ANISOTROPIC_TISSUE_COMPILER_ID,
      requestedExtractorId: overlapCard.extractorId,
      effectiveExtractorId: overlapCard.extractorId,
      amplitudes: overlapCard.amplitudes.map((amplitude) => overlapControlAmplitude({
        amplitude,
        controlId,
        control,
        overlapCard,
        overlapTarget,
        descriptor,
        baselinePrimitivesForAssay,
        baselineField,
        baselineObservations,
      })),
    }],
  ));

  const combined = overlapCard.amplitudes.map((amplitude, amplitudeIndex) => {
    let perturbed = baselinePrimitivesForAssay;
    for (const control of Object.values(overlapCard.controls)) {
      perturbed = perturbOverlapPrimitives(perturbed, descriptor, control, amplitude).primitives;
    }
    const field = createField(
      perturbed,
      overlapCard.grid,
      { longitudinalClosureCells: 2 },
      descriptor.isoValue,
    );
    const mesh = extractMesh(field, overlapCard.grid);
    const scaledTarget = scaleOverlapTarget(
      overlapTarget,
      'combined',
      amplitude,
      overlapCard.referenceAmplitude,
    );
    const referenceField = overlapReferenceField(
      overlapTarget,
      overlapCard.grid,
      'combined',
      amplitude,
      overlapCard.referenceAmplitude,
    );
    const referenceMesh = extractMesh(referenceField, overlapCard.grid);
    const observations = observeBoundary(field, scaledTarget, 'perturbed');
    return {
      amplitude,
      mesh,
      topology: topologyEvidence(mesh),
      fullSurface: fullSurfaceEvidence(mesh, referenceField, overlapTarget.normalizationSpan),
      surfaceIdentity: surfaceEvidence(field, mesh, 'mixture-weights'),
      observations,
      reference: {
        mesh: referenceMesh,
        topology: topologyEvidence(referenceMesh),
      },
      sections: overlapCard.sectionPlanes.map(
        (anterior) => sliceMeshAtAnterior(mesh, anterior),
      ),
      referenceSections: overlapCard.sectionPlanes.map(
        (anterior) => sliceMeshAtAnterior(referenceMesh, anterior),
      ),
      superposition: responseSuperposition(
        baselineObservations,
        controls['muscle-tension'].amplitudes[amplitudeIndex].observations,
        controls['fat-distribution'].amplitudes[amplitudeIndex].observations,
        observations,
        overlapTarget.normalizationSpan,
      ),
    };
  });

  const evidenceFailures = [];
  const allSurfaces = [
    baseline,
    ...Object.values(controls).flatMap((control) => control.amplitudes),
    ...combined,
  ];
  if (allSurfaces.some((surface) => (
    !surface.topology.closed
      || surface.topology.componentCount !== 1
      || surface.topology.vertexCount < overlapCard.evidence.minimumVertices
  ))) {
    evidenceFailures.push({ code: 'envelope-topology-invalid' });
  }
  if (Object.values(controls).some((control) => control.amplitudes.some((entry) => (
    entry.sections.some(
      (section) => section.segments.length < overlapCard.evidence.minimumSectionSegments,
    ) || !entry.reference.topology.closed || entry.reference.topology.componentCount !== 1
  ))) || combined.some((entry) => entry.sections.some(
    (section) => section.segments.length < overlapCard.evidence.minimumSectionSegments,
  ))) {
    evidenceFailures.push({ code: 'mesh-derived-section-or-reference-invalid' });
  }

  const hypothesisFailures = [];
  if (baseline.fullSurface.normalizedRmse
      > overlapCard.evidence.maximumBaselineNormalizedRmse) {
    hypothesisFailures.push({ code: 'baseline-fit-exceeded' });
  }
  if (baseline.volumeRelativeError
      > overlapCard.evidence.maximumBaselineVolumeRelativeError) {
    hypothesisFailures.push({ code: 'baseline-volume-fit-exceeded' });
  }
  for (const [controlId, control] of Object.entries(controls)) {
    for (const entry of control.amplitudes) {
      if (entry.response.normalizedRmse > overlapCard.evidence.maximumResponseNormalizedRmse) {
        hypothesisFailures.push({ code: 'response-fit-exceeded', controlId, amplitude: entry.amplitude });
      }
      if (entry.fullSurface.normalizedRmse
          > overlapCard.evidence.maximumControlFullSurfaceNormalizedRmse) {
        hypothesisFailures.push({
          code: 'control-full-surface-fit-exceeded',
          controlId,
          amplitude: entry.amplitude,
        });
      }
      if (entry.spatialCrosstalkRatio > overlapCard.evidence.maximumSpatialCrosstalkRatio) {
        hypothesisFailures.push({ code: 'spatial-crosstalk-exceeded', controlId, amplitude: entry.amplitude });
      }
      if (entry.causalSurfaceAttribution.targetCausalFraction
          < overlapCard.evidence.minimumTargetCausalFraction) {
        hypothesisFailures.push({ code: 'surface-attribution-insufficient', controlId, amplitude: entry.amplitude });
      }
    }
  }
  for (const entry of combined) {
    if (entry.fullSurface.normalizedRmse
        > overlapCard.evidence.maximumCombinedFullSurfaceNormalizedRmse) {
      hypothesisFailures.push({
        code: 'combined-full-surface-fit-exceeded',
        amplitude: entry.amplitude,
      });
    }
    if (entry.superposition.normalizedRmse
        > overlapCard.evidence.maximumCombinedSuperpositionNormalizedRmse) {
      hypothesisFailures.push({ code: 'combined-superposition-exceeded', amplitude: entry.amplitude });
    }
  }

  const result = {
    schema: OVERLAPPING_ANISOTROPIC_TISSUE_CONTROL_SCHEMA,
    status: 'completed',
    claimCeiling: overlapCard.claimCeiling,
    promotion: overlapCard.promotion,
    targetId: overlapTarget.id,
    targetHash: hashValue(overlapTarget),
    requestedTargetRef: overlapCard.targetRef,
    effectiveTargetId: overlapTarget.id,
    effectiveTargetHash: hashValue(overlapTarget),
    descriptorId: descriptor.id,
    descriptorHash: hashValue(descriptor),
    requestedDescriptorRef: overlapCard.descriptorRef,
    effectiveDescriptorId: descriptor.id,
    effectiveDescriptorHash: hashValue(descriptor),
    overlapCardId: overlapCard.id,
    overlapCardHash: hashValue(overlapCard),
    compilerId: OVERLAPPING_ANISOTROPIC_TISSUE_COMPILER_ID,
    requestedCompilerId: overlapCard.compilerId,
    effectiveCompilerId: OVERLAPPING_ANISOTROPIC_TISSUE_COMPILER_ID,
    extractorId: overlapCard.extractorId,
    grid: structuredClone(overlapCard.grid),
    sectionPlanes: structuredClone(overlapCard.sectionPlanes),
    amplitudes: structuredClone(overlapCard.amplitudes),
    baseline,
    controls,
    combined,
    frozenScalarControl: {
      sourceAssayHash: frozenSweep.assayHash,
      compilerId: SCALAR_ROW.compilerId,
      sourceCardRef: overlapCard.frozenScalarControl.sourceCardRef,
      reoptimizedForOverlapAssay: false,
      amplitudes: frozenSweep.amplitudes.map((entry) => {
        const scalar = entry.rows.find((row) => row.id === SCALAR_ROW.id);
        return {
          amplitude: entry.amplitude,
          primitiveCount: scalar.controlComplexity.primitiveCount,
          topology: scalar.topology,
          fullSurface: scalar.fullSurface,
        };
      }),
    },
    evidenceVerdict: { passed: evidenceFailures.length === 0, failures: evidenceFailures },
    hypothesisVerdict: { passed: hypothesisFailures.length === 0, failures: hypothesisFailures },
  };
  return { ...result, assayHash: hashValue(result) };
}

function buildOverlapInteractionAmplitude({
  amplitude,
  candidate,
  overlapCard,
  overlapTarget,
  descriptor,
  baselinePrimitivesForAssay,
}) {
  let perturbed = baselinePrimitivesForAssay;
  for (const control of Object.values(overlapCard.controls)) {
    perturbed = perturbOverlapPrimitives(perturbed, descriptor, control, amplitude).primitives;
  }
  const field = createField(
    perturbed,
    overlapCard.grid,
    { longitudinalClosureCells: 2 },
    descriptor.isoValue,
    candidate,
  );
  const mesh = extractMesh(field, overlapCard.grid);
  const referenceField = overlapReferenceField(
    overlapTarget,
    overlapCard.grid,
    'combined',
    amplitude,
    overlapCard.referenceAmplitude,
  );
  const referenceMesh = extractMesh(referenceField, overlapCard.grid);
  const fullSurface = fullSurfaceEvidence(mesh, referenceField, overlapTarget.normalizationSpan);
  const referenceFullSurface = fullSurfaceEvidence(
    referenceMesh,
    referenceField,
    overlapTarget.normalizationSpan,
  );
  return {
    amplitude,
    mesh,
    topology: topologyEvidence(mesh),
    fullSurface,
    surfaceAreaRelativeError: Math.abs(fullSurface.area - referenceFullSurface.area)
      / Math.max(referenceFullSurface.area, 1e-12),
    volumeRelativeError: Math.abs(fullSurface.volume - referenceFullSurface.volume)
      / Math.max(referenceFullSurface.volume, 1e-12),
    surfaceIdentity: surfaceEvidence(field, mesh, 'mixture-weights'),
    observations: observeBoundary(
      field,
      scaleOverlapTarget(
        overlapTarget,
        'combined',
        amplitude,
        overlapCard.referenceAmplitude,
      ),
      'perturbed',
    ),
    reference: {
      mesh: referenceMesh,
      topology: topologyEvidence(referenceMesh),
      fullSurface: referenceFullSurface,
    },
    sections: overlapCard.sectionPlanes.map(
      (anterior) => sliceMeshAtAnterior(mesh, anterior),
    ),
    referenceSections: overlapCard.sectionPlanes.map(
      (anterior) => sliceMeshAtAnterior(referenceMesh, anterior),
    ),
  };
}

export function buildOverlappingAnisotropicTissueInteractionAssay({
  interactionCard,
  overlapCard,
  overlapTarget,
  descriptor,
  frozenSweepCard,
  frozenAssayCard,
  frozenTarget,
} = {}) {
  const sourceAssay = buildOverlappingAnisotropicTissueControlAssay({
    overlapCard,
    overlapTarget,
    descriptor,
    frozenSweepCard,
    frozenAssayCard,
    frozenTarget,
  });
  validateOverlapInteractionCard(interactionCard, sourceAssay);

  const baselinePrimitivesForAssay = overlapBaselinePrimitives(overlapTarget, descriptor);
  const additive = sourceAssay.combined.map((entry) => {
    const referenceField = overlapReferenceField(
      overlapTarget,
      overlapCard.grid,
      'combined',
      entry.amplitude,
      overlapCard.referenceAmplitude,
    );
    const referenceFullSurface = fullSurfaceEvidence(
      entry.reference.mesh,
      referenceField,
      overlapTarget.normalizationSpan,
    );
    return {
      ...entry,
      surfaceAreaRelativeError: Math.abs(entry.fullSurface.area - referenceFullSurface.area)
        / Math.max(referenceFullSurface.area, 1e-12),
      volumeRelativeError: Math.abs(entry.fullSurface.volume - referenceFullSurface.volume)
        / Math.max(referenceFullSurface.volume, 1e-12),
      reference: {
        ...entry.reference,
        fullSurface: referenceFullSurface,
      },
    };
  });
  const candidates = interactionCard.candidates.map((candidate) => {
    const amplitudes = overlapCard.amplitudes.map((amplitude) => (
      buildOverlapInteractionAmplitude({
        amplitude,
        candidate,
        overlapCard,
        overlapTarget,
        descriptor,
        baselinePrimitivesForAssay,
      })
    ));
    const stress = amplitudes.find(
      (entry) => entry.amplitude === interactionCard.decision.stressAmplitude,
    );
    const topologyPass = amplitudes.every((entry) => (
      entry.topology.closed && entry.topology.componentCount === 1
    ));
    const qualityPass = amplitudes.every((entry, index) => (
      entry.topology.closed
        && entry.topology.componentCount === 1
        && entry.surfaceAreaRelativeError <= additive[index].surfaceAreaRelativeError
        && entry.volumeRelativeError <= additive[index].volumeRelativeError
    ));
    const fitPass = stress.fullSurface.normalizedRmse
      <= interactionCard.decision.maximumCombinedFullSurfaceNormalizedRmse;
    const qualifies = topologyPass && qualityPass && fitPass;
    return {
      id: candidate.id,
      law: candidate.law,
      coefficient: candidate.coefficient,
      amplitudes,
      stress,
      topologyPass,
      qualityPass,
      fitPass,
      qualifies,
    };
  });
  const additiveStress = additive.find(
    (entry) => entry.amplitude === interactionCard.decision.stressAmplitude,
  );
  const rankedCandidates = [...candidates].sort(
    (left, right) => left.stress.fullSurface.normalizedRmse
      - right.stress.fullSurface.normalizedRmse,
  );
  const evidenceFailures = [];
  for (const candidate of candidates) {
    for (const entry of candidate.amplitudes) {
      if (entry.topology.vertexCount === 0
        || !Number.isFinite(entry.fullSurface.normalizedRmse)
        || entry.reference.topology.vertexCount === 0) {
        evidenceFailures.push({
          code: 'interaction-candidate-evidence-invalid',
          candidateId: candidate.id,
          amplitude: entry.amplitude,
        });
      }
    }
  }
  const passed = candidates.some((candidate) => candidate.qualifies);
  const positiveCandidates = candidates
    .filter((candidate) => candidate.coefficient > 0)
    .sort((left, right) => left.coefficient - right.coefficient);
  const positiveMinimumBracketed = positiveCandidates.some((candidate, index) => {
    if (index === 0) return false;
    const previous = positiveCandidates[index - 1];
    return candidate.stress.topology.componentCount !== 1
      || !candidate.stress.topology.closed
      || candidate.stress.fullSurface.normalizedRmse
        >= previous.stress.fullSurface.normalizedRmse;
  });
  const qualityFitIncompatibilityObserved = positiveCandidates.some(
    (candidate) => candidate.qualityPass && !candidate.fitPass,
  ) && positiveCandidates.some(
    (candidate) => candidate.fitPass && !candidate.qualityPass,
  );
  const conclusive = passed || positiveMinimumBracketed || qualityFitIncompatibilityObserved;
  const qualifyingCandidates = candidates.filter((candidate) => candidate.qualifies).sort(
    (left, right) => left.stress.fullSurface.normalizedRmse
      - right.stress.fullSurface.normalizedRmse,
  );
  const result = {
    schema: 'kaminos.overlapping-anisotropic-interaction-law-result.v0',
    status: 'completed',
    claimCeiling: interactionCard.claimCeiling,
    promotion: interactionCard.promotion,
    interactionCardId: interactionCard.id,
    interactionCardHash: hashValue(interactionCard),
    sourceAssayHash: sourceAssay.assayHash,
    independentControlsHash: hashValue(sourceAssay.controls),
    targetHash: sourceAssay.targetHash,
    descriptorHash: sourceAssay.descriptorHash,
    overlapCardHash: sourceAssay.overlapCardHash,
    effectiveCompilerId: sourceAssay.effectiveCompilerId,
    extractorId: sourceAssay.extractorId,
    grid: structuredClone(sourceAssay.grid),
    sectionPlanes: structuredClone(sourceAssay.sectionPlanes),
    amplitudes: structuredClone(sourceAssay.amplitudes),
    frozenScalarControl: structuredClone(sourceAssay.frozenScalarControl),
    surfaceQualityFollowup: structuredClone(
      interactionCard.decision.surfaceQualityFollowup,
    ),
    additive,
    additiveStress,
    candidates,
    evidenceVerdict: {
      passed: evidenceFailures.length === 0,
      failures: evidenceFailures,
    },
    verdict: {
      passed,
      conclusive,
      positiveMinimumBracketed,
      qualityFitIncompatibilityObserved,
      improved: (rankedCandidates[0]?.stress.fullSurface.normalizedRmse ?? Infinity)
        < additiveStress.fullSurface.normalizedRmse,
      bestCandidateId: rankedCandidates[0]?.id ?? null,
      admittedCandidateId: qualifyingCandidates[0]?.id ?? null,
      inference: passed
        ? 'missing-overlap-interaction-law-supported'
        : conclusive
          ? 'bounded-signed-product-family-failed-quality-fit-incompatibility'
          : 'signed-product-family-inconclusive-range',
    },
  };
  return { ...result, assayHash: hashValue(result) };
}
