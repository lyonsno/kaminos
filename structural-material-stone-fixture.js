export function buildGpuStoneFixture(prepared, options = {}) {
  if (prepared?.schema !== 'kaminos.imported-solid.grid-intersection.manifold-3.5.4.v0' || !/^[a-f0-9]{64}$/.test(prepared.sourceSha256) || !prepared.cells?.length || !prepared.bonds?.length) throw new Error('Verified geometry-derived solid preparation required');
  if (!prepared.spacing?.every(n => Number.isFinite(n) && n > 0) || Math.abs(prepared.volume - prepared.totalVolume) > prepared.volume * 1e-5) throw new Error('Invalid prepared volume or spacing');
  const actualVolume = prepared.cells.reduce((sum, cell) => sum + cell.volume, 0);
  if (!(prepared.volume > 0) || !Number.isFinite(actualVolume) || Math.abs(actualVolume - prepared.volume) > prepared.volume * 1e-5) throw new Error('Prepared region volume ledger disagrees');
  const config = { layers: prepared.grid[2], depth: prepared.size[2], scale: 1, density: 1, gravity: 9.81, timeStep: 1/60,
    solverIterations: 20, stiffness: 10000, strength: 200, friction: .65, gripStiffness: 250, gripRadius: .7,
    initialJointPenalty: 10000, gravityRampSeconds: .5, substeps: 1, preventPenetratingNormalDropout: true, ...options };
  for (const name of ['density', 'timeStep', 'stiffness', 'strength', 'gripStiffness']) if (!(config[name] > 0) || !Number.isFinite(config[name])) throw new Error(`Invalid ${name}`);
  for (const name of ['gravity', 'friction', 'gripRadius', 'gravityRampSeconds']) if (config[name] < 0 || !Number.isFinite(config[name])) throw new Error(`Invalid ${name}`);
  if (!Number.isInteger(config.solverIterations) || config.solverIterations < 1 || config.initialJointPenalty < 1 || config.initialJointPenalty > config.stiffness) throw new Error('Invalid solver configuration');
  const cells = prepared.cells.map((cell, index) => {
    if (cell.index !== index || !(cell.volume > 0) || !cell.position.every(Number.isFinite)) throw new Error('Invalid prepared region');
    const pinned = cell.column === 0;
    return { index, id: cell.id, column: cell.column, row: cell.row, layer: cell.layer, pinned, position: [...cell.position], quaternion: [0,0,0,1],
      halfExtents: prepared.spacing.map(n => n/2), mass: pinned ? 0 : cell.volume * config.density, volume: cell.volume };
  });
  const bonds = prepared.bonds.filter(b => !(cells[b.a]?.pinned && cells[b.b]?.pinned)).map(b => {
    if (!cells[b.a] || !cells[b.b] || !(b.area > 0) || !Number.isFinite(b.area)) throw new Error('Invalid prepared interface');
    return { ...b, normal: [...b.normal], anchorA: [...b.anchorA], anchorB: [...b.anchorB] };
  });
  return { cells, bonds, config, dimensions: Object.fromEntries(['dx','dy','dz'].map((key, i) => [key, prepared.spacing[i]])), floorY: -1.5 };
}
