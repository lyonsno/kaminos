export const STRUCTURAL_MATERIAL_3D_SCHEMA = 'kaminos.structural-material.layered-sidecar.v0';
export const STRUCTURAL_MATERIAL_3D_ROUTE = 'kaminos.structural-material.layered-slab-fracture.v0';
export const STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY = 'deterministic-layered-graph-force-fracture-v0';
export const STRUCTURAL_MATERIAL_3D_GEOMETRY_AUTHORITY = 'stress-concentration-notched-layered-slab-v0';
export const STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY = 'threejs-sidecar-consumer-not-truth-v0';
export const STRUCTURAL_MATERIAL_3D_SOUND_AUTHORITY = 'material-derived-sound-impulses-v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, digits = 5) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function normalizedVector3(vector = {}) {
  const x = finite(vector.x, 0);
  const y = finite(vector.y, 0);
  const z = finite(vector.z, 0);
  const length = Math.hypot(x, y, z);
  if (length < 0.000001) return { x: 1, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function normalizedPoint2(point = {}, fallback = { x: 0.5, y: 0.5 }) {
  return {
    x: clamp(point.x, 0, 1) ?? fallback.x,
    y: clamp(point.y, 0, 1) ?? fallback.y,
  };
}

function normalizedPoint3(point = {}, fallback = { x: 0.9, y: 0.5, z: 0.5 }) {
  return {
    x: clamp(point.x ?? fallback.x, 0, 1),
    y: clamp(point.y ?? fallback.y, 0, 1),
    z: clamp(point.z ?? fallback.z, 0, 1),
  };
}

function cloneState(state) {
  return {
    ...state,
    nodes: state.nodes.map(node => ({ ...node, displacement: { ...node.displacement } })),
    bonds: state.bonds.map(bond => ({
      ...bond,
      midpoint: { ...bond.midpoint },
      direction: { ...bond.direction },
      lastStress: finite(bond.lastStress),
      lastStrain: finite(bond.lastStrain),
    })),
    components: state.components.map(component => ({ ...component, center: { ...component.center }, nodeIds: [...component.nodeIds] })),
    appliedInteractions: state.appliedInteractions.map(interaction => ({ ...interaction })),
    sound: {
      ...state.sound,
      events: state.sound.events.map(event => ({ ...event, midpoint: event.midpoint ? { ...event.midpoint } : null })),
    },
  };
}

function nodeIdAt(x, y, z, columns, rows) {
  return `n${z * columns * rows + y * columns + x}`;
}

function bondKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function shouldSkipNotchBond(a, b, notch) {
  if (!notch) return false;
  if (Math.abs(a.z - b.z) > 0.001) return false;
  const seamDistance = Math.abs((a.x + b.x) * 0.5 - 0.5);
  const midY = (a.y + b.y) * 0.5;
  const crossesCenterSeam = seamDistance < 0.13 && Math.abs(a.x - b.x) > 0.001;
  if (!crossesCenterSeam) return false;
  return Math.abs(midY - 0.5) > 0.16;
}

function geometryRoleForBond(a, b, bondKind, notch) {
  if (!notch) return bondKind === 'depth' ? 'depth-tie' : 'body';
  const midpoint = {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
  const seamDistance = Math.abs(midpoint.x - 0.5);
  const centerY = Math.abs(midpoint.y - 0.5);
  if (bondKind === 'depth') {
    if (seamDistance < 0.18 && centerY <= 0.2) return 'notch-depth-tie';
    return 'depth-tie';
  }
  if (seamDistance < 0.13 && centerY <= 0.16 && Math.abs(a.x - b.x) > 0.001) return 'notch-bridge';
  if (seamDistance < 0.22 && centerY <= 0.36) return 'notch-shoulder';
  if (midpoint.z < 0.08 || midpoint.z > 0.92) return 'skin';
  return 'body';
}

function computeComponents(nodes, bonds) {
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  for (const bond of bonds) {
    if (!bond.alive) continue;
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const nodeIds = [];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop();
      nodeIds.push(id);
      for (const next of adjacency.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    const componentNodes = nodeIds.map(id => byId.get(id));
    const pinned = componentNodes.some(item => item.pinned);
    const center = {
      x: componentNodes.reduce((sum, item) => sum + item.x, 0) / componentNodes.length,
      y: componentNodes.reduce((sum, item) => sum + item.y, 0) / componentNodes.length,
      z: componentNodes.reduce((sum, item) => sum + item.z, 0) / componentNodes.length,
    };
    components.push({
      id: `c${components.length}`,
      nodeIds,
      pinned,
      center: { x: round(center.x), y: round(center.y), z: round(center.z) },
      nodeCount: nodeIds.length,
    });
  }
  return components;
}

function maxComponentSeparation(components) {
  let max = 0;
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      const a = components[i].center;
      const b = components[j].center;
      max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return round(max);
}

function buildSound(events, brokenCount, repairedCount) {
  const impulseEnergy = events.reduce((sum, event) => sum + finite(event.energy), 0);
  const crackEvents = events.filter(event => event.kind === 'crack');
  const bindEvents = events.filter(event => event.kind === 'bind');
  const depthCracks = crackEvents.filter(event => event.bondKind === 'depth').length;
  const brightness = clamp(
    crackEvents.reduce((sum, event) => sum + finite(event.strain), 0) / Math.max(1, crackEvents.length) +
      depthCracks * 0.08 +
      bindEvents.length * 0.18,
    0,
    4,
  );
  const roughness = clamp((crackEvents.length * 0.22 + brokenCount * 0.065 + depthCracks * 0.11) / Math.max(1, events.length), 0, 2.5);
  const sound = {
    authority: STRUCTURAL_MATERIAL_3D_SOUND_AUTHORITY,
    impulseEnergy: round(impulseEnergy, 5),
    brightness: round(brightness, 5),
    roughness: round(roughness, 5),
    events,
  };
  sound.signature = [
    STRUCTURAL_MATERIAL_3D_SOUND_AUTHORITY,
    `e${round(sound.impulseEnergy, 4)}`,
    `b${round(sound.brightness, 4)}`,
    `r${round(sound.roughness, 4)}`,
    `c${brokenCount}`,
    `m${repairedCount}`,
  ].join(':');
  return sound;
}

function finalizeState(state, forceDirection = { x: 1, y: 0, z: 0 }, magnitude = 0) {
  const components = computeComponents(state.nodes, state.bonds);
  const componentByNode = new Map();
  for (const component of components) {
    for (const nodeId of component.nodeIds) componentByNode.set(nodeId, component);
  }
  const brokenCount = state.bonds.filter(bond => !bond.alive).length;
  const separationScale = brokenCount > 0 ? clamp(magnitude * 0.05, 0.025, 0.16) : 0;
  const nodes = state.nodes.map(node => {
    const component = componentByNode.get(node.id);
    const looseBias = component?.pinned ? 0 : clamp((component?.center.x ?? node.x) - 0.43, -0.18, 0.72);
    const depthBias = clamp(node.z - 0.5, -0.5, 0.5);
    return {
      ...node,
      componentId: component?.id || 'c0',
      displacement: {
        x: round(forceDirection.x * separationScale * looseBias),
        y: round(forceDirection.y * separationScale * looseBias),
        z: round(forceDirection.z * separationScale * (looseBias + depthBias * 0.35)),
      },
    };
  });
  return {
    ...state,
    nodes,
    components,
    sound: buildSound(state.sound.events, brokenCount, state.bonds.filter(bond => bond.repaired).length),
  };
}

export function createLayeredStructuralMaterial(options = {}) {
  const columns = Math.max(5, Math.floor(finite(options.columns, 9)));
  const rows = Math.max(4, Math.floor(finite(options.rows, 5)));
  const layers = Math.max(2, Math.floor(finite(options.layers, 4)));
  const notch = options.notch !== false;
  const nodes = [];
  for (let z = 0; z < layers; z += 1) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        nodes.push({
          id: nodeIdAt(x, y, z, columns, rows),
          x: round(x / (columns - 1)),
          y: round(y / (rows - 1)),
          z: round(z / (layers - 1)),
          layer: z,
          pinned: x === 0,
          componentId: 'c0',
          displacement: { x: 0, y: 0, z: 0 },
        });
      }
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairs = new Set();
  const bonds = [];
  const addBond = (x0, y0, z0, x1, y1, z1, bondKind = 'in-plane') => {
    if (
      x0 < 0 || x0 >= columns || y0 < 0 || y0 >= rows || z0 < 0 || z0 >= layers ||
      x1 < 0 || x1 >= columns || y1 < 0 || y1 >= rows || z1 < 0 || z1 >= layers
    ) return;
    const a = byId.get(nodeIdAt(x0, y0, z0, columns, rows));
    const b = byId.get(nodeIdAt(x1, y1, z1, columns, rows));
    const key = bondKey(a.id, b.id);
    if (pairs.has(key) || shouldSkipNotchBond(a, b, notch)) return;
    pairs.add(key);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const rest = Math.hypot(dx, dy, dz);
    const role = geometryRoleForBond(a, b, bondKind, notch);
    const strengthScale = role === 'notch-depth-tie'
      ? 0.42
      : role === 'notch-bridge'
        ? 0.36
        : role === 'notch-shoulder'
          ? 0.72
          : bondKind === 'depth'
            ? 0.92
            : 1;
    bonds.push({
      id: `b${bonds.length}`,
      a: a.id,
      b: b.id,
      rest: round(rest),
      direction: { x: round(dx / rest), y: round(dy / rest), z: round(dz / rest) },
      midpoint: { x: round((a.x + b.x) * 0.5), y: round((a.y + b.y) * 0.5), z: round((a.z + b.z) * 0.5) },
      strength: round(1.58 * strengthScale),
      stiffness: role === 'notch-depth-tie' ? 0.72 : role === 'notch-bridge' ? 0.82 : 1,
      geometryRole: role,
      bondKind,
      alive: true,
      repaired: false,
      lastStress: 0,
      lastStrain: 0,
      cause: null,
    });
  };
  for (let z = 0; z < layers; z += 1) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        addBond(x, y, z, x + 1, y, z, 'in-plane');
        addBond(x, y, z, x, y + 1, z, 'in-plane');
        addBond(x, y, z, x + 1, y + 1, z, 'in-plane');
        addBond(x + 1, y, z, x, y + 1, z, 'in-plane');
        addBond(x, y, z, x, y, z + 1, 'depth');
      }
    }
  }
  const initial = {
    schema: STRUCTURAL_MATERIAL_3D_SCHEMA,
    route: STRUCTURAL_MATERIAL_3D_ROUTE,
    solverAuthority: STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY,
    geometryAuthority: notch ? STRUCTURAL_MATERIAL_3D_GEOMETRY_AUTHORITY : 'uniform-layered-slab-control-v0',
    visualConsumerAuthority: STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY,
    soundAuthority: STRUCTURAL_MATERIAL_3D_SOUND_AUTHORITY,
    topologyEpoch: 0,
    connectivityEpoch: 0,
    columns,
    rows,
    layers,
    nodes,
    bonds,
    components: [],
    appliedInteractions: [],
    sound: buildSound([], 0, 0),
  };
  return finalizeState(initial);
}

