export function buildGpuArchFixture(profile, options = {}) {
  if (!Number.isInteger(profile.columns) || !Number.isInteger(profile.rows) ||
      profile.columns < 1 || profile.rows < 1 ||
      profile.occupancy?.length !== profile.columns * profile.rows ||
      profile.occupancy.some(value => typeof value !== 'boolean')) throw new Error('invalid arch occupancy');
  if (!profile.bounds || [0, 1].some(axis => !Number.isFinite(profile.bounds.min?.[axis]) ||
      !Number.isFinite(profile.bounds.max?.[axis]) || profile.bounds.max[axis] <= profile.bounds.min[axis])) {
    throw new Error('arch bounds must be finite and increasing');
  }
  const config = { layers: 3, depth: 0.65, scale: 4, density: 1, gravity: 9.81,
    timeStep: 1 / 60, solverIterations: 20, stiffness: 1e6, strength: 80,
    friction: 0.65, gripStiffness: 250, gripRadius: 0.55, initialJointPenalty: 1e6, gravityRampSeconds: .5,
    substeps: 1, preventPenetratingNormalDropout: false, ...options };
  for (const name of ['depth', 'scale', 'density', 'timeStep', 'stiffness', 'strength', 'gripStiffness']) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) throw new Error(`${name} must be positive and finite`);
  }
  for (const name of ['gravity', 'friction', 'gripRadius', 'gravityRampSeconds']) {
    if (!Number.isFinite(config[name]) || config[name] < 0) throw new Error(`${name} must be nonnegative and finite`);
  }
  if (!Number.isInteger(config.layers) || config.layers < 2) throw new Error('layers must be at least two');
  if (!Number.isInteger(config.solverIterations) || config.solverIterations < 1) throw new Error('solverIterations must be positive');
  if (!Number.isInteger(config.substeps) || config.substeps < 1 || config.substeps > 8) throw new Error('substeps must fit the pinned engine capacity of one through eight');
  if (typeof config.preventPenetratingNormalDropout !== 'boolean') throw new Error('preventPenetratingNormalDropout must be boolean');
  if (!Number.isFinite(config.initialJointPenalty) || config.initialJointPenalty < 1 ||
      config.initialJointPenalty > config.stiffness) throw new Error('initialJointPenalty must be finite, at least one and no greater than stiffness');
  const dx = (profile.bounds.max[0] - profile.bounds.min[0]) * config.scale / profile.columns;
  const dy = (profile.bounds.max[1] - profile.bounds.min[1]) * config.scale / profile.rows;
  const dz = config.depth / config.layers, floorY = profile.bounds.min[1] * config.scale;
  const cells = [], bonds = [], byGrid = new Map(), lowest = [Infinity, Infinity];
  for (let row = 0; row < profile.rows; row++) for (let column = 0; column < profile.columns; column++) {
    if (profile.occupancy[row * profile.columns + column]) {
      const side = column < profile.columns / 2 ? 0 : 1;
      lowest[side] = Math.min(lowest[side], row);
    }
  }
  for (let layer = 0; layer < config.layers; layer++) {
    for (let row = 0; row < profile.rows; row++) for (let column = 0; column < profile.columns; column++) {
      if (!profile.occupancy[row * profile.columns + column]) continue;
      const pinned = row === lowest[column < profile.columns / 2 ? 0 : 1];
      const position = [(profile.bounds.min[0] + (column + 0.5) * dx / config.scale) * config.scale,
        floorY + (row + 0.5) * dy, -config.depth / 2 + (layer + 0.5) * dz];
      const cell = { index: cells.length, id: `cell:${column}:${row}:${layer}`, column, row, layer, pinned,
        position, quaternion: [0, 0, 0, 1], halfExtents: [dx * 0.49, dy * 0.49, dz * 0.49],
        mass: pinned ? 0 : dx * dy * dz * config.density, volume: dx * dy * dz };
      cells.push(cell); byGrid.set(`${column}:${row}:${layer}`, cell.index);
    }
  }
  for (const cell of cells) for (const [dc, dr, dl, area] of
    [[1, 0, 0, dy * dz], [0, 1, 0, dx * dz], [0, 0, 1, dx * dy]]) {
    const b = byGrid.get(`${cell.column + dc}:${cell.row + dr}:${cell.layer + dl}`);
    if (b === undefined || cell.pinned && cells[b].pinned) continue;
    const midpoint = cell.position.map((value, axis) => (value + cells[b].position[axis]) * 0.5);
    bonds.push({ id: `connection:${bonds.length}`, a: cell.index, b, area, normal: [dc, dr, dl],
      anchorA: midpoint.map((value, axis) => value - cell.position[axis]),
      anchorB: midpoint.map((value, axis) => value - cells[b].position[axis]) });
  }
  return { cells, bonds, config, dimensions: { dx, dy, dz }, floorY };
}
