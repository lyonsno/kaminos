export const STRUCTURAL_ARCH_PROXY_SCHEMA = 'kaminos.structural-material.arch-silhouette-proxy.v0';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function key(column, row, layer) {
  return `${column}:${row}:${layer}`;
}

function withComponents(state) {
  const adjacency = state.nodes.map(() => []);
  for (const bond of state.bonds) {
    if (!bond.alive) continue;
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  }
  const labels = Array(state.nodes.length).fill(-1);
  const components = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== -1) continue;
    const label = components.length;
    const queue = [start];
    labels[start] = label;
    for (let head = 0; head < queue.length; head += 1) {
      for (const next of adjacency[queue[head]]) {
        if (labels[next] !== -1) continue;
        labels[next] = label;
        queue.push(next);
      }
    }
    components.push({ id: label, size: queue.length });
  }
  return {
    ...state,
    nodes: state.nodes.map((node, index) => ({ ...node, componentId: labels[index] })),
    components,
  };
}

export function rasterizeArchTriangles(triangles, bounds, columns, rows) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2) {
    throw new Error('arch raster dimensions must be integers of at least two');
  }
  const [minX, minY] = bounds.min;
  const [maxX, maxY] = bounds.max;
  if (!(maxX > minX && maxY > minY)) throw new Error('arch raster bounds must have area');
  const occupancy = Array(columns * rows).fill(false);
  const dx = (maxX - minX) / columns;
  const dy = (maxY - minY) / rows;
  for (const triangle of triangles) {
    const [[ax, ay], [bx, by], [cx, cy]] = triangle;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-12) continue;
    const left = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / dx));
    const right = Math.min(columns - 1, Math.floor((Math.max(ax, bx, cx) - minX) / dx));
    const bottom = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / dy));
    const top = Math.min(rows - 1, Math.floor((Math.max(ay, by, cy) - minY) / dy));
    for (let row = bottom; row <= top; row += 1) {
      const y = minY + (row + 0.5) * dy;
      for (let column = left; column <= right; column += 1) {
        const x = minX + (column + 0.5) * dx;
        const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
        const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
        const c = 1 - a - b;
        if (a >= -1e-8 && b >= -1e-8 && c >= -1e-8) occupancy[row * columns + column] = true;
      }
    }
  }
  return { columns, rows, occupancy, bounds };
}

export function buildArchStructuralProxy(profile, options = {}) {
  const { columns, rows, occupancy, bounds } = profile;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || occupancy?.length !== columns * rows) {
    throw new Error('arch profile occupancy shape mismatch');
  }
  if (occupancy.some(value => typeof value !== 'boolean')) throw new Error('arch occupancy must be boolean');
  const layers = options.layers ?? 3;
  if (!Number.isInteger(layers) || layers < 2) throw new Error('arch proxy requires at least two depth layers');
  const depth = finite(options.depth ?? 0.36, 'depth');
  if (depth <= 0) throw new Error('arch depth must be positive');
  const nodes = [];
  const byGrid = new Map();
  const occupied = (column, row) => column >= 0 && column < columns && row >= 0 && row < rows && occupancy[row * columns + column];
  const midColumn = columns / 2;
  let leftFootRow = Infinity;
  let rightFootRow = Infinity;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!occupied(column, row)) continue;
      if (column < midColumn) leftFootRow = Math.min(leftFootRow, row);
      else rightFootRow = Math.min(rightFootRow, row);
    }
  }
  for (let layer = 0; layer < layers; layer += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (!occupied(column, row)) continue;
        const index = nodes.length;
        nodes.push({
          id: `n${index}`, column, row, layer,
          x: bounds.min[0] + (column + 0.5) * (bounds.max[0] - bounds.min[0]) / columns,
          y: bounds.min[1] + (row + 0.5) * (bounds.max[1] - bounds.min[1]) / rows,
          z: -depth / 2 + layer * depth / (layers - 1),
          pinned: column < midColumn ? row === leftFootRow : row === rightFootRow,
          displacement: { x: 0, y: 0, z: 0 },
        });
        byGrid.set(key(column, row, layer), index);
      }
    }
  }
  if (!nodes.some(node => node.pinned && node.x < 0) || !nodes.some(node => node.pinned && node.x > 0)) {
    throw new Error('arch proxy needs occupied foot supports on both sides');
  }
  const bonds = [];
  const offsets = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0]];
  for (const node of nodes) {
    for (const [dc, dr, dl] of offsets) {
      const next = byGrid.get(key(node.column + dc, node.row + dr, node.layer + dl));
      if (next === undefined) continue;
      if (dc && dr && !occupied(node.column + dc, node.row) && !occupied(node.column, node.row + dr)) continue;
      const other = nodes[next];
      const delta = [other.x - node.x, other.y - node.y, other.z - node.z];
      const rest = Math.hypot(...delta);
      bonds.push({
        id: `b${bonds.length}`, a: byGrid.get(key(node.column, node.row, node.layer)), b: next,
        rest, direction: delta.map(value => value / rest),
        midpoint: { x: (node.x + other.x) / 2, y: (node.y + other.y) / 2, z: (node.z + other.z) / 2 },
        kind: dl ? 'depth' : dc && dr ? 'diagonal' : 'axis',
        stiffness: dl ? 0.6 : 1,
        alive: true, lastStrain: 0,
      });
    }
  }
  return withComponents({
    schema: STRUCTURAL_ARCH_PROXY_SCHEMA,
    geometryAuthority: 'glb-projected-silhouette-extrusion-v0',
    solverAuthority: 'shear-regularized-linear-spring-pcg-v0',
    visualAuthority: 'glb-consumer-not-structural-truth-v0',
    source: profile.source || null,
    columns, rows, layers, depth, occupancy: [...occupancy], bounds,
    nodes, bonds, connectivityEpoch: 0, events: [],
  });
}

