import {
  EXACT_STATE_CADENCE_RING_IDENTITY,
  createExactStateCadenceRing,
  exactStateCadenceAllocationPlan,
  planExactStateProduction,
  recordCompletedExactState,
  resetExactStateCadenceRing,
  selectExactStatePresentation,
} from './volume-exact-state-cadence-ring.mjs';

export const EXACT_STATE_CADENCE_GPU_IDENTITY = 'kaminos.volume.exact-state-cadence-gpu.v0';

const INTERPOLATION_WORKGROUP_SIZE = 256;
const INTERPOLATION_UNIFORM_BYTES = 16;

const INTERPOLATION_WGSL = /* wgsl */ `
struct InterpolationParams {
  alpha: f32,
  fluidFloatCount: u32,
  frontFloatCount: u32,
  controlGeneration: u32,
};

@group(0) @binding(0) var<uniform> params: InterpolationParams;
@group(0) @binding(1) var<storage, read> fromFluid: array<f32>;
@group(0) @binding(2) var<storage, read> toFluid: array<f32>;
@group(0) @binding(3) var<storage, read_write> presentationFluid: array<f32>;
@group(0) @binding(4) var<storage, read> fromFront: array<f32>;
@group(0) @binding(5) var<storage, read> toFront: array<f32>;
@group(0) @binding(6) var<storage, read_write> presentationFront: array<f32>;

@compute @workgroup_size(${INTERPOLATION_WORKGROUP_SIZE})
fn interpolateExactState(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index < params.fluidFloatCount) {
    presentationFluid[index] = mix(fromFluid[index], toFluid[index], params.alpha);
  }
  if (index < params.frontFloatCount) {
    presentationFront[index] = mix(fromFront[index], toFront[index], params.alpha);
  }
}
`;

function invalidRuntime(reason, allocation = null) {
  return {
    ok: false,
    identity: EXACT_STATE_CADENCE_GPU_IDENTITY,
    reason,
    allocation,
  };
}

