import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLayeredStructuralWitnessScenario,
  createLayeredStructuralMaterial,
} from '../structural-material-3d-core.js';
import { buildLayeredStructuralCpuSequenceOracle } from '../structural-material-3d-webgpu-retained.js';

const root = new URL('..', import.meta.url).pathname;
const hotCorePath = join(root, 'structural-material-3d-webgpu-hot-sidecar.js');
const hotWitnessPath = join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(hotCorePath), 'persistent WebGPU structural sidecar core exists');
assert.ok(existsSync(hotWitnessPath), 'persistent WebGPU structural sidecar has a reusable browser witness');

const {
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  createLayeredStructuralHotWebGpuSidecar,
  layeredStructuralHotSidecarObjectIdentity,
  validateLayeredStructuralHotSidecarReceipt,
} = await import('../structural-material-3d-webgpu-hot-sidecar.js');

assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  'kaminos.structural-material.webgpu-hot-sidecar.v0',
);
assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
  'persistent-webgpu-device-pipelines-buffers-v0',
);

const hotSource = readFileSync(hotCorePath, 'utf8');
const witnessSource = readFileSync(hotWitnessPath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');

assert.equal(
  (hotSource.match(/createComputePipelineAsync/g) || []).length,
  4,
  'hot sidecar compiles solver, solved fracture, binding, and topology pipelines once during initialization',
);
assert.match(hotSource, /operationQueue/, 'hot sidecar serializes execute, reinitialize, and dispose operations');
assert.match(
  hotSource,
  /lastAcceptedExecution\?\.eventEpoch === eventEpoch/,
  'exact replay is valid only while no later retained-state mutation has advanced the epoch',
);
assert.match(
  hotSource,
  /eventHeaderResetCount/,
  'hot sidecar resets the event journal header for every interaction epoch',
);
assert.match(
  hotSource,
  /cleanupInitializationFailure/,
  'partial initialization destroys every allocated GPU object before rejecting',
);
assert.match(hotSource, /mode: 'interactive'/, 'hot receipts identify interactive execution mode');
assert.match(hotSource, /compactReadbackBufferCount/, 'hot receipts expose compact terminal readback count');
assert.doesNotMatch(hotSource, /buildLayeredStructuralCpuSequenceOracle/, 'interactive runtime does not run the CPU parity oracle');
assert.doesNotMatch(hotSource, /parseLayeredStructuralGpuResponses/, 'interactive runtime does not read full response payloads');
assert.doesNotMatch(hotSource, /parseLayeredStructuralGpuEvents/, 'interactive runtime does not read the event journal');
assert.match(witnessSource, /warmReuse/, 'browser witness proves warm lifecycle reuse');
assert.match(
  witnessSource,
  /sameGenerationOrderedApplication/,
  'browser witness proves immediate same-generation interactions both apply in order',
);
assert.match(
  witnessSource,
  /dispatchProjectedStructuralDrag[\s\S]*?__structuralMaterial3dPickTarget/,
  'each live ordering gesture reacquires a projected target from the currently deformed shell',
);
assert.match(witnessSource, /coldInitialization/, 'browser witness separates cold initialization timing');
assert.match(witnessSource, /disposeIdempotent/, 'browser witness proves idempotent teardown');
assert.match(witnessSource, /requestedRoute/, 'browser witness records the requested hot route');
assert.match(witnessSource, /effectiveRoute/, 'browser witness records the effective hot route');
assert.match(witnessSource, /failurePhase/, 'browser witness preserves failure phase');
assert.match(witnessSource, /cpuFallbackUsed/, 'browser witness rejects CPU fallback');
assert.match(witnessSource, /actualScreenshotPixels/, 'browser witness validates actual screenshot pixels');
assert.match(
  witnessSource,
  /structuralColorPixels/,
  'browser witness requires slab-colored pixels instead of accepting generic page chrome',
);
assert.match(pageSource, /createLayeredStructuralHotWebGpuSidecar/, 'live 3D route creates the persistent sidecar');
assert.doesNotMatch(
  pageSource,
  /gpuTearAppliedReceipts\.push/,
  'witness bookkeeping does not retain every full GPU receipt for the page lifetime',
);
assert.match(
  pageSource,
  /buildLayeredStructuralHotSympatheticTearFailureReceipt/,
  'live 3D route converts sidecar rejection into a route-identified product receipt',
);
assert.match(
  pageSource,
  /synchronizeHotSidecar[\s\S]*?\.catch\(/,
  'reset and bind synchronization consume and report sidecar rejection',
);
assert.match(pageSource, /runLayeredStructuralRetainedWebGpuParity/, 'cold exact validation route remains available');

const state = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const objectIdentity = layeredStructuralHotSidecarObjectIdentity(state);
assert.match(objectIdentity, /^kaminos\.structural-material\.hot-object\.v0:[0-9a-f]{8}:n180:b631$/);

const previousUsage = globalThis.GPUBufferUsage;
const previousMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = {
  STORAGE: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
  UNIFORM: 8,
  MAP_READ: 16,
};
globalThis.GPUMapMode = { READ: 1 };
const destroyedBuffers = [];
let destroyedDeviceCount = 0;
const failingDevice = {
  queue: { writeBuffer() {} },
  createBuffer(descriptor) {
    return {
      descriptor,
      destroy() {
        destroyedBuffers.push(descriptor.label);
      },
    };
  },
  createShaderModule() {
    return {};
  },
  async createComputePipelineAsync() {
    throw new Error('injected pipeline initialization failure');
  },
  destroy() {
    destroyedDeviceCount += 1;
  },
};
let initializationError;
try {
  await createLayeredStructuralHotWebGpuSidecar({
    state,
    gpu: {
      async requestAdapter() {
        return {
          info: { vendor: 'test' },
          async requestDevice() {
            return failingDevice;
          },
        };
      },
    },
  });
} catch (error) {
  initializationError = error;
} finally {
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode;
  else globalThis.GPUMapMode = previousMapMode;
}
assert.equal(initializationError?.message, 'injected pipeline initialization failure');
assert.equal(destroyedBuffers.length, 13, 'failed initialization destroys all allocated buffers');
assert.equal(destroyedDeviceCount, 1, 'failed initialization destroys its device');
assert.deepEqual(
  initializationError?.hotSidecarInitialization?.lifecycle,
  {
    adapterRequestCount: 1,
    deviceRequestCount: 1,
    pipelineCreateCount: 1,
    bufferAllocationCount: 13,
    executionAttemptCount: 0,
    executionCount: 0,
    bindingAttemptCount: 0,
    bindingCount: 0,
    bindingDispatchCount: 0,
    bindEventCount: 0,
    eventHeaderResetCount: 0,
    interactionUploadCount: 0,
    dispatchCount: 0,
    solverDispatchCount: 0,
    solverNodeReadbackCount: 0,
    dispatchSubmissionCount: 0,
    topologyDispatchCount: 0,
    compactReadbackCount: 0,
    compactReadbackBufferCount: 2,
    fullValidationReadbackCount: 0,
    reinitializeCount: 0,
    rollbackCount: 0,
    rollbackFailureCount: 0,
    residentStateTrusted: true,
    bufferDestroyCount: 13,
    bufferDestroyErrorCount: 0,
    deviceDestroyCount: 1,
    deviceDestroyErrorCount: 0,
    disposed: true,
  },
  'failed initialization carries a complete cleanup receipt',
);

const scenario = buildLayeredStructuralWitnessScenario();
const exactReceipt = {
  schema: 'kaminos.structural-material.webgpu-hot-sidecar-interaction-receipt.v0',
  status: 'passed',
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  requestedBackend: 'webgpu',
  effectiveBackend: 'webgpu',
  cpuFallbackUsed: false,
  authority: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_AUTHORITY,
  mode: 'interactive',
  objectIdentity,
  eventEpoch: 1,
  interaction: scenario.force,
  lifecycle: {
    adapterRequestCount: 1,
    deviceRequestCount: 1,
    pipelineCreateCount: 4,
    bufferAllocationCount: 13,
    executionAttemptCount: 1,
    executionCount: 1,
    bindingAttemptCount: 0,
    bindingCount: 0,
    bindingDispatchCount: 0,
    bindEventCount: 0,
    eventHeaderResetCount: 1,
    solverDispatchCount: 12,
    solverNodeReadbackCount: 1,
    compactReadbackCount: 1,
    compactReadbackBufferCount: 2,
    fullValidationReadbackCount: 0,
    disposed: false,
  },
  gpuStructuralState: {
    finalBondLiveness: state.bonds.map(() => true),
    componentLabels: state.nodes.map(() => 0),
    nodeDisplacements: state.nodes.map(() => ({ x: 0, y: 0, z: 0 })),
  },
  solver: {
    route: 'kaminos.structural-material.webgpu-resident-compliant-jacobi.v0',
    authority: 'retained-webgpu-node-displacement-live-bond-constraints-v0',
    iterationCount: 12,
    dispatchCount: 12,
    generation: { before: 0, after: 1 },
    metrics: {
      maxConstraintResidual: 0,
      meanConstraintResidual: 0,
      contactTargetError: 0,
      maxPinnedDisplacement: 0,
      nonPrimaryCurrentResponse: 0,
    },
  },
  topology: {
    authority: 'webgpu-minimum-node-component-labels-v0',
    componentCount: 1,
    componentLabels: [0],
    anchoredComponentLabel: 0,
    anchoredComponentCount: 1,
    detachedComponentLabels: [],
  },
};

assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, exactReceipt).ok,
  true,
  'exact interactive receipt satisfies compact sidecar invariants without CPU parity',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    effectiveRoute: 'kaminos.structural-material.wrong-route.v0',
  }).ok,
  false,
  'wrong effective route cannot satisfy interactive receipt invariants',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    objectIdentity: 'kaminos.structural-material.hot-object.v0:stale:n180:b631',
  }).ok,
  false,
  'stale object identity cannot satisfy interactive receipt invariants',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    lifecycle: { ...exactReceipt.lifecycle, pipelineCreateCount: 5 },
  }).ok,
  false,
  'pipeline recreation cannot masquerade as warm execution',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    lifecycle: { ...exactReceipt.lifecycle, fullValidationReadbackCount: 1 },
  }).ok,
  false,
  'full validation readback cannot masquerade as interactive execution',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    gpuStructuralState: {
      ...exactReceipt.gpuStructuralState,
      componentLabels: exactReceipt.gpuStructuralState.componentLabels.slice(1),
    },
  }).ok,
  false,
  'partial component output cannot pass compact receipt validation',
);
const graphIncoherentLabels = state.nodes.map(node => node.pinned ? 0 : 1);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    gpuStructuralState: {
      finalBondLiveness: state.bonds.map(() => true),
      componentLabels: graphIncoherentLabels,
    },
    topology: {
      authority: 'webgpu-minimum-node-component-labels-v0',
      componentCount: 2,
      componentLabels: [0, 1],
      anchoredComponentLabel: 0,
      anchoredComponentCount: 1,
      detachedComponentLabels: [1],
    },
  }).ok,
  false,
  'labels that split endpoints of an alive bond cannot author visible separation',
);
const fracturedLiveness = buildLayeredStructuralCpuSequenceOracle(
  state,
  [scenario.force],
).finalBondLiveness;
assert.ok(fracturedLiveness.some(alive => !alive), 'collapsed-label fixture uses genuinely fractured liveness');
const collapsedFractureValidation = validateLayeredStructuralHotSidecarReceipt(state, {
  ...exactReceipt,
  gpuStructuralState: {
    finalBondLiveness: fracturedLiveness,
    componentLabels: state.nodes.map(() => 0),
  },
});
assert.equal(
  collapsedFractureValidation.ok,
  false,
  'labels collapsed across components induced by fractured liveness cannot pass compact validation',
);
assert.ok(
  collapsedFractureValidation.reasons.includes('component-label-liveness-coherence'),
  'collapsed-label rejection names exact liveness-to-label incoherence',
);
assert.equal(
  validateLayeredStructuralHotSidecarReceipt(state, {
    ...exactReceipt,
    lifecycle: { ...exactReceipt.lifecycle, eventHeaderResetCount: 0 },
  }).ok,
  false,
  'a warm receipt cannot pass without one event-header reset per execution',
);
