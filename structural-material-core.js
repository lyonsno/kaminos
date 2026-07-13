export const STRUCTURAL_MATERIAL_SCHEMA = 'kaminos.structural-material.sidecar.v0';
export const STRUCTURAL_MATERIAL_ROUTE = 'kaminos.structural-material.proxy-plane-fracture.v0';
export const STRUCTURAL_MATERIAL_SOLVER_AUTHORITY = 'deterministic-coarse-elastic-graph-force-fracture-v0';
export const STRUCTURAL_MATERIAL_GEOMETRY_AUTHORITY = 'stress-concentration-notched-proxy-plane-v0';
export const STRUCTURAL_MATERIAL_SOUND_AUTHORITY = 'material-derived-sound-impulses-v0';

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

function normalizedVector(vector = {}) {
  const x = finite(vector.x, 0);
  const y = finite(vector.y, 0);
  const length = Math.hypot(x, y);
  if (length < 0.000001) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
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
    sound: {
      ...state.sound,
      events: state.sound.events.map(event => ({ ...event, midpoint: event.midpoint ? { ...event.midpoint } : null })),
    },
    components: state.components.map(component => ({ ...component, nodeIds: [...component.nodeIds] })),
    appliedInteractions: state.appliedInteractions.map(interaction => ({ ...interaction })),
  };
}

function bondKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function nodeIdAt(x, y, columns) {
  return `n${y * columns + x}`;
}

function shouldSkipNotchBond(a, b, notch) {
  if (!notch) return false;
  const seamDistance = Math.abs((a.x + b.x) * 0.5 - 0.5);
  const midY = (a.y + b.y) * 0.5;
  const crossesCenterSeam = seamDistance < 0.095 && Math.abs(a.x - b.x) > 0.001;
  if (!crossesCenterSeam) return false;
  return Math.abs(midY - 0.5) > 0.225;
}