function positiveByteSize(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function createExactStateCadenceGpuRuntime(options = {}) {
  const device = options.device;
  if (!device) return invalidRuntime('webgpu-device-missing');
  const fluidBytes = positiveByteSize(options.fluidBytes);
  const frontBytes = positiveByteSize(options.frontBytes);
  const allocation = exactStateCadenceAllocationPlan({
    requestedDepth: options.requestedDepth,
    presentationDelaySteps: options.presentationDelaySteps,
    fluidBytes,
    frontBytes,
    maxBufferSize: device.limits?.maxBufferSize,
    maxStorageBufferBindingSize: device.limits?.maxStorageBufferBindingSize,
  });
  if (!allocation.ok) return invalidRuntime('exact-state-cadence-allocation-refused', allocation);

  const ring = createExactStateCadenceRing({
    capacity: allocation.allocatedDepth,
    presentationDelaySteps: allocation.presentationDelaySteps,
    stepDurationMs: options.stepDurationMs,
    controlGeneration: options.controlGeneration,
  });
  const slots = Array.from({ length: allocation.allocatedDepth }, (_, slot) => ({
    slot,
    fluidBuffer: device.createBuffer({
      label: `kaminos exact-state cadence fluid slot ${slot}`,
      size: fluidBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    frontBuffer: device.createBuffer({
      label: `kaminos exact-state cadence front slot ${slot}`,
      size: frontBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  }));
  const presentationFluidBuffer = device.createBuffer({
    label: 'kaminos exact-state cadence presentation fluid',
    size: fluidBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const presentationFrontBuffer = device.createBuffer({
    label: 'kaminos exact-state cadence presentation front',
    size: frontBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const interpolationUniformBuffer = device.createBuffer({
    label: 'kaminos exact-state cadence interpolation parameters',
    size: INTERPOLATION_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const interpolationBindGroupLayout = device.createBindGroupLayout({
    label: 'kaminos exact-state cadence interpolation layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const interpolationPipeline = device.createComputePipeline({
    label: 'kaminos exact-state cadence adjacent-state interpolation',
    layout: device.createPipelineLayout({
      label: 'kaminos exact-state cadence interpolation pipeline layout',
      bindGroupLayouts: [interpolationBindGroupLayout],
    }),
    compute: {
      module: device.createShaderModule({
        label: 'kaminos exact-state cadence interpolation shader',
        code: INTERPOLATION_WGSL,
      }),
      entryPoint: 'interpolateExactState',
    },
  });
  const interpolationBindGroups = new Map();
  let destroyed = false;
  let lastArchiveReceipt = null;
  let lastCompletionReceipt = null;
  let lastPresentationReceipt = null;

  function bindGroupFor(fromSlot, toSlot) {
    const key = `${fromSlot}:${toSlot}`;
    if (interpolationBindGroups.has(key)) return interpolationBindGroups.get(key);
    const from = slots[fromSlot];
    const to = slots[toSlot];
    if (!from || !to) return null;
    const bindGroup = device.createBindGroup({
      label: `kaminos exact-state cadence interpolation ${key}`,
      layout: interpolationBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: interpolationUniformBuffer } },
        { binding: 1, resource: { buffer: from.fluidBuffer } },
        { binding: 2, resource: { buffer: to.fluidBuffer } },
        { binding: 3, resource: { buffer: presentationFluidBuffer } },
        { binding: 4, resource: { buffer: from.frontBuffer } },
        { binding: 5, resource: { buffer: to.frontBuffer } },
        { binding: 6, resource: { buffer: presentationFrontBuffer } },
      ],
    });
    interpolationBindGroups.set(key, bindGroup);
    return bindGroup;
  }

  function planProduction(request = {}) {
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed', allocation);
    return planExactStateProduction(ring, request);
  }

  function encodeProductionArchive(encoder, planReceipt, sourceFluidBuffer, sourceFrontBuffer) {
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed', allocation);
    if (planReceipt?.status !== 'planned') return invalidRuntime('exact-state-production-plan-missing', allocation);
    const slot = slots[planReceipt.slot];
    if (!slot || !sourceFluidBuffer || !sourceFrontBuffer) {
      return invalidRuntime('exact-state-production-buffer-missing', allocation);
    }
    encoder.copyBufferToBuffer(
      sourceFluidBuffer,
      0,
      slot.fluidBuffer,
      0,
      fluidBytes,
    );
    encoder.copyBufferToBuffer(
      sourceFrontBuffer,
      0,
      slot.frontBuffer,
      0,
      frontBytes,
    );
    lastArchiveReceipt = {
      identity: EXACT_STATE_CADENCE_GPU_IDENTITY,
      status: 'encoded-not-completed',
      sourceStep: planReceipt.sourceStep,
      slot: planReceipt.slot,
      controlGeneration: planReceipt.controlGeneration,
      fluidBytes,
      frontBytes,
      copyBytes: fluidBytes + frontBytes,
    };
    return { ok: true, receipt: { ...lastArchiveReceipt } };
  }

  async function completeProduction(planReceipt, submittedAtMs) {
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed', allocation);
    await device.queue.onSubmittedWorkDone();
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed-after-submit', allocation);
    const completion = recordCompletedExactState(ring, {
      sourceStep: planReceipt.sourceStep,
      completedAtMs: Number(submittedAtMs),
      controlGeneration: planReceipt.controlGeneration,
      plannedSlot: planReceipt.slot,
    });
    if (completion.ok) lastCompletionReceipt = completion.receipt;
    return completion;
  }

  function selectPresentation(options = {}) {
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed', allocation);
    return selectExactStatePresentation(ring, options);
  }

  function encodePresentation(encoder, presentationReceipt) {
    if (destroyed) return invalidRuntime('exact-state-cadence-runtime-destroyed', allocation);
    if (presentationReceipt?.status !== 'selected') {
      return invalidRuntime('exact-state-presentation-selection-missing', allocation);
    }
    const bindGroup = bindGroupFor(presentationReceipt.fromSlot, presentationReceipt.toSlot);
    if (!bindGroup) return invalidRuntime('exact-state-presentation-slot-missing', allocation);
    const parameters = new ArrayBuffer(INTERPOLATION_UNIFORM_BYTES);
    const view = new DataView(parameters);
    view.setFloat32(0, presentationReceipt.alpha, true);
    view.setUint32(4, fluidBytes / Float32Array.BYTES_PER_ELEMENT, true);
    view.setUint32(8, frontBytes / Float32Array.BYTES_PER_ELEMENT, true);
    view.setUint32(12, presentationReceipt.controlGeneration, true);
    device.queue.writeBuffer(interpolationUniformBuffer, 0, parameters);
    const pass = encoder.beginComputePass({
      label: `kaminos exact-state cadence present ${presentationReceipt.fromSourceStep}->${presentationReceipt.toSourceStep}`,
    });
    pass.setPipeline(interpolationPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(Math.max(
      fluidBytes / Float32Array.BYTES_PER_ELEMENT,
      frontBytes / Float32Array.BYTES_PER_ELEMENT,
    ) / INTERPOLATION_WORKGROUP_SIZE));
    pass.end();
    lastPresentationReceipt = {
      ...presentationReceipt,
      identity: EXACT_STATE_CADENCE_GPU_IDENTITY,
      status: 'encoded-not-submitted',
      selectionStatus: presentationReceipt.status,
      interpolationDispatches: 1,
    };
    return { ok: true, receipt: { ...lastPresentationReceipt } };
  }

  function reset(options = {}) {
    return resetExactStateCadenceRing(ring, options);
  }

  function debugState() {
    return {
      identity: EXACT_STATE_CADENCE_GPU_IDENTITY,
      ringIdentity: EXACT_STATE_CADENCE_RING_IDENTITY,
      ok: !destroyed,
      authority: ring.oneSimulatorAuthority,
      phaseSource: ring.phaseSource,
      allocation: { ...allocation },
      controlGeneration: ring.controlGeneration,
      residentCount: ring.residentCount,
      oldestSourceStep: ring.oldestSourceStep,
      newestSourceStep: ring.newestSourceStep,
      lastPresentedFromSourceStep: ring.lastPresentedFromSourceStep,
      lastPresentedToSourceStep: ring.lastPresentedToSourceStep,
      lastPresentedAlpha: ring.lastPresentedAlpha,
      refusedCompletionCount: ring.refusedCompletionCount,
      refusedPresentationCount: ring.refusedPresentationCount,
      lastRefusal: ring.lastRefusal,
      lastArchiveReceipt,
      lastCompletionReceipt,
      lastPresentationReceipt,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const slot of slots) {
      slot.fluidBuffer.destroy();
      slot.frontBuffer.destroy();
    }
    presentationFluidBuffer.destroy();
    presentationFrontBuffer.destroy();
    interpolationUniformBuffer.destroy();
    interpolationBindGroups.clear();
  }

  return {
    ok: true,
    identity: EXACT_STATE_CADENCE_GPU_IDENTITY,
    allocation,
    ring,
    slots,
    presentationFluidBuffer,
    presentationFrontBuffer,
    planProduction,
    encodeProductionArchive,
    completeProduction,
    selectPresentation,
    encodePresentation,
    reset,
    debugState,
    destroy,
  };
}
