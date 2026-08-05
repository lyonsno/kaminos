import { createHash } from 'node:crypto';

export const MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA =
  'kaminos.muscle-compartment-ring-cage.v0';

const TWO_PI = 2 * Math.PI;
const FRAME_EPSILON = 1e-12;
const SUPPORTED_FREEDOM_MODES = Object.freeze([
  'affine-section',
  'free-ring',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashCanonical(value) {
  return sha256(canonicalJson(value));
}

export function encodeMuscleCompartmentRingCageCanonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function encodeMuscleCompartmentRingCageIdentityDomain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ring cage identity domain requires an object');
  }
  const { identity: _selfExcludedIdentity, ...identityDomain } = value;
  return encodeMuscleCompartmentRingCageCanonicalBytes(identityDomain);
}

export function verifyMuscleCompartmentRingCageIdentity(value) {
  if (!value?.identity || typeof value.identity !== 'object') {
    throw new Error('ring cage identity envelope is missing');
  }
  if (value.identity.domain !== 'self-excluding-top-level-identity') {
    throw new Error('unsupported ring cage identity domain');
  }
  const bytes = encodeMuscleCompartmentRingCageIdentityDomain(value);
  const actualSha256 = sha256(bytes);
  if (value.identity.sha256 !== actualSha256) {
    throw new Error(
      `ring cage identity sha256 mismatch: recorded ${value.identity.sha256}, actual ${actualSha256}`,
    );
  }
  if (value.identity.canonicalByteLength !== bytes.byteLength) {
    throw new Error(
      `ring cage identity canonicalByteLength mismatch: recorded ${value.identity.canonicalByteLength}, actual ${bytes.byteLength}`,
    );
  }
  return {
    verified: true,
    domain: value.identity.domain,
    sha256: actualSha256,
    canonicalByteLength: bytes.byteLength,
  };
}

export function hashMuscleCompartmentRingCageCanonicalJson(value) {
  return hashCanonical(value);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
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

function normalize(vector, label) {
  const magnitude = length(vector);
  if (!(magnitude > FRAME_EPSILON)) {
    throw new Error(`${label} must have nonzero finite length`);
  }
  return scale(vector, 1 / magnitude);
}

function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function requirePoint(value, label) {
  if (!isFinitePoint(value)) throw new Error(`${label} must be a finite 3D point`);
}

function requireNonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function samePoint(left, right) {
  return left.every((value, axis) => value === right[axis]);
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('ring cage config must be an object');
  }
  const {
    ringVertexCount,
    freedomMode,
    volumeTolerance,
    sourceVolumeTolerance,
    frameSeedDirection,
  } = config;
  if (!Number.isInteger(ringVertexCount) || ringVertexCount < 8 || ringVertexCount > 16) {
    throw new Error('ringVertexCount must be an integer between 8 and 16');
  }
  if (!SUPPORTED_FREEDOM_MODES.includes(freedomMode)) {
    throw new Error('freedomMode must be affine-section or free-ring');
  }
  if (!Number.isFinite(volumeTolerance) || !(volumeTolerance > 0)) {
    throw new Error('volumeTolerance must be positive and finite');
  }
  if (!Number.isFinite(sourceVolumeTolerance) || !(sourceVolumeTolerance > 0)) {
    throw new Error('sourceVolumeTolerance must be positive and finite');
  }
  requirePoint(frameSeedDirection, 'frameSeedDirection');
  if (!(length(frameSeedDirection) > FRAME_EPSILON)) {
    throw new Error('frameSeedDirection must have nonzero finite length');
  }
  return structuredClone(config);
}

function continuousCarrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const segmentLength = length(subtract(end.position, start.position));
    volume += Math.PI * segmentLength / 3 * (
      start.radius ** 2 + start.radius * end.radius + end.radius ** 2
    );
  }
  return volume;
}

