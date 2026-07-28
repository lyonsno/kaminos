export const SWING_CLEARANCE_ASSAY_ROUTE =
  'kaminos/lirm-719024/swing-clearance-static-operator-assay-v0';
export const SWING_CLEARANCE_SOURCE_HASH =
  'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
export const SWING_CLEARANCE_CONTACT_ATLAS_HASH =
  'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78';
export const SWING_CLEARANCE_REGISTRATION_HASH =
  'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9';
export const SWING_CLEARANCE_SUPPORT_ID = 'rear-left';

const EPSILON = 1e-12;

function point(values, vertex) {
  const offset = vertex * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function add(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value, label) {
  const magnitude = length(value);
  if (!(magnitude > EPSILON)) throw new Error(`${label} must be nonzero`);
  return multiply(value, 1 / magnitude);
}

function smoothstep(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor((sorted.length - 1) * fraction);
  return sorted[index];
}

function weightedCentroid(positions, indices, weights) {
  const output = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < indices.length; index += 1) {
    const weight = Number(weights[index]);
    const sample = point(positions, indices[index]);
    total += weight;
    output[0] += sample[0] * weight;
    output[1] += sample[1] * weight;
    output[2] += sample[2] * weight;
  }
  if (!(total > EPSILON)) throw new Error('weighted centroid requires positive total weight');
  return multiply(output, 1 / total);
}

function minimumRotation(from, to) {
  const source = normalize(from, 'source lever');
  const target = normalize(to, 'desired lever');
  const axisVector = cross(source, target);
  const axisLength = length(axisVector);
  const cosine = Math.max(-1, Math.min(1, dot(source, target)));
  if (axisLength <= EPSILON) {
    return { axis: [1, 0, 0], angle: cosine < 0 ? Math.PI : 0 };
  }
  return {
    axis: multiply(axisVector, 1 / axisLength),
    angle: Math.atan2(axisLength, cosine),
  };
}

function rotateAroundAxis(value, axis, angle) {
  if (Math.abs(angle) <= EPSILON) return [...value];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(multiply(value, cosine), multiply(cross(axis, value), sine)),
    multiply(axis, dot(axis, value) * (1 - cosine)),
  );
}

function carrierWeight(rawWeight, rigidCoreThreshold) {
  if (rawWeight >= rigidCoreThreshold) return 1;
  return smoothstep(rawWeight / rigidCoreThreshold);
}

function signedDistance(position, terrainPoint, terrainNormal) {
  return dot(subtract(position, terrainPoint), terrainNormal);
}

function triangleAreaNormal(positions, a, b, c) {
  return cross(
    subtract(point(positions, b), point(positions, a)),
    subtract(point(positions, c), point(positions, a)),
  );
}

function edgeLength(positions, left, right) {
  return length(subtract(point(positions, right), point(positions, left)));
}