function stressForBond(bond, interaction) {
  const direction = normalizedVector3(interaction.vector);
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const radius = clamp(interaction.radius, 0.06, 0.8);
  const point = normalizedPoint3(interaction.point);
  const axial = Math.abs(bond.direction.x * direction.x + bond.direction.y * direction.y + bond.direction.z * direction.z);
  const shear = Math.hypot(
    bond.direction.y * direction.z - bond.direction.z * direction.y,
    bond.direction.z * direction.x - bond.direction.x * direction.z,
    bond.direction.x * direction.y - bond.direction.y * direction.x,
  );
  const xLoad = 0.18 + bond.midpoint.x * 0.86;
  const dy = bond.midpoint.y - point.y;
  const dz = bond.midpoint.z - point.z;
  const grip = 0.28 + 0.72 * Math.exp(-(dy * dy + dz * dz * 0.72) / (2 * radius * radius));
  const notchDistance = Math.hypot(bond.midpoint.x - 0.5, bond.midpoint.y - 0.5);
  const notchBoost = bond.geometryRole === 'notch-depth-tie'
    ? 1.0 + 2.35 * Math.exp(-(notchDistance * notchDistance) / (2 * 0.19 * 0.19))
    : bond.geometryRole === 'notch-bridge'
      ? 1.0 + 2.05 * Math.exp(-(notchDistance * notchDistance) / (2 * 0.18 * 0.18))
      : bond.geometryRole === 'notch-shoulder'
        ? 1.0 + 0.62 * Math.exp(-(notchDistance * notchDistance) / (2 * 0.24 * 0.24))
        : 1;
  const depthShear = bond.bondKind === 'depth' ? Math.abs(direction.z) * 0.48 + shear * 0.22 : Math.abs(direction.z) * 0.12;
  const contactRamp = magnitude < 0.45 ? clamp(magnitude / 0.45, 0, 1) * 0.52 : 1;
  return magnitude * contactRamp * (0.18 + 0.78 * axial + 0.35 * shear + depthShear) * xLoad * grip * notchBoost;
}

