import { advanceArchStructuralForce, bindArchStructuralProxy, fractureArchStructuralProxy, solveArchStructuralForce } from './structural-material-arch-core.js';

export function advanceArchVolumeLoad(state, load = {}, options = {}) {
  const duration = options.duration ?? 0.1;
  const timeStep = options.timeStep ?? 0.02;
  const damping = options.damping ?? 8;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('load duration must be finite and positive');
  if (!Number.isFinite(timeStep) || timeStep <= 0) throw new Error('load time step must be finite and positive');
  const startingEpoch = state.connectivityEpoch;
  const startingEvents = state.events.length;
  let next = state;
  let elapsed = 0;
  let steps = 0;
  while (elapsed < duration - Number.EPSILON * duration) {
    const dt = Math.min(timeStep, duration - elapsed);
    next = fractureArchStructuralProxy(advanceArchStructuralForce(next, load, { timeStep: dt, damping }),
      { threshold: load.threshold });
    elapsed += dt;
    steps += 1;
  }
  return { ...next, loadApplication: {
    round: (state.loadApplication?.round ?? 0) + 1,
    elapsed: (state.loadApplication?.elapsed ?? 0) + elapsed,
    duration: elapsed, steps, timeStep, damping, startingEpoch,
    addedCracks: next.events.length - startingEvents,
  } };
}

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
  const brokenSegmentLayers = [];
  for (const bond of state.bonds) {
    const value = bond.alive ? bond.lastStrain || 0 : 0;
    strain[bond.a] = Math.max(strain[bond.a], value);
    strain[bond.b] = Math.max(strain[bond.b], value);
    const a = state.nodes[bond.a];
    const b = state.nodes[bond.b];
    if (!bond.alive && a.layer === b.layer && (a.layer === 0 || a.layer === state.layers - 1)) {
      const direction = bond.direction ?? [b.x - a.x, b.y - a.y, b.z - a.z];
      const rest = bond.rest ?? Math.hypot(...direction);
      const norm = Math.hypot(...direction);
      if (!norm) continue;
      // Broken history stays with each end; it must never span a separated gap.
      for (const [index, sign] of [[bond.a, 1], [bond.b, -1]]) {
        const position = nodes[index].position;
        brokenSegments.push([...position, ...position.map((value, axis) =>
          value + sign * direction[axis] / norm * rest * 0.2)]);
        brokenSegmentLayers.push(state.nodes[index].layer);
      }
    }
  }
  for (let index = 0; index < nodes.length; index += 1) nodes[index].strain = strain[index];
  return { nodes, brokenSegments, brokenSegmentLayers };
}

export function resolveArchVolumeEquilibrium(state, load) {
  if (!state.load) return { state, mode: 'unloaded' };
  if (state.load.mode === 'equal-force-time-step') return { state, mode: 'evolving-force-pose' };
  const broken = state.bonds.some(bond => !bond.alive);
  const contactCells = new Set(state.load.contactCells.map(cell => `${cell.column}:${cell.row}`));
  const pinnedComponents = new Set(state.nodes.filter(node => node.pinned).map(node => node.componentId));
  const loadedComponents = new Set(state.nodes
    .filter(node => contactCells.has(`${node.column}:${node.row}`))
    .map(node => node.componentId));
  if ([...loadedComponents].some(id => !pinnedComponents.has(id))) {
    return { state, mode: 'accepted-pose-unanchored' };
  }
  if (broken && state.load.requestedForce === 0) return { state, mode: 'unloaded-damaged' };
  if (broken && state.load.requestedForce > 0) return { state, mode: 'fracture-event-pose' };
  const mode = state.events.some(event => event.kind === 'bind') ? 'repaired-graph-equilibrium' : 'intact-graph-equilibrium';
  return { state: solveArchStructuralForce(state, load), mode };
}

export function releaseArchStructuralLoad(state, load = {}) {
  if (!state?.load) throw new Error('arch release requires an applied structural load');
  return {
    state: solveArchStructuralForce(state, { ...state.load, ...load, force: 0 }),
    mode: 'unloaded-damaged',
  };
}

export function bindReleasedArchVolume(state, load = {}) {
  if (state.load?.requestedForce !== 0 || state.nodes.some(node =>
    Object.values(node.displacement).some(value => value !== 0))) {
    throw new Error('arch Bind requires a released reference pose');
  }
  const bondIds = state.bonds.filter(bond => !bond.alive).map(bond => bond.id);
  const repaired = bindArchStructuralProxy(state, { bondIds });
  return solveArchStructuralForce(repaired, { ...state.load, ...load, force: 0 });
}