function createLocalDeformationMetrics(source, realized, indices, influenceSet) {
  const edgeRatios = [];
  const areaRatios = [];
  let flippedTriangleCount = 0;
  let triangleCount = 0;
  const displacement = new Float64Array(source.length / 3);
  for (let vertex = 0; vertex < displacement.length; vertex += 1) {
    displacement[vertex] = length(subtract(point(realized, vertex), point(source, vertex)));
  }
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const vertices = [indices[index], indices[index + 1], indices[index + 2]];
    if (!vertices.some(vertex => influenceSet.has(vertex))) continue;
    triangleCount += 1;
    const sourceNormal = triangleAreaNormal(source, ...vertices);
    const realizedNormal = triangleAreaNormal(realized, ...vertices);
    const sourceArea = length(sourceNormal);
    const realizedArea = length(realizedNormal);
    if (sourceArea > EPSILON) areaRatios.push(realizedArea / sourceArea);
    if (sourceArea > EPSILON
        && realizedArea > EPSILON
        && dot(sourceNormal, realizedNormal) < 0) {
      flippedTriangleCount += 1;
    }
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const sourceLength = edgeLength(source, vertices[left], vertices[right]);
      if (sourceLength > EPSILON) {
        edgeRatios.push(edgeLength(realized, vertices[left], vertices[right]) / sourceLength);
      }
    }
  }
  return {
    triangleCount,
    flippedTriangleCount,
    displacement: Array.from(displacement),
    edgeRatio: {
      q05: quantile(edgeRatios, 0.05),
      q50: quantile(edgeRatios, 0.5),
      q95: quantile(edgeRatios, 0.95),
      minimum: edgeRatios.length ? Math.min(...edgeRatios) : null,
      maximum: edgeRatios.length ? Math.max(...edgeRatios) : null,
    },
    areaRatio: {
      q05: quantile(areaRatios, 0.05),
      q50: quantile(areaRatios, 0.5),
      q95: quantile(areaRatios, 0.95),
      minimum: areaRatios.length ? Math.min(...areaRatios) : null,
      maximum: areaRatios.length ? Math.max(...areaRatios) : null,
    },
  };
}

function createClearanceSummary({
  positions,
  supportVertexIndices,
  terrainPoint,
  terrainNormal,
  targetClearance,
}) {
  const values = Array.from(
    supportVertexIndices,
    vertex => signedDistance(point(positions, vertex), terrainPoint, terrainNormal),
  );
  const minimum = Math.min(...values);
  return {
    target: targetClearance,
    minimum,
    q05: quantile(values, 0.05),
    q50: quantile(values, 0.5),
    q95: quantile(values, 0.95),
    maximum: Math.max(...values),
    passes: minimum + 1e-9 >= targetClearance,
    values,
  };
}

function createCollarSummary(source, realized, bodySideSet) {
  const sourceDistances = [];
  const realizedDistances = [];
  const absoluteLogDistanceDistortions = [];
  for (const pair of bodySideSet.pairs) {
    const sourceDistance = edgeLength(source, pair.attachmentVertex, pair.bodyVertex);
    const realizedDistance = edgeLength(realized, pair.attachmentVertex, pair.bodyVertex);
    sourceDistances.push(sourceDistance);
    realizedDistances.push(realizedDistance);
    absoluteLogDistanceDistortions.push(
      Math.abs(Math.log(Math.max(realizedDistance, EPSILON) / Math.max(sourceDistance, EPSILON))),
    );
  }
  return {
    pairCount: bodySideSet.pairs.length,
    sourceDistance: {
      q05: quantile(sourceDistances, 0.05),
      q50: quantile(sourceDistances, 0.5),
      q95: quantile(sourceDistances, 0.95),
    },
    realizedDistance: {
      q05: quantile(realizedDistances, 0.05),
      q50: quantile(realizedDistances, 0.5),
      q95: quantile(realizedDistances, 0.95),
    },
    maximumAbsoluteLogDistanceDistortion:
      Math.max(...absoluteLogDistanceDistortions, 0),
    absoluteLogDistanceDistortions,
  };
}

export function createSwingClearanceMaskSummary(probe) {
  const supportVertexIndices = Array.from(probe?.vertexIndices ?? []);
  const influenceVertexIndices = Array.from(probe?.carrier?.influenceVertexIndices ?? []);
  const attachmentVertexIndices = Array.from(probe?.carrier?.attachmentVertexIndices ?? []);
  if (supportVertexIndices.length === 0
      || influenceVertexIndices.length === 0
      || attachmentVertexIndices.length === 0) {
    throw new Error('swing-clearance mask identity requires support, influence, and attachment vertices');
  }
  return {
    supportId: probe.id,
    supportVertexCount: supportVertexIndices.length,
    influenceVertexCount: influenceVertexIndices.length,
    attachmentVertexCount: attachmentVertexIndices.length,
    supportVertexIndices,
    influenceVertexIndices,
    attachmentVertexIndices,
  };
}

