import { evaluateLayeredStructuralBondResponse } from './structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_CPU_ORACLE_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_COMPUTE_SHADER,
  STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_INTERACTION_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES,
  STRUCTURAL_MATERIAL_3D_WEBGPU_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE,
  layeredStructuralGpuAbiDescriptor,
  layeredStructuralGpuAdapterIdentity,
  layeredStructuralGpuNow,
  packLayeredStructuralGpuInteraction,
  packLayeredStructuralGpuSnapshot,
  parseLayeredStructuralGpuBondLiveness,
  parseLayeredStructuralGpuEvents,
  parseLayeredStructuralGpuResponses,
} from './structural-material-3d-webgpu-core.js';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE = 'kaminos.structural-material.webgpu-retained-bond-sequence.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_AUTHORITY = 'webgpu-retained-bond-liveness-and-event-journal-v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_SEQUENCE_AUTHORITY = 'ordered-screen-space-force-epochs-v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function effectiveVector(vector = {}) {
  const x = finite(vector.x);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length < 0.000001) return { x: 1, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function effectivePoint(point = {}) {
  return {
    x: clamp(point.x ?? 0.9, 0, 1),
    y: clamp(point.y ?? 0.5, 0, 1),
    z: clamp(point.z ?? 0.5, 0, 1),
  };
}

function float32(value) {
  return Math.fround(finite(value));
}

function effectiveInteraction(interaction = {}, eventEpoch) {
  const vector = effectiveVector(interaction.vector);
  const point = effectivePoint(interaction.point);
  return {
    eventEpoch,
    vector: {
      x: float32(vector.x),
      y: float32(vector.y),
      z: float32(vector.z),
    },
    point: {
      x: float32(point.x),
      y: float32(point.y),
      z: float32(point.z),
    },
    magnitude: float32(clamp(interaction.magnitude, 0, 5)),
    radius: float32(clamp(interaction.radius, 0.06, 0.8)),
  };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sameNumericSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sortedEventIds(events) {
  return events.map(event => event.bondIndex).sort((a, b) => a - b);
}

function eventEpochHistogram(events) {
  const histogram = {};
  for (const event of events) {
    const epoch = String(event.eventEpoch);
    histogram[epoch] = (histogram[epoch] || 0) + 1;
  }
  return histogram;
}

export function layeredStructuralInteractionSequenceIdentity(interactions = []) {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    throw new Error('retained WebGPU interaction sequence must contain at least one epoch');
  }
  const effective = interactions.map((interaction, index) => effectiveInteraction(interaction, index + 1));
  return `kaminos.structural-material.interaction-sequence.v0:${fnv1a(JSON.stringify(effective))}:n${effective.length}`;
}

export function buildLayeredStructuralRetainedWitnessInteractions(force) {
  return [
    {
      kind: 'sub-threshold-contact',
      point: { x: 0.7, y: 0.35, z: 0.5 },
      vector: { x: 0.9, y: 0.1, z: 0.2 },
      magnitude: 0.2,
      radius: 0.2,
    },
    { ...force, point: { ...force.point }, vector: { ...force.vector } },
    { ...force, point: { ...force.point }, vector: { ...force.vector } },
    {
      ...force,
      kind: 'shifted-depth-shear',
      point: { x: 0.78, y: 0.62, z: 0.28 },
      vector: { x: 0.68, y: -0.18, z: -0.71 },
      magnitude: 1.72,
      radius: 0.24,
    },
  ];
}

export function buildLayeredStructuralCpuSequenceOracle(state, interactions = []) {
  const sequenceIdentity = layeredStructuralInteractionSequenceIdentity(interactions);
  let bonds = state.bonds.map(bond => ({
    ...bond,
    direction: { ...bond.direction },
    midpoint: { ...bond.midpoint },
  }));
  const eventCandidates = [];
  let responses = [];

  interactions.forEach((interaction, interactionIndex) => {
    const eventEpoch = interactionIndex + 1;
    responses = bonds.map((bond, bondIndex) => {
      const response = evaluateLayeredStructuralBondResponse(bond, interaction);
      if (response.shouldBreak) {
        eventCandidates.push({
          bondIndex,
          bondId: bond.id,
          bondKind: bond.bondKind,
          geometryRole: bond.geometryRole,
          cause: 'stress-threshold',
          stress: response.stress,
          strain: response.strain,
          energy: response.energy,
          midpoint: { ...bond.midpoint },
          eventEpoch,
        });
      }
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
    bonds = bonds.map((bond, bondIndex) => ({
      ...bond,
      alive: responses[bondIndex].nextAlive,
      cause: responses[bondIndex].shouldBreak ? 'stress-threshold' : bond.cause,
      lastStress: responses[bondIndex].stress,
      lastStrain: responses[bondIndex].strain,
    }));
  });

  return {
    authority: `${STRUCTURAL_MATERIAL_3D_CPU_ORACLE_AUTHORITY}:retained-sequence-v0`,
    sequenceAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_SEQUENCE_AUTHORITY,
    sequenceIdentity,
    interactionCount: interactions.length,
    responseCount: responses.length,
    eventCandidateCount: eventCandidates.length,
    eventEpochHistogram: eventEpochHistogram(eventCandidates),
    responses,
    eventCandidates,
    finalBondLiveness: bonds.map(bond => bond.alive),
  };
}

export function compareLayeredStructuralRetainedGpuParity(cpuOracle, gpuResult, options = {}) {
  const tolerances = {
    stress: finite(options.stressTolerance, 0.0005),
    strain: finite(options.strainTolerance, 0.0005),
    energy: finite(options.energyTolerance, 0.0005),
    midpoint: finite(options.midpointTolerance, 0.00001),
  };
  const lifecycle = gpuResult.lifecycle || {};
  const lifecycleMatches = lifecycle.adapterRequestCount === 1 &&
    lifecycle.deviceRequestCount === 1 &&
    lifecycle.pipelineCreateCount === 1 &&
    lifecycle.interactionUploadCount === cpuOracle.interactionCount &&
    lifecycle.dispatchCount === cpuOracle.interactionCount &&
    lifecycle.dispatchSubmissionCount === cpuOracle.interactionCount &&
    lifecycle.intermediateReadbackCount === 0 &&
    lifecycle.validationReadbackCount === 1 &&
    lifecycle.readbackSubmissionCount === 1;
  const sequenceIdentityMatches = gpuResult.requestedSequenceIdentity === cpuOracle.sequenceIdentity &&
    gpuResult.effectiveSequenceIdentity === cpuOracle.sequenceIdentity;

  let responseIdentityMatches = cpuOracle.responses.length === gpuResult.responses.length;
  let responseLivenessMatches = responseIdentityMatches;
  let numericValuesFinite = true;
  let maxStressError = 0;
  let maxStrainError = 0;
  let maxEnergyError = 0;
  for (let index = 0; index < cpuOracle.responses.length; index += 1) {
    const expected = cpuOracle.responses[index];
    const actual = gpuResult.responses[index];
    if (!actual) {
      responseIdentityMatches = false;
      responseLivenessMatches = false;
      numericValuesFinite = false;
      maxStressError = Infinity;
      maxStrainError = Infinity;
      maxEnergyError = Infinity;
      continue;
    }
    responseIdentityMatches = responseIdentityMatches &&
      actual.bondIndex === expected.bondIndex &&
      actual.bondId === expected.bondId &&
      actual.bondKind === expected.bondKind &&
      actual.geometryRole === expected.geometryRole;
    responseLivenessMatches = responseLivenessMatches && actual.nextAlive === expected.nextAlive;
    maxStressError = Math.max(maxStressError, Math.abs(expected.stress - actual.stress));
    maxStrainError = Math.max(maxStrainError, Math.abs(expected.strain - actual.strain));
    maxEnergyError = Math.max(maxEnergyError, Math.abs(expected.energy - actual.energy));
    numericValuesFinite = numericValuesFinite && [actual.stress, actual.strain, actual.energy].every(Number.isFinite);
  }

  const finalLivenessMatches = cpuOracle.finalBondLiveness.length === gpuResult.finalBondLiveness.length &&
    cpuOracle.finalBondLiveness.every((alive, index) => gpuResult.finalBondLiveness[index] === alive);
  const expectedEventIds = sortedEventIds(cpuOracle.eventCandidates);
  const actualEventIds = sortedEventIds(gpuResult.eventCandidates);
  const eventSetMatches = sameNumericSet(expectedEventIds, actualEventIds);
  const noDuplicateEvents = new Set(actualEventIds).size === actualEventIds.length;
  const gpuEventByBond = new Map(gpuResult.eventCandidates.map(event => [event.bondIndex, event]));
  let eventPayloadMatches = eventSetMatches;
  let eventEpochsMatch = eventSetMatches;
  let maxEventStressError = 0;
  let maxEventStrainError = 0;
  let maxEventEnergyError = 0;
  let maxEventMidpointError = 0;
  for (const expected of cpuOracle.eventCandidates) {
    const actual = gpuEventByBond.get(expected.bondIndex);
    if (!actual) {
      eventPayloadMatches = false;
      eventEpochsMatch = false;
      numericValuesFinite = false;
      maxEventStressError = Infinity;
      maxEventStrainError = Infinity;
      maxEventEnergyError = Infinity;
      maxEventMidpointError = Infinity;
      continue;
    }
    eventPayloadMatches = eventPayloadMatches &&
      actual.bondId === expected.bondId &&
      actual.bondKind === expected.bondKind &&
      actual.geometryRole === expected.geometryRole &&
      actual.cause === expected.cause;
    eventEpochsMatch = eventEpochsMatch && actual.eventEpoch === expected.eventEpoch;
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
  }

  const eventCountMatches = gpuResult.eventCount === cpuOracle.eventCandidateCount &&
    gpuResult.eventCandidates.length === cpuOracle.eventCandidateCount;
  const eventOverflowCount = Math.max(0, Math.floor(finite(gpuResult.eventOverflowCount)));
  const numericParity = numericValuesFinite &&
    maxStressError <= tolerances.stress &&
    maxStrainError <= tolerances.strain &&
    maxEnergyError <= tolerances.energy &&
    maxEventStressError <= tolerances.stress &&
    maxEventStrainError <= tolerances.strain &&
    maxEventEnergyError <= tolerances.energy &&
    maxEventMidpointError <= tolerances.midpoint;

  return {
    ok: lifecycleMatches && sequenceIdentityMatches && responseIdentityMatches && responseLivenessMatches &&
      finalLivenessMatches && eventSetMatches && eventPayloadMatches && eventEpochsMatch && noDuplicateEvents &&
      eventCountMatches && eventOverflowCount === 0 && numericParity,
    tolerances,
    lifecycleMatches,
    sequenceIdentityMatches,
    responseIdentityMatches,
    responseLivenessMatches,
    finalLivenessMatches,
    eventSetMatches,
    eventPayloadMatches,
    eventEpochsMatch,
    noDuplicateEvents,
    eventCountMatches,
    numericValuesFinite,
    numericParity,
    eventOverflowCount,
    cpuEventCount: cpuOracle.eventCandidateCount,
    gpuEventCount: gpuResult.eventCandidates.length,
    finalAliveBondCount: gpuResult.finalBondLiveness.filter(Boolean).length,
    finalBrokenBondCount: gpuResult.finalBondLiveness.filter(alive => !alive).length,
    maxStressError,
    maxStrainError,
    maxEnergyError,
    maxEventStressError,
    maxEventStrainError,
    maxEventEnergyError,
    maxEventMidpointError,
  };
}

export function layeredStructuralRetainedResultFingerprint(gpuResult) {
  const payload = {
    sequenceIdentity: gpuResult.effectiveSequenceIdentity,
    finalBondLiveness: gpuResult.finalBondLiveness,
    events: gpuResult.eventCandidates.map(event => ({
      bondIndex: event.bondIndex,
      eventEpoch: event.eventEpoch,
      stress: float32(event.stress),
      strain: float32(event.strain),
      energy: float32(event.energy),
    })),
  };
  return `kaminos.structural-material.retained-result.v0:${fnv1a(JSON.stringify(payload))}`;
}

function emptyLifecycle() {
  return {
    adapterRequestCount: 0,
    deviceRequestCount: 0,
    pipelineCreateCount: 0,
    interactionUploadCount: 0,
    dispatchCount: 0,
    dispatchSubmissionCount: 0,
    intermediateReadbackCount: 0,
    validationReadbackCount: 0,
    readbackSubmissionCount: 0,
    mappedBufferCount: 0,
    bufferAllocationCount: 0,
    bufferDestroyCount: 0,
    bufferDestroyErrorCount: 0,
    deviceDestroyCount: 0,
    deviceDestroyErrorCount: 0,
    cleanupMatches: false,
  };
}

export function layeredStructuralRetainedCleanupMatches(lifecycle = {}) {
  return lifecycle.adapterRequestCount === 1 &&
    lifecycle.deviceRequestCount === 1 &&
    lifecycle.validationReadbackCount === 1 &&
    lifecycle.mappedBufferCount === 4 &&
    lifecycle.bufferAllocationCount === 10 &&
    lifecycle.bufferDestroyCount === lifecycle.bufferAllocationCount &&
    lifecycle.bufferDestroyErrorCount === 0 &&
    lifecycle.deviceDestroyCount === 1 &&
    lifecycle.deviceDestroyErrorCount === 0;
}

export async function runLayeredStructuralRetainedWebGpuParity(options = {}) {
  const state = options.state;
  const interactions = options.interactions || [];
  const cpuOracle = buildLayeredStructuralCpuSequenceOracle(state, interactions);
  const requestedSequenceIdentity = options.requestedSequenceIdentity || cpuOracle.sequenceIdentity;
  const effectiveSequenceIdentity = layeredStructuralInteractionSequenceIdentity(interactions);
  const packed = packLayeredStructuralGpuSnapshot(state, interactions[0]);
  const lifecycle = emptyLifecycle();
  const result = {
    schema: 'kaminos.structural-material.webgpu-retained-sequence-receipt.v0',
    status: 'failed',
    failurePhase: 'gpu-availability',
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
    effectiveRoute: null,
    requestedBackend: 'webgpu',
    effectiveBackend: null,
    cpuFallbackUsed: false,
    solverAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_SOLVER_AUTHORITY,
    retainedAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_AUTHORITY,
    cpuOracleAuthority: cpuOracle.authority,
    sequenceAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_SEQUENCE_AUTHORITY,
    requestedSequenceIdentity,
    effectiveSequenceIdentity: null,
    interactionCount: interactions.length,
    abi: layeredStructuralGpuAbiDescriptor(),
    adapter: null,
    lifecycle,
    dispatch: null,
    timingsMs: {},
    cpuOracle: {
      responseCount: cpuOracle.responseCount,
      eventCandidateCount: cpuOracle.eventCandidateCount,
      eventEpochHistogram: cpuOracle.eventEpochHistogram,
      finalAliveBondCount: cpuOracle.finalBondLiveness.filter(Boolean).length,
      finalBrokenBondCount: cpuOracle.finalBondLiveness.filter(alive => !alive).length,
    },
    gpuResult: null,
    parity: null,
    resultFingerprint: null,
    error: null,
  };
  const gpu = Object.prototype.hasOwnProperty.call(options, 'gpu')
    ? options.gpu
    : globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) {
    result.error = { message: 'navigator.gpu unavailable; CPU fallback is forbidden for retained structural state' };
    return result;
  }

  let device;
  let errorScopeOpen = false;
  const buffers = [];
  const cleanupErrors = [];
  try {
    result.failurePhase = 'adapter-request';
    lifecycle.adapterRequestCount += 1;
    const adapterStart = layeredStructuralGpuNow();
    const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference || 'high-performance' });
    result.timingsMs.adapterRequest = layeredStructuralGpuNow() - adapterStart;
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    result.adapter = layeredStructuralGpuAdapterIdentity(adapter);

    result.failurePhase = 'device-request';
    lifecycle.deviceRequestCount += 1;
    const deviceStart = layeredStructuralGpuNow();
    device = await adapter.requestDevice();
    result.timingsMs.deviceRequest = layeredStructuralGpuNow() - deviceStart;
    const usage = globalThis.GPUBufferUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !mapMode) throw new Error('WebGPU constants unavailable in effective runtime');

    result.failurePhase = 'buffer-allocation';
    const makeBuffer = descriptor => {
      const buffer = device.createBuffer(descriptor);
      buffers.push(buffer);
      lifecycle.bufferAllocationCount += 1;
      return buffer;
    };
    const nodeBuffer = makeBuffer({ label: 'retained-structural-node-storage', size: packed.nodeData.byteLength, usage: usage.STORAGE | usage.COPY_DST });
    const bondBuffer = makeBuffer({ label: 'retained-structural-bond-storage', size: packed.bondData.byteLength, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC });
    const interactionBuffer = makeBuffer({ label: 'retained-structural-interaction-uniform', size: STRUCTURAL_MATERIAL_3D_WEBGPU_INTERACTION_BYTES, usage: usage.UNIFORM | usage.COPY_DST });
    const responseBuffer = makeBuffer({ label: 'retained-structural-response-storage', size: packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES, usage: usage.STORAGE | usage.COPY_SRC });
    const eventHeaderBuffer = makeBuffer({ label: 'retained-structural-event-header', size: STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC });
    const eventBuffer = makeBuffer({ label: 'retained-structural-event-storage', size: packed.eventCapacity * STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES, usage: usage.STORAGE | usage.COPY_SRC });
    const bondReadback = makeBuffer({ label: 'retained-structural-bond-readback', size: packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    const responseReadback = makeBuffer({ label: 'retained-structural-response-readback', size: packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    const eventHeaderReadback = makeBuffer({ label: 'retained-structural-event-header-readback', size: STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    const eventReadback = makeBuffer({ label: 'retained-structural-event-readback', size: packed.eventCapacity * STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES, usage: usage.COPY_DST | usage.MAP_READ });
    device.queue.writeBuffer(nodeBuffer, 0, packed.nodeData);
    device.queue.writeBuffer(bondBuffer, 0, packed.bondData);
    device.queue.writeBuffer(eventHeaderBuffer, 0, new Uint32Array(4));

    result.failurePhase = 'pipeline-compile';
    device.pushErrorScope('validation');
    errorScopeOpen = true;
    const shaderModule = device.createShaderModule({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
      code: STRUCTURAL_MATERIAL_3D_WEBGPU_COMPUTE_SHADER,
    });
    lifecycle.pipelineCreateCount += 1;
    const pipelineStart = layeredStructuralGpuNow();
    const pipeline = await device.createComputePipelineAsync({
      label: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
    result.timingsMs.pipelineCompile = layeredStructuralGpuNow() - pipelineStart;
    const bindGroup = device.createBindGroup({
      label: 'retained-structural-bind-group',
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

    result.failurePhase = 'retained-dispatch-sequence';
    const workgroupCount = Math.ceil(packed.bondCount / STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE);
    const sequenceStart = layeredStructuralGpuNow();
    interactions.forEach((interaction, interactionIndex) => {
      const eventEpoch = interactionIndex + 1;
      const interactionData = packLayeredStructuralGpuInteraction(state, interaction, {
        eventCapacity: packed.eventCapacity,
        eventEpoch,
      });
      device.queue.writeBuffer(interactionBuffer, 0, interactionData);
      lifecycle.interactionUploadCount += 1;
      const encoder = device.createCommandEncoder({ label: `retained-structural-epoch-${eventEpoch}` });
      const pass = encoder.beginComputePass({ label: `${STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE}:epoch-${eventEpoch}` });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();
      device.queue.submit([encoder.finish()]);
      lifecycle.dispatchCount += 1;
      lifecycle.dispatchSubmissionCount += 1;
    });
    result.timingsMs.dispatchSequenceCpuEnqueue = layeredStructuralGpuNow() - sequenceStart;

    result.failurePhase = 'terminal-readback-copy';
    const readbackEncoder = device.createCommandEncoder({ label: 'retained-structural-terminal-readback' });
    readbackEncoder.copyBufferToBuffer(bondBuffer, 0, bondReadback, 0, packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_BOND_STRIDE_BYTES);
    readbackEncoder.copyBufferToBuffer(responseBuffer, 0, responseReadback, 0, packed.bondCount * STRUCTURAL_MATERIAL_3D_WEBGPU_RESPONSE_STRIDE_BYTES);
    readbackEncoder.copyBufferToBuffer(eventHeaderBuffer, 0, eventHeaderReadback, 0, STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_HEADER_BYTES);
    readbackEncoder.copyBufferToBuffer(eventBuffer, 0, eventReadback, 0, packed.eventCapacity * STRUCTURAL_MATERIAL_3D_WEBGPU_EVENT_STRIDE_BYTES);
    device.queue.submit([readbackEncoder.finish()]);
    lifecycle.readbackSubmissionCount += 1;
    await device.queue.onSubmittedWorkDone();
    result.timingsMs.sequenceAndTerminalCopyGpuCompletion = layeredStructuralGpuNow() - sequenceStart;

    result.failurePhase = 'terminal-validation-readback';
    lifecycle.validationReadbackCount += 1;
    lifecycle.mappedBufferCount += 4;
    const readbackStart = layeredStructuralGpuNow();
    await Promise.all([
      bondReadback.mapAsync(mapMode.READ),
      responseReadback.mapAsync(mapMode.READ),
      eventHeaderReadback.mapAsync(mapMode.READ),
      eventReadback.mapAsync(mapMode.READ),
    ]);
    const bondBytes = bondReadback.getMappedRange().slice(0);
    const responseBytes = responseReadback.getMappedRange().slice(0);
    const headerBytes = eventHeaderReadback.getMappedRange().slice(0);
    const eventBytes = eventReadback.getMappedRange().slice(0);
    bondReadback.unmap();
    responseReadback.unmap();
    eventHeaderReadback.unmap();
    eventReadback.unmap();
    result.timingsMs.terminalReadbackMap = layeredStructuralGpuNow() - readbackStart;

    const headerView = new DataView(headerBytes);
    const eventCount = headerView.getUint32(0, true);
    const eventOverflowCount = headerView.getUint32(4, true);
    const readableEventCount = Math.min(eventCount, packed.eventCapacity);
    const gpuResult = {
      requestedSequenceIdentity,
      effectiveSequenceIdentity,
      lifecycle,
      responses: parseLayeredStructuralGpuResponses(responseBytes, state),
      eventCandidates: parseLayeredStructuralGpuEvents(eventBytes, readableEventCount, state),
      finalBondLiveness: parseLayeredStructuralGpuBondLiveness(bondBytes, state),
      eventCount,
      eventOverflowCount,
    };

    result.failurePhase = 'validation';
    const validationError = await device.popErrorScope();
    errorScopeOpen = false;
    if (validationError) throw new Error(`WebGPU validation error: ${validationError.message}`);
    result.parity = compareLayeredStructuralRetainedGpuParity(cpuOracle, gpuResult, options.tolerances || {});
    result.resultFingerprint = layeredStructuralRetainedResultFingerprint(gpuResult);
    result.gpuResult = {
      responseCount: gpuResult.responses.length,
      eventCandidateCount: gpuResult.eventCandidates.length,
      eventCount,
      eventOverflowCount,
      eventBondIndices: sortedEventIds(gpuResult.eventCandidates),
      eventEpochs: gpuResult.eventCandidates.map(event => event.eventEpoch),
      eventEpochHistogram: eventEpochHistogram(gpuResult.eventCandidates),
      finalAliveBondCount: gpuResult.finalBondLiveness.filter(Boolean).length,
      finalBrokenBondCount: gpuResult.finalBondLiveness.filter(alive => !alive).length,
    };
    result.dispatch = {
      workgroupSize: STRUCTURAL_MATERIAL_3D_WEBGPU_WORKGROUP_SIZE,
      workgroupCount,
      interactionCount: interactions.length,
      bondCount: packed.bondCount,
      nodeCount: packed.nodeCount,
      eventCapacity: packed.eventCapacity,
    };
    result.effectiveSequenceIdentity = effectiveSequenceIdentity;
    if (!result.parity.ok) throw new Error('retained WebGPU structural state diverged from sequential CPU oracle');

    result.status = 'passed';
    result.failurePhase = null;
    result.effectiveRoute = STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE;
    result.effectiveBackend = 'webgpu';
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
  } finally {
    for (const buffer of buffers) {
      if (typeof buffer.destroy !== 'function') {
        lifecycle.bufferDestroyErrorCount += 1;
        cleanupErrors.push('allocated WebGPU buffer did not expose destroy()');
        continue;
      }
      try {
        buffer.destroy();
        lifecycle.bufferDestroyCount += 1;
      } catch (error) {
        lifecycle.bufferDestroyErrorCount += 1;
        cleanupErrors.push(`WebGPU buffer destruction failed: ${error.message}`);
      }
    }
    if (device) {
      if (typeof device.destroy !== 'function') {
        lifecycle.deviceDestroyErrorCount += 1;
        cleanupErrors.push('created WebGPU device did not expose destroy()');
      } else {
        try {
          device.destroy();
          lifecycle.deviceDestroyCount += 1;
        } catch (error) {
          lifecycle.deviceDestroyErrorCount += 1;
          cleanupErrors.push(`WebGPU device destruction failed: ${error.message}`);
        }
      }
    }
  }
  lifecycle.cleanupMatches = layeredStructuralRetainedCleanupMatches(lifecycle);
  if (result.parity) {
    result.parity.cleanupMatches = lifecycle.cleanupMatches;
    result.parity.ok = result.parity.ok && lifecycle.cleanupMatches;
  }
  if (result.status === 'passed' && !lifecycle.cleanupMatches) {
    result.status = 'failed';
    result.failurePhase = 'resource-cleanup-validation';
    result.effectiveRoute = null;
    result.effectiveBackend = null;
    result.error = {
      name: 'Error',
      message: cleanupErrors.length > 0
        ? `retained WebGPU cleanup failed: ${cleanupErrors.join('; ')}`
        : 'retained WebGPU cleanup accounting did not satisfy the terminal lifecycle contract',
    };
  }
  return result;
}