export function evaluateLayeredStructuralBondResponse(bond, interaction = {}) {
  if (!bond.alive) {
    return {
      stress: finite(bond.lastStress),
      strain: finite(bond.lastStrain),
      energy: 0,
      shouldBreak: false,
      nextAlive: false,
    };
  }
  const stress = stressForBond(bond, interaction);
  const strain = stress / Math.max(0.001, bond.stiffness);
  const shouldBreak = strain > bond.strength;
  return {
    stress,
    strain,
    energy: shouldBreak
      ? (strain - bond.strength) * bond.rest * (bond.bondKind === 'depth' ? 1.05 : 0.86)
      : 0,
    shouldBreak,
    nextAlive: !shouldBreak,
  };
}

export function applyLayeredStructuralInteraction(state, interaction = {}, options = {}) {
  let next = cloneState(state);
  const steps = Math.max(1, Math.floor(finite(options.steps, 1)));
  const direction = normalizedVector3(interaction.vector);
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const events = [...next.sound.events];
  for (let step = 0; step < steps; step += 1) {
    next.bonds = next.bonds.map(bond => {
      if (!bond.alive) return bond;
      const response = evaluateLayeredStructuralBondResponse(bond, interaction);
      if (!response.shouldBreak) return { ...bond, lastStress: round(response.stress), lastStrain: round(response.strain) };
      events.push({
        kind: 'crack',
        bondId: bond.id,
        bondKind: bond.bondKind,
        geometryRole: bond.geometryRole,
        cause: 'stress-threshold',
        stress: round(response.stress),
        strain: round(response.strain),
        energy: round(response.energy),
        midpoint: { ...bond.midpoint },
        step,
      });
      return {
        ...bond,
        alive: false,
        cause: 'stress-threshold',
        lastStress: round(response.stress),
        lastStrain: round(response.strain),
      };
    });
  }
  next = {
    ...next,
    topologyEpoch: next.topologyEpoch + (events.length > next.sound.events.length ? 1 : 0),
    connectivityEpoch: next.connectivityEpoch + (events.length > next.sound.events.length ? 1 : 0),
    appliedInteractions: [...next.appliedInteractions, {
      kind: interaction.kind || 'screen-space-layered-force',
      point: normalizedPoint3(interaction.point),
      vector: { x: round(direction.x), y: round(direction.y), z: round(direction.z) },
      magnitude: round(magnitude),
      radius: round(interaction.radius ?? 0.2),
      steps,
    }],
    sound: { ...next.sound, events },
  };
  return finalizeState(next, direction, magnitude);
}