export function createSwingClearanceBodySideSet({
  positions,
  probes,
  probe,
  neighborsPerAttachment = 4,
} = {}) {
  if (!Number.isInteger(neighborsPerAttachment) || neighborsPerAttachment < 1) {
    throw new Error('body-side set requires a positive integer neighbor count');
  }
  const excluded = new Set(
    probes.flatMap(entry => Array.from(entry.carrier.influenceVertexIndices)),
  );
  const candidates = Array.from(
    { length: positions.length / 3 },
    (_, vertex) => vertex,
  ).filter(vertex => !excluded.has(vertex));
  const buildTree = (vertices, depth = 0) => {
    if (vertices.length === 0) return null;
    const axis = depth % 3;
    vertices.sort((left, right) => (
      positions[left * 3 + axis] - positions[right * 3 + axis]
      || left - right
    ));
    const middle = Math.floor(vertices.length / 2);
    return {
      vertex: vertices[middle],
      axis,
      left: buildTree(vertices.slice(0, middle), depth + 1),
      right: buildTree(vertices.slice(middle + 1), depth + 1),
    };
  };
  const tree = buildTree(candidates);
  const queryNearest = attachmentVertex => {
    const origin = point(positions, attachmentVertex);
    const nearest = [];
    const accept = bodyVertex => {
      const sample = {
        attachmentVertex,
        bodyVertex,
        sourceDistance: edgeLength(positions, attachmentVertex, bodyVertex),
      };
      nearest.push(sample);
      nearest.sort((left, right) => (
        left.sourceDistance - right.sourceDistance
        || left.bodyVertex - right.bodyVertex
      ));
      if (nearest.length > neighborsPerAttachment) nearest.pop();
    };
    const visit = node => {
      if (!node) return;
      const coordinate = positions[node.vertex * 3 + node.axis];
      const delta = origin[node.axis] - coordinate;
      const near = delta <= 0 ? node.left : node.right;
      const far = delta <= 0 ? node.right : node.left;
      visit(near);
      accept(node.vertex);
      const maximumDistance = nearest.length < neighborsPerAttachment
        ? Infinity
        : nearest.at(-1).sourceDistance;
      if (Math.abs(delta) <= maximumDistance + EPSILON) visit(far);
    };
    visit(tree);
    return nearest;
  };
  const pairs = [];
  for (const attachmentVertex of probe.carrier.attachmentVertexIndices) {
    const nearest = queryNearest(attachmentVertex);
    if (nearest.length !== neighborsPerAttachment) {
      throw new Error('body-side set cannot satisfy frozen neighbor count');
    }
    pairs.push(...nearest);
  }
  return {
    authority: 'nearest-outside-all-carrier-influence-regions',
    neighborsPerAttachment,
    pairs,
  };
}

