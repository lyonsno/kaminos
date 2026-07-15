import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'coupled-live-smoke-hierarchy.mjs');

assert.equal(
  existsSync(sourcePath),
  true,
  'the coupled current-state socket must have a live owned hierarchy compiler/archive',
);

const {
  COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
  COUPLED_LIVE_SMOKE_NEAR_OCCUPANCY_THRESHOLD,
  COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
  assessCoupledLiveSmokeFarEvidence,
  createCoupledLiveSmokeHierarchyCompiler,
  createCoupledLiveSmokeHierarchyArchive,
  summarizePackedLiveSmokeProduct,
} = await import(pathToFileURL(sourcePath));
const { buildPhaseMatchedHybridSmokePlan } = await import(
  new URL('../smoke-splat-motion-source.mjs', import.meta.url)
);
const { assessLiveCoupledSmokeMotion } = await import(
  new URL('../smoke-splat-motion-source.mjs', import.meta.url)
);
const {
  SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY,
  SMOKE_SPLAT_GPU_PRODUCT_SCHEMA,
  SMOKE_SPLAT_PACKING_IDENTITY,
} = await import(new URL('../smoke-splat-gpu-product.mjs', import.meta.url));

function genericProductFields({ capacity = 3, activeCount = 3 } = {}) {
  return {
    schema: SMOKE_SPLAT_GPU_PRODUCT_SCHEMA,
    producerAuthority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
    compilerIdentity: 'test-live-smoke-compiler-v0',
    packedByteLength: capacity * 16 * Float32Array.BYTES_PER_ELEMENT,
    capacity,
    activeCount,
    representation: {
      requestedIdentity: 'test-packed-smoke-v0',
      effectiveIdentity: 'test-packed-smoke-v0',
      fallbackReason: null,
      packingIdentity: SMOKE_SPLAT_PACKING_IDENTITY,
      activeRecordsPackedFirst: true,
      outputWasTruncated: false,
    },
    draw: { authority: SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY, mode: 'direct' },
  };
}

assert.equal(
  COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
  'live-coupled-dense-state-owned-hierarchy-v0',
);
assert.equal(
  COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
  'renderer-owned-destroy-on-evict-v0',
);
assert.equal(COUPLED_LIVE_SMOKE_NEAR_OCCUPANCY_THRESHOLD, 0.0025);

const telemetryPacked = new Float32Array(3 * 16);
telemetryPacked.set([0.1, 0.2, 0.3, 0, 0, 1, 0.2, 0.3, 0.2, 0.04, 0.8, 0.1, 0, 0, 0, 0], 0);
telemetryPacked.set([-0.4, 1.2, 0.5, 0, 0, 1, 0.1, 0.2, 0.1, 0.02, 0.5, 0, 0, 0, 0, 1], 16);
telemetryPacked[47] = 1;
const packedTelemetry = summarizePackedLiveSmokeProduct(telemetryPacked, {
  coarseCount: 1,
  fineCount: 2,
});
assert.deepEqual(packedTelemetry.nonzeroCounts, { coarse: 1, fine: 1, total: 2 });
assert.ok(Math.abs(packedTelemetry.extinctionMass.coarse - 0.04) < 1e-6);
assert.ok(Math.abs(packedTelemetry.extinctionMass.fine - 0.02) < 1e-6);
assert.ok(Math.abs(packedTelemetry.extinctionMass.total - 0.06) < 1e-6);
assert.ok(Math.abs(packedTelemetry.maxDensityWitness - 0.8) < 1e-6);
assert.ok(Math.abs(packedTelemetry.positiveDensityQuantiles.p50 - 0.5) < 1e-6);
assert.ok(Math.abs(packedTelemetry.positiveDensityQuantiles.p99 - 0.5) < 1e-6);
assert.ok(Math.abs(packedTelemetry.positiveExtinctionMassQuantiles.p50 - 0.02) < 1e-6);
assert.ok(packedTelemetry.occupiedBounds.min.every((value, index) => Math.abs(value - [-0.4, 0.2, 0.3][index]) < 1e-6));
assert.ok(packedTelemetry.occupiedBounds.max.every((value, index) => Math.abs(value - [0.1, 1.2, 0.5][index]) < 1e-6));
assert.throws(
  () => summarizePackedLiveSmokeProduct(new Float32Array(15), { coarseCount: 1, fineCount: 0 }),
  /packed.*length/i,
  'partial readback must fail instead of reporting authoritative mass',
);
const packedFarEvidence = assessCoupledLiveSmokeFarEvidence({
  products: [
    { nonzeroCounts: { coarse: 8 }, occupiedBounds: { max: [0.3, 1.12, 0.2] } },
    { nonzeroCounts: { coarse: 9 }, occupiedBounds: { max: [0.3, 1.15, 0.2] } },
  ],
  domainTelemetry: {
    frameCount: 60,
    smokeDomainTransferLastReadbackFrame: 30,
    smokeDomainFarAdvectedActiveCells: 0,
  },
});
assert.equal(packedFarEvidence.status, 'passed');
assert.equal(packedFarEvidence.authority, 'exact-packed-coarse-support-beyond-near-domain-v0');
assert.equal(packedFarEvidence.counterTelemetryFreshness, 'stale-supporting-only');
assert.throws(
  () => assessCoupledLiveSmokeFarEvidence({
    products: [
      { nonzeroCounts: { coarse: 0 }, occupiedBounds: { max: [0.3, 0.9, 0.2] } },
      { nonzeroCounts: { coarse: 0 }, occupiedBounds: { max: [0.3, 0.9, 0.2] } },
    ],
  }),
  /coarse support/i,
  'near smoke cannot impersonate current far-domain participation',
);

