export const EFFIGY_TILE_GEOMETRY_SCHEMA = 'kaminos.structural-material.effigy-tile-sidecar.v0';
export const EFFIGY_TILE_GEOMETRY_ROUTE = 'kaminos.structural-material.effigy-tile.v0';
export const EFFIGY_TILE_GEOMETRY_AUTHORITY = 'gpu-structural-state-to-dual-cell-surface-v0';
export const EFFIGY_TILE_CONTACT_AUTHORITY = 'stable-effigy-surface-to-structural-contact-v0';
export const EFFIGY_TILE_TRANSITION_AUTHORITY = 'structural-sidecar-to-rendered-surface-transition-v0';

const DIRECTIONS = [
  { key: '-x', axis: 'x', sign: -1 },
  { key: '+x', axis: 'x', sign: 1 },
  { key: '-y', axis: 'y', sign: -1 },
  { key: '+y', axis: 'y', sign: 1 },
  { key: '-z', axis: 'z', sign: -1 },
  { key: '+z', axis: 'z', sign: 1 },
];

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`effigy tile requires finite ${label}`);
  return number;
}

function point(value, label) {
  return {
    x: finite(value?.x, `${label}.x`),
    y: finite(value?.y, `${label}.y`),
    z: finite(value?.z, `${label}.z`),
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function componentOrdinal(componentId) {
  const match = String(componentId || '').match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function round(value, digits = 9) {
  const scale = 10 ** digits;
  return Math.round(finite(value, 'rounded value') * scale) / scale;
}

function roundedPoint(value) {
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function coordinateKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function bondKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function sortedCoordinates(nodes, axis) {
  return [...new Set(nodes.map(node => finite(node[axis], `${node.id}.${axis}`)))].sort((a, b) => a - b);
}

function dualInterval(coordinates, value) {
  const index = coordinates.indexOf(value);
  if (index < 0) throw new Error(`effigy tile cannot locate structural coordinate ${value}`);
  return {
    min: index === 0 ? value : (coordinates[index - 1] + value) * 0.5,
    max: index === coordinates.length - 1 ? value : (value + coordinates[index + 1]) * 0.5,
  };
}

function profilePoint(value, profile) {
  const next = { ...value };
  if (profile !== 'rib-upper-v0' && profile !== 'rib-lower-v0') return next;
  if (Math.abs(value.z) > 0.000001 && Math.abs(value.z - 1) > 0.000001) return next;
  const dx = value.x - 0.68;
  const dy = value.y - (profile === 'rib-lower-v0' ? 0.72 : 0.28);
  const rib = 0.075 * Math.exp(-(dx * dx) / 0.035 - (dy * dy) / 0.055);
  next.z += value.z < 0.5 ? -rib * 0.35 : rib;
  return next;
}

function faceVertices(bounds, direction, profile) {
  const { x, y, z } = bounds;
  let vertices;
  if (direction.key === '-x') {
    vertices = [
      { x: x.min, y: y.min, z: z.min },
      { x: x.min, y: y.min, z: z.max },
      { x: x.min, y: y.max, z: z.max },
      { x: x.min, y: y.max, z: z.min },
    ];
  } else if (direction.key === '+x') {
    vertices = [
      { x: x.max, y: y.min, z: z.min },
      { x: x.max, y: y.max, z: z.min },
      { x: x.max, y: y.max, z: z.max },
      { x: x.max, y: y.min, z: z.max },
    ];
  } else if (direction.key === '-y') {
    vertices = [
      { x: x.min, y: y.min, z: z.min },
      { x: x.max, y: y.min, z: z.min },
      { x: x.max, y: y.min, z: z.max },
      { x: x.min, y: y.min, z: z.max },
    ];
  } else if (direction.key === '+y') {
    vertices = [
      { x: x.min, y: y.max, z: z.min },
      { x: x.min, y: y.max, z: z.max },
      { x: x.max, y: y.max, z: z.max },
      { x: x.max, y: y.max, z: z.min },
    ];
  } else if (direction.key === '-z') {
    vertices = [
      { x: x.min, y: y.min, z: z.min },
      { x: x.min, y: y.max, z: z.min },
      { x: x.max, y: y.max, z: z.min },
      { x: x.max, y: y.min, z: z.min },
    ];
  } else {
    vertices = [
      { x: x.min, y: y.min, z: z.max },
      { x: x.max, y: y.min, z: z.max },
      { x: x.max, y: y.max, z: z.max },
      { x: x.min, y: y.max, z: z.max },
    ];
  }
  return vertices.map(vertex => roundedPoint(profilePoint(vertex, profile)));
}

function neighborCoordinate(node, direction, coordinatesByAxis) {
  const coordinates = coordinatesByAxis[direction.axis];
  const value = node[direction.axis];
  const index = coordinates.indexOf(value);
  const neighborIndex = index + direction.sign;
  if (neighborIndex < 0 || neighborIndex >= coordinates.length) return null;
  return {
    x: direction.axis === 'x' ? coordinates[neighborIndex] : node.x,
    y: direction.axis === 'y' ? coordinates[neighborIndex] : node.y,
    z: direction.axis === 'z' ? coordinates[neighborIndex] : node.z,
  };
}

function faceVisibility(neighbor, bond, authoredOpening) {
  if (!neighbor) return 'outer-surface';
  if (!bond) return authoredOpening ? 'authored-opening' : 'invalid-missing-adjacency';
  return bond.alive ? 'hidden-live-adjacency' : 'fracture-surface';
}

function surfaceRole(visibility, node) {
  if (visibility === 'fracture-surface') return 'fracture';
  if (visibility === 'authored-opening') return 'notch';
  if (node.structuralRole === 'bell-body') return 'bell-shell';
  if (node.structuralRole === 'bell-frame') return 'bell-frame';
  if (node.pinned) return 'support';
  return 'clay-shell';
}

function validateSidecar(sidecar) {
  const errors = [];
  const cellIds = new Set();
  const faceIds = new Set();
  for (const cell of sidecar.cells) {
    if (cellIds.has(cell.id)) errors.push(`duplicate-cell:${cell.id}`);
    cellIds.add(cell.id);
    const ownedFaces = sidecar.faces.filter(face => face.cellId === cell.id);
    if (ownedFaces.length !== 6) errors.push(`cell-face-count:${cell.id}:${ownedFaces.length}`);
  }
  for (const face of sidecar.faces) {
    if (faceIds.has(face.id)) errors.push(`duplicate-face:${face.id}`);
    faceIds.add(face.id);
    if (face.restVertices.length !== 4 || face.currentVertices.length !== 4) {
      errors.push(`face-vertex-count:${face.id}`);
    }
    if (face.visibility === 'fracture-surface' && face.governingBondAlive !== false) {
      errors.push(`fracture-face-live:${face.id}`);
    }
    if (face.visibility === 'hidden-live-adjacency' && face.governingBondAlive !== true) {
      errors.push(`hidden-face-dead:${face.id}`);
    }
    if (face.visibility === 'invalid-missing-adjacency') {
      errors.push(`undeclared-opening:${face.structuralNodeId}:${face.neighborStructuralNodeId}`);
    }
  }
  const facesByBond = new Map();
  for (const face of sidecar.faces) {
    if (!face.governingBondId) continue;
    if (!facesByBond.has(face.governingBondId)) facesByBond.set(face.governingBondId, []);
    facesByBond.get(face.governingBondId).push(face);
  }
  for (const bond of sidecar.structuralBondLiveness) {
    const faces = facesByBond.get(bond.id) || [];
    if (bond.surfaceGovernance === 'dual-cell-interface') {
      if (faces.length !== 2) errors.push(`axis-bond-face-count:${bond.id}:${faces.length}`);
      const expectedVisibility = bond.alive ? 'hidden-live-adjacency' : 'fracture-surface';
      if (faces.some(face => face.visibility !== expectedVisibility)) {
        errors.push(`axis-bond-visibility:${bond.id}:${expectedVisibility}`);
      }
    } else if (bond.surfaceGovernance === 'interior-brace') {
      if (faces.length !== 0) errors.push(`interior-brace-face-count:${bond.id}:${faces.length}`);
    } else {
      errors.push(`unknown-surface-governance:${bond.id}:${bond.surfaceGovernance || 'missing'}`);
    }
  }
  if (!sidecar.faces.some(face => face.visibility === 'outer-surface')) errors.push('outer-surface-missing');
  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    errorCount: errors.length,
    errors,
  };
}

export function buildEffigyTileGeometrySidecar(state, options = {}) {
  if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.bonds)) {
    throw new Error('effigy tile requires structural nodes and bonds');
  }
  if (state.nodes.length === 0) throw new Error('effigy tile requires at least one structural node');
  const profile = options.profile || state.effigyProfile || 'rib-upper-v0';
  if (state.effigyProfile && options.profile && state.effigyProfile !== options.profile) {
    throw new Error(`effigy tile profile mismatch: structural ${state.effigyProfile}; surface ${options.profile}`);
  }
  const coordinatesByAxis = {
    x: sortedCoordinates(state.nodes, 'x'),
    y: sortedCoordinates(state.nodes, 'y'),
    z: sortedCoordinates(state.nodes, 'z'),
  };
  const nodeByCoordinate = new Map(state.nodes.map(node => [coordinateKey(node.x, node.y, node.z), node]));
  const bondByNodes = new Map(state.bonds.map(bond => [bondKey(bond.a, bond.b), bond]));
  const authoredOpeningKeys = new Set((state.authoredOpeningNodePairs || []).map(pair => bondKey(pair.a, pair.b)));
  const cells = [];
  const faces = [];

  for (const node of state.nodes) {
    const restCenter = point(node, node.id);
    const displacement = point(node.displacement || { x: 0, y: 0, z: 0 }, `${node.id}.displacement`);
    const bounds = {
      x: dualInterval(coordinatesByAxis.x, node.x),
      y: dualInterval(coordinatesByAxis.y, node.y),
      z: dualInterval(coordinatesByAxis.z, node.z),
    };
    const cellId = `cell:${node.id}`;
    cells.push({
      id: cellId,
      structuralNodeId: node.id,
      componentId: node.componentId,
      structuralRole: node.structuralRole || 'masonry',
      pinned: Boolean(node.pinned),
      restCenter: roundedPoint(restCenter),
      currentCenter: roundedPoint(add(restCenter, displacement)),
      displacement: roundedPoint(displacement),
      restBounds: {
        x: { min: round(bounds.x.min), max: round(bounds.x.max) },
        y: { min: round(bounds.y.min), max: round(bounds.y.max) },
        z: { min: round(bounds.z.min), max: round(bounds.z.max) },
      },
    });

    for (const direction of DIRECTIONS) {
      const neighborPoint = neighborCoordinate(node, direction, coordinatesByAxis);
      const neighbor = neighborPoint
        ? nodeByCoordinate.get(coordinateKey(neighborPoint.x, neighborPoint.y, neighborPoint.z)) || null
        : null;
      const bond = neighbor ? bondByNodes.get(bondKey(node.id, neighbor.id)) || null : null;
      const authoredOpening = Boolean(neighbor && authoredOpeningKeys.has(bondKey(node.id, neighbor.id)));
      const visibility = faceVisibility(neighbor, bond, authoredOpening);
      const restVertices = faceVertices(bounds, direction, profile);
      const currentVertices = restVertices.map(vertex => roundedPoint(add(vertex, displacement)));
      faces.push({
        id: `face:${node.id}:${direction.key}`,
        cellId,
        structuralNodeId: node.id,
        componentId: node.componentId,
        structuralRole: node.structuralRole || 'masonry',
        pinned: Boolean(node.pinned),
        direction: direction.key,
        axis: direction.axis,
        sign: direction.sign,
        neighborStructuralNodeId: neighbor?.id || null,
        governingBondId: bond?.id || null,
        governingBondAlive: bond ? Boolean(bond.alive) : null,
        authoredOpening,
        visibility,
        surfaceRole: surfaceRole(visibility, node),
        restVertices,
        currentVertices,
        triangles: [[0, 1, 2], [0, 2, 3]],
        pick: {
          authority: EFFIGY_TILE_CONTACT_AUTHORITY,
          structuralNodeId: node.id,
        },
      });
    }
  }

  const controlledFaceCounts = new Map();
  for (const face of faces) {
    if (!face.governingBondId) continue;
    controlledFaceCounts.set(face.governingBondId, (controlledFaceCounts.get(face.governingBondId) || 0) + 1);
  }
  const structuralBondLiveness = state.bonds.map(bond => ({
    id: bond.id,
    alive: Boolean(bond.alive),
    surfaceGovernance: bond.surfaceGovernance || null,
    controlledFaceCount: controlledFaceCounts.get(bond.id) || 0,
  }));
  const sidecar = {
    schema: EFFIGY_TILE_GEOMETRY_SCHEMA,
    route: EFFIGY_TILE_GEOMETRY_ROUTE,
    authority: EFFIGY_TILE_GEOMETRY_AUTHORITY,
    sourceSchema: state.schema || null,
    sourceRoute: state.route || null,
    topologyEpoch: Number.isInteger(state.topologyEpoch) ? state.topologyEpoch : null,
    connectivityEpoch: Number.isInteger(state.connectivityEpoch) ? state.connectivityEpoch : null,
    profile,
    topologyProfile: state.topologyProfile || 'layered-slab-v0',
    assetIdentity: [
      'effigy-tile',
      profile,
      state.topologyProfile || 'layered-slab-v0',
      `${coordinatesByAxis.x.length}x${coordinatesByAxis.y.length}x${coordinatesByAxis.z.length}`,
      `n${cells.length}`,
    ].join(':'),
    cells,
    faces,
    structuralBondLiveness,
    authoredOpeningNodePairs: (state.authoredOpeningNodePairs || []).map(pair => ({ ...pair })),
    authoredSockets: (state.authoredSockets || []).map(socket => ({
      ...socket,
      nodeIds: [...socket.nodeIds],
    })),
  };
  sidecar.validation = validateSidecar(sidecar);
  sidecar.status = sidecar.validation.status;
  sidecar.summary = {
    cellCount: cells.length,
    faceCount: faces.length,
    visibleFaceCount: faces.filter(face => face.visibility !== 'hidden-live-adjacency').length,
    outerFaceCount: faces.filter(face => face.visibility === 'outer-surface').length,
    authoredOpeningFaceCount: faces.filter(face => face.visibility === 'authored-opening').length,
    fractureFaceCount: faces.filter(face => face.visibility === 'fracture-surface').length,
    hiddenLiveAdjacencyFaceCount: faces.filter(face => face.visibility === 'hidden-live-adjacency').length,
    deadInteriorBraceCount: structuralBondLiveness.filter(
      bond => !bond.alive && bond.surfaceGovernance === 'interior-brace',
    ).length,
  };
  return sidecar;
}

function interpolatedTrianglePoint(vertices, triangle, barycentric) {
  const weights = [
    Math.max(0, finite(barycentric?.x ?? 1 / 3, 'barycentric.x')),
    Math.max(0, finite(barycentric?.y ?? 1 / 3, 'barycentric.y')),
    Math.max(0, finite(barycentric?.z ?? 1 / 3, 'barycentric.z')),
  ];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) throw new Error('effigy tile contact requires nonzero barycentric weight');
  const normalized = weights.map(weight => weight / total);
  return roundedPoint(triangle.reduce((result, vertexIndex, index) => ({
    x: result.x + vertices[vertexIndex].x * normalized[index],
    y: result.y + vertices[vertexIndex].y * normalized[index],
    z: result.z + vertices[vertexIndex].z * normalized[index],
  }), { x: 0, y: 0, z: 0 }));
}