export function createLayeredStructuralDragInteraction({ start, current, depthBias = 0 } = {}) {
  const dragStart = normalizedPoint2(start);
  const dragCurrent = normalizedPoint2(current, dragStart);
  const dx = dragCurrent.x - dragStart.x;
  const dy = dragCurrent.y - dragStart.y;
  const dz = clamp(depthBias, -1, 1);
  const length = Math.hypot(dx, dy, dz * 0.44);
  const direction = normalizedVector3({ x: dx, y: dy, z: dz });
  const magnitude = clamp(length * 3.65, 0.08, 1.95);
  const radius = clamp(0.12 + length * 0.27, 0.12, 0.34);
  return {
    kind: 'screen-space-layered-drag',
    authority: 'screen-space-drag-to-layered-force-envelope-v0',
    start: { x: round(dragStart.x), y: round(dragStart.y), z: 0.5 },
    point: { x: round(dragCurrent.x), y: round(dragCurrent.y), z: round(clamp(0.5 - dz * 0.5, 0, 1)) },
    vector: { x: round(direction.x), y: round(direction.y), z: round(direction.z) },
    dragLength: round(length),
    magnitude: round(magnitude),
    radius: round(radius),
  };
}

export function bindLayeredStructuralConnectivity(state, binding = {}) {
  let next = cloneState(state);
  const point = normalizedPoint3(binding.point, { x: 0.5, y: 0.5, z: 0.5 });
  const radius = clamp(binding.radius, 0.03, 0.6);
  const strength = clamp(binding.strength, 0.2, 4);
  const events = [...next.sound.events];
  let repaired = 0;
  next.bonds = next.bonds.map(bond => {
    if (bond.alive) return bond;
    const d = Math.hypot(bond.midpoint.x - point.x, bond.midpoint.y - point.y, bond.midpoint.z - point.z);
    if (d > radius) return bond;
    repaired += 1;
    events.push({
      kind: 'bind',
      bondId: bond.id,
      bondKind: bond.bondKind,
      geometryRole: bond.geometryRole,
      cause: 'operator-binding',
      stress: 0,
      strain: 0,
      energy: round((radius - d) * strength * (bond.bondKind === 'depth' ? 0.72 : 0.55)),
      midpoint: { ...bond.midpoint },
      step: repaired,
    });
    return {
      ...bond,
      alive: true,
      repaired: true,
      cause: null,
      strength: round(Math.max(bond.strength, strength)),
      lastStress: 0,
      lastStrain: 0,
    };
  });
  next = {
    ...next,
    topologyEpoch: next.topologyEpoch + (repaired > 0 ? 1 : 0),
    connectivityEpoch: next.connectivityEpoch + (repaired > 0 ? 1 : 0),
    sound: { ...next.sound, events },
  };
  return finalizeState(next, { x: 0, y: 0, z: 0 }, 0);
}