function borrowedBuffer(label) {
  return {
    label,
    destroy() {
      throw new Error(`borrowed producer buffer ${label} must not be destroyed`);
    },
  };
}

const device = { queue: { submit() {} } };

function descriptor({ generation = 4, retainedHistoryEpoch = 7, writeTick = 10 } = {}) {
  return {
    schema: 'kaminos.coupled-smoke.phase-state.v0',
    socketIdentity: 'coupled-near-far-phase-state-socket-v0',
    producerIdentity: 'native-near-far-fluid-state-export-v0',
    gpu: {
      device,
      queue: device.queue,
      ownership: 'borrowed-producer-owned-do-not-destroy-v0',
    },
    phase: {
      token: { generation, retainedHistoryEpoch, writeTick },
      retainedHistoryAuthority: 'current-state-only-no-fabricated-phase-history-v0',
      retainedSlotCount: 1,
      historyOffset: 0,
    },
    domains: {
      near: { grid: 8, buffer: borrowedBuffer(`near-${writeTick}`) },
      far: { grid: 4, buffer: borrowedBuffer(`far-${writeTick}`) },
    },
    renderer: {
      authority: 'renderer-neutral-state-only-v0',
      consumerSynchronization: 'same-device-queue-order-or-explicit-onSubmittedWorkDone-v0',
    },
  };
}

const compiled = [];
function compileCurrent(current) {
  const token = { ...current.phase.token };
  const packedBuffer = {
    token,
    destroyed: false,
    destroy() { this.destroyed = true; },
  };
  const product = {
    ...genericProductFields(),
    identity: `owned:${token.generation}:${token.retainedHistoryEpoch}:${token.writeTick}`,
    authority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
    ownership: COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
    device,
    phaseToken: token,
    packedBuffer,
    hierarchyCounts: { coarse: 2, fine: 1, total: 3 },
    splatCount: 3,
  };
  compiled.push(product);
  return product;
}

const archive = createCoupledLiveSmokeHierarchyArchive({ device, compileCurrent });

const first = archive.capture(descriptor());
assert.equal(first.status, 'warming');
assert.equal(first.consecutiveProductCount, 1);
assert.deepEqual(first.productDraws, [{
  identity: 'owned:4:7:10',
  requestedRepresentation: 'test-packed-smoke-v0',
  effectiveRepresentation: 'test-packed-smoke-v0',
  fallbackReason: null,
  capacity: 3,
  activeCount: 3,
  drawAuthority: SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY,
  drawMode: 'direct',
}]);
assert.throws(
  () => archive.getConsecutiveProducts(),
  error => error?.report?.failurePhase === 'consecutive-history-resolution',
  'one current product must not impersonate two-phase history',
);

