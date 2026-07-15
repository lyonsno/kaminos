import { evaluateLayeredStructuralBondResponse } from './structural-material-3d-core.js';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_ABI = 'kaminos.structural-material.packed-bond-abi.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE = 'kaminos.structural-material.webgpu-bond-response-parity.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_SOLVER_AUTHORITY = 'webgpu-compute-bond-response-fracture-candidates-v0';
export const STRUCTURAL_MATERIAL_3D_CPU_ORACLE_AUTHORITY = 'deterministic-layered-bond-response-cpu-oracle-v0';

const WORKGROUP_SIZE = 64;
const NODE_STRIDE_BYTES = 32;
const BOND_STRIDE_BYTES = 80;
const RESPONSE_STRIDE_BYTES = 32;
const EVENT_STRIDE_BYTES = 48;
const EVENT_HEADER_BYTES = 16;
const INTERACTION_BYTES = 48;

const GEOMETRY_ROLE_CODES = Object.freeze({
  body: 0,
  skin: 1,
  'depth-tie': 2,
  'notch-depth-tie': 3,
  'notch-bridge': 4,
  'notch-shoulder': 5,
});
const GEOMETRY_ROLES_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(GEOMETRY_ROLE_CODES).map(([role, code]) => [code, role]),
));

const GPU_LAYOUT = Object.freeze({
  abi: STRUCTURAL_MATERIAL_3D_WEBGPU_ABI,
  workgroupSize: WORKGROUP_SIZE,
  nodeStrideBytes: NODE_STRIDE_BYTES,
  bondStrideBytes: BOND_STRIDE_BYTES,
  responseStrideBytes: RESPONSE_STRIDE_BYTES,
  eventStrideBytes: EVENT_STRIDE_BYTES,
  eventHeaderBytes: EVENT_HEADER_BYTES,
  interactionBytes: INTERACTION_BYTES,
  nodeFields: ['position3', 'pinned', 'displacement3', 'componentOrdinal'],
  bondFields: ['endpointIndices', 'bondKind', 'geometryRole', 'direction3', 'midpoint3', 'rest', 'strength', 'stiffness', 'alive', 'lastStress', 'lastStrain', 'repaired'],
  responseFields: ['stress', 'strain', 'energy', 'shouldBreak', 'bondIndex', 'bondKind', 'geometryRole', 'nextAlive'],
  eventFields: ['bondIndex', 'bondKind', 'geometryRole', 'cause', 'stress', 'strain', 'energy', 'midpoint3'],
});