export function resolveEffigyTileSurfaceContact(sidecar, pick = {}) {
  if (sidecar?.schema !== EFFIGY_TILE_GEOMETRY_SCHEMA || sidecar.status !== 'passed') {
    throw new Error('effigy tile contact requires a validated geometry sidecar');
  }
  const face = sidecar.faces.find(candidate => candidate.id === pick.faceId);
  if (!face) throw new Error(`effigy tile contact cannot resolve face ${pick.faceId}`);
  if (face.visibility === 'hidden-live-adjacency') {
    throw new Error(`effigy tile contact cannot select hidden face ${pick.faceId}`);
  }
  const triangleIndex = Number.isInteger(pick.triangleIndex) ? pick.triangleIndex : 0;
  const triangle = face.triangles[triangleIndex];
  if (!triangle) throw new Error(`effigy tile contact cannot resolve triangle ${triangleIndex}`);
  const cell = sidecar.cells.find(candidate => candidate.id === face.cellId);
  if (!cell) throw new Error(`effigy tile contact cannot resolve cell ${face.cellId}`);
  return {
    authority: EFFIGY_TILE_CONTACT_AUTHORITY,
    profile: sidecar.profile,
    faceId: face.id,
    triangleIndex,
    barycentric: {
      x: round(pick.barycentric?.x ?? 1 / 3),
      y: round(pick.barycentric?.y ?? 1 / 3),
      z: round(pick.barycentric?.z ?? 1 / 3),
    },
    surfaceRestPoint: interpolatedTrianglePoint(face.restVertices, triangle, pick.barycentric),
    surfaceCurrentPoint: interpolatedTrianglePoint(face.currentVertices, triangle, pick.barycentric),
    structuralContact: {
      authority: 'stable-rest-material-contact-v0',
      kind: 'node',
      id: face.structuralNodeId,
      point: { ...cell.restCenter },
      segmentT: null,
    },
  };
}