const duplicate = archive.capture(descriptor());
assert.equal(duplicate.status, 'duplicate-current-noop');
assert.equal(compiled.length, 1, 'a duplicate current write tick must not compile again');

const gap = archive.capture(descriptor({ writeTick: 12 }));
assert.equal(gap.status, 'warming-after-write-gap');
assert.equal(compiled[0].packedBuffer.destroyed, true, 'a write gap evicts non-consecutive history');
assert.equal(gap.consecutiveProductCount, 1);

const available = archive.capture(descriptor({ writeTick: 13 }));
assert.equal(available.status, 'consecutive-history-available');
assert.deepEqual(
  archive.getConsecutiveProducts().map(product => product.phaseToken.writeTick),
  [12, 13],
  'the renderer receives oldest then newest exact consecutive products',
);
assert.throws(
  () => archive.capture(descriptor({ writeTick: 12 })),
  error => error?.report?.failurePhase === 'current-token-ordering',
  'a stale descriptor must fail instead of rewinding live history',
);

const reset = archive.capture(descriptor({ generation: 5, retainedHistoryEpoch: 0, writeTick: 0 }));
assert.equal(reset.status, 'warming-after-generation-reset');
assert.equal(compiled[1].packedBuffer.destroyed, true);
assert.equal(compiled[2].packedBuffer.destroyed, true);
assert.equal(reset.consecutiveProductCount, 1);

assert.throws(
  () => archive.capture({ ...descriptor({ generation: 5, retainedHistoryEpoch: 0, writeTick: 1 }), gpu: { device: {}, queue: {} } }),
  error => error?.report?.failurePhase === 'socket-validation',
  'device mismatch must fail before compilation',
);

const failingArchive = createCoupledLiveSmokeHierarchyArchive({
  device,
  compileCurrent() { throw new Error('synthetic compiler failure'); },
});
assert.throws(
  () => failingArchive.capture(descriptor()),
  error => (
    error?.report?.failurePhase === 'hierarchy-compilation'
    && error.report.lastTrustworthyToken === null
    && /synthetic compiler failure/.test(error.report.cause)
  ),
  'compiler failure must preserve a durable failure phase and last trustworthy token',
);

let malformedProductDestroyCount = 0;
const malformedArchive = createCoupledLiveSmokeHierarchyArchive({
  device,
  compileCurrent(current) {
    return {
      identity: 'malformed-owned-product',
      authority: 'wrong-authority',
      ownership: COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
      device,
      phaseToken: { ...current.phase.token },
      packedBuffer: { destroy() { malformedProductDestroyCount += 1; } },
      hierarchyCounts: { coarse: 2, fine: 1, total: 3 },
      splatCount: 3,
    };
  },
});
assert.throws(
  () => malformedArchive.capture(descriptor()),
  error => error?.report?.failurePhase === 'hierarchy-compilation',
  'invalid compiler metadata must fail archive validation',
);
assert.equal(
  malformedProductDestroyCount,
  1,
  'an archive-owned GPU product rejected by validation is destroyed exactly once',
);

archive.dispose();
assert.equal(compiled.at(-1).packedBuffer.destroyed, true);
assert.equal(archive.debugState().status, 'disposed');