function solveArchLinearSystem(state, load, mode) {
  const x = finite(load.x ?? 0, 'load x');
  const y = finite(load.y ?? state.bounds.max[1], 'load y');
  const magnitude = finite(mode === 'force' ? load.force : load.travel, mode === 'force' ? 'load force' : 'load travel');
  const iterations = load.iterations ?? 1200;
  if (!(magnitude >= 0) || !Number.isInteger(iterations) || iterations < 1) throw new Error('invalid arch load');
  const candidate = state.nodes.filter(node => node.layer === Math.floor(state.layers / 2) && !node.pinned);
  if (!candidate.length) throw new Error('arch has no movable contact');
  const contact = candidate.reduce((best, node) =>
    (node.x - x) ** 2 + (node.y - y) ** 2 < (best.x - x) ** 2 + (best.y - y) ** 2 ? node : best);
  const contactIndices = state.nodes.flatMap((node, index) =>
    node.column === contact.column && node.row === contact.row ? [index] : []);
  const count = state.nodes.length * 3;
  const fixed = new Uint8Array(count);
  const fixedValues = new Float64Array(count);
  const external = new Float64Array(count);
  for (let index = 0; index < state.nodes.length; index += 1) {
    if (state.nodes[index].pinned) fixed.fill(1, index * 3, index * 3 + 3);
  }
  for (const index of contactIndices) {
    if (mode === 'travel') {
      fixed.fill(1, index * 3, index * 3 + 3);
      fixedValues[index * 3 + 1] = -magnitude;
    } else {
      external[index * 3 + 1] = -magnitude / contactIndices.length;
    }
  }
  const shearWeight = 0.18;
  const diagonal = new Float64Array(count);
  const liveBonds = state.bonds.filter(bond => bond.alive);
  for (const bond of liveBonds) {
    const stiffness = bond.stiffness / bond.rest;
    for (let axis = 0; axis < 3; axis += 1) {
      const entry = stiffness * (shearWeight + (1 - shearWeight) * bond.direction[axis] ** 2);
      diagonal[bond.a * 3 + axis] += entry;
      diagonal[bond.b * 3 + axis] += entry;
    }
  }
  const apply = vector => {
    const result = new Float64Array(count);
    for (const bond of liveBonds) {
      const a = bond.a * 3;
      const b = bond.b * 3;
      const direction = bond.direction;
      const dx = vector[b] - vector[a];
      const dy = vector[b + 1] - vector[a + 1];
      const dz = vector[b + 2] - vector[a + 2];
      const axial = dx * direction[0] + dy * direction[1] + dz * direction[2];
      const stiffness = bond.stiffness / bond.rest;
      const delta = [dx, dy, dz];
      for (let axis = 0; axis < 3; axis += 1) {
        const contribution = stiffness * (shearWeight * delta[axis] + (1 - shearWeight) * axial * direction[axis]);
        result[a + axis] -= contribution;
        result[b + axis] += contribution;
      }
    }
    return result;
  };
  const fixedForce = apply(fixedValues);
  const rhs = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    if (!fixed[index]) rhs[index] = external[index] - fixedForce[index];
  }
  const dot = (a, b) => {
    let sum = 0;
    for (let index = 0; index < count; index += 1) if (!fixed[index]) sum += a[index] * b[index];
    return sum;
  };
  const rhsNorm = Math.sqrt(dot(rhs, rhs));
  const solution = new Float64Array(count);
  let residual = rhs.slice();
  let preconditioned = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    if (!fixed[index]) preconditioned[index] = residual[index] / Math.max(1e-12, diagonal[index]);
  }
  let direction = preconditioned.slice();
  let rz = dot(residual, preconditioned);
  let usedIterations = 0;
  for (; usedIterations < iterations && Math.sqrt(dot(residual, residual)) > Math.max(1e-12, rhsNorm * 1e-7); usedIterations += 1) {
    const product = apply(direction);
    const denominator = dot(direction, product);
    if (!(denominator > 0)) throw new Error('arch stiffness is not positive on the loaded subspace');
    const alpha = rz / denominator;
    for (let index = 0; index < count; index += 1) {
      if (fixed[index]) continue;
      solution[index] += alpha * direction[index];
      residual[index] -= alpha * product[index];
    }
    const nextPreconditioned = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      if (!fixed[index]) nextPreconditioned[index] = residual[index] / Math.max(1e-12, diagonal[index]);
    }
    const nextRz = dot(residual, nextPreconditioned);
    const beta = nextRz / rz;
    for (let index = 0; index < count; index += 1) {
      if (!fixed[index]) direction[index] = nextPreconditioned[index] + beta * direction[index];
    }
    preconditioned = nextPreconditioned;
    rz = nextRz;
  }
  const relativeResidual = rhsNorm ? Math.sqrt(dot(residual, residual)) / rhsNorm : 0;
  if (relativeResidual > 1e-6) throw new Error(`arch linear solve did not converge: residual ${relativeResidual}`);
  const displacement = new Float64Array(count);
  for (let index = 0; index < count; index += 1) displacement[index] = solution[index] + fixedValues[index];
  const nodes = state.nodes.map((node, index) => ({
    ...node,
    displacement: {
      x: displacement[index * 3],
      y: displacement[index * 3 + 1],
      z: displacement[index * 3 + 2],
    },
  }));
  const bonds = state.bonds.map(bond => {
    if (!bond.alive) return { ...bond };
    const a = bond.a * 3;
    const b = bond.b * 3;
    const delta = [displacement[b] - displacement[a], displacement[b + 1] - displacement[a + 1], displacement[b + 2] - displacement[a + 2]];
    const axial = delta.reduce((sum, value, axis) => sum + value * bond.direction[axis], 0);
    const transverse = Math.sqrt(Math.max(0, delta.reduce((sum, value) => sum + value * value, 0) - axial * axial));
    return { ...bond, lastStrain: (Math.abs(axial) + shearWeight * transverse) / bond.rest };
  });
  const finalForce = apply(displacement);
  let supportReaction = 0;
  for (let index = 0; index < state.nodes.length; index += 1) {
    if (state.nodes[index].pinned) supportReaction += finalForce[index * 3 + 1];
  }
  return {
    ...state, nodes, bonds,
    load: {
      mode: mode === 'force' ? 'equal-force' : 'prescribed-travel',
      x, y, contact: { column: contact.column, row: contact.row },
      requestedForce: mode === 'force' ? magnitude : null,
      effectiveForce: mode === 'force' ? supportReaction : null,
      travel: -contactIndices.reduce((sum, index) => sum + displacement[index * 3 + 1], 0) / contactIndices.length,
      requestedTravel: mode === 'travel' ? magnitude : null,
      iterationBudget: iterations, iterations: usedIterations, relativeResidual,
      shearWeight,
    },
    maxStrain: Math.max(...bonds.filter(bond => bond.alive).map(bond => bond.lastStrain)),
  };
}

