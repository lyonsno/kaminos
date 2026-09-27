export function buildArchVolumeFrame(state) {
  if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.bonds) || !Number.isInteger(state.layers)) {
    throw new Error('arch volume requires a structural state with nodes, bonds, and layers');
  }
  const strain = new Float64Array(state.nodes.length);
  const nodes = state.nodes.map(node => ({
    position: [
      node.x + node.displacement.x,
      node.y + node.displacement.y,
      node.z + node.displacement.z,
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