const livePlanProducts = [20, 21].map(writeTick => ({
  ...genericProductFields(),
  identity: `live:${writeTick}`,
  authority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
  ownership: COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
  device,
  phaseToken: { generation: 8, retainedHistoryEpoch: 2, writeTick },
  slotIdentity: {
    simulatorGeneration: 8,
    historySlot: writeTick % 2,
    slotWriteTick: writeTick,
    modelIdentity: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
  },
  packedBuffer: { label: `gpu-product-${writeTick}`, destroy() {} },
  splatCount: 3,
  hierarchyCounts: { coarse: 2, fine: 1, total: 3 },
}));
const livePlan = buildPhaseMatchedHybridSmokePlan({
  products: livePlanProducts,
  flameInstances: [
    { index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } },
    { index: 1, phaseHistoryOffsetSlots: 1, transform: { translate: [2, 0, 0], scale: 1 } },
  ],
  fineLodFraction: 1,
  requestedRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
  effectiveRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
});
assert.equal(livePlan.productUploads[0].packedBuffer, livePlanProducts[0].packedBuffer);
assert.equal(livePlan.productUploads[0].packed, null, 'live GPU products do not round-trip through CPU packed arrays');
assert.equal(livePlan.productUploads[0].selectedCount, 3);
assert.equal(livePlan.instanceBindings[0].productWriteTick, 21);
assert.equal(livePlan.instanceBindings[1].productWriteTick, 20);
assert.throws(
  () => buildPhaseMatchedHybridSmokePlan({
    products: livePlanProducts,
    flameInstances: [
      { index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } },
    ],
    fineLodFraction: 0.5,
    requestedRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
    effectiveRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
  }),
  /live GPU product.*fine LOD/i,
  'live products fail instead of silently repacking or dropping GPU-resident fine mass',
);

const {
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_ROUTE_IDENTITY,
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_APPEARANCE_IDENTITY,
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_COARSE_COVERAGE,
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE,
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_OPTICAL_GAIN,
  createSpatialStrataHybridSmokeRenderer,
} = await import(new URL('../spatial-strata-hybrid-smoke-renderer.mjs', import.meta.url));
assert.equal(
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_ROUTE_IDENTITY,
  'spatial-strata-hybrid-smoke-live-coupled-v0',
);
assert.equal(
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_APPEARANCE_IDENTITY,
  'temperature-lit-sparse-live-smoke-v0',
);
assert.equal(
  SPATIAL_STRATA_HYBRID_SMOKE_LIVE_COARSE_COVERAGE,
  1.8,
  'the published live default matches the coverage consumed by the validated route',
);
assert.equal(SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE, 1.7);
assert.equal(SPATIAL_STRATA_HYBRID_SMOKE_LIVE_OPTICAL_GAIN, 12);