export function summarizeLayeredStructuralState(state) {
  const broken = state.bonds.filter(bond => !bond.alive);
  const repaired = state.bonds.filter(bond => bond.repaired);
  const maxStress = state.bonds.reduce((max, bond) => Math.max(max, finite(bond.lastStress)), 0);
  const crossDepthBondCount = state.bonds.filter(bond => bond.bondKind === 'depth').length;
  const brokenDepthBondCount = broken.filter(bond => bond.bondKind === 'depth').length;
  const crackPath = broken.map(bond => ({
    bondId: bond.id,
    a: bond.a,
    b: bond.b,
    bondKind: bond.bondKind,
    midpoint: { ...bond.midpoint },
    stress: round(bond.lastStress),
    strain: round(bond.lastStrain),
    cause: bond.cause || 'unknown',
    geometryRole: bond.geometryRole,
  }));
  return {
    schema: STRUCTURAL_MATERIAL_3D_SCHEMA,
    route: STRUCTURAL_MATERIAL_3D_ROUTE,
    solverAuthority: state.solverAuthority,
    geometryAuthority: state.geometryAuthority,
    visualConsumerAuthority: state.visualConsumerAuthority,
    soundAuthority: state.soundAuthority,
    nodeCount: state.nodes.length,
    bondCount: state.bonds.length,
    layerCount: state.layers,
    crossDepthBondCount,
    brokenBondCount: broken.length,
    brokenDepthBondCount,
    repairedBondCount: repaired.length,
    componentCount: state.components.length,
    maxStress: round(maxStress),
    maxComponentSeparation: maxComponentSeparation(state.components),
    crackPath,
    sidecar: {
      schema: STRUCTURAL_MATERIAL_3D_SCHEMA,
      requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
      effectiveRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
      structuralTruthAuthority: STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY,
      visualConsumerAuthority: STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY,
      storageShape: {
        nodeFields: ['id', 'position3', 'displacement3', 'componentId', 'pinned'],
        bondFields: ['id', 'a', 'b', 'restLength', 'direction3', 'strength', 'stress', 'alive', 'geometryRole', 'bondKind'],
        eventFields: ['kind', 'bondId', 'midpoint3', 'stress', 'strain', 'energy', 'cause'],
      },
    },
    sound: {
      impulseEnergy: state.sound.impulseEnergy,
      brightness: state.sound.brightness,
      roughness: state.sound.roughness,
      signature: state.sound.signature,
      eventCount: state.sound.events.length,
    },
  };
}

export function buildLayeredStructuralWitnessScenario(options = {}) {
  const force = {
    kind: 'screen-space-layered-drag',
    point: { x: 0.92, y: finite(options.forceY, 0.52), z: finite(options.forceZ, 0.85) },
    vector: { x: 1, y: finite(options.forceSkewY, 0.08), z: finite(options.forceSkewZ, -0.64) },
    magnitude: finite(options.magnitude, 1.46),
    radius: finite(options.radius, 0.26),
  };
  const notched = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
  const control = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: false });
  const cracked = applyLayeredStructuralInteraction(notched, force, { steps: 4 });
  const controlAfter = applyLayeredStructuralInteraction(control, force, { steps: 4 });
  const crackSummary = summarizeLayeredStructuralState(cracked);
  const crackPoint = crackSummary.crackPath.find(edge => edge.bondKind === 'depth')?.midpoint || crackSummary.crackPath[0]?.midpoint || { x: 0.5, y: 0.5, z: 0.5 };
  const bound = bindLayeredStructuralConnectivity(cracked, { point: crackPoint, radius: 0.22, strength: 1.25 });
  return {
    schema: STRUCTURAL_MATERIAL_3D_SCHEMA,
    requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    effectiveRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    solverAuthority: STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY,
    geometryAuthority: STRUCTURAL_MATERIAL_3D_GEOMETRY_AUTHORITY,
    visualConsumerAuthority: STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY,
    force,
    states: {
      initial: notched,
      cracked,
      control: controlAfter,
      bound,
    },
    summaries: {
      initial: summarizeLayeredStructuralState(notched),
      cracked: crackSummary,
      control: summarizeLayeredStructuralState(controlAfter),
      bound: summarizeLayeredStructuralState(bound),
    },
  };
}