function validateSource(source, config) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.muscles) ||
      source.muscles.length === 0) {
    throw new Error('muscle compartment ring cage source requires at least one muscle');
  }
  requireNonemptyString(source.id, 'source id');
  const constructionIds = new Set();
  const sourceVolumeReceipts = new Map();
  for (const [muscleIndex, muscle] of source.muscles.entries()) {
    const label = muscle?.id || `muscle[${muscleIndex}]`;
    requireNonemptyString(muscle?.id, `muscle[${muscleIndex}] id`);
    requireNonemptyString(muscle?.identity?.constructionId, `${label} constructionId`);
    if (constructionIds.has(muscle.identity.constructionId)) {
      throw new Error(`duplicate constructionId ${muscle.identity.constructionId}; constructionId must be unique`);
    }
    constructionIds.add(muscle.identity.constructionId);
    if (!Array.isArray(muscle.centerline) || muscle.centerline.length < 2) {
      throw new Error(`${label} centerline requires at least two samples`);
    }
    for (const [sectionIndex, sample] of muscle.centerline.entries()) {
      requirePoint(sample?.position, `${label} centerline[${sectionIndex}] position`);
      if (!Number.isFinite(sample?.radius) || !(sample.radius > 0)) {
        throw new Error(`${label} centerline[${sectionIndex}] radius must be positive and finite`);
      }
      if (sectionIndex > 0 &&
          length(subtract(sample.position, muscle.centerline[sectionIndex - 1].position)) <=
            FRAME_EPSILON) {
        throw new Error(`${label} centerline consecutive samples must not coincide`);
      }
    }
    for (const role of ['origin', 'insertion']) {
      const attachment = muscle.attachments?.[role];
      requireNonemptyString(attachment?.id, `${label} ${role} attachment id`);
      requirePoint(attachment?.position, `${label} ${role} attachment position`);
      const endpoint = role === 'origin' ? muscle.centerline[0] : muscle.centerline.at(-1);
      if (!samePoint(attachment.position, endpoint.position)) {
        throw new Error(`${label} ${role} attachment must equal its centerline endpoint`);
      }
    }
    if (!Number.isFinite(muscle.targetVolume) || !(muscle.targetVolume > 0)) {
      throw new Error(`${label} targetVolume must be positive and finite`);
    }
    const measuredCarrierVolume = continuousCarrierVolume(muscle.centerline);
    const targetRelativeError = Math.abs(measuredCarrierVolume - muscle.targetVolume) /
      muscle.targetVolume;
    if (targetRelativeError > config.sourceVolumeTolerance) {
      throw new Error(
        `${label} source carrier volume ${measuredCarrierVolume} disagrees with targetVolume ` +
        `${muscle.targetVolume} beyond sourceVolumeTolerance ${config.sourceVolumeTolerance}`,
      );
    }
    sourceVolumeReceipts.set(muscle.identity.constructionId, {
      continuousCarrierVolume: measuredCarrierVolume,
      targetRelativeError,
    });
  }
  return sourceVolumeReceipts;
}

function tangentsFor(centerline, constructionId) {
  return centerline.map((sample, index) => {
    const previous = centerline[Math.max(0, index - 1)].position;
    const next = centerline[Math.min(centerline.length - 1, index + 1)].position;
    return normalize(
      subtract(next, previous),
      `${constructionId} section ${index} tangent`,
    );
  });
}