export function assessEffigyTileGeometryTransition(before, after, options = {}) {
  const errors = [];
  if (before?.schema !== EFFIGY_TILE_GEOMETRY_SCHEMA) errors.push('before-schema-mismatch');
  if (after?.schema !== EFFIGY_TILE_GEOMETRY_SCHEMA) errors.push('after-schema-mismatch');
  if (before?.assetIdentity !== after?.assetIdentity) errors.push('asset-identity-mismatch');
  if (before?.status !== 'passed') errors.push('before-sidecar-failed');
  if (after?.status !== 'passed') errors.push('after-sidecar-failed');

  const beforeBonds = new Map((before?.structuralBondLiveness || []).map(bond => [bond.id, bond.alive]));
  const afterBonds = new Map((after?.structuralBondLiveness || []).map(bond => [bond.id, bond.alive]));
  const bondIds = [...new Set([...beforeBonds.keys(), ...afterBonds.keys()])].sort();
  const missingBondIds = bondIds.filter(id => !beforeBonds.has(id) || !afterBonds.has(id));
  if (missingBondIds.length > 0) errors.push('bond-identity-mismatch');
  const changedBondIds = bondIds.filter(id => beforeBonds.get(id) !== afterBonds.get(id));
  const topologyEpochChanged = before?.topologyEpoch !== after?.topologyEpoch;
  const connectivityEpochChanged = before?.connectivityEpoch !== after?.connectivityEpoch;

  const beforeCells = new Map((before?.cells || []).map(cell => [cell.structuralNodeId, cell]));
  const afterCells = new Map((after?.cells || []).map(cell => [cell.structuralNodeId, cell]));
  const componentIdentityChangedNodeIds = [...new Set([...beforeCells.keys(), ...afterCells.keys()])]
    .filter(id => {
      const beforeCell = beforeCells.get(id);
      const afterCell = afterCells.get(id);
      if (!beforeCell || !afterCell) return true;
      const beforeOrdinal = componentOrdinal(beforeCell.componentId);
      const afterOrdinal = componentOrdinal(afterCell.componentId);
      return beforeOrdinal === null || afterOrdinal === null || beforeOrdinal !== afterOrdinal;
    })
    .sort();

  const beforeFaces = new Map((before?.faces || []).map(face => [face.id, face]));
  const afterFaces = new Map((after?.faces || []).map(face => [face.id, face]));
  const faceIds = [...new Set([...beforeFaces.keys(), ...afterFaces.keys()])].sort();
  const missingFaceIds = faceIds.filter(id => !beforeFaces.has(id) || !afterFaces.has(id));
  if (missingFaceIds.length > 0) errors.push('face-identity-mismatch');
  const componentIdentityChangedFaceIds = faceIds.filter(id => {
    const beforeFace = beforeFaces.get(id);
    const afterFace = afterFaces.get(id);
    if (!beforeFace || !afterFace) return true;
    const beforeOrdinal = componentOrdinal(beforeFace.componentId);
    const afterOrdinal = componentOrdinal(afterFace.componentId);
    return beforeOrdinal === null || afterOrdinal === null || beforeOrdinal !== afterOrdinal;
  });
  if (changedBondIds.length === 0) {
    if (topologyEpochChanged) errors.push('topology-epoch-changed-without-liveness');
    if (connectivityEpochChanged) errors.push('connectivity-epoch-changed-without-liveness');
    if (componentIdentityChangedNodeIds.length > 0 || componentIdentityChangedFaceIds.length > 0) {
      errors.push('component-identity-changed-without-liveness');
    }
  }
  let maxSurfaceDelta = 0;
  let contactSurfaceDelta = 0;
  let visibleContactFaceCount = 0;
  const contactNodeId = options.contactNodeId || null;
  for (const id of faceIds) {
    const beforeFace = beforeFaces.get(id);
    const afterFace = afterFaces.get(id);
    if (!beforeFace || !afterFace) continue;
    const visibleContactFace = afterFace.structuralNodeId === contactNodeId &&
      (beforeFace.visibility !== 'hidden-live-adjacency' || afterFace.visibility !== 'hidden-live-adjacency');
    if (visibleContactFace) visibleContactFaceCount += 1;
    for (let index = 0; index < beforeFace.currentVertices.length; index += 1) {
      const delta = magnitude(subtract(afterFace.currentVertices[index], beforeFace.currentVertices[index]));
      maxSurfaceDelta = Math.max(maxSurfaceDelta, delta);
      if (visibleContactFace) contactSurfaceDelta = Math.max(contactSurfaceDelta, delta);
    }
  }
  if (contactNodeId && !after?.cells?.some(cell => cell.structuralNodeId === contactNodeId)) {
    errors.push('contact-node-missing');
  }
  const beforeFractureIds = new Set((before?.faces || [])
    .filter(face => face.visibility === 'fracture-surface')
    .map(face => face.id));
  const afterFractureIds = (after?.faces || [])
    .filter(face => face.visibility === 'fracture-surface')
    .map(face => face.id);
  const newFractureFaceIds = afterFractureIds.filter(id => !beforeFractureIds.has(id)).sort();

  return {
    authority: EFFIGY_TILE_TRANSITION_AUTHORITY,
    status: errors.length === 0 ? 'passed' : 'failed',
    errors,
    assetIdentity: after?.assetIdentity || null,
    contactNodeId,
    bondLivenessChanged: changedBondIds.length > 0,
    changedBondIds,
    topologyEpochChanged,
    connectivityEpochChanged,
    componentIdentityChangedNodeIds,
    componentIdentityChangedFaceIds,
    missingBondIds,
    missingFaceIds,
    maxSurfaceDelta: round(maxSurfaceDelta),
    contactSurfaceDelta: round(contactSurfaceDelta),
    visibleContactFaceCount,
    prefractureCompliance: errors.length === 0 && changedBondIds.length === 0 &&
      visibleContactFaceCount > 0 && contactSurfaceDelta > 0,
    fractureFaceCountBefore: beforeFractureIds.size,
    fractureFaceCountAfter: afterFractureIds.length,
    newFractureFaceCount: newFractureFaceIds.length,
    newFractureFaceIds,
  };
}
