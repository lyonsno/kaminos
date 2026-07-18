import { STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE } from './structural-material-3d-webgpu-core.js';

export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE =
  'kaminos.structural-material.webgpu-resident-compliant-jacobi.v0';
export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY =
  'retained-webgpu-node-displacement-live-bond-constraints-v0';
export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SCHEMA =
  'kaminos.structural-material.resident-compliant-jacobi-receipt.v0';
export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_INTERACTION_BYTES = 64;
export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ITERATIONS = 12;

const DEFAULT_CONFIG = Object.freeze({
  iterationCount: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ITERATIONS,
  relaxation: 0.72,
  stiffnessScale: 0.42,
  maximumCorrection: 0.045,
  maximumContactTravel: 0.42,
});

export const STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER = /* wgsl */ `
struct NodeRecord {
  position: vec4<f32>,
  displacement: vec4<f32>,
}

struct BondRecord {
  endpoints: vec4<u32>,
  direction: vec4<f32>,
  midpoint: vec4<f32>,
  material: vec4<f32>,
  prior: vec4<f32>,
}

struct SolverInteraction {
  contactTarget: vec4<f32>,
  counts: vec4<u32>,
  parameters: vec4<f32>,
  identity: vec4<u32>,
}

@group(0) @binding(0) var<storage, read> sourceNodes: array<NodeRecord>;
@group(0) @binding(1) var<storage, read_write> targetNodes: array<NodeRecord>;
@group(0) @binding(2) var<storage, read> bonds: array<BondRecord>;
@group(0) @binding(3) var<storage, read> componentLabels: array<u32>;
@group(0) @binding(4) var<uniform> interaction: SolverInteraction;

@compute @workgroup_size(${STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let nodeIndex = globalId.x;
  if (nodeIndex >= interaction.counts.x) {
    return;
  }

  var source = sourceNodes[nodeIndex];
  let contactIndex = interaction.counts.z;
  if (nodeIndex == contactIndex) {
    source.displacement = vec4<f32>(interaction.contactTarget.xyz, source.displacement.w);
    targetNodes[nodeIndex] = source;
    return;
  }
  if (source.position.w >= 0.5) {
    source.displacement = vec4<f32>(0.0, 0.0, 0.0, source.displacement.w);
    targetNodes[nodeIndex] = source;
    return;
  }
  if (componentLabels[nodeIndex] != componentLabels[contactIndex]) {
    targetNodes[nodeIndex] = source;
    return;
  }

  let currentPosition = source.position.xyz + source.displacement.xyz;
  var correction = vec3<f32>(0.0);
  var incidentCount = 0.0;
  for (var bondIndex = 0u; bondIndex < interaction.counts.y; bondIndex += 1u) {
    let bond = bonds[bondIndex];
    if (bond.material.w < 0.5) {
      continue;
    }
    let isA = bond.endpoints.x == nodeIndex;
    let isB = bond.endpoints.y == nodeIndex;
    if (!isA && !isB) {
      continue;
    }
    let neighborIndex = select(bond.endpoints.x, bond.endpoints.y, isA);
    let neighbor = sourceNodes[neighborIndex];
    let neighborPosition = neighbor.position.xyz + neighbor.displacement.xyz;
    let delta = neighborPosition - currentPosition;
    let currentLength = length(delta);
    if (currentLength < 0.000001) {
      continue;
    }
    let extension = currentLength - bond.material.x;
    let stiffnessWeight = 1.0 - exp(-max(0.0, bond.material.z) * interaction.parameters.y);
    correction += normalize(delta) * extension * 0.5 * stiffnessWeight;
    incidentCount += 1.0;
  }

  if (incidentCount > 0.0) {
    correction = correction / incidentCount;
    let correctionLength = length(correction);
    if (correctionLength > interaction.parameters.z) {
      correction *= interaction.parameters.z / correctionLength;
    }
    source.displacement = vec4<f32>(
      source.displacement.xyz + correction * interaction.parameters.x,
      source.displacement.w,
    );
  }
  targetNodes[nodeIndex] = source;
}
`;

