import { solveArchStructuralForce } from './structural-material-arch-core.js';

export function buildArchVolumeFrame(state, equilibrium = state) {
  if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.bonds) || !Number.isInteger(state.layers)) {
    throw new Error('arch volume requires a structural state with nodes, bonds, and layers');
  }
  if (!equilibrium || equilibrium.nodes?.length !== state.nodes.length || equilibrium.bonds?.length !== state.bonds.length) {
    throw new Error('arch volume equilibrium must preserve structural graph shape');
  }
  const strain = new Float64Array(state.nodes.length);
  const nodes = state.nodes.map((node, index) => ({
    position: [
      node.x + equilibrium.nodes[index].displacement.x,
      node.y + equilibrium.nodes[index].displacement.y,
      node.z + equilibrium.nodes[index].displacement.z,
    ],
    layer: node.layer,
    componentId: node.componentId,
    pinned: node.pinned,
    strain: 0,
  }));
  const brokenSegments = [];
  for (const bond of state.bonds) {
    const value = bond.lastStrain || 0;
    strain[bond.a] = Math.max(strain[bond.a], value);
    strain[bond.b] = Math.max(strain[bond.b], value);
    const a = state.nodes[bond.a];
    const b = state.nodes[bond.b];
    if (!bond.alive && a.layer === b.layer && (a.layer === 0 || a.layer === state.layers - 1)) {
      brokenSegments.push([...nodes[bond.a].position, ...nodes[bond.b].position]);
    }
  }
  for (let index = 0; index < nodes.length; index += 1) nodes[index].strain = strain[index];
  return { nodes, brokenSegments };
}

export function resolveArchVolumeEquilibrium(state, load) {
  if (!state.load) return { state, mode: 'unloaded' };
  const contactCells = new Set(state.load.contactCells.map(cell => `${cell.column}:${cell.row}`));
  const pinnedComponents = new Set(state.nodes.filter(node => node.pinned).map(node => node.componentId));
  const loadedComponents = new Set(state.nodes
    .filter(node => contactCells.has(`${node.column}:${node.row}`))
    .map(node => node.componentId));
  if ([...loadedComponents].some(id => !pinnedComponents.has(id))) {
    return { state, mode: 'accepted-pose-unanchored' };
  }
  const mode = state.bonds.some(bond => !bond.alive) ? 'broken-graph-equilibrium' :
    state.events.some(event => event.kind === 'bind') ? 'repaired-graph-equilibrium' : 'intact-graph-equilibrium';
  return { state: solveArchStructuralForce(state, load), mode };
}
