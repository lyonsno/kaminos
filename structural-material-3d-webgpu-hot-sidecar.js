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
  parseLayeredStructuralGpuBondLiveness,
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
  if (lifecycle.pipelineCreateCount !== 2) reasons.push('pipeline-lifecycle');
  if (lifecycle.bufferAllocationCount !== 9) reasons.push('buffer-lifecycle');
  if (lifecycle.executionCount < 1) reasons.push('execution-lifecycle');
  if (lifecycle.executionAttemptCount < lifecycle.executionCount) reasons.push('execution-attempt-lifecycle');
  if (lifecycle.eventHeaderResetCount !== lifecycle.executionAttemptCount) reasons.push('event-header-lifecycle');
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

function makeLifecycle() {
  return {
    adapterRequestCount: 0,
    deviceRequestCount: 0,
    pipelineCreateCount: 0,
    bufferAllocationCount: 0,
    executionAttemptCount: 0,
    executionCount: 0,
    eventHeaderResetCount: 0,
    interactionUploadCount: 0,
    dispatchCount: 0,
    dispatchSubmissionCount: 0,
    topologyDispatchCount: 0,
    compactReadbackCount: 0,
    compactReadbackBufferCount: 2,
    fullValidationReadbackCount: 0,
    reinitializeCount: 0,
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
  let topologyPipeline;
  let fractureBindGroup;
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
      try {
        if (disposed) throw new Error('hot structural sidecar is disposed');
        eventEpoch += 1;
        const interactionData = packLayeredStructuralGpuInteraction(state, interaction, {
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
        const finalBondLiveness = parseLayeredStructuralGpuBondLiveness(bondBytes, state);
        const componentLabels = Array.from(new Uint32Array(componentBytes));
        const topology = deriveTopology(state, componentLabels);
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
        const validation = validateLayeredStructuralHotSidecarReceipt(state, receipt);
        receipt.compactValidation = validation;
        if (!validation.ok) {
          receipt.status = 'failed';
          receipt.effectiveRoute = null;
          receipt.failurePhase = 'compact-receipt-validation';
          receipt.error = { message: `compact receipt failed: ${validation.reasons.join(', ')}` };
        }
      } catch (error) {
        receipt.failurePhase = receipt.failurePhase || 'warm-execution';
        receipt.error = cloneError(error);
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
