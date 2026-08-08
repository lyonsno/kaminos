const PARENT_ATLAS_SCHEMA = 'kaminos.authored-muscle-coordinate-parent-atlas.v0';
const FRAME_RECEIPT_SCHEMA = 'kaminos.k4-envelope-frame-binding-receipt.v0';
const SOLVER_CARRIER_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-solver-carrier.v0';

export const K4_SOURCE_ROUTE_CONTAINMENT_SCHEMA =
  'kaminos.k4-source-route-containment-assay.v0';

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(vector) {
  return Math.sqrt(dot(vector, vector));
}

function distance(a, b) {
  return norm(subtract(a, b));
}

function applySimilarity(transform, point) {
  const scaled = point.map(value => value * transform.scale);
  return [0, 1, 2].map(row =>
    transform.rotation[row][0] * scaled[0] +
    transform.rotation[row][1] * scaled[1] +
    transform.rotation[row][2] * scaled[2] +
    transform.translation[row]);
}

function finitePoint(value, label) {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite xyz point`);
  }
  return value;
}

function validateRequestedConstructionIds(value) {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Error('requested construction ids must be a nonempty string array');
  }
  if (new Set(value).size !== value.length) {
    throw new Error('requested construction ids must be unique');
  }
}

function sectionId(constructionId, index) {
  return `${constructionId}:section:${String(index).padStart(4, '0')}`;
}

export function classifyRouteContainmentRow({
  sourceSignedDistance,
  restSignedDistance,
  currentSignedDistance,
  sourceToRestDrift,
  tolerance,
}) {
  for (const [label, value] of Object.entries({
    sourceSignedDistance,
    restSignedDistance,
    currentSignedDistance,
    sourceToRestDrift,
    tolerance,
  })) {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  }
  if (!(tolerance > 0)) throw new Error('tolerance must be positive');
  const sourceOutside = sourceSignedDistance > 0;
  const restOutside = restSignedDistance > 0;
  const currentOutside = currentSignedDistance > 0;
  const exportDrift = sourceToRestDrift > tolerance;
  const mechanisms = [];
  let classification;
  let correspondenceImplication = null;

  if (exportDrift) {
    mechanisms.push('fixture-export-drift');
    if (restOutside !== currentOutside) mechanisms.push('packing-displacement');
    classification = mechanisms.length > 1 ? 'mixed' : 'fixture-export-drift';
  } else if (!sourceOutside && !restOutside && currentOutside) {
    mechanisms.push('packing-displacement');
    classification = 'packing-induced-route-escape';
  } else if (sourceOutside && restOutside && currentOutside) {
    mechanisms.push('source-route-outside');
    classification = 'source-route-outside';
    correspondenceImplication = 'regional-correspondence-question';
  } else if (sourceOutside && restOutside && !currentOutside) {
    mechanisms.push('source-route-outside', 'packing-displacement');
    classification = 'packing-corrected-source-route';
    correspondenceImplication = 'regional-correspondence-question';
  } else if (!sourceOutside && !restOutside && !currentOutside) {
    classification = 'contained';
  } else {
    mechanisms.push('containment-state-contradiction');
    classification = 'mixed';
  }

  return {
    classification,
    mechanisms,
    correspondenceImplication,
    sourceOutside,
    restOutside,
    currentOutside,
  };
}

function sourceSamplesForRoute(route, constructionId) {
  const candidates = route?.fields?.centerline?.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error(`source route ${constructionId} has no centerline candidates`);
  }
  const candidate = candidates.find(row =>
    row.kind === 'source-curve-centerline');
  const samples = candidate?.value?.resampledSamples;
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`source route ${constructionId} lacks resampled source samples`);
  }
  return { candidate, samples };
}

function axisNodesForCage(cage, constructionId) {
  const nodes = cage?.manifest?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(`fixture cage ${constructionId} has no nodes`);
  }
  const axes = nodes.filter(node => node.id?.endsWith(':axis'))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (axes.length === 0) throw new Error(`fixture cage ${constructionId} has no axes`);
  return axes;
}

function fixedSectionIds(cage) {
  const fixedNodeIds = new Set((cage.manifest.constraints?.boundaryMasks || [])
    .filter(mask => mask.fixed === true)
    .map(mask => mask.nodeId));
  const ids = new Set();
  for (const node of cage.manifest.nodes) {
    if (!fixedNodeIds.has(node.id)) continue;
    const match = /^(.*:section:\d+)/.exec(node.id);
    if (match) ids.add(match[1]);
  }
  return ids;
}

export function buildK4SourceRouteContainment({
  parentAtlas,
  frameReceipt,
  envelopeMesh,
  solverCarrier,
  shapeAssay,
  requestedConstructionIds,
  tolerance,
  signedDistance = signedEnvelopeDistance,
}) {
  validateRequestedConstructionIds(requestedConstructionIds);
  if (parentAtlas?.schema !== PARENT_ATLAS_SCHEMA) {
    throw new Error(`source-route containment requires ${PARENT_ATLAS_SCHEMA}`);
  }
  if (frameReceipt?.schema !== FRAME_RECEIPT_SCHEMA) {
    throw new Error(`source-route containment requires ${FRAME_RECEIPT_SCHEMA}`);
  }
  if (solverCarrier?.schema !== SOLVER_CARRIER_SCHEMA) {
    throw new Error(`source-route containment requires ${SOLVER_CARRIER_SCHEMA}`);
  }
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    throw new Error('source-route containment tolerance must be positive');
  }
  const transform = frameReceipt.sourceToEnvelope?.transform;
  if (!transform || !Number.isFinite(transform.scale) ||
      !Array.isArray(transform.rotation) || !Array.isArray(transform.translation)) {
    throw new Error('source-route containment frame receipt lacks a transform');
  }
  const shapeCarrierSha256 = shapeAssay?.shaping?.sourceCarrierSha256;
  if (shapeCarrierSha256 && shapeCarrierSha256 !== solverCarrier.identity?.sha256) {
    throw new Error(
      `shape assay carrier identity mismatch: receipt ${shapeCarrierSha256}, ` +
      `fixture ${solverCarrier.identity?.sha256 || 'missing'}`,
    );
  }
  const frameConstructions = new Set(frameReceipt.effectiveConstructionIds ||
    parentAtlas.routeInventory.map(row => row.constructionId));
  const shapeStatuses = new Map((shapeAssay?.shaping?.sectionReceipts || [])
    .map(row => [row.sectionId, row.status]));
  const rows = [];
  const constructionSummaries = [];

  for (const constructionId of requestedConstructionIds) {
    if (!frameConstructions.has(constructionId)) {
      throw new Error(`frame receipt does not cover requested ${constructionId}`);
    }
    const route = parentAtlas.routeInventory.find(row =>
      row.constructionId === constructionId);
    if (!route) throw new Error(`parent atlas lacks requested ${constructionId}`);
    const cage = solverCarrier.cages.find(row =>
      row.constructionId === constructionId);
    if (!cage) throw new Error(`solver carrier lacks requested ${constructionId}`);
    const { candidate, samples } = sourceSamplesForRoute(route, constructionId);
    const axes = axisNodesForCage(cage, constructionId);
    if (samples.length !== axes.length) {
      throw new Error(
        `${constructionId} source/fixture section count mismatch: ` +
        `${samples.length} versus ${axes.length}`,
      );
    }
    const fixed = fixedSectionIds(cage);
    let maximumSourceToRestDrift = 0;
    let maximumRestToCurrentDisplacement = 0;
    let sourceOutsideCount = 0;
    let restOutsideCount = 0;
    let currentOutsideCount = 0;
    const classifications = {};

    for (let index = 0; index < samples.length; index += 1) {
      const id = sectionId(constructionId, index);
      const axis = axes[index];
      if (axis.id !== `${id}:axis`) {
        throw new Error(`${constructionId} section order mismatch at ${index}: ${axis.id}`);
      }
      const sourcePosition = finitePoint(samples[index].position,
        `${id} source position`);
      const restPosition = finitePoint(axis.restPosition, `${id} rest position`);
      const currentPosition = finitePoint(axis.currentPosition,
        `${id} current position`);
      const sourceEnvelopePosition = applySimilarity(transform, sourcePosition);
      const restEnvelopePosition = applySimilarity(transform, restPosition);
      const currentEnvelopePosition = applySimilarity(transform, currentPosition);
      const sourceFit = signedDistance(sourceEnvelopePosition, envelopeMesh);
      const restFit = signedDistance(restEnvelopePosition, envelopeMesh);
      const currentFit = signedDistance(currentEnvelopePosition, envelopeMesh);
      const sourceToRestDrift = distance(sourcePosition, restPosition);
      const restToCurrentDisplacement = distance(restPosition, currentPosition);
      const result = classifyRouteContainmentRow({
        sourceSignedDistance: sourceFit.signedDistance,
        restSignedDistance: restFit.signedDistance,
        currentSignedDistance: currentFit.signedDistance,
        sourceToRestDrift,
        tolerance,
      });
      maximumSourceToRestDrift = Math.max(maximumSourceToRestDrift,
        sourceToRestDrift);
      maximumRestToCurrentDisplacement = Math.max(
        maximumRestToCurrentDisplacement, restToCurrentDisplacement);
      sourceOutsideCount += Number(result.sourceOutside);
      restOutsideCount += Number(result.restOutside);
      currentOutsideCount += Number(result.currentOutside);
      classifications[result.classification] =
        (classifications[result.classification] || 0) + 1;
      rows.push({
        constructionId,
        sectionId: id,
        sectionIndex: index,
        sourceSampleId: `${candidate.value.sourcePathSha256}:resampled:${String(index).padStart(4, '0')}`,
        sourcePathSha256: candidate.value.sourcePathSha256,
        fixedAttachmentSection: fixed.has(id),
        returnedShapeStatus: shapeStatuses.get(id) || 'unreported',
        source: {
          position: sourcePosition,
          envelopePosition: sourceEnvelopePosition,
          signedDistance: sourceFit.signedDistance,
          inside: sourceFit.inside,
        },
        fixtureRest: {
          position: restPosition,
          envelopePosition: restEnvelopePosition,
          signedDistance: restFit.signedDistance,
          inside: restFit.inside,
        },
        packedCurrent: {
          position: currentPosition,
          envelopePosition: currentEnvelopePosition,
          signedDistance: currentFit.signedDistance,
          inside: currentFit.inside,
        },
        sourceToRestDrift,
        restToCurrentDisplacement,
        ...result,
      });
    }
    constructionSummaries.push({
      constructionId,
      sectionCount: samples.length,
      sourceOutsideCount,
      restOutsideCount,
      currentOutsideCount,
      maximumSourceToRestDrift,
      maximumRestToCurrentDisplacement,
      classifications,
    });
  }

  const returnedEscapeIds = [...shapeStatuses.entries()]
    .filter(([, status]) => status === 'axis-outside-envelope')
    .map(([id]) => id)
    .filter(id => requestedConstructionIds.some(constructionId =>
      id.startsWith(`${constructionId}:section:`)));
  const rowById = new Map(rows.map(row => [row.sectionId, row]));
  const returnedEscapeRows = returnedEscapeIds.map(id => {
    const row = rowById.get(id);
    if (!row) throw new Error(`shape assay escape ${id} has no comparison row`);
    if (!row.currentOutside) {
      throw new Error(`shape assay escape ${id} is inside under the effective comparison`);
    }
    return row;
  });

  return {
    schema: K4_SOURCE_ROUTE_CONTAINMENT_SCHEMA,
    status: 'completed-provisional',
    claimCeiling: 'source-to-assay-geometric-attribution-only',
    heldClaims: [
      'operator-authored-containment-intent',
      'anatomical-route-correctness',
      'anatomical-registration',
      'production-admission',
    ],
    frameAuthority: frameReceipt.sourceToEnvelope.authority,
    requestedConstructionIds: [...requestedConstructionIds],
    effectiveConstructionIds: [...requestedConstructionIds],
    sourceIdentity: {
      parentAtlasId: parentAtlas.id,
      blend: parentAtlas.source,
      graph: parentAtlas.sourceGraphIdentity,
    },
    tolerance,
    constructionSummaries,
    returnedEscapeSectionIds: returnedEscapeIds,
    returnedEscapeRows,
    fixedAttachmentRows: rows.filter(row => row.fixedAttachmentSection),
    rows,
  };
}

const COMPONENT_READERS = Object.freeze({
  5120: (view, offset) => view.getInt8(offset),
  5121: (view, offset) => view.getUint8(offset),
  5122: (view, offset) => view.getInt16(offset, true),
  5123: (view, offset) => view.getUint16(offset, true),
  5125: (view, offset) => view.getUint32(offset, true),
  5126: (view, offset) => view.getFloat32(offset, true),
});
const COMPONENT_SIZES = Object.freeze({
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
});

function quaternionToMatrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function composeTrs(node) {
  if (node.matrix) {
    const matrix = node.matrix;
    return {
      linear: [
        [matrix[0], matrix[4], matrix[8]],
        [matrix[1], matrix[5], matrix[9]],
        [matrix[2], matrix[6], matrix[10]],
      ],
      translation: [matrix[12], matrix[13], matrix[14]],
    };
  }
  const rotation = quaternionToMatrix(node.rotation || [0, 0, 0, 1]);
  const scale = node.scale || [1, 1, 1];
  return {
    linear: rotation.map(row => row.map((value, column) =>
      value * scale[column])),
    translation: node.translation || [0, 0, 0],
  };
}

function composeFrames(parent, child) {
  const linear = [0, 1, 2].map(row => [0, 1, 2].map(column =>
    parent.linear[row][0] * child.linear[0][column] +
    parent.linear[row][1] * child.linear[1][column] +
    parent.linear[row][2] * child.linear[2][column]));
  const translation = [0, 1, 2].map(row =>
    parent.linear[row][0] * child.translation[0] +
    parent.linear[row][1] * child.translation[1] +
    parent.linear[row][2] * child.translation[2] +
    parent.translation[row]);
  return { linear, translation };
}

function applyFrame(frame, point) {
  return [0, 1, 2].map(row =>
    frame.linear[row][0] * point[0] +
    frame.linear[row][1] * point[1] +
    frame.linear[row][2] * point[2] +
    frame.translation[row]);
}

function accessorValues(document, binary, accessorIndex, components) {
  const accessor = document.accessors[accessorIndex];
  const view = document.bufferViews[accessor.bufferView];
  const reader = COMPONENT_READERS[accessor.componentType];
  const size = COMPONENT_SIZES[accessor.componentType];
  if (!reader) throw new Error(`unsupported glb component type ${accessor.componentType}`);
  const stride = view.byteStride || components * size;
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const rows = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const row = [];
    for (let component = 0; component < components; component += 1) {
      row.push(reader(data, base + index * stride + component * size));
    }
    rows.push(components === 1 ? row[0] : row);
  }
  return rows;
}

export function parseGlbTriangleSoup(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 20 || buffer.subarray(0, 4).toString() !== 'glTF') {
    throw new Error('glb parse requires a binary glTF header');
  }
  let offset = 12;
  let document = null;
  let binary = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(payload.toString());
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  if (!document || !binary) throw new Error('glb parse requires JSON and BIN chunks');
  const identity = {
    linear: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    translation: [0, 0, 0],
  };
  const vertices = [];
  const triangles = [];
  const visit = (nodeIndex, parentFrame) => {
    const node = document.nodes[nodeIndex];
    const frame = composeFrames(parentFrame, composeTrs(node));
    if (Number.isInteger(node.mesh)) {
      for (const primitive of document.meshes[node.mesh].primitives) {
        const base = vertices.length;
        const positions = accessorValues(document, binary,
          primitive.attributes.POSITION, 3);
        for (const position of positions) vertices.push(applyFrame(frame, position));
        const indices = Number.isInteger(primitive.indices)
          ? accessorValues(document, binary, primitive.indices, 1)
          : positions.map((_, index) => index);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          triangles.push([
            base + indices[index], base + indices[index + 1],
            base + indices[index + 2],
          ]);
        }
      }
    }
    for (const child of node.children || []) visit(child, frame);
  };
  const scene = document.scenes[document.scene ?? 0];
  for (const nodeIndex of scene.nodes) visit(nodeIndex, identity);
  if (triangles.length === 0) throw new Error('glb parse found no triangles');
  return { vertices, triangles };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function pointTriangleDistanceSquared(point, a, b, c) {
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ap = subtract(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = subtract(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const value = clamp01(d1 / (d1 - d3));
    const projection = [0, 1, 2].map(index => a[index] + ab[index] * value);
    return dot(subtract(point, projection), subtract(point, projection));
  }
  const cp = subtract(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const value = clamp01(d2 / (d2 - d6));
    const projection = [0, 1, 2].map(index => a[index] + ac[index] * value);
    return dot(subtract(point, projection), subtract(point, projection));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const value = clamp01((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const projection = [0, 1, 2].map(index =>
      b[index] + (c[index] - b[index]) * value);
    return dot(subtract(point, projection), subtract(point, projection));
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const projection = [0, 1, 2].map(index =>
    a[index] + ab[index] * v + ac[index] * w);
  return dot(subtract(point, projection), subtract(point, projection));
}

function triangleSolidAngle(point, a, b, c) {
  const ra = subtract(a, point);
  const rb = subtract(b, point);
  const rc = subtract(c, point);
  const la = norm(ra);
  const lb = norm(rb);
  const lc = norm(rc);
  const numerator = dot(ra, cross(rb, rc));
  const denominator = la * lb * lc + dot(ra, rb) * lc +
    dot(rb, rc) * la + dot(rc, ra) * lb;
  return 2 * Math.atan2(numerator, denominator);
}

export function signedEnvelopeDistance(point, mesh) {
  let bestSquared = Infinity;
  let windingSum = 0;
  for (const [aIndex, bIndex, cIndex] of mesh.triangles) {
    const a = mesh.vertices[aIndex];
    const b = mesh.vertices[bIndex];
    const c = mesh.vertices[cIndex];
    bestSquared = Math.min(bestSquared,
      pointTriangleDistanceSquared(point, a, b, c));
    windingSum += triangleSolidAngle(point, a, b, c);
  }
  const winding = windingSum / (4 * Math.PI);
  const inside = Math.abs(winding) > 0.5;
  const unsignedDistance = Math.sqrt(bestSquared);
  return {
    signedDistance: inside ? -unsignedDistance : unsignedDistance,
    winding,
    inside,
  };
}