const acceptedLiveMotion = assessLiveCoupledSmokeMotion({
  simulatorStepCounts: [40, 41, 42],
  newestProductTicks: [40, 41, 42],
  frameStateIdentities: ['state-40', 'state-41', 'state-42'],
  smokeContributionMeanAbsDiffs: [0.3, 0.35, 0.32],
  smokeResidualMotionMeanAbsDiffs: [0.18, 0.22],
});
assert.equal(acceptedLiveMotion.status, 'passed');
assert.equal(acceptedLiveMotion.authority, 'frame-locked-live-smoke-residual-motion-v1');
assert.throws(
  () => assessLiveCoupledSmokeMotion({
    simulatorStepCounts: [63, 64, 65, 66],
    newestProductTicks: [62, 63, 64, 65],
    frameStateIdentities: [
      'live-coupled-frame:1:1:63:sim-63:a',
      'live-coupled-frame:1:1:64:sim-64:b',
      'live-coupled-frame:1:1:65:sim-65:c',
      'live-coupled-frame:1:1:66:sim-66:d',
    ],
    smokeContributionMeanAbsDiffs: [0.5, 0.5, 0.5, 0.5],
    smokeResidualMotionMeanAbsDiffs: [0.5, 0.5, 0.5],
  }),
  /product tick.*simulator step/i,
  'an advancing one-frame-stale product stream cannot certify current-frame smoke',
);
assert.throws(
  () => assessLiveCoupledSmokeMotion({
    simulatorStepCounts: [40, 41],
    newestProductTicks: [40, 41],
    frameStateIdentities: [null, null],
    smokeContributionMeanAbsDiffs: [0.3, 0.4],
    smokeResidualMotionMeanAbsDiffs: [0.2],
  }),
  /frame state identity/i,
  'unlocked state telemetry cannot certify captured pixels',
);
assert.throws(
  () => assessLiveCoupledSmokeMotion({
    simulatorStepCounts: [40, 41],
    newestProductTicks: [40, 41],
    frameStateIdentities: ['state-40', 'state-41'],
    smokeContributionMeanAbsDiffs: [0, 0],
    smokeResidualMotionMeanAbsDiffs: [0],
  }),
  /smoke contribution/i,
  'moving flames cannot certify invisible or composited-away smoke',
);
assert.throws(
  () => assessLiveCoupledSmokeMotion({
    simulatorStepCounts: [40, 41],
    newestProductTicks: [40, 41],
    frameStateIdentities: ['state-40', 'state-41'],
    smokeContributionMeanAbsDiffs: [0.3, 0.4],
    smokeResidualMotionMeanAbsDiffs: [0],
  }),
  /smoke residual.*did not move/i,
  'a static smoke layer cannot borrow motion from the learned flame control',
);

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 };
const destroyedLiveBuffers = [];
let activeLiveProducts = livePlanProducts.map(product => ({
  ...product,
  packedBuffer: {
    label: product.packedBuffer.label,
    destroy() { destroyedLiveBuffers.push(this.label); },
  },
}));
const rendererDevice = {
  queue: { writeBuffer() {} },
  createShaderModule(descriptor) { return descriptor; },
  createRenderPipeline() {
    return { getBindGroupLayout() { return {}; } };
  },
  createBuffer(descriptor) {
    const bytes = new ArrayBuffer(descriptor.size);
    return {
      descriptor,
      destroy() {},
      getMappedRange() { return bytes; },
      unmap() {},
    };
  },
  createBindGroup(descriptor) { return descriptor; },
};
activeLiveProducts = activeLiveProducts.map(product => ({ ...product, device: rendererDevice }));
const renderer = createSpatialStrataHybridSmokeRenderer({
  device: rendererDevice,
  productSource: () => activeLiveProducts,
  requestedRoute: SPATIAL_STRATA_HYBRID_SMOKE_LIVE_ROUTE_IDENTITY,
  effectiveRoute: SPATIAL_STRATA_HYBRID_SMOKE_LIVE_ROUTE_IDENTITY,
});
const rendererInstances = [
  { index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } },
  { index: 1, phaseHistoryOffsetSlots: 1, transform: { translate: [2, 0, 0], scale: 1 } },
];
renderer.update({
  flameInstances: rendererInstances,
  viewProj: new Float32Array(16),
  cameraMatrix: new Float32Array(16),
  cameraPosition: [0, 0, 4],
  elapsedSeconds: 1,
});
assert.equal(renderer.debugState().productSourceMode, 'live-owned-product-source');
assert.equal(renderer.debugState().appearanceIdentity, SPATIAL_STRATA_HYBRID_SMOKE_LIVE_APPEARANCE_IDENTITY);
assert.deepEqual(renderer.debugState().coverage, {
  authority: 'live-coarse-uniform-fine-fixed-v0',
  coarse: 1.8,
  fine: SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE,
});
assert.deepEqual(renderer.debugState().productWriteTicks, [20, 21]);
assert.equal(renderer.debugState().drawAuthority, SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY);
assert.equal(renderer.debugState().drawMode, 'direct');
assert.deepEqual(
  renderer.debugState().plan.productUploads.map(upload => ({
    capacity: upload.capacity,
    activeCount: upload.activeCount,
    requestedRepresentation: upload.requestedRepresentation,
    effectiveRepresentation: upload.effectiveRepresentation,
    fallbackReason: upload.fallbackReason,
  })),
  [20, 21].map(() => ({
    capacity: 3,
    activeCount: 3,
    requestedRepresentation: 'test-packed-smoke-v0',
    effectiveRepresentation: 'test-packed-smoke-v0',
    fallbackReason: null,
  })),
);
const activeDrawCalls = [];
const texture = { createView() { return {}; } };
renderer.encodeSpatialStrataSmoke({
  beginRenderPass() {
    return {
      setPipeline() {},
      setBindGroup() {},
      draw(vertexCount, instanceCount) { activeDrawCalls.push([vertexCount, instanceCount]); },
      end() {},
    };
  },
}, {
  hybridSplatDepthMoments: texture,
  frontColor: texture,
  frontInterval: texture,
  backColor: texture,
  backInterval: texture,
});
assert.deepEqual(activeDrawCalls, [[6, 6]], 'renderer submits active records times flame instances');

