import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_COMPUTE_SHADER,
  STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_INTERACTION_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE,
  layeredStructuralGpuAbiDescriptor,
  layeredStructuralGpuAdapterIdentity,
  layeredStructuralGpuNow,
  packLayeredStructuralGpuInteraction,
  packLayeredStructuralGpuSnapshot,
} from './structural-material-3d-webgpu-core.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_COMPONENT_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_COMPONENT_SHADER,
  STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
  layeredStructuralInteractionSequenceIdentity,
} from './structural-material-3d-webgpu-retained.js';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE =
  'kaminos.structural-material.webgpu-hot-sidecar.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY =
  'persistent-webgpu-device-pipelines-buffers-v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_SCHEMA =
  'kaminos.structural-material.webgpu-hot-sidecar-interaction-receipt.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE =
  'kaminos.structural-material.webgpu-resident-binding.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY =
  'webgpu-resident-authored-edge-reactivation-v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_SCHEMA =
  'kaminos.structural-material.webgpu-resident-binding-receipt.v0';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_SHADER = /* wgsl */ `
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

struct BindEvent {
  identity: vec4<u32>,
  metrics: vec4<f32>,
  midpoint: vec4<f32>,
}

@group(0) @binding(0) var<storage, read_write> bonds: array<BondRecord>;
@group(0) @binding(1) var<uniform> interaction: Interaction;
@group(0) @binding(2) var<storage, read_write> responses: array<BondResponse>;
@group(0) @binding(3) var<storage, read_write> eventHeader: EventHeader;
@group(0) @binding(4) var<storage, read_write> events: array<BindEvent>;

@compute @workgroup_size(${STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let bondIndex = globalId.x;
  if (bondIndex >= interaction.counts.x) {
    return;
  }

  var bond = bonds[bondIndex];
  if (bond.material.w >= 0.5) {
    responses[bondIndex].metrics = vec4<f32>(bond.prior.x, bond.prior.y, 0.0, 0.0);
    responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 1u);
    return;
  }

  let distanceFromBinding = distance(bond.midpoint.xyz, interaction.pointRadius.xyz);
  if (distanceFromBinding > interaction.pointRadius.w) {
    responses[bondIndex].metrics = vec4<f32>(bond.prior.x, bond.prior.y, 0.0, 0.0);
    responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 0u);
    return;
  }

  let requestedStrength = interaction.directionMagnitude.w;
  let priorStress = bond.prior.x;
  let priorStrain = bond.prior.y;
  var energyScale = 0.55;
  if (bond.endpoints.z == 1u) {
    energyScale = 0.72;
  }
  let bindEnergy = max(0.0, interaction.pointRadius.w - distanceFromBinding) * requestedStrength * energyScale;
  bond.material.y = max(bond.material.y, requestedStrength);
  bond.material.w = 1.0;
  bond.prior.z = 1.0;
  bond.prior.w = bitcast<f32>(interaction.counts.w);
  bonds[bondIndex] = bond;

  responses[bondIndex].metrics = vec4<f32>(priorStress, priorStrain, bindEnergy, 1.0);
  responses[bondIndex].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 1u);
  let slot = atomicAdd(&eventHeader.count, 1u);
  if (slot < interaction.counts.y) {
    events[slot].identity = vec4<u32>(bondIndex, bond.endpoints.z, bond.endpoints.w, 2u);
    events[slot].metrics = vec4<f32>(priorStress, priorStrain, bindEnergy, bond.material.y);
    events[slot].midpoint = vec4<f32>(bond.midpoint.xyz, bitcast<f32>(interaction.counts.w));
  } else {
    atomicAdd(&eventHeader.overflow, 1u);
  }
}
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function cloneLifecycle(lifecycle) {
  return { ...lifecycle };
}

function cloneError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function normalizedBinding(binding = {}) {
  return {
    point: {
      x: clamp(binding.point?.x ?? 0.5, 0, 1),
      y: clamp(binding.point?.y ?? 0.5, 0, 1),
      z: clamp(binding.point?.z ?? 0.5, 0, 1),
    },
    radius: clamp(binding.radius ?? 0.22, 0.03, 0.6),
    strength: clamp(binding.strength ?? 1.25, 0.2, 4),
  };
}

function packLayeredStructuralGpuBinding(state, binding, eventEpoch) {
  const effective = normalizedBinding(binding);
  const data = new ArrayBuffer(STRUCTURAL_MATERIAL_3D_WEBGPU_INTERACTION_BYTES);
  const view = new DataView(data);
  view.setFloat32(12, effective.strength, true);
  view.setFloat32(16, effective.point.x, true);
  view.setFloat32(20, effective.point.y, true);
  view.setFloat32(24, effective.point.z, true);
  view.setFloat32(28, effective.radius, true);
  view.setUint32(32, state.bonds.length, true);
  view.setUint32(36, state.bonds.length, true);
  view.setUint32(40, state.nodes.length, true);
  view.setUint32(44, eventEpoch, true);
  return { data, effective };
}

export function parseLayeredStructuralGpuBondMutationState(buffer, state) {
  const view = new DataView(buffer);
  return state.bonds.map((bond, index) => {
    const offset = index * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES;
    return {
      bondIndex: index,
      bondId: bond.id,
      alive: view.getFloat32(offset + 60, true) >= 0.5,
      strength: view.getFloat32(offset + 52, true),
      lastStress: view.getFloat32(offset + 64, true),
      lastStrain: view.getFloat32(offset + 68, true),
      repaired: view.getFloat32(offset + 72, true) >= 0.5,
      lastMutationEpoch: view.getUint32(offset + 76, true),
    };
  });
}

function applyGpuBondMutationState(state, mutationState) {
  return {
    ...state,
    bonds: state.bonds.map((bond, index) => {
      const mutation = mutationState[index];
      return {
        ...bond,
        alive: mutation.alive,
        strength: mutation.strength,
        lastStress: mutation.lastStress,
        lastStrain: mutation.lastStrain,
        repaired: mutation.repaired,
        cause: mutation.alive ? null : 'stress-threshold',
      };
    }),
  };
}

export function layeredStructuralHotSidecarObjectIdentity(state) {
  const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
  const bonds = Array.isArray(state?.bonds) ? state.bonds : [];
  const payload = {
    nodes: nodes.map(node => [node.id, node.x, node.y, node.z, Boolean(node.pinned)]),
    bonds: bonds.map(bond => [bond.id, bond.a, bond.b, bond.bondKind, bond.geometryRole]),
  };
  return `kaminos.structural-material.hot-object.v0:${fnv1a(JSON.stringify(payload))}:n${nodes.length}:b${bonds.length}`;
}

function deriveTopology(state, componentLabels) {
  const componentsByLabel = new Map();
  componentLabels.forEach((label, index) => {
    if (!componentsByLabel.has(label)) componentsByLabel.set(label, []);
    componentsByLabel.get(label).push(index);
  });
  const components = [...componentsByLabel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([label, nodeIndices]) => ({
      label,
      nodeIndices,
      pinned: nodeIndices.some(index => state.nodes[index]?.pinned),
    }));
  const anchored = components.filter(component => component.pinned);
  return {
    authority: STRUCTURAL_MATERIAL_3D_WEBGPU_COMPONENT_AUTHORITY,
    componentCount: components.length,
    componentLabels: components.map(component => component.label),
    anchoredComponentLabel: anchored.length === 1 ? anchored[0].label : null,
    anchoredComponentCount: anchored.length,
    detachedComponentLabels: components.filter(component => !component.pinned).map(component => component.label),
  };
}

export function validateLayeredStructuralHotSidecarReceipt(state, receipt) {
  const reasons = [];
  const finalBondLiveness = receipt?.gpuStructuralState?.finalBondLiveness;
  const componentLabels = receipt?.gpuStructuralState?.componentLabels;
  const expectedObjectIdentity = layeredStructuralHotSidecarObjectIdentity(state);
  const lifecycle = receipt?.lifecycle || {};

  if (receipt?.status !== 'passed') reasons.push('status');
  if (receipt?.requestedRoute !== STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE) reasons.push('requested-route');
  if (receipt?.effectiveRoute !== STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE) reasons.push('effective-route');
  if (receipt?.effectiveBackend !== 'webgpu' || receipt?.cpuFallbackUsed !== false) reasons.push('backend');
  if (receipt?.authority !== STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY) reasons.push('authority');
  if (receipt?.mode !== 'interactive') reasons.push('mode');
  if (receipt?.objectIdentity !== expectedObjectIdentity) reasons.push('object-identity');
  if (!Number.isInteger(receipt?.eventEpoch) || receipt.eventEpoch < 1) reasons.push('event-epoch');
  if (lifecycle.adapterRequestCount !== 1 || lifecycle.deviceRequestCount !== 1) reasons.push('device-lifecycle');
  if (lifecycle.pipelineCreateCount !== 3) reasons.push('pipeline-lifecycle');
  if (lifecycle.bufferAllocationCount !== 9) reasons.push('buffer-lifecycle');
  if (lifecycle.executionCount < 1) reasons.push('execution-lifecycle');
  if (lifecycle.executionAttemptCount < lifecycle.executionCount) reasons.push('execution-attempt-lifecycle');
  if (lifecycle.eventHeaderResetCount !== lifecycle.executionAttemptCount + lifecycle.bindingAttemptCount) {
    reasons.push('event-header-lifecycle');
  }
  if (lifecycle.compactReadbackCount < 1 || lifecycle.compactReadbackBufferCount !== 2) reasons.push('compact-readback');
  if (lifecycle.fullValidationReadbackCount !== 0) reasons.push('validation-readback');
  if (lifecycle.disposed !== false) reasons.push('disposed');

  if (!Array.isArray(finalBondLiveness) || finalBondLiveness.length !== state.bonds.length) {
    reasons.push('bond-liveness-length');
  } else if (!finalBondLiveness.every(alive => typeof alive === 'boolean')) {
    reasons.push('bond-liveness-values');
  }
  if (!Array.isArray(componentLabels) || componentLabels.length !== state.nodes.length) {
    reasons.push('component-label-length');
  } else {
    const validLabels = componentLabels.every(label =>
      Number.isInteger(label) && label >= 0 && label < state.nodes.length);
    if (!validLabels) {
      reasons.push('component-label-values');
    } else {
      const topology = deriveTopology(state, componentLabels);
      const canonical = topology.componentLabels.every(label => {
        const indices = componentLabels
          .map((candidate, index) => candidate === label ? index : -1)
          .filter(index => index >= 0);
        return label === Math.min(...indices);
      });
      if (!canonical) reasons.push('component-label-canonicality');
      if (topology.anchoredComponentCount !== 1) reasons.push('anchored-component-count');
      if (receipt?.topology?.authority !== topology.authority) reasons.push('topology-authority');
      if (receipt?.topology?.componentCount !== topology.componentCount) reasons.push('topology-count');
      if (JSON.stringify(receipt?.topology?.componentLabels) !== JSON.stringify(topology.componentLabels)) {
        reasons.push('topology-labels');
      }
      if (receipt?.topology?.anchoredComponentLabel !== topology.anchoredComponentLabel) {
        reasons.push('topology-anchor');
      }
      if (Array.isArray(finalBondLiveness) && finalBondLiveness.length === state.bonds.length) {
        const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
        const aliveBondLabelsAgree = state.bonds.every((bond, bondIndex) => {
          if (!finalBondLiveness[bondIndex]) return true;
          const a = nodeIndexById.get(bond.a);
          const b = nodeIndexById.get(bond.b);
          return Number.isInteger(a) && Number.isInteger(b) && componentLabels[a] === componentLabels[b];
        });
        if (!aliveBondLabelsAgree) reasons.push('alive-bond-component-coherence');
      }
    }
  }
  return { ok: reasons.length === 0, reasons, expectedObjectIdentity };
}

export function validateLayeredStructuralHotBindingReceipt(state, receipt) {
  const reasons = [];
  const finalBondLiveness = receipt?.gpuStructuralState?.finalBondLiveness;
  const componentLabels = receipt?.gpuStructuralState?.componentLabels;
  const bondMutationState = receipt?.gpuStructuralState?.bondMutationState;
  const events = receipt?.binding?.events;
  const lifecycle = receipt?.lifecycle || {};
  const expectedObjectIdentity = layeredStructuralHotSidecarObjectIdentity(state);

  if (receipt?.status !== 'passed') reasons.push('status');
  if (receipt?.requestedRoute !== STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE) reasons.push('requested-route');
  if (receipt?.effectiveRoute !== STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE) reasons.push('effective-route');
  if (receipt?.executionRoute !== STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE) reasons.push('execution-route');
  if (receipt?.effectiveBackend !== 'webgpu' || receipt?.cpuFallbackUsed !== false) reasons.push('backend');
  if (receipt?.authority !== STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY) reasons.push('authority');
  if (receipt?.objectIdentity !== expectedObjectIdentity) reasons.push('object-identity');
  if (!Number.isInteger(receipt?.eventEpoch) || receipt.eventEpoch < 1) reasons.push('event-epoch');
  if (lifecycle.adapterRequestCount !== 1 || lifecycle.deviceRequestCount !== 1) reasons.push('device-lifecycle');
  if (lifecycle.pipelineCreateCount !== 3) reasons.push('pipeline-lifecycle');
  if (lifecycle.bufferAllocationCount !== 9) reasons.push('buffer-lifecycle');
  if (lifecycle.bindingCount < 1 || lifecycle.bindingAttemptCount < lifecycle.bindingCount) {
    reasons.push('binding-lifecycle');
  }
  if (lifecycle.bindingDispatchCount < lifecycle.bindingCount) reasons.push('binding-dispatch-lifecycle');
  if (lifecycle.eventHeaderResetCount !== lifecycle.executionAttemptCount + lifecycle.bindingAttemptCount) {
    reasons.push('event-header-lifecycle');
  }
  if (lifecycle.compactReadbackCount < 1 || lifecycle.compactReadbackBufferCount !== 2) reasons.push('compact-readback');
  if (lifecycle.fullValidationReadbackCount !== 0) reasons.push('validation-readback');
  if (lifecycle.disposed !== false) reasons.push('disposed');

  if (!Array.isArray(finalBondLiveness) || finalBondLiveness.length !== state.bonds.length) {
    reasons.push('bond-liveness-length');
  }
  if (!Array.isArray(bondMutationState) || bondMutationState.length !== state.bonds.length) {
    reasons.push('bond-mutation-state-length');
  }
  if (!Array.isArray(componentLabels) || componentLabels.length !== state.nodes.length) {
    reasons.push('component-label-length');
  }
  if (!Array.isArray(events)) {
    reasons.push('binding-events');
  } else {
    const eventIndices = events.map(event => event.bondIndex);
    const effective = receipt?.binding?.effective;
    const expectedEventIndices = effective?.point && Number.isFinite(effective.radius)
      ? state.bonds.flatMap((bond, bondIndex) => {
          if (bond.alive) return [];
          const distance = Math.hypot(
            finite(bond.midpoint?.x) - finite(effective.point.x),
            finite(bond.midpoint?.y) - finite(effective.point.y),
            finite(bond.midpoint?.z) - finite(effective.point.z),
          );
          return distance <= effective.radius + 0.000001 ? [bondIndex] : [];
        })
      : [];
    if (new Set(eventIndices).size !== eventIndices.length) reasons.push('duplicate-binding-events');
    if (events.length !== receipt?.binding?.eventCount) reasons.push('binding-event-count');
    if (receipt?.binding?.noOp !== (events.length === 0)) reasons.push('binding-noop-identity');
    if (JSON.stringify(eventIndices) !== JSON.stringify(expectedEventIndices)) {
      reasons.push('binding-eligible-set');
    }
    if (events.some(event =>
      event.eventEpoch !== receipt.eventEpoch ||
      event.previousAlive !== false ||
      event.cause !== 'operator-binding' ||
      !finalBondLiveness?.[event.bondIndex]
    )) reasons.push('binding-event-provenance');
    const point = receipt?.binding?.effective?.point;
    const radius = receipt?.binding?.effective?.radius;
    if (!point || !Number.isFinite(radius) || events.some(event =>
      Math.hypot(
        finite(event.midpoint?.x) - finite(point.x),
        finite(event.midpoint?.y) - finite(point.y),
        finite(event.midpoint?.z) - finite(point.z),
      ) > radius + 0.000001
    )) reasons.push('binding-contact-region');
    if (Array.isArray(bondMutationState)) {
      const stamped = bondMutationState
        .filter(bond => bond.lastMutationEpoch === receipt.eventEpoch)
        .map(bond => bond.bondIndex);
      if (JSON.stringify(stamped) !== JSON.stringify(eventIndices)) reasons.push('binding-mutation-stamps');
    }
    if (expectedEventIndices.some(index => finalBondLiveness?.[index] !== true)) {
      reasons.push('binding-terminal-liveness');
    }
  }

  if (Array.isArray(finalBondLiveness) && Array.isArray(componentLabels) &&
      finalBondLiveness.length === state.bonds.length && componentLabels.length === state.nodes.length) {
    const topology = deriveTopology(state, componentLabels);
    if (topology.anchoredComponentCount !== 1) reasons.push('anchored-component-count');
    if (receipt?.topology?.componentCount !== topology.componentCount) reasons.push('topology-count');
    if (JSON.stringify(receipt?.topology?.componentLabels) !== JSON.stringify(topology.componentLabels)) {
      reasons.push('topology-labels');
    }
    const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
    const coherent = state.bonds.every((bond, bondIndex) => {
      if (!finalBondLiveness[bondIndex]) return true;
      return componentLabels[nodeIndexById.get(bond.a)] === componentLabels[nodeIndexById.get(bond.b)];
    });
    if (!coherent) reasons.push('alive-bond-component-coherence');
  }
  return { ok: reasons.length === 0, reasons, expectedObjectIdentity };
}

function makeLifecycle() {
  return {
    adapterRequestCount: 0,
    deviceRequestCount: 0,
    pipelineCreateCount: 0,
    bufferAllocationCount: 0,
    executionAttemptCount: 0,
    executionCount: 0,
    bindingAttemptCount: 0,
    bindingCount: 0,
    bindingDispatchCount: 0,
    bindEventCount: 0,
    eventHeaderResetCount: 0,
    interactionUploadCount: 0,
    dispatchCount: 0,
    dispatchSubmissionCount: 0,
    topologyDispatchCount: 0,
    compactReadbackCount: 0,
    compactReadbackBufferCount: 2,
    fullValidationReadbackCount: 0,
    reinitializeCount: 0,
    rollbackCount: 0,
    rollbackFailureCount: 0,
    residentStateTrusted: true,
    bufferDestroyCount: 0,
    bufferDestroyErrorCount: 0,
    deviceDestroyCount: 0,
    deviceDestroyErrorCount: 0,
    disposed: false,
  };
}

export async function createLayeredStructuralHotWebGpuSidecar(options = {}) {
  let state = options.state;
  const objectIdentity = layeredStructuralHotSidecarObjectIdentity(state);
  const gpu = Object.prototype.hasOwnProperty.call(options, 'gpu')
    ? options.gpu
    : globalThis.navigator?.gpu;
  const usage = globalThis.GPUBufferUsage;
  const mapMode = globalThis.GPUMapMode;
  const lifecycle = makeLifecycle();
  const coldTimingsMs = {};
  const buffers = [];
  let device = null;
  let disposed = false;
  let disposeRequested = false;
  let disposePromise = null;
  let eventEpoch = 0;
  let operationQueue = Promise.resolve();
  const hotReceiptValidator = options.hotReceiptValidator || validateLayeredStructuralHotSidecarReceipt;
  const bindingReceiptValidator = options.bindingReceiptValidator || validateLayeredStructuralHotBindingReceipt;

  if (!state?.nodes?.length || !state?.bonds?.length) {
    throw new Error('hot structural sidecar requires a nonempty topology-fixed state');
  }
  if (!gpu?.requestAdapter || !usage || !mapMode) {
    throw new Error('WebGPU unavailable; CPU fallback is forbidden for the hot structural sidecar');
  }

  const packed = packLayeredStructuralGpuSnapshot(state, {});
  const coldStart = layeredStructuralGpuNow();
  lifecycle.adapterRequestCount += 1;
  const adapterStart = layeredStructuralGpuNow();
  const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference || 'high-performance' });
  coldTimingsMs.adapterRequest = layeredStructuralGpuNow() - adapterStart;
  if (!adapter) throw new Error('WebGPU adapter unavailable for hot structural sidecar');
  const adapterIdentity = layeredStructuralGpuAdapterIdentity(adapter);

  lifecycle.deviceRequestCount += 1;
  const deviceStart = layeredStructuralGpuNow();
  device = await adapter.requestDevice();
  coldTimingsMs.deviceRequest = layeredStructuralGpuNow() - deviceStart;

  const makeBuffer = descriptor => {
    const buffer = device.createBuffer(descriptor);
    buffers.push(buffer);
    lifecycle.bufferAllocationCount += 1;
    return buffer;
  };

  let nodeBuffer;
  let bondBuffer;
  let interactionBuffer;
  let responseBuffer;
  let eventHeaderBuffer;
  let eventBuffer;
  let componentLabelBuffer;
  let bondReadback;
  let componentReadback;
  let fracturePipeline;
  let bindingPipeline;
  let topologyPipeline;
  let fractureBindGroup;
  let bindingBindGroup;
  let topologyBindGroup;

  const cleanupInitializationFailure = error => {
    for (const buffer of buffers) {
      try {
        buffer.destroy();
        lifecycle.bufferDestroyCount += 1;
      } catch {
        lifecycle.bufferDestroyErrorCount += 1;
      }
    }
    try {
      device?.destroy();
      if (device) lifecycle.deviceDestroyCount += 1;
    } catch {
      lifecycle.deviceDestroyErrorCount += 1;
    }
    lifecycle.disposed = true;
    error.hotSidecarInitialization = {
      failurePhase: 'initialization',
      requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
      requestedBackend: 'webgpu',
      effectiveBackend: device ? 'webgpu' : null,
      cpuFallbackUsed: false,
      objectIdentity,
      lifecycle: cloneLifecycle(lifecycle),
    };
    throw error;
  };

  try {
    nodeBuffer = makeBuffer({
      label: 'hot-structural-node-storage',
      size: packed.nodeData.byteLength,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    bondBuffer = makeBuffer({
      label: 'hot-structural-bond-storage',
      size: packed.bondData.byteLength,
      usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
    });
    interactionBuffer = makeBuffer({
      label: 'hot-structural-interaction-uniform',
      size: STRUCTURAL_MATERIAL_3D_WEBGPU_INTERACTION_BYTES,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    responseBuffer = makeBuffer({
      label: 'hot-structural-response-storage',
      size: packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES,
      usage: usage.STORAGE,
    });
    eventHeaderBuffer = makeBuffer({
      label: 'hot-structural-event-header-storage',
      size: STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    eventBuffer = makeBuffer({
      label: 'hot-structural-event-storage',
      size: packed.eventCapacity * STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES,
      usage: usage.STORAGE,
    });
    componentLabelBuffer = makeBuffer({
      label: 'hot-structural-component-label-storage',
      size: packed.nodeCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
    });
    bondReadback = makeBuffer({
      label: 'hot-structural-bond-readback',
      size: packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES,
      usage: usage.COPY_DST | usage.MAP_READ,
    });
    componentReadback = makeBuffer({
      label: 'hot-structural-component-readback',
      size: packed.nodeCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: usage.COPY_DST | usage.MAP_READ,
    });

    device.queue.writeBuffer(nodeBuffer, 0, packed.nodeData);
    device.queue.writeBuffer(bondBuffer, 0, packed.bondData);
    device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));
    device.queue.writeBuffer(
      componentLabelBuffer,
      0,
      Uint32Array.from({ length: packed.nodeCount }, (_, index) => index),
    );

    const pipelineStart = layeredStructuralGpuNow();
    const fractureModule = device.createShaderModule({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
      code: STRUCTURAL_MATERIAL_3D_WEBGPU_COMPUTE_SHADER,
    });
    lifecycle.pipelineCreateCount += 1;
    fracturePipeline = await device.createComputePipelineAsync({
      label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE}:fracture`,
      layout: 'auto',
      compute: { module: fractureModule, entryPoint: 'main' },
    });
    coldTimingsMs.fracturePipelineCompile = layeredStructuralGpuNow() - pipelineStart;

    const bindingPipelineStart = layeredStructuralGpuNow();
    const bindingModule = device.createShaderModule({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
      code: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_SHADER,
    });
    lifecycle.pipelineCreateCount += 1;
    bindingPipeline = await device.createComputePipelineAsync({
      label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE}:binding`,
      layout: 'auto',
      compute: { module: bindingModule, entryPoint: 'main' },
    });
    coldTimingsMs.bindingPipelineCompile = layeredStructuralGpuNow() - bindingPipelineStart;

    const topologyPipelineStart = layeredStructuralGpuNow();
    const topologyModule = device.createShaderModule({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_COMPONENT_AUTHORITY,
      code: STRUCTURAL_MATERIAL_3D_WEBGPU_COMPONENT_SHADER,
    });
    lifecycle.pipelineCreateCount += 1;
    topologyPipeline = await device.createComputePipelineAsync({
      label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE}:topology`,
      layout: 'auto',
      compute: { module: topologyModule, entryPoint: 'main' },
    });
    coldTimingsMs.topologyPipelineCompile = layeredStructuralGpuNow() - topologyPipelineStart;

    fractureBindGroup = device.createBindGroup({
      label: 'hot-structural-fracture-bind-group',
      layout: fracturePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: nodeBuffer } },
        { binding: 1, resource: { buffer: bondBuffer } },
        { binding: 2, resource: { buffer: interactionBuffer } },
        { binding: 3, resource: { buffer: responseBuffer } },
        { binding: 4, resource: { buffer: eventHeaderBuffer } },
        { binding: 5, resource: { buffer: eventBuffer } },
      ],
    });
    bindingBindGroup = device.createBindGroup({
      label: 'hot-structural-binding-bind-group',
      layout: bindingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bondBuffer } },
        { binding: 1, resource: { buffer: interactionBuffer } },
        { binding: 2, resource: { buffer: responseBuffer } },
        { binding: 3, resource: { buffer: eventHeaderBuffer } },
        { binding: 4, resource: { buffer: eventBuffer } },
      ],
    });
    topologyBindGroup = device.createBindGroup({
      label: 'hot-structural-topology-bind-group',
      layout: topologyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bondBuffer } },
        { binding: 1, resource: { buffer: componentLabelBuffer } },
      ],
    });
    coldTimingsMs.total = layeredStructuralGpuNow() - coldStart;
  } catch (error) {
    cleanupInitializationFailure(error);
  }

  const enqueue = operation => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => undefined);
    return result;
  };

  const restoreAcceptedGpuState = async acceptedState => {
    try {
      const accepted = packLayeredStructuralGpuSnapshot(acceptedState, {});
      device.queue.writeBuffer(nodeBuffer, 0, accepted.nodeData);
      device.queue.writeBuffer(bondBuffer, 0, accepted.bondData);
      device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));
      device.queue.writeBuffer(
        componentLabelBuffer,
        0,
        Uint32Array.from({ length: accepted.nodeCount }, (_, index) => index),
      );
      await device.queue.onSubmittedWorkDone();
      lifecycle.rollbackCount += 1;
      lifecycle.residentStateTrusted = true;
      return null;
    } catch (error) {
      lifecycle.rollbackFailureCount += 1;
      lifecycle.residentStateTrusted = false;
      return error;
    }
  };

  const baseReceipt = () => ({
    schema: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_SCHEMA,
    status: 'failed',
    failurePhase: null,
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
    effectiveRoute: null,
    requestedBackend: 'webgpu',
    effectiveBackend: 'webgpu',
    cpuFallbackUsed: false,
    authority: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
    validationRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
    mode: 'interactive',
    objectIdentity,
    adapter: adapterIdentity,
    abi: layeredStructuralGpuAbiDescriptor(),
    coldTimingsMs: { ...coldTimingsMs },
    lifecycle: cloneLifecycle(lifecycle),
    error: null,
  });

  const execute = interaction => {
    if (disposeRequested) {
      return Promise.resolve({
        ...baseReceipt(),
        failurePhase: 'disposed',
        error: { message: 'hot structural sidecar is disposed or disposing' },
      });
    }
    return enqueue(async () => {
      const receipt = baseReceipt();
      const timingsMs = {};
      const warmStart = layeredStructuralGpuNow();
      const sourceState = state;
      let dispatchSubmitted = false;
      let rollbackAttempted = false;
      try {
        if (disposed) throw new Error('hot structural sidecar is disposed');
        if (!lifecycle.residentStateTrusted) throw new Error('hot structural sidecar resident state is untrusted');
        eventEpoch += 1;
        const interactionData = packLayeredStructuralGpuInteraction(sourceState, interaction, {
          eventCapacity: packed.eventCapacity,
          eventEpoch,
        });
        lifecycle.executionAttemptCount += 1;
        const sequenceIdentity = layeredStructuralInteractionSequenceIdentity([interaction]);
        device.queue.writeBuffer(interactionBuffer, 0, interactionData);
        device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));
        lifecycle.eventHeaderResetCount += 1;
        device.queue.writeBuffer(
          componentLabelBuffer,
          0,
          Uint32Array.from({ length: packed.nodeCount }, (_, index) => index),
        );
        lifecycle.interactionUploadCount += 1;

        device.pushErrorScope('validation');
        const enqueueStart = layeredStructuralGpuNow();
        const encoder = device.createCommandEncoder({
          label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE}:epoch-${eventEpoch}`,
        });
        const fracturePass = encoder.beginComputePass({ label: `hot-structural-fracture:${eventEpoch}` });
        fracturePass.setPipeline(fracturePipeline);
        fracturePass.setBindGroup(0, fractureBindGroup);
        fracturePass.dispatchWorkgroups(Math.ceil(packed.bondCount / STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE));
        fracturePass.end();
        lifecycle.dispatchCount += 1;
        for (let passIndex = 0; passIndex < packed.nodeCount; passIndex += 1) {
          const topologyPass = encoder.beginComputePass({
            label: `hot-structural-topology:${eventEpoch}:${passIndex + 1}`,
          });
          topologyPass.setPipeline(topologyPipeline);
          topologyPass.setBindGroup(0, topologyBindGroup);
          topologyPass.dispatchWorkgroups(
            Math.ceil(packed.bondCount / STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE),
          );
          topologyPass.end();
          lifecycle.topologyDispatchCount += 1;
        }
        encoder.copyBufferToBuffer(
          bondBuffer,
          0,
          bondReadback,
          0,
          packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES,
        );
        encoder.copyBufferToBuffer(
          componentLabelBuffer,
          0,
          componentReadback,
          0,
          packed.nodeCount * Uint32Array.BYTES_PER_ELEMENT,
        );
        device.queue.submit([encoder.finish()]);
        dispatchSubmitted = true;
        lifecycle.dispatchSubmissionCount += 1;
        timingsMs.warmCpuEnqueue = layeredStructuralGpuNow() - enqueueStart;
        await device.queue.onSubmittedWorkDone();
        timingsMs.warmGpuCompletion = layeredStructuralGpuNow() - enqueueStart;

        const mapStart = layeredStructuralGpuNow();
        await Promise.all([
          bondReadback.mapAsync(mapMode.READ),
          componentReadback.mapAsync(mapMode.READ),
        ]);
        const bondBytes = bondReadback.getMappedRange().slice(0);
        const componentBytes = componentReadback.getMappedRange().slice(0);
        bondReadback.unmap();
        componentReadback.unmap();
        timingsMs.compactReadbackMap = layeredStructuralGpuNow() - mapStart;
        lifecycle.compactReadbackCount += 1;
        lifecycle.executionCount += 1;

        const validationError = await device.popErrorScope();
        if (validationError) throw new Error(`WebGPU validation error: ${validationError.message}`);
        const bondMutationState = parseLayeredStructuralGpuBondMutationState(bondBytes, sourceState);
        const finalBondLiveness = bondMutationState.map(bond => bond.alive);
        const componentLabels = Array.from(new Uint32Array(componentBytes));
        const topology = deriveTopology(sourceState, componentLabels);
        timingsMs.warmTotal = layeredStructuralGpuNow() - warmStart;

        Object.assign(receipt, {
          status: 'passed',
          effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
          eventEpoch,
          requestedSequenceIdentity: sequenceIdentity,
          effectiveSequenceIdentity: sequenceIdentity,
          interaction: {
            kind: interaction?.kind || 'screen-space-layered-drag',
            point: { ...interaction.point },
            vector: { ...interaction.vector },
            magnitude: finite(interaction.magnitude),
            radius: finite(interaction.radius),
          },
          timingsMs,
          lifecycle: cloneLifecycle(lifecycle),
          gpuStructuralState: { finalBondLiveness, componentLabels },
          topology,
        });
        const validation = hotReceiptValidator(sourceState, receipt);
        receipt.compactValidation = validation;
        if (!validation.ok) {
          receipt.status = 'failed';
          receipt.effectiveRoute = null;
          receipt.failurePhase = 'compact-receipt-validation';
          receipt.error = { message: `compact receipt failed: ${validation.reasons.join(', ')}` };
          rollbackAttempted = true;
          const rollbackError = await restoreAcceptedGpuState(sourceState);
          receipt.lifecycle = cloneLifecycle(lifecycle);
          if (rollbackError) {
            receipt.failurePhase = 'resident-state-rollback';
            receipt.error = {
              message: `compact receipt failed and resident rollback failed: ${rollbackError.message}`,
            };
          }
        } else {
          state = applyGpuBondMutationState(sourceState, bondMutationState);
        }
      } catch (error) {
        receipt.failurePhase = receipt.failurePhase || 'warm-execution';
        receipt.error = cloneError(error);
        if (dispatchSubmitted && !rollbackAttempted) {
          const rollbackError = await restoreAcceptedGpuState(sourceState);
          if (rollbackError) {
            receipt.failurePhase = 'resident-state-rollback';
            receipt.error = cloneError(rollbackError);
          }
        }
        receipt.lifecycle = cloneLifecycle(lifecycle);
        for (const readback of [bondReadback, componentReadback]) {
          try {
            readback.unmap();
          } catch {
            // A failed sibling map may leave this readback unmapped.
          }
        }
        try {
          await device.popErrorScope();
        } catch {
          // Error scope may already have been consumed.
        }
      }
      return receipt;
    });
  };

  const baseBindingReceipt = () => ({
    schema: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_SCHEMA,
    status: 'failed',
    failurePhase: null,
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
    effectiveRoute: null,
    executionRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
    requestedBackend: 'webgpu',
    effectiveBackend: 'webgpu',
    cpuFallbackUsed: false,
    authority: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY,
    objectIdentity,
    adapter: adapterIdentity,
    abi: layeredStructuralGpuAbiDescriptor(),
    coldTimingsMs: { ...coldTimingsMs },
    lifecycle: cloneLifecycle(lifecycle),
    error: null,
  });

  const bind = binding => {
    if (disposeRequested) {
      return Promise.resolve({
        ...baseBindingReceipt(),
        failurePhase: 'disposed',
        error: { message: 'hot structural sidecar is disposed or disposing' },
      });
    }
    return enqueue(async () => {
      const receipt = baseBindingReceipt();
      const timingsMs = {};
      const warmStart = layeredStructuralGpuNow();
      const sourceState = state;
      let dispatchSubmitted = false;
      let rollbackAttempted = false;
      try {
        if (disposed) throw new Error('hot structural sidecar is disposed');
        if (!lifecycle.residentStateTrusted) throw new Error('hot structural sidecar resident state is untrusted');
        eventEpoch += 1;
        const packedBinding = packLayeredStructuralGpuBinding(sourceState, binding, eventEpoch);
        lifecycle.bindingAttemptCount += 1;
        device.queue.writeBuffer(interactionBuffer, 0, packedBinding.data);
        device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));
        lifecycle.eventHeaderResetCount += 1;
        device.queue.writeBuffer(
          componentLabelBuffer,
          0,
          Uint32Array.from({ length: packed.nodeCount }, (_, index) => index),
        );
        lifecycle.interactionUploadCount += 1;

        device.pushErrorScope('validation');
        const enqueueStart = layeredStructuralGpuNow();
        const encoder = device.createCommandEncoder({
          label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE}:epoch-${eventEpoch}`,
        });
        const bindingPass = encoder.beginComputePass({ label: `hot-structural-binding:${eventEpoch}` });
        bindingPass.setPipeline(bindingPipeline);
        bindingPass.setBindGroup(0, bindingBindGroup);
        bindingPass.dispatchWorkgroups(
          Math.ceil(packed.bondCount / STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE),
        );
        bindingPass.end();
        lifecycle.bindingDispatchCount += 1;
        for (let passIndex = 0; passIndex < packed.nodeCount; passIndex += 1) {
          const topologyPass = encoder.beginComputePass({
            label: `hot-structural-binding-topology:${eventEpoch}:${passIndex + 1}`,
          });
          topologyPass.setPipeline(topologyPipeline);
          topologyPass.setBindGroup(0, topologyBindGroup);
          topologyPass.dispatchWorkgroups(
            Math.ceil(packed.bondCount / STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE),
          );
          topologyPass.end();
          lifecycle.topologyDispatchCount += 1;
        }
        encoder.copyBufferToBuffer(
          bondBuffer,
          0,
          bondReadback,
          0,
          packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES,
        );
        encoder.copyBufferToBuffer(
          componentLabelBuffer,
          0,
          componentReadback,
          0,
          packed.nodeCount * Uint32Array.BYTES_PER_ELEMENT,
        );
        device.queue.submit([encoder.finish()]);
        dispatchSubmitted = true;
        lifecycle.dispatchSubmissionCount += 1;
        timingsMs.warmCpuEnqueue = layeredStructuralGpuNow() - enqueueStart;
        await device.queue.onSubmittedWorkDone();
        timingsMs.warmGpuCompletion = layeredStructuralGpuNow() - enqueueStart;

        const mapStart = layeredStructuralGpuNow();
        await Promise.all([
          bondReadback.mapAsync(mapMode.READ),
          componentReadback.mapAsync(mapMode.READ),
        ]);
        const bondBytes = bondReadback.getMappedRange().slice(0);
        const componentBytes = componentReadback.getMappedRange().slice(0);
        bondReadback.unmap();
        componentReadback.unmap();
        timingsMs.compactReadbackMap = layeredStructuralGpuNow() - mapStart;
        lifecycle.compactReadbackCount += 1;

        const validationError = await device.popErrorScope();
        if (validationError) throw new Error(`WebGPU validation error: ${validationError.message}`);
        const bondMutationState = parseLayeredStructuralGpuBondMutationState(bondBytes, sourceState);
        const finalBondLiveness = bondMutationState.map(bond => bond.alive);
        const componentLabels = Array.from(new Uint32Array(componentBytes));
        const topology = deriveTopology(sourceState, componentLabels);
        const events = bondMutationState
          .filter(bond => bond.lastMutationEpoch === eventEpoch)
          .map(mutation => {
            const bond = sourceState.bonds[mutation.bondIndex];
            const distance = Math.hypot(
              bond.midpoint.x - packedBinding.effective.point.x,
              bond.midpoint.y - packedBinding.effective.point.y,
              bond.midpoint.z - packedBinding.effective.point.z,
            );
            const energyScale = bond.bondKind === 'depth' ? 0.72 : 0.55;
            return {
              eventEpoch,
              bondIndex: mutation.bondIndex,
              bondId: bond.id,
              bondKind: bond.bondKind,
              geometryRole: bond.geometryRole,
              cause: 'operator-binding',
              previousAlive: false,
              midpoint: { ...bond.midpoint },
              priorFailure: { stress: mutation.lastStress, strain: mutation.lastStrain },
              requestedStrength: packedBinding.effective.strength,
              effectiveStrength: mutation.strength,
              distance,
              energy: Math.max(0, packedBinding.effective.radius - distance) *
                packedBinding.effective.strength * energyScale,
            };
          });
        lifecycle.bindingCount += 1;
        lifecycle.bindEventCount += events.length;
        timingsMs.warmTotal = layeredStructuralGpuNow() - warmStart;

        Object.assign(receipt, {
          status: 'passed',
          effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
          eventEpoch,
          timingsMs,
          lifecycle: cloneLifecycle(lifecycle),
          gpuStructuralState: { finalBondLiveness, componentLabels, bondMutationState },
          topology,
          binding: {
            requested: binding || {},
            effective: packedBinding.effective,
            eventCount: events.length,
            events,
            noOp: events.length === 0,
          },
        });
        const validation = bindingReceiptValidator(sourceState, receipt);
        receipt.compactValidation = validation;
        if (!validation.ok) {
          receipt.status = 'failed';
          receipt.effectiveRoute = null;
          receipt.failurePhase = 'compact-binding-receipt-validation';
          receipt.error = { message: `compact binding receipt failed: ${validation.reasons.join(', ')}` };
          rollbackAttempted = true;
          const rollbackError = await restoreAcceptedGpuState(sourceState);
          receipt.lifecycle = cloneLifecycle(lifecycle);
          if (rollbackError) {
            receipt.failurePhase = 'resident-state-rollback';
            receipt.error = {
              message: `compact binding receipt failed and resident rollback failed: ${rollbackError.message}`,
            };
          }
        } else {
          state = applyGpuBondMutationState(sourceState, bondMutationState);
        }
      } catch (error) {
        receipt.failurePhase = receipt.failurePhase || 'warm-binding';
        receipt.error = cloneError(error);
        if (dispatchSubmitted && !rollbackAttempted) {
          const rollbackError = await restoreAcceptedGpuState(sourceState);
          if (rollbackError) {
            receipt.failurePhase = 'resident-state-rollback';
            receipt.error = cloneError(rollbackError);
          }
        }
        receipt.lifecycle = cloneLifecycle(lifecycle);
        for (const readback of [bondReadback, componentReadback]) {
          try {
            readback.unmap();
          } catch {
            // A failed sibling map may leave this readback unmapped.
          }
        }
        try {
          await device.popErrorScope();
        } catch {
          // Error scope may already have been consumed.
        }
      }
      return receipt;
    });
  };

  const reinitialize = nextState => {
    if (disposeRequested) {
      return Promise.resolve({ status: 'failed', failurePhase: 'disposed', objectIdentity });
    }
    return enqueue(async () => {
      const nextIdentity = layeredStructuralHotSidecarObjectIdentity(nextState);
      if (nextIdentity !== objectIdentity) {
        return {
          status: 'failed',
          failurePhase: 'object-identity',
          objectIdentity,
          requestedObjectIdentity: nextIdentity,
        };
      }
      const nextPacked = packLayeredStructuralGpuSnapshot(nextState, {});
      state = nextState;
      eventEpoch = 0;
      device.queue.writeBuffer(nodeBuffer, 0, nextPacked.nodeData);
      device.queue.writeBuffer(bondBuffer, 0, nextPacked.bondData);
      device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));
      device.queue.writeBuffer(
        componentLabelBuffer,
        0,
        Uint32Array.from({ length: packed.nodeCount }, (_, index) => index),
      );
      await device.queue.onSubmittedWorkDone();
      lifecycle.reinitializeCount += 1;
      lifecycle.residentStateTrusted = true;
      return {
        status: 'passed',
        effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
        objectIdentity,
        eventEpoch,
        lifecycle: cloneLifecycle(lifecycle),
      };
    });
  };

  const dispose = () => {
    if (disposePromise) return disposePromise;
    disposeRequested = true;
    disposePromise = enqueue(async () => {
      if (!disposed) {
        for (const buffer of buffers) {
          try {
            buffer.destroy();
            lifecycle.bufferDestroyCount += 1;
          } catch {
            lifecycle.bufferDestroyErrorCount += 1;
          }
        }
        try {
          device.destroy();
          lifecycle.deviceDestroyCount += 1;
        } catch {
          lifecycle.deviceDestroyErrorCount += 1;
        }
        disposed = true;
        lifecycle.disposed = true;
      }
      return {
        status: lifecycle.bufferDestroyCount === lifecycle.bufferAllocationCount &&
          lifecycle.bufferDestroyErrorCount === 0 &&
          lifecycle.deviceDestroyCount === 1 &&
          lifecycle.deviceDestroyErrorCount === 0
          ? 'passed'
          : 'failed',
        effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
        authority: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
        objectIdentity,
        lifecycle: cloneLifecycle(lifecycle),
      };
    });
    return disposePromise;
  };

  return {
    status: 'initialized',
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
    effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
    authority: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
    objectIdentity,
    adapter: adapterIdentity,
    coldTimingsMs: { ...coldTimingsMs },
    initializationLifecycle: cloneLifecycle(lifecycle),
    execute,
    bind,
    reinitialize,
    dispose,
    snapshot() {
      return {
        status: disposed ? 'disposed' : 'initialized',
        objectIdentity,
        eventEpoch,
        lifecycle: cloneLifecycle(lifecycle),
      };
    },
  };
}