export const STRUCTURAL_MATERIAL_3D_SOLVED_FRACTURE_SHADER = /* wgsl */ `
struct NodeRecord {
  position: vec4<f32>,
  displacement: vec4<f32>,
}

struct BondRecord {
  endpoints: vec4<u32>,
  direction: vec4<f32>,
  midpoint: vec4<f32>,
  material: vec4<f32>,
  prior: vec4<f32>,
}

struct Interaction {
  directionMagnitude: vec4<f32>,
  pointRadius: vec4<f32>,
  counts: vec4<u32>,
}

struct BondResponse {
  metrics: vec4<f32>,
  identity: vec4<u32>,
}

struct EventHeader {
  count: atomic<u32>,
  overflow: atomic<u32>,
  reserved0: u32,
  reserved1: u32,
}

struct CrackEvent {
  identity: vec4<u32>,
  metrics: vec4<f32>,
  midpoint: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> nodes: array<NodeRecord>;
@group(0) @binding(1) var<storage, read_write> bonds: array<BondRecord>;
@group(0) @binding(2) var<uniform> interaction: Interaction;
@group(0) @binding(3) var<storage, read_write> responses: array<BondResponse>;
@group(0) @binding(4) var<storage, read_write> eventHeader: EventHeader;
@group(0) @binding(5) var<storage, read_write> events: array<CrackEvent>;

@compute @workgroup_size(${STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let bondIndex = globalId.x;
  if (bondIndex >= interaction.counts.x) {
    return;
  }

  var bond = bonds[bondIndex];
  if (bond.material.w < 0.5) {
    responses[bondIndex].metrics = vec4<f32>(bond.prior.x, bond.prior.y, 0.0, 0.0);
    responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 0u);
    return;
  }

  let a = nodes[bond.endpoints.x];
  let b = nodes[bond.endpoints.y];
  let current = (b.position.xyz + b.displacement.xyz) -
    (a.position.xyz + a.displacement.xyz);
  let currentLength = length(current);
  let safeRest = max(0.000001, bond.material.x);
  let axialStrain = abs(currentLength - safeRest) / safeRest;
  var currentDirection = bond.direction.xyz;
  if (currentLength > 0.000001) {
    currentDirection = current / currentLength;
  }
  let shear = length(cross(currentDirection, bond.direction.xyz));
  let strain = axialStrain + shear * 0.18;
  let stress = strain * bond.material.z;
  let failureStrain = 0.11 + bond.material.y * 0.055;
  let shouldBreak = strain > failureStrain;
  var energy = 0.0;
  if (shouldBreak) {
    energy = (strain - failureStrain) * safeRest * bond.material.z;
  }

  responses[bondIndex].metrics = vec4<f32>(stress, strain, energy, select(0.0, 1.0, shouldBreak));
  responses[bondIndex].identity = vec4<u32>(
    bondIndex,
    bond.endpoints.z,
    bond.endpoints.w,
    select(1u, 0u, shouldBreak),
  );
  bond.prior.x = stress;
  bond.prior.y = strain;
  if (shouldBreak) {
    bond.material.w = 0.0;
    let slot = atomicAdd(&eventHeader.count, 1u);
    if (slot < interaction.counts.y) {
      events[slot].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 1u);
      events[slot].metrics = vec4<f32>(stress, strain, energy, failureStrain);
      events[slot].midpoint = vec4<f32>(bond.midpoint.xyz, bitcast<f32>(interaction.counts.w));
    } else {
      atomicAdd(&eventHeader.overflow, 1u);
    }
  }
  bonds[bondIndex] = bond;
}
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, digits = 9) {
  const scale = 10 ** digits;
  const rounded = Math.round(finite(value) * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizedVector(vector = {}) {
  const x = finite(vector.x, 1);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length < 0.000001) return { x: 1, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function displacementOf(node) {
  return {
    x: finite(node?.displacement?.x),
    y: finite(node?.displacement?.y),
    z: finite(node?.displacement?.z),
  };
}

function nodePosition(node, displacement = displacementOf(node)) {
  return {
    x: finite(node.x) + displacement.x,
    y: finite(node.y) + displacement.y,
    z: finite(node.z) + displacement.z,
  };
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function deriveLayeredStructuralAliveComponentLabels(state) {
  if (!state?.nodes?.length || !state?.bonds) {
    throw new Error('resident solver component labels require structural nodes and bonds');
  }
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const adjacency = state.nodes.map(() => []);
  for (const bond of state.bonds) {
    if (!bond.alive) continue;
    const a = nodeIndexById.get(bond.a);
    const b = nodeIndexById.get(bond.b);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`resident solver cannot resolve bond endpoints: ${bond.id}`);
    }
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const labels = new Array(state.nodes.length).fill(-1);
  for (let start = 0; start < state.nodes.length; start += 1) {
    if (labels[start] >= 0) continue;
    const stack = [start];
    const component = [];
    labels[start] = start;
    while (stack.length > 0) {
      const index = stack.pop();
      component.push(index);
      for (const neighbor of adjacency[index]) {
        if (labels[neighbor] >= 0) continue;
        labels[neighbor] = start;
        stack.push(neighbor);
      }
    }
    const label = Math.min(...component);
    component.forEach(index => {
      labels[index] = label;
    });
  }
  return labels;
}

export function resolveLayeredStructuralSolverContact(state, interaction = {}) {
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const identity = interaction.contactIdentity;
  if (identity?.kind === 'node') {
    const index = nodeIndexById.get(identity.id);
    if (!Number.isInteger(index)) throw new Error('resident solver received an unknown node contact');
    return { primaryNodeIndex: index, primaryNodeId: state.nodes[index].id, kind: 'node' };
  }
  if (identity?.kind === 'bond') {
    const bond = state.bonds.find(candidate => candidate.id === identity.id);
    if (!bond) throw new Error('resident solver received an unknown bond contact');
    const segmentT = clamp(identity.segmentT ?? 0.5, 0, 1);
    const id = segmentT <= 0.5 ? bond.a : bond.b;
    const index = nodeIndexById.get(id);
    if (!Number.isInteger(index)) throw new Error('resident solver cannot resolve bond contact endpoint');
    return { primaryNodeIndex: index, primaryNodeId: id, kind: 'bond', segmentT };
  }

  const point = {
    x: finite(interaction.point?.x, 0.5),
    y: finite(interaction.point?.y, 0.5),
    z: finite(interaction.point?.z, 0.5),
  };
  let primaryNodeIndex = 0;
  let nearestDistance = Infinity;
  state.nodes.forEach((node, index) => {
    const distance = Math.hypot(node.x - point.x, node.y - point.y, node.z - point.z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      primaryNodeIndex = index;
    }
  });
  return {
    primaryNodeIndex,
    primaryNodeId: state.nodes[primaryNodeIndex].id,
    kind: 'nearest-node-fallback',
  };
}

export function normalizeLayeredStructuralResidentSolverConfig(options = {}) {
  let iterationCount = Math.max(2, Math.floor(finite(
    options.iterationCount,
    DEFAULT_CONFIG.iterationCount,
  )));
  if (iterationCount % 2 !== 0) iterationCount += 1;
  return {
    iterationCount,
    relaxation: clamp(options.relaxation ?? DEFAULT_CONFIG.relaxation, 0.05, 1),
    stiffnessScale: clamp(options.stiffnessScale ?? DEFAULT_CONFIG.stiffnessScale, 0.01, 2),
    maximumCorrection: clamp(
      options.maximumCorrection ?? DEFAULT_CONFIG.maximumCorrection,
      0.001,
      0.2,
    ),
    maximumContactTravel: clamp(
      options.maximumContactTravel ?? DEFAULT_CONFIG.maximumContactTravel,
      0.01,
      1,
    ),
  };
}

export function buildLayeredStructuralResidentSolverInteraction(
  state,
  interaction = {},
  options = {},
) {
  const config = normalizeLayeredStructuralResidentSolverConfig(options);
  const contact = resolveLayeredStructuralSolverContact(state, interaction);
  const direction = normalizedVector(interaction.vector);
  const baselineDisplacements = Array.isArray(options.baselineDisplacements) &&
    options.baselineDisplacements.length === state.nodes.length
    ? options.baselineDisplacements.map(displacement => ({
        x: finite(displacement?.x),
        y: finite(displacement?.y),
        z: finite(displacement?.z),
      }))
    : state.nodes.map(displacementOf);
  const visualTravel = Number.isFinite(interaction.dragLength)
    ? interaction.dragLength
    : Number.isFinite(interaction.visualEnd?.x) && Number.isFinite(interaction.displayPoint?.x)
      ? distance3(interaction.visualEnd, interaction.displayPoint)
      : clamp(interaction.magnitude, 0, 5) * 0.115;
  const contactTravel = clamp(visualTravel, 0, config.maximumContactTravel);
  const baseline = baselineDisplacements[contact.primaryNodeIndex];
  const target = {
    x: round(baseline.x + direction.x * contactTravel),
    y: round(baseline.y + direction.y * contactTravel),
    z: round(baseline.z + direction.z * contactTravel),
  };
  return {
    schema: 'kaminos.structural-material.resident-solver-interaction.v0',
    route: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
    authority: 'gesture-baseline-to-absolute-structural-contact-target-v0',
    gestureId: interaction.gestureId == null ? null : String(interaction.gestureId),
    contact,
    contactNodeIndices: [contact.primaryNodeIndex],
    contactNodeIds: [contact.primaryNodeId],
    contactTargetDisplacements: [target],
    baselineDisplacements,
    direction,
    contactTravel: round(contactTravel),
    config,
  };
}

export function packLayeredStructuralResidentSolverInteraction(
  state,
  solverInteraction,
  identity = {},
) {
  const data = new ArrayBuffer(STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_INTERACTION_BYTES);
  const view = new DataView(data);
  const target = solverInteraction.contactTargetDisplacements[0];
  const config = solverInteraction.config;
  view.setFloat32(0, target.x, true);
  view.setFloat32(4, target.y, true);
  view.setFloat32(8, target.z, true);
  view.setFloat32(12, solverInteraction.contactTravel, true);
  view.setUint32(16, state.nodes.length, true);
  view.setUint32(20, state.bonds.length, true);
  view.setUint32(24, solverInteraction.contact.primaryNodeIndex, true);
  view.setUint32(28, config.iterationCount, true);
  view.setFloat32(32, config.relaxation, true);
  view.setFloat32(36, config.stiffnessScale, true);
  view.setFloat32(40, config.maximumCorrection, true);
  view.setFloat32(44, config.maximumContactTravel, true);
  view.setUint32(48, Math.max(0, Math.floor(finite(identity.eventEpoch))), true);
  view.setUint32(52, Math.max(0, Math.floor(finite(identity.solverGeneration))), true);
  view.setUint32(56, Math.max(0, Math.floor(finite(state.topologyEpoch))), true);
  view.setUint32(60, Math.max(0, Math.floor(finite(state.connectivityEpoch))), true);
  return data;
}

export function parseLayeredStructuralResidentSolverNodes(buffer, state) {
  const expectedBytes = state.nodes.length * 32;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== expectedBytes) {
    throw new Error('resident solver node readback length mismatch');
  }
  const view = new DataView(buffer);
  return state.nodes.map((node, index) => {
    const offset = index * 32;
    return {
      ...node,
      displacement: {
        x: view.getFloat32(offset + 16, true),
        y: view.getFloat32(offset + 20, true),
        z: view.getFloat32(offset + 24, true),
      },
    };
  });
}

function constraintMetrics(state, displacements) {
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const bondResponses = [];
  for (let bondIndex = 0; bondIndex < state.bonds.length; bondIndex += 1) {
    const bond = state.bonds[bondIndex];
    const aIndex = nodeIndexById.get(bond.a);
    const bIndex = nodeIndexById.get(bond.b);
    const a = nodePosition(state.nodes[aIndex], displacements[aIndex]);
    const b = nodePosition(state.nodes[bIndex], displacements[bIndex]);
    const currentLength = distance3(a, b);
    const residual = Math.abs(currentLength - bond.rest);
    const axialStrain = residual / Math.max(0.000001, bond.rest);
    const currentDirection = currentLength > 0.000001
      ? { x: (b.x - a.x) / currentLength, y: (b.y - a.y) / currentLength, z: (b.z - a.z) / currentLength }
      : { x: 0, y: 0, z: 0 };
    const shear = Math.hypot(
      currentDirection.y * finite(bond.direction?.z) - currentDirection.z * finite(bond.direction?.y),
      currentDirection.z * finite(bond.direction?.x) - currentDirection.x * finite(bond.direction?.z),
      currentDirection.x * finite(bond.direction?.y) - currentDirection.y * finite(bond.direction?.x),
    );
    const strain = axialStrain + shear * 0.18;
    bondResponses.push({
      bondIndex,
      bondId: bond.id,
      alive: Boolean(bond.alive),
      currentLength: round(currentLength),
      residual: round(residual),
      strain: round(strain),
      stress: round(strain * finite(bond.stiffness, 1)),
    });
  }
  const live = bondResponses.filter(response => response.alive);
  return {
    bondResponses,
    maxConstraintResidual: round(Math.max(0, ...live.map(response => response.residual))),
    meanConstraintResidual: round(
      live.reduce((sum, response) => sum + response.residual, 0) / Math.max(1, live.length),
    ),
    maxSolvedStrain: round(Math.max(0, ...live.map(response => response.strain))),
  };
}

export function summarizeLayeredStructuralSolvedNodes(state, nodes, solverInteraction) {
  const displacements = nodes.map(displacementOf);
  const metrics = constraintMetrics(state, displacements);
  const contactIndex = solverInteraction.contact.primaryNodeIndex;
  const contactLabel = deriveLayeredStructuralAliveComponentLabels(state)[contactIndex];
  const labels = deriveLayeredStructuralAliveComponentLabels(state);
  const nonPrimaryCurrentResponse = Math.max(0, ...nodes.map((node, index) => {
    if (labels[index] === contactLabel) return 0;
    const baseline = solverInteraction.baselineDisplacements[index];
    return Math.hypot(
      node.displacement.x - baseline.x,
      node.displacement.y - baseline.y,
      node.displacement.z - baseline.z,
    );
  }));
  return {
    ...metrics,
    movedNodeCount: nodes.filter((node, index) => {
      const baseline = solverInteraction.baselineDisplacements[index];
      return Math.hypot(
        node.displacement.x - baseline.x,
        node.displacement.y - baseline.y,
        node.displacement.z - baseline.z,
      ) > 0.000001;
    }).length,
    maxPinnedDisplacement: round(Math.max(0, ...nodes
      .filter((node, index) => node.pinned && index !== contactIndex)
      .map(node => Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z)))),
    nonPrimaryCurrentResponse: round(nonPrimaryCurrentResponse),
    contactTargetError: round(distance3(
      nodes[contactIndex].displacement,
      solverInteraction.contactTargetDisplacements[0],
    )),
  };
}

export function solveLayeredStructuralCpuConstraints(state, solverInteraction, options = {}) {
  if (!state?.nodes?.length || !state?.bonds?.length) {
    throw new Error('resident solver requires nonempty structural state');
  }
  if (solverInteraction?.route !== STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE) {
    throw new Error('resident solver interaction route mismatch');
  }
  const config = normalizeLayeredStructuralResidentSolverConfig({
    ...solverInteraction.config,
    ...options,
  });
  const labels = deriveLayeredStructuralAliveComponentLabels(state);
  const contactIndex = solverInteraction.contact.primaryNodeIndex;
  const contactLabel = labels[contactIndex];
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  let displacements = state.nodes.map(displacementOf);
  const iterations = [];

  for (let iteration = 0; iteration < config.iterationCount; iteration += 1) {
    const source = displacements;
    const target = source.map(displacement => ({ ...displacement }));
    let maxCorrection = 0;
    for (let nodeIndex = 0; nodeIndex < state.nodes.length; nodeIndex += 1) {
      const node = state.nodes[nodeIndex];
      if (nodeIndex === contactIndex) {
        target[nodeIndex] = { ...solverInteraction.contactTargetDisplacements[0] };
      } else if (node.pinned) {
        target[nodeIndex] = { x: 0, y: 0, z: 0 };
      } else if (labels[nodeIndex] === contactLabel) {
        const current = nodePosition(node, source[nodeIndex]);
        const correction = { x: 0, y: 0, z: 0 };
        let incidentCount = 0;
        for (const bond of state.bonds) {
          if (!bond.alive || bond.a !== node.id && bond.b !== node.id) continue;
          const neighborId = bond.a === node.id ? bond.b : bond.a;
          const neighborIndex = nodeIndexById.get(neighborId);
          const neighbor = nodePosition(state.nodes[neighborIndex], source[neighborIndex]);
          const dx = neighbor.x - current.x;
          const dy = neighbor.y - current.y;
          const dz = neighbor.z - current.z;
          const length = Math.hypot(dx, dy, dz);
          if (length < 0.000001) continue;
          const extension = length - bond.rest;
          const stiffnessWeight = 1 - Math.exp(-Math.max(0, finite(bond.stiffness, 1)) * config.stiffnessScale);
          correction.x += dx / length * extension * 0.5 * stiffnessWeight;
          correction.y += dy / length * extension * 0.5 * stiffnessWeight;
          correction.z += dz / length * extension * 0.5 * stiffnessWeight;
          incidentCount += 1;
        }
        if (incidentCount > 0) {
          correction.x /= incidentCount;
          correction.y /= incidentCount;
          correction.z /= incidentCount;
          const length = Math.hypot(correction.x, correction.y, correction.z);
          if (length > config.maximumCorrection) {
            const scale = config.maximumCorrection / length;
            correction.x *= scale;
            correction.y *= scale;
            correction.z *= scale;
          }
          target[nodeIndex] = {
            x: source[nodeIndex].x + correction.x * config.relaxation,
            y: source[nodeIndex].y + correction.y * config.relaxation,
            z: source[nodeIndex].z + correction.z * config.relaxation,
          };
        }
      }
      maxCorrection = Math.max(maxCorrection, distance3(target[nodeIndex], source[nodeIndex]));
    }
    displacements = target;
    const residuals = constraintMetrics(state, displacements);
    iterations.push({
      iteration: iteration + 1,
      maxCorrection: round(maxCorrection),
      maxConstraintResidual: residuals.maxConstraintResidual,
      meanConstraintResidual: residuals.meanConstraintResidual,
    });
  }

  const nodes = state.nodes.map((node, index) => ({
    ...node,
    displacement: {
      x: round(displacements[index].x),
      y: round(displacements[index].y),
      z: round(displacements[index].z),
    },
  }));
  return {
    schema: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SCHEMA,
    status: 'passed',
    route: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
    authority: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
    iterationCount: config.iterationCount,
    config,
    contact: { ...solverInteraction.contact },
    nodes,
    iterations,
    metrics: summarizeLayeredStructuralSolvedNodes(state, nodes, solverInteraction),
  };
}