const replacedBuffers = activeLiveProducts.map(product => product.packedBuffer);
activeLiveProducts = activeLiveProducts.map((product, index) => ({
  ...product,
  identity: `live:${21 + index}`,
  phaseToken: { ...product.phaseToken, writeTick: 21 + index },
  slotIdentity: { ...product.slotIdentity, slotWriteTick: 21 + index },
  packedBuffer: {
    label: `gpu-product-${21 + index}`,
    destroy() { destroyedLiveBuffers.push(this.label); },
  },
}));
renderer.update({
  flameInstances: rendererInstances,
  viewProj: new Float32Array(16),
  cameraMatrix: new Float32Array(16),
  cameraPosition: [0, 0, 4],
  elapsedSeconds: 2,
});
assert.deepEqual(renderer.debugState().productWriteTicks, [21, 22]);
assert.equal(
  replacedBuffers.some(buffer => destroyedLiveBuffers.includes(buffer.label)),
  false,
  'renderer rebinding does not destroy archive-owned products',
);
renderer.dispose();
assert.deepEqual(destroyedLiveBuffers, [], 'renderer disposal leaves archive-owned products untouched');

globalThis.GPUBufferUsage.COPY_SRC = 8;
const compilerPassCalls = [];
const compilerDevice = {
  queue: {
    submitted: 0,
    submit() { this.submitted += 1; },
  },
  createShaderModule(descriptor) { return descriptor; },
  createComputePipeline(descriptor) {
    const expectedBindings = descriptor.compute.entryPoint === 'compileNear' ? [0, 2] : [1, 2];
    return {
      descriptor,
      getBindGroupLayout() { return { expectedBindings }; },
    };
  },
  createBuffer(descriptor) {
    return { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
  },
  createBindGroup(descriptor) {
    assert.deepEqual(
      descriptor.entries.map(entry => entry.binding),
      descriptor.layout.expectedBindings,
      'each auto-layout bind group contains only resources used by its compute entry point',
    );
    return descriptor;
  },
  createCommandEncoder() {
    return {
      beginComputePass() {
        return {
          setPipeline(pipeline) { compilerPassCalls.push(['pipeline', pipeline.descriptor.compute.entryPoint]); },
          setBindGroup(index, bindGroup) { compilerPassCalls.push(['bindGroup', index, bindGroup.entries.map(entry => entry.binding)]); },
          dispatchWorkgroups(count) { compilerPassCalls.push(['dispatch', count]); },
          end() { compilerPassCalls.push(['end']); },
        };
      },
      finish() { return { identity: 'compiled-command-buffer' }; },
    };
  },
};
const compilerDescriptor = descriptor({ generation: 9, retainedHistoryEpoch: 1, writeTick: 2 });
compilerDescriptor.gpu = {
  device: compilerDevice,
  queue: compilerDevice.queue,
  ownership: 'borrowed-producer-owned-do-not-destroy-v0',
};
compilerDescriptor.domains.near.bufferLayout = { identity: 'fluid-4xvec4f-per-cell-v0' };
compilerDescriptor.domains.far.bufferLayout = { identity: 'velocity-density-extinction-proxy-vec4f-per-cell-v0' };
const compiler = createCoupledLiveSmokeHierarchyCompiler({
  device: compilerDevice,
  nearOutputGrid: 4,
  farOutputGrid: 2,
});
const compiledProduct = compiler.compileCurrent(compilerDescriptor);
assert.equal(compiledProduct.splatCount, 72);
assert.equal(compiledProduct.capacity, 72);
assert.equal(compiledProduct.activeCount, 72);
assert.equal(compiledProduct.draw.authority, SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY);
assert.equal(compiledProduct.representation.requestedIdentity, 'fixed-grid-spatial-strata-smoke-splats-v0');
assert.equal(compiledProduct.representation.effectiveIdentity, 'fixed-grid-spatial-strata-smoke-splats-v0');
assert.equal(compiledProduct.representation.fallbackReason, null);
assert.deepEqual(compilerPassCalls.filter(call => call[0] === 'bindGroup'), [
  ['bindGroup', 0, [0, 2]],
  ['bindGroup', 0, [1, 2]],
]);
assert.equal(compilerDevice.queue.submitted, 1);
compiledProduct.packedBuffer.destroy();
compiler.dispose();

const { spatialStrataHybridSmokeConfigIdentity } = await import(
  new URL('../spatial-strata-hybrid-smoke-source-lifecycle.mjs', import.meta.url)
);
const liveConfigIdentity = JSON.parse(spatialStrataHybridSmokeConfigIdentity({
  sourceMode: 'live-coupled',
  manifestUrl: '',
  fineLodFraction: 1,
  coarseCoverageScale: 1.8,
  motionRate: 0,
}));
assert.equal(liveConfigIdentity.sourceMode, 'live-coupled');
assert.equal(liveConfigIdentity.manifestUrl, null);
assert.throws(
  () => spatialStrataHybridSmokeConfigIdentity({
    sourceMode: 'offline-manifest',
    manifestUrl: '',
    fineLodFraction: 1,
    coarseCoverageScale: 1.8,
    motionRate: 0.16,
  }),
  /manifestUrl/i,
  'offline source remains explicit and cannot silently fall through to live state',
);

const coreSource = readFileSync(join(root, 'volume-core.js'), 'utf8');
const hierarchySource = readFileSync(sourcePath, 'utf8');
const spatialStrataRendererSource = readFileSync(join(root, 'spatial-strata-hybrid-smoke-renderer.mjs'), 'utf8');
const pageSource = readFileSync(join(root, 'index.html'), 'utf8');
const motionWitnessSource = readFileSync(join(root, 'volume-boundary-splat-motion-witness.mjs'), 'utf8');
assert.match(coreSource, /createCoupledLiveSmokeHierarchyCompiler/);
assert.match(coreSource, /createCoupledLiveSmokeHierarchyArchive/);
assert.match(coreSource, /normalizeHybridSmokeSource/);
assert.match(pageSource, /volume_hybrid_smoke_source/);
assert.match(
  spatialStrataRendererSource,
  /liveCoverage[\s\S]*opticalGain/,
  'live reconstruction must close fine-cell coverage while preserving a named optical response',
);
assert.match(
  spatialStrataRendererSource,
  /tauCeiling\s*=\s*mix\(0\.36,\s*0\.52,\s*liveProduct\)[\s\S]*clamp\([^;]+tauCeiling\)/,
  'live optical tuning must not raise the offline-manifest per-splat opacity ceiling',
);
assert.match(
  hierarchySource,
  /rawDensity\s*>?=\s*NEAR_OCCUPANCY_THRESHOLD/,
  'near compiler must discard the measured numerical fog floor before accumulating mass',
);
assert.match(
  coreSource,
  /coupledLiveSmokeHierarchyArchive\.capture\(\s*getCoupledSmokePhaseState\(\{\s*historyOffset:\s*0\s*\}\),\s*\{\s*commandEncoder:\s*encoder\s*\},?\s*\)/,
  'the render path compiles current state after simulator writes in the same command encoder',
);
assert.match(
  coreSource,
  /if\s*\(advanceSim\s*&&\s*!sampleLookFreeze\)\s*\{[\s\S]{0,180}encodeSim\(encoder\);[\s\S]{0,120}encodeSmokeDomainTransfer\(encoder\);/,
  'controlled simulation steps must advance the coupled far domain before archiving near/far phase state',
);
const sampleFrameStart = coreSource.indexOf('async function sampleFrame');
const sampleFrameEnd = coreSource.indexOf('async function sampleRenderScaleSet', sampleFrameStart);
const sampleFrameSource = coreSource.slice(sampleFrameStart, sampleFrameEnd);
assert.match(
  sampleFrameSource,
  /sampleBoundarySplatGpuProfile\(\{\s*advanceSimulation:\s*false\s*\}\)/,
  'a controlled sample must profile the captured state without advancing the simulator a second time',
);
assert.match(
  coreSource,
  /warming-no-smoke-no-fallback/,
  'the first product is a visible warming state instead of offline or shared-current substitution',
);
assert.match(
  coreSource,
  /if\s*\(config\.sourceMode\s*===\s*['"]live-coupled['"]\)\s*\{[\s\S]{0,300}return\s*\{\s*sourceMode:\s*['"]live-coupled['"]\s*\};\s*\}\s*return\s+loadSmokeSplatMotionSource/,
  'live source selection returns before the offline manifest loader',
);
assert.match(
  motionWitnessSource,
  /frame-locked-controlled-live-coupled-near-far-cdp-canvas-v1/,
  'live witness binds state telemetry and canvas pixels under a paused controlled frame',
);
assert.match(
  motionWitnessSource,
  /volumeEffectiveRoute:\s*canvasCapture\.effectiveRoute[\s\S]{0,8000}capture\.effectiveRoute\s*=\s*deriveSpatialStrataHybridSmokeEffectiveRoute\(\[capture\]\)/,
  'hybrid captures must preserve the native volume route separately and publish the validated smoke renderer route as effectiveRoute',
);
assert.match(
  motionWitnessSource,
  /controlledSmokeMotion:[\s\S]{0,500}summarizePublishedLiveCoupledHybridSmokeMotion\(\[staticSequence,\s*grazingSequence\]\)/,
  'the report must assess every published live-coupled camera sequence',
);
assert.match(
  motionWitnessSource,
  /function rejectFalseClosure[\s\S]{0,7000}summarizePublishedLiveCoupledHybridSmokeMotion\(\[report\.staticCamera,\s*report\.grazingCamera\]\)/,
  'false-closure rejection must rerun the all-sequence live motion predicate',
);
assert.match(
  motionWitnessSource,
  /smokeContributionMeanAbsDiffs[\s\S]*smokeResidualMotionMeanAbsDiffs/,
  'live witness requires visible moving smoke residuals against a same-state learned-flame control',
);
assert.match(
  motionWitnessSource,
  /inspectCoupledLiveSmokeProductTelemetry[\s\S]*liveProductTelemetry/,
  'live witness reads the exact packed products instead of inferring smoke occupancy from flame motion',
);
assert.match(
  motionWitnessSource,
  /failurePhase\s*=\s*['"]live-far-warmup['"][\s\S]{0,240}waitForLiveFarSmokeEvidence\(\)[\s\S]*failurePhase\s*=\s*['"]static-camera-capture['"]/, 
  'live witness waits for far-advection trigger evidence before pausing for its controlled visual sequence',
);
assert.match(
  motionWitnessSource,
  /await waitForRequestedLiveRoute\(\)[\s\S]{0,180}validateRequestedEffectiveConfig/,
  'live config validation waits for a bound effective renderer instead of rejecting startup warming',
);
assert.match(
  motionWitnessSource,
  /Page\.bringToFront[\s\S]{0,500}waitForRequestedLiveRoute/,
  'the CDP witness foregrounds its page before controlled live-route priming',
);
assert.match(
  motionWitnessSource,
  /advanceLiveCoupledWarmupStep[\s\S]{0,1800}controlledStepFrame[\s\S]{0,900}resumeRenderLoop:\s*false/,
  'the warmup helper advances the coupled simulator explicitly while keeping RAF paused',
);
assert.ok(
  motionWitnessSource.indexOf('let liveWarmupStepIndex = 0;') < motionWitnessSource.indexOf('\ntry {'),
  'live warmup state must be initialized before top-level witness execution can call the helper',
);
assert.match(
  motionWitnessSource,
  /waitForRequestedLiveRoute[\s\S]{0,1800}advanceLiveCoupledWarmupStep/,
  'route priming advances the coupled simulator explicitly instead of waiting on page-visible RAF',
);
assert.match(
  motionWitnessSource,
  /waitForLiveFarSmokeEvidence[\s\S]{0,1800}advanceLiveCoupledWarmupStep[\s\S]{0,900}inspectCoupledLiveSmokeProductTelemetry/,
  'far warmup maps exact packed products only after an explicit paused coupled step',
);
assert.match(
  motionWitnessSource,
  /liveCoupledDomainTelemetry[\s\S]*smokeDomainTransferActiveCells[\s\S]*smokeDomainFarAdvectedActiveCells/,
  'live witness rejects a coupled socket whose far transfer never becomes persistent state',
);

console.log('coupled live smoke hierarchy contracts passed');