const COMPUTE_SHADER = /* wgsl */ `
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
@group(0) @binding(1) var<storage, read> bonds: array<BondRecord>;
@group(0) @binding(2) var<uniform> interaction: Interaction;
@group(0) @binding(3) var<storage, read_write> responses: array<BondResponse>;
@group(0) @binding(4) var<storage, read_write> eventHeader: EventHeader;
@group(0) @binding(5) var<storage, read_write> events: array<CrackEvent>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let bondIndex = globalId.x;
  if (bondIndex >= interaction.counts.x) {
    return;
  }

  let bond = bonds[bondIndex];
  let alive = bond.material.w >= 0.5;
  if (!alive) {
    responses[bondIndex].metrics = vec4<f32>(bond.prior.x, bond.prior.y, 0.0, 0.0);
    responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 0u);
    return;
  }

  let forceDirection = interaction.directionMagnitude.xyz;
  let magnitude = interaction.directionMagnitude.w;
  let point = interaction.pointRadius.xyz;
  let radius = interaction.pointRadius.w;
  let direction = bond.direction.xyz;
  let nodeMidpoint = (nodes[bond.endpoints.x].position.xyz + nodes[bond.endpoints.y].position.xyz) * 0.5;
  let axial = abs(dot(direction, forceDirection));
  let shear = length(cross(direction, forceDirection));
  let xLoad = 0.18 + nodeMidpoint.x * 0.86;
  let dy = nodeMidpoint.y - point.y;
  let dz = nodeMidpoint.z - point.z;
  let grip = 0.28 + 0.72 * exp(-(dy * dy + dz * dz * 0.72) / (2.0 * radius * radius));
  let notchDelta = nodeMidpoint.xy - vec2<f32>(0.5, 0.5);
  let notchDistanceSquared = dot(notchDelta, notchDelta);

  var notchBoost = 1.0;
  if (bond.endpoints.w == 3u) {
    notchBoost = 1.0 + 2.35 * exp(-notchDistanceSquared / (2.0 * 0.19 * 0.19));
  } else if (bond.endpoints.w == 4u) {
    notchBoost = 1.0 + 2.05 * exp(-notchDistanceSquared / (2.0 * 0.18 * 0.18));
  } else if (bond.endpoints.w == 5u) {
    notchBoost = 1.0 + 0.62 * exp(-notchDistanceSquared / (2.0 * 0.24 * 0.24));
  }

  var depthShear = abs(forceDirection.z) * 0.12;
  if (bond.endpoints.z == 1u) {
    depthShear = abs(forceDirection.z) * 0.48 + shear * 0.22;
  }
  var contactRamp = 1.0;
  if (magnitude < 0.45) {
    contactRamp = clamp(magnitude / 0.45, 0.0, 1.0) * 0.52;
  }

  let stress = magnitude * contactRamp * (0.18 + 0.78 * axial + 0.35 * shear + depthShear) * xLoad * grip * notchBoost;
  let strain = stress / max(0.001, bond.material.z);
  let shouldBreak = strain > bond.material.y;
  var energy = 0.0;
  if (shouldBreak) {
    var energyScale = 0.86;
    if (bond.endpoints.z == 1u) {
      energyScale = 1.05;
    }
    energy = (strain - bond.material.y) * bond.material.x * energyScale;
  }

  responses[bondIndex].metrics = vec4<f32>(stress, strain, energy, select(0.0, 1.0, shouldBreak));
  responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, select(1u, 0u, shouldBreak));

  if (shouldBreak) {
    let slot = atomicAdd(&eventHeader.count, 1u);
    if (slot < interaction.counts.y) {
      events[slot].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 1u);
      events[slot].metrics = vec4<f32>(stress, strain, energy, 0.0);
      events[slot].midpoint = bond.midpoint;
    } else {
      atomicAdd(&eventHeader.overflow, 1u);
    }
  }
}
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function normalizedVector3(vector = {}) {
  const x = finite(vector.x);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length < 0.000001) return { x: 1, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function normalizedPoint3(point = {}) {
  return {
    x: clamp(point.x ?? 0.9, 0, 1),
    y: clamp(point.y ?? 0.5, 0, 1),
    z: clamp(point.z ?? 0.5, 0, 1),
  };
}

function geometryRoleCode(role) {
  return GEOMETRY_ROLE_CODES[role] ?? GEOMETRY_ROLE_CODES.body;
}

function componentOrdinal(componentId) {
  const match = String(componentId || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function layeredStructuralGpuAbiDescriptor() {
  return {
    ...GPU_LAYOUT,
    nodeFields: [...GPU_LAYOUT.nodeFields],
    bondFields: [...GPU_LAYOUT.bondFields],
    responseFields: [...GPU_LAYOUT.responseFields],
    eventFields: [...GPU_LAYOUT.eventFields],
    geometryRoleCodes: { ...GEOMETRY_ROLE_CODES },
  };
}

export function packLayeredStructuralGpuSnapshot(state, interaction = {}) {
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const nodeData = new ArrayBuffer(state.nodes.length * NODE_STRIDE_BYTES);
  const nodeView = new DataView(nodeData);
  state.nodes.forEach((node, index) => {
    const offset = index * NODE_STRIDE_BYTES;
    nodeView.setFloat32(offset, finite(node.x), true);
    nodeView.setFloat32(offset + 4, finite(node.y), true);
    nodeView.setFloat32(offset + 8, finite(node.z), true);
    nodeView.setFloat32(offset + 12, node.pinned ? 1 : 0, true);
    nodeView.setFloat32(offset + 16, finite(node.displacement?.x), true);
    nodeView.setFloat32(offset + 20, finite(node.displacement?.y), true);
    nodeView.setFloat32(offset + 24, finite(node.displacement?.z), true);
    nodeView.setFloat32(offset + 28, componentOrdinal(node.componentId), true);
  });

  const bondData = new ArrayBuffer(state.bonds.length * BOND_STRIDE_BYTES);
  const bondView = new DataView(bondData);
  state.bonds.forEach((bond, index) => {
    const offset = index * BOND_STRIDE_BYTES;
    bondView.setUint32(offset, nodeIndexById.get(bond.a), true);
    bondView.setUint32(offset + 4, nodeIndexById.get(bond.b), true);
    bondView.setUint32(offset + 8, bond.bondKind === 'depth' ? 1 : 0, true);
    bondView.setUint32(offset + 12, geometryRoleCode(bond.geometryRole), true);
    bondView.setFloat32(offset + 16, finite(bond.direction?.x), true);
    bondView.setFloat32(offset + 20, finite(bond.direction?.y), true);
    bondView.setFloat32(offset + 24, finite(bond.direction?.z), true);
    bondView.setFloat32(offset + 28, 0, true);
    bondView.setFloat32(offset + 32, finite(bond.midpoint?.x), true);
    bondView.setFloat32(offset + 36, finite(bond.midpoint?.y), true);
    bondView.setFloat32(offset + 40, finite(bond.midpoint?.z), true);
    bondView.setFloat32(offset + 44, 0, true);
    bondView.setFloat32(offset + 48, finite(bond.rest), true);
    bondView.setFloat32(offset + 52, finite(bond.strength), true);
    bondView.setFloat32(offset + 56, finite(bond.stiffness, 1), true);
    bondView.setFloat32(offset + 60, bond.alive ? 1 : 0, true);
    bondView.setFloat32(offset + 64, finite(bond.lastStress), true);
    bondView.setFloat32(offset + 68, finite(bond.lastStrain), true);
    bondView.setFloat32(offset + 72, bond.repaired ? 1 : 0, true);
    bondView.setFloat32(offset + 76, 0, true);
  });

  const direction = normalizedVector3(interaction.vector);
  const point = normalizedPoint3(interaction.point);
  const eventCapacity = state.bonds.length;
  const interactionData = new ArrayBuffer(INTERACTION_BYTES);
  const interactionView = new DataView(interactionData);
  interactionView.setFloat32(0, direction.x, true);
  interactionView.setFloat32(4, direction.y, true);
  interactionView.setFloat32(8, direction.z, true);
  interactionView.setFloat32(12, clamp(interaction.magnitude, 0, 5), true);
  interactionView.setFloat32(16, point.x, true);
  interactionView.setFloat32(20, point.y, true);
  interactionView.setFloat32(24, point.z, true);
  interactionView.setFloat32(28, clamp(interaction.radius, 0.06, 0.8), true);
  interactionView.setUint32(32, state.bonds.length, true);
  interactionView.setUint32(36, eventCapacity, true);
  interactionView.setUint32(40, state.nodes.length, true);
  interactionView.setUint32(44, 1, true);

  return {
    abi: STRUCTURAL_MATERIAL_3D_WEBGPU_ABI,
    layout: layeredStructuralGpuAbiDescriptor(),
    nodeCount: state.nodes.length,
    bondCount: state.bonds.length,
    eventCapacity,
    nodeData,
    bondData,
    interactionData,
  };
}

export function buildLayeredStructuralCpuBondOracle(state, interaction = {}) {
  const responses = state.bonds.map((bond, bondIndex) => {
    const response = evaluateLayeredStructuralBondResponse(bond, interaction);
    return {
      bondIndex,
      bondId: bond.id,
      bondKind: bond.bondKind,
      geometryRole: bond.geometryRole,
      stress: response.stress,
      strain: response.strain,
      energy: response.energy,
      shouldBreak: response.shouldBreak,
      nextAlive: response.nextAlive,
    };
  });
  const eventCandidates = responses
    .filter(response => response.shouldBreak)
    .map(response => {
      const bond = state.bonds[response.bondIndex];
      return {
        bondIndex: response.bondIndex,
        bondId: response.bondId,
        bondKind: response.bondKind,
        geometryRole: response.geometryRole,
        cause: 'stress-threshold',
        stress: response.stress,
        strain: response.strain,
        energy: response.energy,
        midpoint: { ...bond.midpoint },
      };
    });
  return {
    authority: STRUCTURAL_MATERIAL_3D_CPU_ORACLE_AUTHORITY,
    responseCount: responses.length,
    eventCandidateCount: eventCandidates.length,
    responses,
    eventCandidates,
  };
}

function sortedBreakSet(responses) {
  return responses.filter(response => response.shouldBreak).map(response => response.bondIndex).sort((a, b) => a - b);
}

function sortedEventSet(events) {
  return events.map(event => event.bondIndex).sort((a, b) => a - b);
}

function sameNumericSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function compareLayeredStructuralGpuParity(cpuOracle, gpuResult, options = {}) {
  const tolerances = {
    stress: finite(options.stressTolerance, 0.0005),
    strain: finite(options.strainTolerance, 0.0005),
    energy: finite(options.energyTolerance, 0.0005),
    midpoint: finite(options.midpointTolerance, 0.00001),
  };
  let maxStressError = 0;
  let maxStrainError = 0;
  let maxEnergyError = 0;
  let numericValuesFinite = true;
  let livenessMatches = cpuOracle.responses.length === gpuResult.responses.length;
  let responseIdentityMatches = cpuOracle.responses.length === gpuResult.responses.length;
  for (let index = 0; index < cpuOracle.responses.length; index += 1) {
    const expected = cpuOracle.responses[index];
    const actual = gpuResult.responses[index];
    if (!actual) {
      maxStressError = Infinity;
      maxStrainError = Infinity;
      maxEnergyError = Infinity;
      numericValuesFinite = false;
      livenessMatches = false;
      responseIdentityMatches = false;
      continue;
    }
    const stressError = Math.abs(expected.stress - actual.stress);
    const strainError = Math.abs(expected.strain - actual.strain);
    const energyError = Math.abs(expected.energy - actual.energy);
    maxStressError = Math.max(maxStressError, stressError);
    maxStrainError = Math.max(maxStrainError, strainError);
    maxEnergyError = Math.max(maxEnergyError, energyError);
    numericValuesFinite = numericValuesFinite && [actual.stress, actual.strain, actual.energy].every(Number.isFinite);
    livenessMatches = livenessMatches && expected.nextAlive === actual.nextAlive;
    responseIdentityMatches = responseIdentityMatches &&
      actual.bondIndex === expected.bondIndex &&
      actual.bondKind === expected.bondKind &&
      actual.geometryRole === expected.geometryRole;
  }

  const cpuBreakSet = sortedBreakSet(cpuOracle.responses);
  const gpuBreakSet = sortedBreakSet(gpuResult.responses);
  const cpuEventSet = sortedEventSet(cpuOracle.eventCandidates);
  const gpuEventSet = sortedEventSet(gpuResult.eventCandidates);
  const breakSetMatches = sameNumericSet(cpuBreakSet, gpuBreakSet);
  const eventSetMatches = sameNumericSet(cpuEventSet, gpuEventSet);
  const responseCountMatches = cpuOracle.responses.length === gpuResult.responses.length;
  const eventOverflowCount = finite(gpuResult.eventOverflowCount);
  let maxEventStressError = 0;
  let maxEventStrainError = 0;
  let maxEventEnergyError = 0;
  let maxEventMidpointError = 0;
  let eventPayloadMatches = eventSetMatches;
  const gpuEventByBond = new Map(gpuResult.eventCandidates.map(event => [event.bondIndex, event]));
  for (const expected of cpuOracle.eventCandidates) {
    const actual = gpuEventByBond.get(expected.bondIndex);
    if (!actual) {
      eventPayloadMatches = false;
      maxEventStressError = Infinity;
      maxEventStrainError = Infinity;
      maxEventEnergyError = Infinity;
      maxEventMidpointError = Infinity;
      continue;
    }
    maxEventStressError = Math.max(maxEventStressError, Math.abs(expected.stress - actual.stress));
    maxEventStrainError = Math.max(maxEventStrainError, Math.abs(expected.strain - actual.strain));
    maxEventEnergyError = Math.max(maxEventEnergyError, Math.abs(expected.energy - actual.energy));
    maxEventMidpointError = Math.max(
      maxEventMidpointError,
      Math.abs(expected.midpoint.x - actual.midpoint.x),
      Math.abs(expected.midpoint.y - actual.midpoint.y),
      Math.abs(expected.midpoint.z - actual.midpoint.z),
    );
    numericValuesFinite = numericValuesFinite && [
      actual.stress,
      actual.strain,
      actual.energy,
      actual.midpoint.x,
      actual.midpoint.y,
      actual.midpoint.z,
    ].every(Number.isFinite);
    eventPayloadMatches = eventPayloadMatches &&
      actual.bondId === expected.bondId &&
      actual.bondKind === expected.bondKind &&
      actual.geometryRole === expected.geometryRole &&
      actual.cause === expected.cause;
  }
  const numericParity = numericValuesFinite &&
    maxStressError <= tolerances.stress &&
    maxStrainError <= tolerances.strain &&
    maxEnergyError <= tolerances.energy &&
    maxEventStressError <= tolerances.stress &&
    maxEventStrainError <= tolerances.strain &&
    maxEventEnergyError <= tolerances.energy &&
    maxEventMidpointError <= tolerances.midpoint;
  return {
    ok: responseCountMatches && responseIdentityMatches && breakSetMatches && eventSetMatches && eventPayloadMatches && livenessMatches && numericParity && eventOverflowCount === 0,
    tolerances,
    responseCountMatches,
    responseIdentityMatches,
    breakSetMatches,
    eventSetMatches,
    eventPayloadMatches,
    livenessMatches,
    numericValuesFinite,
    numericParity,
    eventOverflowCount,
    cpuBreakCount: cpuBreakSet.length,
    gpuBreakCount: gpuBreakSet.length,
    cpuEventCount: cpuEventSet.length,
    gpuEventCount: gpuEventSet.length,
    maxStressError,
    maxStrainError,
    maxEnergyError,
    maxEventStressError,
    maxEventStrainError,
    maxEventEnergyError,
    maxEventMidpointError,
  };
}

function parseGpuResponses(buffer, state) {
  const view = new DataView(buffer);
  return state.bonds.map((bond, index) => {
    const offset = index * RESPONSE_STRIDE_BYTES;
    return {
      bondIndex: view.getUint32(offset + 16, true),
      bondId: bond.id,
      bondKind: view.getUint32(offset + 20, true) === 1 ? 'depth' : 'in-plane',
      geometryRole: GEOMETRY_ROLES_BY_CODE[view.getUint32(offset + 24, true)] || 'body',
      stress: view.getFloat32(offset, true),
      strain: view.getFloat32(offset + 4, true),
      energy: view.getFloat32(offset + 8, true),
      shouldBreak: view.getFloat32(offset + 12, true) >= 0.5,
      nextAlive: view.getUint32(offset + 28, true) === 1,
    };
  });
}

function parseGpuEvents(buffer, count, state) {
  const view = new DataView(buffer);
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index * EVENT_STRIDE_BYTES;
    const bondIndex = view.getUint32(offset, true);
    const bond = state.bonds[bondIndex];
    events.push({
      bondIndex,
      bondId: bond?.id || `unknown-${bondIndex}`,
      bondKind: view.getUint32(offset + 4, true) === 1 ? 'depth' : 'in-plane',
      geometryRole: GEOMETRY_ROLES_BY_CODE[view.getUint32(offset + 8, true)] || 'body',
      cause: view.getUint32(offset + 12, true) === 1 ? 'stress-threshold' : 'unknown',
      stress: view.getFloat32(offset + 16, true),
      strain: view.getFloat32(offset + 20, true),
      energy: view.getFloat32(offset + 24, true),
      midpoint: {
        x: view.getFloat32(offset + 32, true),
        y: view.getFloat32(offset + 36, true),
        z: view.getFloat32(offset + 40, true),
      },
    });
  }
  return events.sort((a, b) => a.bondIndex - b.bondIndex);
}

function adapterIdentity(adapter) {
  const info = adapter?.info || {};
  return {
    vendor: info.vendor || null,
    architecture: info.architecture || null,
    device: info.device || null,
    description: info.description || null,
    isFallbackAdapter: Boolean(info.isFallbackAdapter),
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export async function runLayeredStructuralWebGpuParity(options = {}) {
  const state = options.state;
  const interaction = options.interaction || {};
  const cpuOracle = buildLayeredStructuralCpuBondOracle(state, interaction);
  const packed = packLayeredStructuralGpuSnapshot(state, interaction);
  const result = {
    schema: 'kaminos.structural-material.webgpu-parity-receipt.v0',
    status: 'failed',
    failurePhase: 'gpu-availability',
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE,
    effectiveRoute: null,
    requestedBackend: 'webgpu',
    effectiveBackend: null,
    cpuFallbackUsed: false,
    solverAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_SOLVER_AUTHORITY,
    cpuOracleAuthority: STRUCTURAL_MATERIAL_3D_CPU_ORACLE_AUTHORITY,
    abi: layeredStructuralGpuAbiDescriptor(),
    adapter: null,
    dispatch: null,
    timingsMs: {},
    cpuOracle: {
      responseCount: cpuOracle.responseCount,
      eventCandidateCount: cpuOracle.eventCandidateCount,
    },
    gpuResult: null,
    parity: null,
    error: null,
  };
  const gpu = Object.prototype.hasOwnProperty.call(options, 'gpu')
    ? options.gpu
    : globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) {
    result.error = { message: 'navigator.gpu unavailable; CPU fallback is forbidden for this parity route' };
    return result;
  }

  let device;
  let errorScopeOpen = false;
  const buffers = [];
  try {
    const adapterStart = now();
    const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference || 'high-performance' });
    result.timingsMs.adapterRequest = now() - adapterStart;
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    result.adapter = adapterIdentity(adapter);

    result.failurePhase = 'device-request';
    const deviceStart = now();
    device = await adapter.requestDevice();
    result.timingsMs.deviceRequest = now() - deviceStart;
    const usage = globalThis.GPUBufferUsage;
    const shaderStage = globalThis.GPUShaderStage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !shaderStage || !mapMode) throw new Error('WebGPU constants unavailable in effective runtime');

    result.failurePhase = 'buffer-allocation';
    const makeBuffer = descriptor => {
      const buffer = device.createBuffer(descriptor);
      buffers.push(buffer);
      return buffer;
    };
    const nodeBuffer = makeBuffer({ label: 'structural-node-storage', size: packed.nodeData.byteLength, usage: usage.STORAGE | usage.COPY_DST });
    const bondBuffer = makeBuffer({ label: 'structural-bond-storage', size: packed.bondData.byteLength, usage: usage.STORAGE | usage.COPY_DST });
    const interactionBuffer = makeBuffer({ label: 'structural-interaction-uniform', size: INTERACTION_BYTES, usage: usage.UNIFORM | usage.COPY_DST });
    const responseBuffer = makeBuffer({ label: 'structural-response-storage', size: packed.bondCount * RESPONSE_STRIDE_BYTES, usage: usage.STORAGE | usage.COPY_SRC });
    const eventHeaderBuffer = makeBuffer({ label: 'structural-event-header', size: EVENT_HEADER_BYTES, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC });
    const eventBuffer = makeBuffer({ label: 'structural-event-storage', size: packed.eventCapacity * EVENT_STRIDE_BYTES, usage: usage.STORAGE | usage.COPY_SRC });
    const responseReadback = makeBuffer({ label: 'structural-response-readback', size: packed.bondCount * RESPONSE_STRIDE_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    const eventHeaderReadback = makeBuffer({ label: 'structural-event-header-readback', size: EVENT_HEADER_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    const eventReadback = makeBuffer({ label: 'structural-event-readback', size: packed.eventCapacity * EVENT_STRIDE_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    device.queue.writeBuffer(nodeBuffer, 0, packed.nodeData);
    device.queue.writeBuffer(bondBuffer, 0, packed.bondData);
    device.queue.writeBuffer(interactionBuffer, 0, packed.interactionData);
    device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));

    result.failurePhase = 'pipeline-compile';
    device.pushErrorScope('validation');
    errorScopeOpen = true;
    const shaderModule = device.createShaderModule({ label: STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE, code: COMPUTE_SHADER });
    const pipelineStart = now();
    const pipeline = await device.createComputePipelineAsync({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE,
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
    result.timingsMs.pipelineCompile = now() - pipelineStart;
    const bindGroup = device.createBindGroup({
      label: 'structural-bond-response-bind-group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: nodeBuffer } },
        { binding: 1, resource: { buffer: bondBuffer } },
        { binding: 2, resource: { buffer: interactionBuffer } },
        { binding: 3, resource: { buffer: responseBuffer } },
        { binding: 4, resource: { buffer: eventHeaderBuffer } },
        { binding: 5, resource: { buffer: eventBuffer } },
      ],
    });

    result.failurePhase = 'dispatch';
    const workgroups = Math.ceil(packed.bondCount / WORKGROUP_SIZE);
    const encoder = device.createCommandEncoder({ label: 'structural-bond-response-parity-encoder' });
    const pass = encoder.beginComputePass({ label: STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(responseBuffer, 0, responseReadback, 0, packed.bondCount * RESPONSE_STRIDE_BYTES);
    encoder.copyBufferToBuffer(eventHeaderBuffer, 0, eventHeaderReadback, 0, EVENT_HEADER_BYTES);
    encoder.copyBufferToBuffer(eventBuffer, 0, eventReadback, 0, packed.eventCapacity * EVENT_STRIDE_BYTES);
    const dispatchStart = now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    result.timingsMs.dispatchAndGpuCompletion = now() - dispatchStart;
    result.dispatch = {
      workgroupSize: WORKGROUP_SIZE,
      workgroupCount: workgroups,
      bondCount: packed.bondCount,
      nodeCount: packed.nodeCount,
      eventCapacity: packed.eventCapacity,
    };

    result.failurePhase = 'readback';
    const readbackStart = now();
    await Promise.all([
      responseReadback.mapAsync(mapMode.READ),
      eventHeaderReadback.mapAsync(mapMode.READ),
      eventReadback.mapAsync(mapMode.READ),
    ]);
    const responseBytes = responseReadback.getMappedRange().slice(0);
    const headerBytes = eventHeaderReadback.getMappedRange().slice(0);
    const eventBytes = eventReadback.getMappedRange().slice(0);
    responseReadback.unmap();
    eventHeaderReadback.unmap();
    eventReadback.unmap();
    result.timingsMs.readbackMapAndCopy = now() - readbackStart;
    const headerView = new DataView(headerBytes);
    const eventCount = headerView.getUint32(0, true);
    const eventOverflowCount = headerView.getUint32(4, true);
    const readableEventCount = Math.min(eventCount, packed.eventCapacity);
    const gpuResult = {
      responses: parseGpuResponses(responseBytes, state),
      eventCandidates: parseGpuEvents(eventBytes, readableEventCount, state),
      eventCount,
      eventOverflowCount,
    };

    result.failurePhase = 'validation';
    const validationError = await device.popErrorScope();
    errorScopeOpen = false;
    if (validationError) throw new Error(`WebGPU validation error: ${validationError.message}`);
    result.parity = compareLayeredStructuralGpuParity(cpuOracle, gpuResult, options.tolerances || {});
    result.gpuResult = {
      responseCount: gpuResult.responses.length,
      eventCandidateCount: gpuResult.eventCandidates.length,
      eventOverflowCount,
      breakBondIndices: sortedBreakSet(gpuResult.responses),
      eventBondIndices: sortedEventSet(gpuResult.eventCandidates),
    };
    if (!result.parity.ok) throw new Error('WebGPU bond response diverged from CPU oracle');

    result.status = 'passed';
    result.failurePhase = null;
    result.effectiveRoute = STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE;
    result.effectiveBackend = 'webgpu';
    return result;
  } catch (error) {
    if (device && errorScopeOpen) {
      try {
        const scopedError = await device.popErrorScope();
        if (scopedError && !String(error.message).includes(scopedError.message)) {
          error = new Error(`${error.message}; WebGPU validation: ${scopedError.message}`);
        }
      } catch {
        // Preserve the primary failure when the device cannot return its error scope.
      }
    }
    result.error = { name: error.name, message: error.message, stack: error.stack };
    return result;
  } finally {
    for (const buffer of buffers) buffer.destroy?.();
    device?.destroy?.();
  }
}