export function solveArchStructuralProxy(state, load = {}) {
  return solveArchLinearSystem(state, load, 'travel');
}

export function solveArchStructuralForce(state, load = {}) {
  return solveArchLinearSystem(state, load, 'force');
}

export function fractureArchStructuralProxy(state, options = {}) {
  const threshold = finite(options.threshold ?? 0.12, 'fracture threshold');
  if (threshold <= 0) throw new Error('fracture threshold must be positive');
  const events = [];
  const bonds = state.bonds.map(bond => {
    if (!bond.alive || bond.lastStrain <= threshold) return { ...bond };
    events.push({
      kind: 'crack', bondId: bond.id, midpoint: bond.midpoint,
      strain: bond.lastStrain, energy: (bond.lastStrain - threshold) * bond.rest * bond.stiffness,
    });
    return { ...bond, alive: false };
  });
  return withComponents({
    ...state, bonds, connectivityEpoch: state.connectivityEpoch + (events.length ? 1 : 0),
    events: [...state.events, ...events],
  });
}

export function bindArchStructuralProxy(state, options = {}) {
  const requested = new Set(options.bondIds || []);
  const events = [];
  const bonds = state.bonds.map(bond => {
    if (bond.alive || !requested.has(bond.id)) return { ...bond };
    events.push({ kind: 'bind', bondId: bond.id, midpoint: bond.midpoint, energy: bond.lastStrain * bond.rest * bond.stiffness });
    return { ...bond, alive: true };
  });
  return withComponents({
    ...state, bonds, connectivityEpoch: state.connectivityEpoch + (events.length ? 1 : 0),
    events: [...state.events, ...events],
  });
}