function geometryRoleForBond(a, b, notch) {
  if (!notch) return 'body';
  const seamDistance = Math.abs((a.x + b.x) * 0.5 - 0.5);
  const midY = (a.y + b.y) * 0.5;
  if (seamDistance < 0.105 && Math.abs(midY - 0.5) <= 0.245 && Math.abs(a.x - b.x) > 0.001) {
    return 'notch-bridge';
  }
  if (seamDistance < 0.18 && Math.abs(midY - 0.5) <= 0.34) return 'notch-shoulder';
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
    };
    components.push({
      id: `c${components.length}`,
      nodeIds,
      pinned,
      center: { x: round(center.x), y: round(center.y) },
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
      max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return round(max);
}

function soundSignature(sound, brokenCount, repairedCount) {
  return [
    STRUCTURAL_MATERIAL_SOUND_AUTHORITY,
    `e${round(sound.impulseEnergy, 4)}`,
    `b${round(sound.brightness, 4)}`,
    `r${round(sound.roughness, 4)}`,
    `c${brokenCount}`,
    `m${repairedCount}`,
  ].join(':');
}

function buildSound(events, brokenCount, repairedCount) {
  const impulseEnergy = events.reduce((sum, event) => sum + finite(event.energy), 0);
  const crackEvents = events.filter(event => event.kind === 'crack');
  const bindEvents = events.filter(event => event.kind === 'bind');
  const brightness = clamp(
    crackEvents.reduce((sum, event) => sum + finite(event.strain), 0) / Math.max(1, crackEvents.length) +
      bindEvents.length * 0.18,
    0,
    3,
  );
  const roughness = clamp((crackEvents.length * 0.23 + brokenCount * 0.07) / Math.max(1, events.length), 0, 2);
  const sound = {
    authority: STRUCTURAL_MATERIAL_SOUND_AUTHORITY,
    impulseEnergy: round(impulseEnergy, 5),
    brightness: round(brightness, 5),
    roughness: round(roughness, 5),
    events,
  };
  sound.signature = soundSignature(sound, brokenCount, repairedCount);
  return sound;
}

function finalizeState(state, forceDirection = { x: 1, y: 0 }, magnitude = 0) {
  const components = computeComponents(state.nodes, state.bonds);
  const componentByNode = new Map();
  for (const component of components) {
    for (const nodeId of component.nodeIds) componentByNode.set(nodeId, component);
  }
  const brokenCount = state.bonds.filter(bond => !bond.alive).length;
  const separationScale = brokenCount > 0 ? clamp(magnitude * 0.055, 0.025, 0.16) : 0;
  const nodes = state.nodes.map(node => {
    const component = componentByNode.get(node.id);
    const looseBias = component?.pinned ? 0 : clamp((component?.center.x ?? node.x) - 0.45, -0.2, 0.7);
    return {
      ...node,
      componentId: component?.id || 'c0',
      displacement: {
        x: round(forceDirection.x * separationScale * looseBias),
        y: round(forceDirection.y * separationScale * looseBias),
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

export function createStructuralMaterialProxyPlane(options = {}) {
  const columns = Math.max(5, Math.floor(finite(options.columns, 13)));
  const rows = Math.max(4, Math.floor(finite(options.rows, 7)));
  const notch = options.notch !== false;
  const nodes = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      nodes.push({
        id: nodeIdAt(x, y, columns),
        x: round(x / (columns - 1)),
        y: round(y / (rows - 1)),
        pinned: x === 0,
        componentId: 'c0',
        displacement: { x: 0, y: 0 },
      });
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairs = new Set();
  const bonds = [];
  const addBond = (x0, y0, x1, y1) => {
    if (x1 < 0 || x1 >= columns || y1 < 0 || y1 >= rows) return;
    const a = byId.get(nodeIdAt(x0, y0, columns));
    const b = byId.get(nodeIdAt(x1, y1, columns));
    const key = bondKey(a.id, b.id);
    if (pairs.has(key) || shouldSkipNotchBond(a, b, notch)) return;
    pairs.add(key);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rest = Math.hypot(dx, dy);
    const role = geometryRoleForBond(a, b, notch);
    const seamWeakness = role === 'notch-bridge' ? 0.52 : role === 'notch-shoulder' ? 0.72 : 1;
    bonds.push({
      id: `b${bonds.length}`,
      a: a.id,
      b: b.id,
      rest: round(rest),
      direction: { x: round(dx / rest), y: round(dy / rest) },
      midpoint: { x: round((a.x + b.x) * 0.5), y: round((a.y + b.y) * 0.5) },
      strength: round(1.55 * seamWeakness),
      stiffness: role === 'notch-bridge' ? 0.84 : 1,
      geometryRole: role,
      alive: true,
      repaired: false,
      lastStress: 0,
      lastStrain: 0,
      cause: null,
    });
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      addBond(x, y, x + 1, y);
      addBond(x, y, x, y + 1);
      addBond(x, y, x + 1, y + 1);
      addBond(x + 1, y, x, y + 1);
    }
  }
  const initial = {
    schema: STRUCTURAL_MATERIAL_SCHEMA,
    route: STRUCTURAL_MATERIAL_ROUTE,
    solverAuthority: STRUCTURAL_MATERIAL_SOLVER_AUTHORITY,
    geometryAuthority: notch ? STRUCTURAL_MATERIAL_GEOMETRY_AUTHORITY : 'uniform-proxy-plane-control-v0',
    soundAuthority: STRUCTURAL_MATERIAL_SOUND_AUTHORITY,
    topologyEpoch: 0,
    connectivityEpoch: 0,
    columns,
    rows,
    nodes,
    bonds,
    components: [],
    appliedInteractions: [],
    sound: buildSound([], 0, 0),
  };
  return finalizeState(initial);
}

function stressForBond(bond, interaction) {
  const direction = normalizedVector(interaction.vector);
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const radius = clamp(interaction.radius, 0.06, 0.8);
  const point = interaction.point || { x: 0.9, y: 0.5 };
  const axial = Math.abs(bond.direction.x * direction.x + bond.direction.y * direction.y);
  const xLoad = 0.18 + bond.midpoint.x * 0.82;
  const gripDy = bond.midpoint.y - clamp(point.y, 0, 1);
  const grip = 0.32 + 0.68 * Math.exp(-(gripDy * gripDy) / (2 * radius * radius));
  const notchDistance = Math.hypot(bond.midpoint.x - 0.5, bond.midpoint.y - 0.5);
  const notchBoost = bond.geometryRole === 'notch-bridge'
    ? 1.0 + 2.05 * Math.exp(-(notchDistance * notchDistance) / (2 * 0.18 * 0.18))
    : bond.geometryRole === 'notch-shoulder'
      ? 1.0 + 0.55 * Math.exp(-(notchDistance * notchDistance) / (2 * 0.22 * 0.22))
      : 1;
  const shear = Math.abs(bond.direction.x * direction.y - bond.direction.y * direction.x);
  return magnitude * (0.22 + 0.78 * axial + 0.18 * shear) * xLoad * grip * notchBoost;
}

export function applyStructuralMaterialInteraction(state, interaction = {}, options = {}) {
  let next = cloneState(state);
  const steps = Math.max(1, Math.floor(finite(options.steps, 1)));
  const direction = normalizedVector(interaction.vector);
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const events = [...next.sound.events];
  for (let step = 0; step < steps; step += 1) {
    next.bonds = next.bonds.map(bond => {
      if (!bond.alive) return bond;
      const stress = stressForBond(bond, interaction);
      const strain = stress / Math.max(0.001, bond.stiffness);
      const shouldBreak = strain > bond.strength;
      if (!shouldBreak) {
        return { ...bond, lastStress: round(stress), lastStrain: round(strain) };
      }
      events.push({
        kind: 'crack',
        bondId: bond.id,
        geometryRole: bond.geometryRole,
        cause: 'stress-threshold',
        stress: round(stress),
        strain: round(strain),
        energy: round((strain - bond.strength) * bond.rest * 0.85),
        midpoint: { ...bond.midpoint },
        step,
      });
      return {
        ...bond,
        alive: false,
        cause: 'stress-threshold',
        lastStress: round(stress),
        lastStrain: round(strain),
      };
    });
  }
  next = {
    ...next,
    topologyEpoch: next.topologyEpoch + (events.length > next.sound.events.length ? 1 : 0),
    connectivityEpoch: next.connectivityEpoch + (events.length > next.sound.events.length ? 1 : 0),
    appliedInteractions: [...next.appliedInteractions, {
      kind: interaction.kind || 'screen-space-force',
      point: { x: round(interaction.point?.x ?? 0.9), y: round(interaction.point?.y ?? 0.5) },
      vector: { x: round(direction.x), y: round(direction.y) },
      magnitude: round(magnitude),
      radius: round(interaction.radius ?? 0.2),
      steps,
    }],
    sound: { ...next.sound, events },
  };
  return finalizeState(next, direction, magnitude);
}

export function bindStructuralMaterialConnectivity(state, binding = {}) {
  let next = cloneState(state);
  const point = binding.point || { x: 0.5, y: 0.5 };
  const radius = clamp(binding.radius, 0.03, 0.5);
  const strength = clamp(binding.strength, 0.2, 4);
  const events = [...next.sound.events];
  let repaired = 0;
  next.bonds = next.bonds.map(bond => {
    if (bond.alive) return bond;
    const d = Math.hypot(bond.midpoint.x - point.x, bond.midpoint.y - point.y);
    if (d > radius) return bond;
    repaired += 1;
    events.push({
      kind: 'bind',
      bondId: bond.id,
      geometryRole: bond.geometryRole,
      cause: 'operator-binding',
      stress: 0,
      strain: 0,
      energy: round((radius - d) * strength * 0.55),
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
  return finalizeState(next, { x: 0, y: 0 }, 0);
}

export function summarizeStructuralMaterialState(state) {
  const broken = state.bonds.filter(bond => !bond.alive);
  const repaired = state.bonds.filter(bond => bond.repaired);
  const maxStress = state.bonds.reduce((max, bond) => Math.max(max, finite(bond.lastStress)), 0);
  const crackPath = broken.map(bond => ({
    bondId: bond.id,
    a: bond.a,
    b: bond.b,
    midpoint: { ...bond.midpoint },
    stress: round(bond.lastStress),
    strain: round(bond.lastStrain),
    cause: bond.cause || 'unknown',
    geometryRole: bond.geometryRole,
  }));
  return {
    schema: STRUCTURAL_MATERIAL_SCHEMA,
    route: STRUCTURAL_MATERIAL_ROUTE,
    solverAuthority: state.solverAuthority,
    geometryAuthority: state.geometryAuthority,
    soundAuthority: state.soundAuthority,
    nodeCount: state.nodes.length,
    bondCount: state.bonds.length,
    brokenBondCount: broken.length,
    repairedBondCount: repaired.length,
    componentCount: state.components.length,
    maxStress: round(maxStress),
    maxComponentSeparation: maxComponentSeparation(state.components),
    crackPath,
    sound: {
      impulseEnergy: state.sound.impulseEnergy,
      brightness: state.sound.brightness,
      roughness: state.sound.roughness,
      signature: state.sound.signature,
      eventCount: state.sound.events.length,
    },
  };
}

function svgEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function renderStructuralMaterialSvg(state, options = {}) {
  const width = Math.max(360, Math.floor(finite(options.width, 720)));
  const height = Math.max(240, Math.floor(finite(options.height, 420)));
  const pad = 48;
  const scaleX = width - pad * 2;
  const scaleY = height - pad * 2;
  const nodeById = new Map(state.nodes.map(node => [node.id, node]));
  const point = (node) => ({
    x: pad + (node.x + node.displacement.x) * scaleX,
    y: pad + (node.y + node.displacement.y) * scaleY,
  });
  const maxStress = Math.max(0.001, ...state.bonds.map(bond => finite(bond.lastStress)));
  const lines = state.bonds.map(bond => {
    const a = point(nodeById.get(bond.a));
    const b = point(nodeById.get(bond.b));
    const stress = clamp(bond.lastStress / maxStress, 0, 1);
    const color = bond.alive
      ? `rgb(${Math.round(40 + stress * 210)},${Math.round(120 - stress * 70)},${Math.round(160 - stress * 100)})`
      : '#ff4a2f';
    const dash = bond.alive ? '' : ' stroke-dasharray="7 5"';
    const widthStroke = bond.alive ? 1.2 + stress * 3.0 : 4.4;
    return `<line x1="${round(a.x, 2)}" y1="${round(a.y, 2)}" x2="${round(b.x, 2)}" y2="${round(b.y, 2)}" stroke="${color}" stroke-width="${round(widthStroke, 2)}" stroke-linecap="round"${dash}/>`;
  });
  const nodes = state.nodes.map(node => {
    const p = point(node);
    const fill = node.pinned ? '#283044' : node.componentId === 'c0' ? '#f7f2df' : '#fff8b8';
    return `<circle cx="${round(p.x, 2)}" cy="${round(p.y, 2)}" r="${node.pinned ? 4.5 : 3.2}" fill="${fill}" stroke="#20202a" stroke-width="1"/>`;
  });
  const summary = summarizeStructuralMaterialState(state);
  const title = svgEscape(options.title || 'Structural material proxy');
  const subtitle = svgEscape(`broken ${summary.brokenBondCount} | components ${summary.componentCount} | sound ${summary.sound.signature}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#10131a"/>
  <text x="24" y="28" fill="#f7f2df" font-family="ui-monospace, Menlo, monospace" font-size="16">${title}</text>
  <text x="24" y="${height - 18}" fill="#9fb4c7" font-family="ui-monospace, Menlo, monospace" font-size="12">${subtitle}</text>
  <g>${lines.join('\n')}</g>
  <g>${nodes.join('\n')}</g>
</svg>`;
}

export function buildStructuralMaterialWitnessScenario(options = {}) {
  const force = {
    kind: 'screen-space-hand-drag',
    point: { x: 0.94, y: finite(options.forceY, 0.5) },
    vector: { x: 1, y: finite(options.forceSkewY, 0.05) },
    magnitude: finite(options.magnitude, 1.35),
    radius: finite(options.radius, 0.24),
  };
  const notched = createStructuralMaterialProxyPlane({ columns: 13, rows: 7, notch: true });
  const control = createStructuralMaterialProxyPlane({ columns: 13, rows: 7, notch: false });
  const cracked = applyStructuralMaterialInteraction(notched, force, { steps: 3 });
  const controlAfter = applyStructuralMaterialInteraction(control, force, { steps: 3 });
  const crackPoint = summarizeStructuralMaterialState(cracked).crackPath[0]?.midpoint || { x: 0.5, y: 0.5 };
  const bound = bindStructuralMaterialConnectivity(cracked, { point: crackPoint, radius: 0.18, strength: 1.2 });
  return {
    schema: STRUCTURAL_MATERIAL_SCHEMA,
    requestedRoute: STRUCTURAL_MATERIAL_ROUTE,
    effectiveRoute: STRUCTURAL_MATERIAL_ROUTE,
    solverAuthority: STRUCTURAL_MATERIAL_SOLVER_AUTHORITY,
    geometryAuthority: STRUCTURAL_MATERIAL_GEOMETRY_AUTHORITY,
    force,
    states: {
      initial: notched,
      cracked,
      control: controlAfter,
      bound,
    },
    summaries: {
      initial: summarizeStructuralMaterialState(notched),
      cracked: summarizeStructuralMaterialState(cracked),
      control: summarizeStructuralMaterialState(controlAfter),
      bound: summarizeStructuralMaterialState(bound),
    },
  };
}