function rotateMinimal(vector, from, to, constructionId, sectionIndex) {
  const rotationAxis = cross(from, to);
  const sine = length(rotationAxis);
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  if (sine <= FRAME_EPSILON) {
    if (cosine < 0) {
      throw new Error(
        `${constructionId} section ${sectionIndex} has antiparallel tangents; minimal frame transport is ambiguous`,
      );
    }
    return [...vector];
  }
  const axis = scale(rotationAxis, 1 / sine);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function transportedFrames(centerline, frameSeedDirection, constructionId) {
  const tangents = tangentsFor(centerline, constructionId);
  const seed = normalize(frameSeedDirection, 'frameSeedDirection');
  const projectedSeed = subtract(seed, scale(tangents[0], dot(seed, tangents[0])));
  if (!(length(projectedSeed) > FRAME_EPSILON)) {
    throw new Error(
      `${constructionId} frameSeedDirection is parallel to the initial tangent`,
    );
  }
  const frames = [{
    tangent: tangents[0],
    normal: normalize(projectedSeed, `${constructionId} initial transported normal`),
  }];
  frames[0].binormal = normalize(
    cross(frames[0].tangent, frames[0].normal),
    `${constructionId} initial transported binormal`,
  );
  for (let index = 1; index < tangents.length; index += 1) {
    const transported = rotateMinimal(
      frames[index - 1].normal,
      tangents[index - 1],
      tangents[index],
      constructionId,
      index,
    );
    const projected = subtract(
      transported,
      scale(tangents[index], dot(transported, tangents[index])),
    );
    const normal = normalize(projected, `${constructionId} section ${index} transported normal`);
    frames.push({
      tangent: tangents[index],
      normal,
      binormal: normalize(
        cross(tangents[index], normal),
        `${constructionId} section ${index} transported binormal`,
      ),
    });
  }
  return frames;
}

export function ellipseRadiusAtAngle(radii, angleRadians) {
  if (!Array.isArray(radii) || radii.length !== 2 ||
      !radii.every(radius => Number.isFinite(radius) && radius > 0)) {
    throw new Error('ellipse radii must be a positive finite pair');
  }
  if (!Number.isFinite(angleRadians)) throw new Error('ellipse angle must be finite');
  const [radiusX, radiusY] = radii;
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return 1 / Math.sqrt(
    cosine * cosine / (radiusX * radiusX) +
    sine * sine / (radiusY * radiusY),
  );
}

export function restrictRingCageSectionToEllipse(section, requestedRadiusScales) {
  if (!section || !Array.isArray(section.vertices) || !section.frame) {
    throw new Error('ellipse restriction requires a ring cage section');
  }
  if (!Array.isArray(requestedRadiusScales) || requestedRadiusScales.length !== 2 ||
      !requestedRadiusScales.every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('ellipse radius scales must be a positive finite pair');
  }
  const [normalScale, binormalScale] = requestedRadiusScales;
  const vertices = section.vertices.map(vertex => {
    const angleRadians = vertex.sourceEmbedding?.angleRadians;
    if (!Number.isFinite(angleRadians)) {
      throw new Error(`ellipse restriction requires source angle for ${vertex.id}`);
    }
    const offset = add(
      scale(
        section.frame.normal,
        section.effectiveReferenceRadius * normalScale * Math.cos(angleRadians),
      ),
      scale(
        section.frame.binormal,
        section.effectiveReferenceRadius * binormalScale * Math.sin(angleRadians),
      ),
    );
    return {
      id: vertex.id,
      sectionId: section.id,
      currentPosition: add(section.referenceCenter, offset),
    };
  });
  return {
    kind: 'ellipse-as-section-affine-restriction',
    sectionId: section.id,
    representation: 'ordered-polygonal-ring-cage',
    requested: { radiusScales: [...requestedRadiusScales] },
    effective: { radiusScales: [...requestedRadiusScales] },
    fallbackUsed: false,
    vertexIds: section.vertices.map(vertex => vertex.id),
    vertices,
  };
}

function signedTetrahedronVolume(points) {
  const [a, b, c, d] = points;
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function referenceTetrahedron(vertexIds, pointById, label) {
  const rawSignedVolume = signedTetrahedronVolume(
    vertexIds.map(id => pointById.get(id)),
  );
  if (!Number.isFinite(rawSignedVolume) || !(rawSignedVolume > 0)) {
    throw new Error(
      `${label} has inconsistent or degenerate raw reference orientation: ${rawSignedVolume}`,
    );
  }
  return {
    vertexIds: [...vertexIds],
    rawSignedVolume,
    orientationParity: 1,
  };
}

function surfaceEdgeMetrics(triangles) {
  const edgeCounts = new Map();
  const directedParity = new Map();
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const from = triangle[index];
      const to = triangle[(index + 1) % 3];
      const edge = [from, to].sort();
      const key = `${edge[0]}|${edge[1]}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      directedParity.set(
        key,
        (directedParity.get(key) ?? 0) + (from === edge[0] ? 1 : -1),
      );
    }
  }
  const openBoundaryEdgeCount = [...edgeCounts.values()].filter(count => count !== 2).length;
  const orientationMismatchEdgeCount = [...directedParity.entries()].filter(
    ([key, parity]) => edgeCounts.get(key) === 2 && parity !== 0,
  ).length;
  return {
    edgeCount: edgeCounts.size,
    openBoundaryEdgeCount,
    orientationMismatchEdgeCount,
    watertight: openBoundaryEdgeCount === 0,
    consistentlyOriented: orientationMismatchEdgeCount === 0,
  };
}

function signedSurfaceVolume(triangles, pointById) {
  return triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.map(id => pointById.get(id));
    return sum + dot(a, cross(b, c)) / 6;
  }, 0);
}

function buildGeometry(muscle, frames, config, radialScale) {
  const constructionId = muscle.identity.constructionId;
  const sectionIndexWidth = 4;
  const radialIndexWidth = 2;
  const axisVertices = [];
  const sections = muscle.centerline.map((sample, sectionIndex) => {
    const sectionId = `${constructionId}:section:${String(sectionIndex).padStart(sectionIndexWidth, '0')}`;
    const fixed = sectionIndex === 0 || sectionIndex === muscle.centerline.length - 1;
    const attachmentRole = sectionIndex === 0
      ? 'origin'
      : sectionIndex === muscle.centerline.length - 1 ? 'insertion' : null;
    const axisVertex = {
      id: `${sectionId}:axis`,
      sectionId,
      referencePosition: [...sample.position],
      currentPosition: [...sample.position],
      fixed,
    };
    axisVertices.push(axisVertex);
    const effectiveRadius = sample.radius * radialScale;
    const vertices = Array.from({ length: config.ringVertexCount }, (_, radialIndex) => {
      const angleRadians = TWO_PI * radialIndex / config.ringVertexCount;
      const radialDirection = add(
        scale(frames[sectionIndex].normal, Math.cos(angleRadians)),
        scale(frames[sectionIndex].binormal, Math.sin(angleRadians)),
      );
      const position = add(sample.position, scale(radialDirection, effectiveRadius));
      const id = `${sectionId}:vertex:${String(radialIndex).padStart(radialIndexWidth, '0')}`;
      return {
        id,
        sectionId,
        index: radialIndex,
        referencePosition: position,
        currentPosition: [...position],
        fixed,
        sourceEmbedding: {
          sectionId,
          representationVertexId: id,
          sourceKnotIndex: sectionIndex,
          angleRadians,
          sourceRadius: sample.radius,
          polygonDiscretizationRadialScale: radialScale,
        },
      };
    });
    return {
      id: sectionId,
      index: sectionIndex,
      referenceCenter: [...sample.position],
      currentCenter: [...sample.position],
      sourceRadius: sample.radius,
      effectiveReferenceRadius: effectiveRadius,
      frame: {
        tangent: frames[sectionIndex].tangent,
        normal: frames[sectionIndex].normal,
        binormal: frames[sectionIndex].binormal,
        transport: sectionIndex === 0 ? 'caller-seeded' : 'minimal-rotation',
      },
      boundary: attachmentRole
        ? {
            kind: 'attachment',
            role: attachmentRole,
            attachmentId: muscle.attachments[attachmentRole].id,
            fixed: true,
          }
        : { kind: 'interior', fixed: false },
      vertices,
    };
  });

  const pointById = new Map();
  for (const vertex of axisVertices) pointById.set(vertex.id, vertex.referencePosition);
  for (const section of sections) {
    for (const vertex of section.vertices) pointById.set(vertex.id, vertex.referencePosition);
  }

  const triangles = [];
  const ringVertexIds = sections.map(section => section.vertices.map(vertex => vertex.id));
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    for (let radialIndex = 0; radialIndex < config.ringVertexCount; radialIndex += 1) {
      const next = (radialIndex + 1) % config.ringVertexCount;
      const a = ringVertexIds[sectionIndex][radialIndex];
      const b = ringVertexIds[sectionIndex + 1][radialIndex];
      const c = ringVertexIds[sectionIndex + 1][next];
      const d = ringVertexIds[sectionIndex][next];
      // Use the same d-b diagonal exposed by the three-tetrahedron prism
      // decomposition below. The alternate a-c diagonal encloses the same
      // volume only while this quad is planar; curved or tapered sections make
      // the two triangulations describe different polyhedra.
      triangles.push([a, d, b], [d, c, b]);
    }
  }
  const lastSectionIndex = sections.length - 1;
  for (let radialIndex = 0; radialIndex < config.ringVertexCount; radialIndex += 1) {
    const next = (radialIndex + 1) % config.ringVertexCount;
    triangles.push([
      axisVertices[0].id,
      ringVertexIds[0][next],
      ringVertexIds[0][radialIndex],
    ]);
    triangles.push([
      axisVertices[lastSectionIndex].id,
      ringVertexIds[lastSectionIndex][radialIndex],
      ringVertexIds[lastSectionIndex][next],
    ]);
  }

  const cells = [];
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    for (let radialIndex = 0; radialIndex < config.ringVertexCount; radialIndex += 1) {
      const next = (radialIndex + 1) % config.ringVertexCount;
      const prism = [
        axisVertices[sectionIndex].id,
        ringVertexIds[sectionIndex][radialIndex],
        ringVertexIds[sectionIndex][next],
        axisVertices[sectionIndex + 1].id,
        ringVertexIds[sectionIndex + 1][radialIndex],
        ringVertexIds[sectionIndex + 1][next],
      ];
      const tetrahedra = [
        [prism[0], prism[1], prism[2], prism[3]],
        [prism[1], prism[2], prism[3], prism[4]],
        [prism[2], prism[3], prism[4], prism[5]],
      ];
      for (const [tetrahedronIndex, tetrahedron] of tetrahedra.entries()) {
        const cellId = `${constructionId}:cell:segment:${String(sectionIndex).padStart(sectionIndexWidth, '0')}:sector:${String(radialIndex).padStart(radialIndexWidth, '0')}:tetra:${tetrahedronIndex}`;
        const oriented = referenceTetrahedron(tetrahedron, pointById, cellId);
        cells.push({
          id: cellId,
          kind: 'tetrahedron',
          sectionSpan: [sections[sectionIndex].id, sections[sectionIndex + 1].id],
          sectorIndex: radialIndex,
          vertexIds: oriented.vertexIds,
          metrics: {
            referenceRawSignedVolume: oriented.rawSignedVolume,
            referenceOrientationParity: oriented.orientationParity,
            referenceOrientedVolume: oriented.rawSignedVolume,
            currentState: 'initialized-reference-only-recompute-required-after-mutation',
          },
        });
      }
    }
  }

  const edgeMetrics = surfaceEdgeMetrics(triangles);
  const referenceSignedVolume = signedSurfaceVolume(triangles, pointById);
  if (!edgeMetrics.consistentlyOriented || !(referenceSignedVolume > 0)) {
    throw new Error(
      `${constructionId} reference surface has inconsistent or nonpositive orientation`,
    );
  }
  return {
    sections,
    axisVertices,
    cells,
    topology: {
      kind: 'closed-capped-ordered-ring-cage',
      ringVertexIds,
      capAxisVertexIds: [axisVertices[0].id, axisVertices.at(-1).id],
      triangles,
      closed: edgeMetrics.watertight,
      ...edgeMetrics,
      referenceSignedVolume,
      referenceUnsignedVolume: Math.abs(referenceSignedVolume),
      currentState: 'initialized-reference-only-recompute-required-after-mutation',
    },
  };
}

export function measureMuscleCompartmentRingCageCurrentGeometry(cage) {
  if (!cage || !Array.isArray(cage.axisVertices) ||
      !Array.isArray(cage.sections) || !Array.isArray(cage.cells) ||
      !Array.isArray(cage.topology?.triangles)) {
    throw new Error('current geometry measurement requires a complete ring cage');
  }
  const currentPointById = new Map();
  for (const vertex of cage.axisVertices) {
    requirePoint(vertex.currentPosition, `${vertex.id} currentPosition`);
    if (currentPointById.has(vertex.id)) throw new Error(`duplicate current node id ${vertex.id}`);
    currentPointById.set(vertex.id, vertex.currentPosition);
  }
  for (const section of cage.sections) {
    requirePoint(section.currentCenter, `${section.id} currentCenter`);
    for (const vertex of section.vertices) {
      requirePoint(vertex.currentPosition, `${vertex.id} currentPosition`);
      if (currentPointById.has(vertex.id)) throw new Error(`duplicate current node id ${vertex.id}`);
      currentPointById.set(vertex.id, vertex.currentPosition);
    }
  }
  const cellMetrics = cage.cells.map(cell => {
    const points = cell.vertexIds.map(id => {
      const point = currentPointById.get(id);
      if (!point) throw new Error(`current cell ${cell.id} references unknown node ${id}`);
      return point;
    });
    const rawSignedVolume = signedTetrahedronVolume(points);
    const referenceParity = cell.metrics?.referenceOrientationParity;
    if (referenceParity !== 1 && referenceParity !== -1) {
      throw new Error(`current cell ${cell.id} lacks reference orientation parity`);
    }
    if (!Number.isFinite(rawSignedVolume) ||
        !(rawSignedVolume * referenceParity > 0)) {
      throw new Error(
        `current cell ${cell.id} has inverted or nonpositive current orientation: ${rawSignedVolume}`,
      );
    }
    return {
      id: cell.id,
      rawSignedVolume,
      referenceOrientationParity: referenceParity,
      orientedVolume: rawSignedVolume * referenceParity,
    };
  });
  const edgeMetrics = surfaceEdgeMetrics(cage.topology.triangles);
  if (!edgeMetrics.watertight || !edgeMetrics.consistentlyOriented) {
    throw new Error('current cage surface topology is open or inconsistently oriented');
  }
  const signedVolume = signedSurfaceVolume(
    cage.topology.triangles,
    currentPointById,
  );
  if (!Number.isFinite(signedVolume) || !(signedVolume > 0)) {
    throw new Error(`current cage surface has nonpositive signed volume: ${signedVolume}`);
  }
  return {
    state: 'recomputed-from-currentPosition',
    cellMetrics,
    cellVolume: cellMetrics.reduce((sum, cell) => sum + cell.orientedVolume, 0),
    signedSurfaceVolume: signedVolume,
    unsignedSurfaceVolume: Math.abs(signedVolume),
    nonFiniteCellCount: 0,
    nonPositiveCellCount: 0,
    openBoundaryEdgeCount: edgeMetrics.openBoundaryEdgeCount,
    orientationMismatchEdgeCount: edgeMetrics.orientationMismatchEdgeCount,
  };
}

function cageFreedom(mode, sections) {
  return {
    requestedMode: mode,
    effectiveMode: mode,
    fallbackUsed: false,
    representation: 'ordered-polygonal-ring-cage',
    sectionRestriction: {
      kind: 'affine-map-on-shared-ring-vertices',
      ellipseRadiusFunction: 'ellipseRadiusAtAngle',
      createsAlternateGeometry: false,
    },
    degreesOfFreedom: mode === 'affine-section'
      ? sections.map(section => ({
          sectionId: section.id,
          kind: 'center-plus-2x2-section-affine',
        }))
      : sections.flatMap(section => section.vertices.map(vertex => ({
          sectionId: section.id,
          vertexId: vertex.id,
          kind: 'free-ring-vertex',
        }))),
  };
}

function cageReferenceGeometry(cage) {
  return {
    axisVertices: cage.axisVertices.map(vertex => ({
      id: vertex.id,
      referencePosition: vertex.referencePosition,
    })),
    sections: cage.sections.map(section => ({
      id: section.id,
      referenceCenter: section.referenceCenter,
      frame: section.frame,
      vertices: section.vertices.map(vertex => ({
        id: vertex.id,
        referencePosition: vertex.referencePosition,
      })),
    })),
    cellVertexIds: cage.cells.map(cell => [cell.id, cell.vertexIds]),
    topology: {
      ringVertexIds: cage.topology.ringVertexIds,
      capAxisVertexIds: cage.topology.capAxisVertexIds,
      triangles: cage.topology.triangles,
    },
  };
}

function sourceCarrierGeometryFor(cage) {
  return {
    schema: 'kaminos.source-radius-carrier-geometry.v0',
    authority: 'derived-from-source-centerline-and-radii',
    sourceId: cage.sourceIdentity.sourceId,
    constructionId: cage.constructionId,
    radiusInterpolation: 'piecewise-linear-conic-frustum',
    orderedSamples: cage.sections.map(section => ({
      id: `${cage.constructionId}:source-carrier:sample:${String(section.index).padStart(4, '0')}`,
      index: section.index,
      position: [...section.referenceCenter],
      radius: section.sourceRadius,
    })),
  };
}

function genericManifestFor(cage) {
  const attachmentByNodeId = new Map();
  for (const boundary of cage.attachmentBoundaries) {
    attachmentByNodeId.set(boundary.axisVertexId, boundary.attachmentId);
    for (const id of boundary.vertexIds) {
      attachmentByNodeId.set(id, boundary.attachmentId);
    }
  }
  const nodes = cage.sections.flatMap((section, index) => [
    cage.axisVertices[index],
    ...section.vertices,
  ]).map(vertex => ({
    id: vertex.id,
    restPosition: [...vertex.referencePosition],
    currentPosition: [...vertex.currentPosition],
    materialRegionId: null,
    attachmentFrameId: attachmentByNodeId.get(vertex.id) ?? null,
    forceApplicationHandle: null,
  }));
  const cells = cage.cells.map(cell => ({
    id: cell.id,
    nodeIds: [...cell.vertexIds],
    orientationConvention: 'positive-right-handed-tetrahedron',
    restRawSignedVolume: cell.metrics.referenceRawSignedVolume,
    restOrientationParity: cell.metrics.referenceOrientationParity,
    materialRegionId: null,
    attachmentFrameId: null,
    forceApplicationHandle: null,
  }));
  const topology = {
    orderedNodeIds: nodes.map(node => node.id),
    orderedCells: cells.map(cell => ({
      id: cell.id,
      nodeIds: [...cell.nodeIds],
      orientationConvention: cell.orientationConvention,
    })),
  };
  const constraints = {
    boundaryMasks: nodes.map(node => ({
      nodeId: node.id,
      fixed: node.attachmentFrameId !== null,
      roles: node.attachmentFrameId === null ? [] : ['fixed-attachment-boundary'],
      attachmentFrameId: node.attachmentFrameId,
      targetTransform: null,
    })),
  };
  const sourceGeometry = sourceCarrierGeometryFor(cage);
  const sourceGeometrySha256 = hashCanonical(sourceGeometry);
  const embedding = {
    immutable: true,
    authority: 'derived-source-radius-carrier-sampling-not-authored-surface',
    entries: cage.sections.flatMap(section => section.vertices.map(vertex => {
      const sourceSample = sourceGeometry.orderedSamples[section.index];
      const angleRadians = vertex.sourceEmbedding.angleRadians;
      const sourceOffset = add(
        scale(section.frame.normal, section.sourceRadius * Math.cos(angleRadians)),
        scale(section.frame.binormal, section.sourceRadius * Math.sin(angleRadians)),
      );
      return {
        sourcePointId:
          `${sourceSample.id}:surface-point:${String(vertex.index).padStart(2, '0')}`,
        sourceGeometrySha256,
        sourcePosition: add(section.referenceCenter, sourceOffset),
        sourceSampleIndex: section.index,
        sourceAngularParameterRadians: angleRadians,
        nodeIds: [vertex.id],
        weights: [1],
        correspondenceAuthority: 'derived-source-radius-carrier-sample-to-cage-node',
        authoredSurfaceCorrespondence: false,
      };
    })),
  };
  return {
    schema: 'kaminos.positive-volume-cage-manifest-projection.v0',
    fixtureScope: 'k4-source-radius-carrier',
    sourceIdentity: cage.sourceIdentity,
    sourceGeometry,
    nodes,
    cells,
    topology,
    constraints,
    embedding,
    semanticHashes: {
      sourceGeometrySha256,
      topologySha256: hashCanonical(topology),
      constraintsSha256: hashCanonical(constraints),
      embeddingSha256: hashCanonical(embedding),
    },
  };
}

function identityEnvelope(value, additions = {}) {
  const bytes = encodeMuscleCompartmentRingCageIdentityDomain(value);
  return {
    domain: 'self-excluding-top-level-identity',
    canonicalization: 'recursive-lexicographic-json-utf8',
    sha256: sha256(bytes),
    canonicalByteLength: bytes.byteLength,
    ...additions,
  };
}

function buildCage(muscle, config, sourceVolumeReceipt) {
  const constructionId = muscle.identity.constructionId;
  const frames = transportedFrames(
    muscle.centerline,
    config.frameSeedDirection,
    constructionId,
  );
  const uncorrectedGeometry = buildGeometry(muscle, frames, config, 1);
  const polygonUncorrectedVolume = uncorrectedGeometry.cells.reduce(
    (sum, cell) => sum + cell.metrics.referenceOrientedVolume,
    0,
  );
  if (!Number.isFinite(polygonUncorrectedVolume) || !(polygonUncorrectedVolume > 0)) {
    throw new Error(`${constructionId} polygon correction requires positive finite volume`);
  }
  let polygonDiscretizationRadialScale = Math.sqrt(
    sourceVolumeReceipt.continuousCarrierVolume / polygonUncorrectedVolume,
  );
  let geometry = buildGeometry(
    muscle,
    frames,
    config,
    polygonDiscretizationRadialScale,
  );
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const measured = geometry.cells.reduce(
      (sum, cell) => sum + cell.metrics.referenceOrientedVolume,
      0,
    );
    const relativeError = Math.abs(
      measured - sourceVolumeReceipt.continuousCarrierVolume,
    ) / sourceVolumeReceipt.continuousCarrierVolume;
    if (relativeError <= Math.min(config.volumeTolerance, 1e-13)) break;
    polygonDiscretizationRadialScale *= Math.sqrt(
      sourceVolumeReceipt.continuousCarrierVolume / measured,
    );
    geometry = buildGeometry(
      muscle,
      frames,
      config,
      polygonDiscretizationRadialScale,
    );
  }
  const referenceVolume = geometry.cells.reduce(
    (sum, cell) => sum + cell.metrics.referenceOrientedVolume,
    0,
  );
  const referenceRelativeError = Math.abs(referenceVolume - muscle.targetVolume) /
    muscle.targetVolume;
  const polygonCorrectionRelativeError = Math.abs(
    referenceVolume - sourceVolumeReceipt.continuousCarrierVolume,
  ) / sourceVolumeReceipt.continuousCarrierVolume;
  if (polygonCorrectionRelativeError > config.volumeTolerance) {
    throw new Error(
      `${constructionId} cage volume exceeds declared volumeTolerance ${config.volumeTolerance}`,
    );
  }
  if (!geometry.topology.watertight) {
    throw new Error(`${constructionId} cage topology is not watertight`);
  }
  const attachmentBoundaries = [
    ['origin', geometry.sections[0]],
    ['insertion', geometry.sections.at(-1)],
  ].map(([role, section]) => ({
    role,
    attachmentId: muscle.attachments[role].id,
    sectionId: section.id,
    axisVertexId: geometry.axisVertices[section.index].id,
    vertexIds: section.vertices.map(vertex => vertex.id),
    fixed: true,
  }));
  const sourceEmbedding = {
    sourceMuscleId: muscle.id,
    sourceConstructionId: constructionId,
    sourceCenterlineSampleCount: muscle.centerline.length,
    radiusPolicy: 'regular-polygon-discretization-correction-after-source-volume-validation',
    polygonDiscretizationRadialScale,
    sectionEmbeddings: geometry.sections.map(section => ({
      sectionId: section.id,
      sourceKnotIndex: section.index,
      sourcePosition: [...muscle.centerline[section.index].position],
      sourceRadius: muscle.centerline[section.index].radius,
    })),
    vertexEmbeddings: geometry.sections.flatMap(section =>
      section.vertices.map(vertex => structuredClone(vertex.sourceEmbedding))),
  };
  const cage = {
    id: `${constructionId}:cage`,
    constructionId,
    sourceIdentity: structuredClone(muscle.identity),
    sourceMuscleId: muscle.id,
    ringVertexCount: config.ringVertexCount,
    freedom: cageFreedom(config.freedomMode, geometry.sections),
    attachmentBoundaries,
    sourceEmbedding,
    sections: geometry.sections,
    axisVertices: geometry.axisVertices,
    cells: geometry.cells,
    topology: geometry.topology,
    volumeAccounting: {
      declaredTolerance: config.volumeTolerance,
      sourceVolumeTolerance: config.sourceVolumeTolerance,
      sourceTargetVolume: muscle.targetVolume,
      sourceContinuousCarrierVolume: sourceVolumeReceipt.continuousCarrierVolume,
      sourceTargetRelativeError: sourceVolumeReceipt.targetRelativeError,
      sourceConsistencyStatus: 'validated-before-polygon-correction',
      polygonUncorrectedVolume,
      polygonDiscretizationRadialScale,
      polygonCorrectionRelativeError,
      referenceVolume,
      referenceRelativeError,
      currentState: 'initialized-reference-only-recompute-required-after-mutation',
    },
    metrics: {
      nonFiniteCellCount: geometry.cells.filter(cell =>
        !Number.isFinite(cell.metrics.referenceRawSignedVolume) ||
        !Number.isFinite(cell.metrics.referenceOrientedVolume)).length,
      nonPositiveReferenceCellCount: geometry.cells.filter(cell =>
        !(cell.metrics.referenceOrientedVolume > 0)).length,
    },
  };
  const initializedCurrentGeometry = measureMuscleCompartmentRingCageCurrentGeometry(cage);
  cage.currentGeometryAtInitialization = initializedCurrentGeometry;
  cage.volumeAccounting.currentVolumeAtInitialization =
    initializedCurrentGeometry.cellVolume;
  cage.volumeAccounting.currentRelativeErrorAtInitialization = Math.abs(
    initializedCurrentGeometry.cellVolume - muscle.targetVolume,
  ) / muscle.targetVolume;
  cage.metrics.nonPositiveCurrentCellCountAtInitialization =
    initializedCurrentGeometry.nonPositiveCellCount;
  cage.genericManifest = genericManifestFor(cage);
  const referenceGeometrySha256 = hashCanonical(cageReferenceGeometry(cage));
  cage.identity = identityEnvelope(cage, {
    referenceGeometrySha256,
  });
  return cage;
}

export function createMuscleCompartmentRingCages(source, requestedConfig) {
  const config = validateConfig(requestedConfig);
  const sourceVolumeReceipts = validateSource(source, config);
  const cages = source.muscles.map(muscle => buildCage(
    muscle,
    config,
    sourceVolumeReceipts.get(muscle.identity.constructionId),
  ));
  const document = {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA,
    source: {
      id: source.id,
      schema: source.schema ?? null,
      orderedConstructionIds: source.muscles.map(
        muscle => muscle.identity.constructionId,
      ),
    },
    config: {
      requested: structuredClone(config),
      effective: structuredClone(config),
      fallbackUsed: false,
    },
    cages,
  };
  document.identity = identityEnvelope(document);
  return document;
}
