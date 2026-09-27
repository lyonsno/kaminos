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