export function createSwingClearanceCandidate({
  family,
  positions,
  indices,
  probe,
  probes,
  terrainPoint,
  terrainNormal,
  targetClearance = 0.008,
  maximumTranslation = 0.035,
  bodySideSet = null,
} = {}) {
  if (!['source', 'translation', 'minimum-rotation'].includes(family)) {
    throw new Error(`unsupported swing-clearance family ${family}`);
  }
  const normal = normalize(Array.from(terrainNormal), 'terrain normal');
  const sourceClearance = createClearanceSummary({
    positions,
    supportVertexIndices: probe.vertexIndices,
    terrainPoint,
    terrainNormal: normal,
    targetClearance,
  });
  const neededClearance = Math.max(0, targetClearance - sourceClearance.minimum);
  const appliedTranslation = family === 'translation'
    ? Math.min(neededClearance, maximumTranslation)
    : 0;
  const pivot = weightedCentroid(
    positions,
    probe.carrier.attachmentVertexIndices,
    probe.carrier.attachmentWeights,
  );
  const contact = weightedCentroid(positions, probe.vertexIndices, probe.weights);
  const sourceLever = subtract(contact, pivot);
  const desiredLever = add(sourceLever, multiply(normal, neededClearance));
  const rotation = family === 'minimum-rotation'
    ? minimumRotation(sourceLever, desiredLever)
    : { axis: [1, 0, 0], angle: 0 };
  const transformed = new Float64Array(positions);
  const influenceSet = new Set(probe.carrier.influenceVertexIndices);
  for (let index = 0; index < probe.carrier.influenceVertexIndices.length; index += 1) {
    const vertex = probe.carrier.influenceVertexIndices[index];
    const skinWeight = carrierWeight(
      probe.carrier.influenceWeights[index],
      probe.carrier.rigidCoreThreshold,
    );
    if (!(skinWeight > 0) || family === 'source') continue;
    const sourcePoint = point(positions, vertex);
    const rigidPoint = family === 'translation'
      ? add(sourcePoint, multiply(normal, appliedTranslation))
      : add(pivot, rotateAroundAxis(subtract(sourcePoint, pivot), rotation.axis, rotation.angle));
    const realizedPoint = add(
      multiply(sourcePoint, 1 - skinWeight),
      multiply(rigidPoint, skinWeight),
    );
    transformed.set(realizedPoint, vertex * 3);
  }
  const exactBodySideSet = bodySideSet ?? createSwingClearanceBodySideSet({
    positions,
    probes,
    probe,
  });
  return {
    family,
    positions: transformed,
    appliedTranslation,
    rotationAxis: rotation.axis,
    rotationRadians: rotation.angle,
    sourceClearance,
    clearance: createClearanceSummary({
      positions: transformed,
      supportVertexIndices: probe.vertexIndices,
      terrainPoint,
      terrainNormal: normal,
      targetClearance,
    }),
    collar: createCollarSummary(positions, transformed, exactBodySideSet),
    deformation: createLocalDeformationMetrics(
      positions,
      transformed,
      indices,
      influenceSet,
    ),
  };
}

export function assertSwingClearanceAssayReport(report) {
  if (report?.schema !== 'kaminos.lirm-swing-clearance-assay-report.v0'
      || report.status !== 'complete') {
    throw new Error('swing-clearance assay requires a complete report');
  }
  if (report.requestedRoute !== SWING_CLEARANCE_ASSAY_ROUTE
      || report.effectiveRoute !== SWING_CLEARANCE_ASSAY_ROUTE) {
    throw new Error('swing-clearance assay route mismatch');
  }
  if (report.sourceHash !== SWING_CLEARANCE_SOURCE_HASH
      || report.actualSourceHash !== SWING_CLEARANCE_SOURCE_HASH) {
    throw new Error('swing-clearance source identity mismatch');
  }
  if (report.supportId !== SWING_CLEARANCE_SUPPORT_ID) {
    throw new Error('swing-clearance support identity mismatch');
  }
  if (report.inputHashes?.contactAtlas !== SWING_CLEARANCE_CONTACT_ATLAS_HASH
      || report.inputHashes?.registration !== SWING_CLEARANCE_REGISTRATION_HASH) {
    throw new Error('swing-clearance input hash identity mismatch');
  }
  const masks = report.masks;
  if (masks?.supportId !== SWING_CLEARANCE_SUPPORT_ID
      || !Array.isArray(masks.supportVertexIndices)
      || !Array.isArray(masks.influenceVertexIndices)
      || !Array.isArray(masks.attachmentVertexIndices)
      || masks.supportVertexIndices.length === 0
      || masks.influenceVertexIndices.length === 0
      || masks.attachmentVertexIndices.length === 0) {
    throw new Error('swing-clearance mask identity mismatch');
  }
  const families = report.candidates?.map(candidate => candidate.family);
  if (families?.join(',') !== 'source,translation,minimum-rotation') {
    throw new Error('swing-clearance candidate families mismatch');
  }
  return report;
}
