export const ARCH_SURFACE_CONSUMER_SCHEMA = 'kaminos.structural-material.arch-surface-consumer.v0';
export const ARCH_SURFACE_CONSUMER_ROUTE = 'kaminos.structural-material.trellis-arch-surface.v0';
export const ARCH_SURFACE_CONSUMER_AUTHORITY = 'trellis-glb-to-persistent-arch-state-displacement-v0';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nearestOccupiedCells(profile) {
  const occupied = [];
  for (let index = 0; index < profile.occupancy.length; index += 1) {
    if (profile.occupancy[index]) occupied.push(index);
  }
  if (!occupied.length) throw new Error('arch surface consumer requires occupied structural cells');
  return profile.occupancy.map((isOccupied, index) => {
    if (isOccupied) return index;
    const column = index % profile.columns;
    const row = Math.floor(index / profile.columns);
    let best = occupied[0];
    let bestDistance = Infinity;
    for (const candidate of occupied) {
      const candidateColumn = candidate % profile.columns;
      const candidateRow = Math.floor(candidate / profile.columns);
      const distance = (candidateColumn - column) ** 2 + (candidateRow - row) ** 2;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  });
}

function gridIndex(profile, x, y) {
  const column = Math.max(0, Math.min(profile.columns - 1,
    Math.floor((x - profile.bounds.min[0]) / (profile.bounds.max[0] - profile.bounds.min[0]) * profile.columns)));
  const row = Math.max(0, Math.min(profile.rows - 1,
    Math.floor((y - profile.bounds.min[1]) / (profile.bounds.max[1] - profile.bounds.min[1]) * profile.rows)));
  return row * profile.columns + column;
}

function layerSpacing(state) {
  const byCell = new Map();
  for (const node of state.nodes) {
    const key = `${node.column}:${node.row}`;
    const values = byCell.get(key) || [];
    values.push(node.z);
    byCell.set(key, values);
  }
  const spacings = [];
  for (const values of byCell.values()) {
    values.sort((a, b) => a - b);
    for (let index = 1; index < values.length; index += 1) {
      const spacing = values[index] - values[index - 1];
      if (spacing > 1e-9) spacings.push(spacing);
    }
  }
  spacings.sort((a, b) => a - b);
  return spacings.length ? spacings[Math.floor(spacings.length / 2)] : 1;
}

function candidateNodesByCell(profile, nearestCells, nodesByCell, radius = 2) {
  return nearestCells.map(center => {
    const centerColumn = center % profile.columns;
    const centerRow = Math.floor(center / profile.columns);
    const candidates = [];
    for (let row = Math.max(0, centerRow - radius); row <= Math.min(profile.rows - 1, centerRow + radius); row += 1) {
      for (let column = Math.max(0, centerColumn - radius); column <= Math.min(profile.columns - 1, centerColumn + radius); column += 1) {
        const values = nodesByCell.get(`${column}:${row}`);
        if (values) candidates.push(...values);
      }
    }
    return candidates;
  });
}

export function projectArchStructuralStateToSurface(profile, state, sourcePositions) {
  if (!profile || profile.source?.kind !== 'trellis-glb' || profile.source.sha256 !== state?.source?.sha256) {
    throw new Error('arch surface consumer requires a structural state from this exact TRELLIS source');
  }
  if (profile.depthSource?.kind !== 'triangle-barycentric-z-envelope-v0' ||
      profile.depthEnvelope?.length !== profile.columns * profile.rows || state.depthMode !== 'surface-envelope') {
    throw new Error('arch surface consumer requires the source mesh depth envelope');
  }
  if (!ArrayBuffer.isView(sourcePositions) || sourcePositions.length === 0 || sourcePositions.length % 3 !== 0) {
    throw new Error('arch surface consumer requires packed mesh vertex positions');
  }
  if (!Array.isArray(state.nodes) || !Array.isArray(state.bonds) || state.nodes.length === 0) {
    throw new Error('arch surface consumer requires structural nodes and bonds');
  }

  const nearestCells = nearestOccupiedCells(profile);
  const nodesByCell = new Map();
  for (const node of state.nodes) {
    const key = `${node.column}:${node.row}`;
    const values = nodesByCell.get(key) || [];
    values.push(node);
    nodesByCell.set(key, values);
  }
  const nodeCandidatesByCell = candidateNodesByCell(profile, nearestCells, nodesByCell);
  const xScale = (profile.bounds.max[0] - profile.bounds.min[0]) / profile.columns;
  const yScale = (profile.bounds.max[1] - profile.bounds.min[1]) / profile.rows;
  const zScale = layerSpacing(state);
  const outputDisplacements = new Float32Array(sourcePositions.length);
  const mappedNodeIds = new Set();
  let maxDisplacement = 0;
  let totalDisplacement = 0;

  for (let vertex = 0; vertex < sourcePositions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const x = finite(sourcePositions[offset], `vertex ${vertex}.x`);
    const y = finite(sourcePositions[offset + 1], `vertex ${vertex}.y`);
    const z = finite(sourcePositions[offset + 2], `vertex ${vertex}.z`);
    const index = gridIndex(profile, x, y);
    const candidates = nodeCandidatesByCell[index];
    if (!candidates.length) throw new Error(`arch surface vertex ${vertex} has no nearby structural node`);

    let exact = null;
    let owner = candidates[0];
    let ownerDistance = Infinity;
    let totalWeight = 0;
    const sum = { x: 0, y: 0, z: 0 };
    for (const node of candidates) {
      const dx = (node.x - x) / xScale;
      const dy = (node.y - y) / yScale;
      const dz = (node.z - z) / zScale;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared < ownerDistance) {
        owner = node;
        ownerDistance = distanceSquared;
      }
      if (distanceSquared < 1e-12) {
        exact = node;
        break;
      }
      const weight = 1 / (distanceSquared + 0.04);
      const displacement = node.displacement || { x: 0, y: 0, z: 0 };
      finite(displacement.x, `${node.id}.displacement.x`);
      finite(displacement.y, `${node.id}.displacement.y`);
      finite(displacement.z, `${node.id}.displacement.z`);
      sum.x += displacement.x * weight;
      sum.y += displacement.y * weight;
      sum.z += displacement.z * weight;
      totalWeight += weight;
    }
    const displacement = exact
      ? exact.displacement || { x: 0, y: 0, z: 0 }
      : { x: sum.x / totalWeight, y: sum.y / totalWeight, z: sum.z / totalWeight };
    const length = Math.hypot(displacement.x, displacement.y, displacement.z);
    outputDisplacements[offset] = displacement.x;
    outputDisplacements[offset + 1] = displacement.y;
    outputDisplacements[offset + 2] = displacement.z;
    maxDisplacement = Math.max(maxDisplacement, length);
    totalDisplacement += length;
    mappedNodeIds.add((exact || owner).id);
  }

  const brokenBondIds = state.bonds.filter(bond => !bond.alive).map(bond => bond.id);
  return {
    schema: ARCH_SURFACE_CONSUMER_SCHEMA,
    route: ARCH_SURFACE_CONSUMER_ROUTE,
    authority: ARCH_SURFACE_CONSUMER_AUTHORITY,
    sourceGlbSha256: profile.source.sha256,
    sourceStateSchema: state.schema,
    solverAuthority: state.solverAuthority,
    interiorMode: state.interiorMode,
    contactDepthMode: state.load?.contactDepthMode || null,
    connectivityEpoch: state.connectivityEpoch,
    componentCount: state.components.length,
    brokenBondIds,
    surfaceVertexCount: sourcePositions.length / 3,
    mappedStructuralNodeCount: mappedNodeIds.size,
    unmappedVertexCount: 0,
    maxRawVertexDisplacement: maxDisplacement,
    meanRawVertexDisplacement: totalDisplacement / (sourcePositions.length / 3),
    rawDisplacements: outputDisplacements,
  };
}
