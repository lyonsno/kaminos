import assert from 'node:assert/strict';

import {
  WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY,
  createWakeSharpPromotedFireGpuContext,
  createWakeSharpPromotedFireVolumeAdapter,
} from '../kiln-sharp-promoted-fire-volume-adapter.mjs';

const submitted = [];
const queue = {
  submit(commandBuffers) {
    submitted.push(commandBuffers);
  },
  async onSubmittedWorkDone() {},
};
const device = {
  queue,
  createTexture(descriptor) {
    return {
      descriptor,
      createView: () => ({ textureLabel: descriptor.label }),
      destroy() {},
    };
  },
  createCommandEncoder() {
    return {
      beginRenderPass() {
        return { end() {} };
      },
      finish() {
        return { identity: 'fake-command-buffer' };
      },
    };
  },
};
let requestedDeviceDescriptor = null;
const requestedGpuContext = await createWakeSharpPromotedFireGpuContext({
  navigatorGpu: {
    async requestAdapter() {
      return {
        info: { vendor: 'test' },
        limits: {
          maxBufferSize: 268435456,
          maxStorageBufferBindingSize: 268435456,
          maxStorageBuffersPerShaderStage: 10,
        },
        features: new Set(),
        async requestDevice(descriptor) {
          requestedDeviceDescriptor = descriptor;
          return device;
        },
      };
    },
  },
  identitySuffix: 'test',
});
assert.equal(
  requestedDeviceDescriptor.requiredLimits.maxStorageBuffersPerShaderStage,
  10,
);
assert.equal(requestedGpuContext.device, device);
assert.equal(requestedGpuContext.queue, queue);
assert.equal(requestedGpuContext.deviceIdentity, 'kaminos-wake-sharp-promoted-device:test');
assert.equal(requestedGpuContext.queueIdentity, 'kaminos-wake-sharp-promoted-queue:test');
const context = {
  configure() {},
  getCurrentTexture() {
    return { createView: () => ({ identity: 'fake-color-view' }) };
  },
};
const classNames = new Set();
const canvas = {
  id: '',
  dataset: {},
  classList: {
    add: value => classNames.add(value),
    remove: value => classNames.delete(value),
    contains: value => classNames.has(value),
  },
  width: 0,
  height: 0,
  clientWidth: 640,
  clientHeight: 360,
  getContext: () => context,
  remove() {},
};
const viewport = {
  appendChild(value) {
    assert.equal(value, canvas);
  },
};
const documentImpl = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return canvas;
  },
};
let initialized = false;
let encodedFrames = 0;
let sampledProfile = null;
const core = {
  async initializeProductFrame() {
    initialized = true;
    return { status: 'initialized', fallbackReason: null };
  },
  encodeProductFrame(input) {
    assert.ok(input.commandEncoder);
    assert.ok(input.colorView);
    assert.ok(input.sceneDepthView);
    assert.ok(input.depthView);
    encodedFrames += 1;
    return {
      status: 'effective',
      frameCount: encodedFrames,
      simStepCount: encodedFrames,
      fallbackReason: null,
    };
  },
  setControls() {},
  setRaymarchSmokePresentationMode() {},
  async sampleFrame() {
    sampledProfile = {
      identity: 'boundary-splat-stage-gpu-timestamp-profile-v0',
      timestampStatus: 'available',
      reason: 'timestamp-query-sampled',
      stages: {
        simulation: { status: 'sampled', ms: 1.2 },
        sidecar: { status: 'sampled', ms: 0.3 },
        compaction: { status: 'sampled', ms: 0.4 },
        candidateCopy: { status: 'sampled', ms: 0 },
        indirectSetup: { status: 'sampled', ms: 0.1 },
        splatRaster: { status: 'sampled', ms: 0.7 },
        matchedRaymarchRaster: { status: 'sampled', ms: 1.8 },
        total: { status: 'sampled', ms: 4.5 },
      },
    };
    return {
      ok: true,
      frameCount: encodedFrames,
      simStepCount: encodedFrames,
      boundarySplatGpuProfile: sampledProfile,
    };
  },
  debugState() {
    return {
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      frameCount: encodedFrames,
      simStepCount: encodedFrames,
      volumeScene: 'crucible-volume-scene',
      boundarySplatMode: 'kernel_moment_covariance',
      boundarySplatRendererIdentity: 'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0',
      boundarySplatAttributeModelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
      selectiveHeadLiveCompositionRequested: 'smoke-raymarch-under-splats-v0',
      selectiveHeadLiveCompositionEffective: 'off',
      selectiveHeadLiveCompositionFallbackReason: null,
      productFrameIdentity: 'product-frame-smoke-raymarch-under-splats-v0',
      productFrameReceipt: {
        identity: 'product-frame-smoke-raymarch-under-splats-v0',
        status: 'initialized',
        fallbackReason: null,
      },
      boundarySplatFallbackReason: null,
      boundarySplatGpuProfile: sampledProfile,
      raymarchSmokePresentationModeEffective: 'on',
      raymarchSmokePresentationModeFallbackReason: null,
      error: null,
    };
  },
  dispose() {},
};

const scheduled = [];
const adapter = createWakeSharpPromotedFireVolumeAdapter({
  viewport,
  camera: {},
  controls: {},
  getControls: () => ({}),
  gpuContext: {
    schema: 'kaminos.volume-foreground-gpu-context.v0',
    device,
    queue,
    adapter: { info: { vendor: 'test' } },
    deviceIdentity: 'device-test',
    queueIdentity: 'queue-test',
  },
  createCore: options => {
    assert.equal(options.productFrameOwner, 'caller');
    assert.equal(options.externalDevice, device);
    return core;
  },
  documentImpl,
  requestFrame: callback => {
    scheduled.push(callback);
    return scheduled.length;
  },
  cancelFrame() {},
  devicePixelRatio: 1,
});

assert.equal(adapter.identity, WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY);
assert.equal(adapter.canvasElement(), canvas);
assert.equal(adapter.foregroundGpuContext().device, device);
assert.equal(adapter.foregroundGpuContext().queue, queue);
await adapter.setActive(true);
assert.equal(initialized, true);
assert.equal(canvas.classList.contains('active'), true);
scheduled.shift()(1000);
scheduled.shift()(1016.7);
await new Promise(resolveImmediate => setImmediate(resolveImmediate));
const liveTiming = adapter.debugState().timing;
assert.equal(liveTiming.identity, 'wake-sharp-promoted-fire-carrier-timing-v0');
assert.ok(liveTiming.frameDeltaMs > 16 && liveTiming.frameDeltaMs < 17);
assert.ok(liveTiming.frameSamples >= 1);
assert.equal(liveTiming.queueTimingAvailable, true);
const stageTiming = await adapter.sampleLiveStageTimings();
assert.equal(stageTiming.status, 'sampled');
assert.equal(stageTiming.profile.timestampStatus, 'available');
assert.equal(stageTiming.profile.stages.total.status, 'sampled');
assert.equal(stageTiming.carrierTimingReset, true);
assert.equal(adapter.debugState().timing.frameSamples, 0);

const opened = adapter.beginFireEpisode({ firingId: 'firing-adapter-001' });
assert.equal(opened.status, 'recording');
assert.equal(opened.firingId, 'firing-adapter-001');
assert.equal(opened.routeIdentity.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
assert.equal(opened.routeIdentity.prototypeIdentity, 'kaminos-volume-prototype-v0');
assert.equal(opened.routeIdentity.volumeScene, 'crucible-volume-scene');
assert.equal(
  opened.routeIdentity.flameRendererIdentity,
  'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0',
);
assert.equal(
  opened.routeIdentity.learnedModelIdentity,
  'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
);
assert.equal(opened.routeIdentity.compositionRequested, 'smoke-raymarch-under-splats-v0');
assert.equal(opened.routeIdentity.compositionEffective, 'smoke-raymarch-under-splats-v0');
assert.equal(opened.routeIdentity.fallbackReason, null);
assert.doesNotThrow(
  () => adapter.recordMainPageKilnRaf(1000, { frameGapMs: 16.7 }),
  'Wake heartbeat samples must feed the promoted episode without a telemetry-name mismatch',
);
const privateSubmissionsBeforeLease = submitted.length;
await adapter.setForegroundOpportunityMode(true);
const frameId = adapter.nextForegroundOpportunityFrameId({ firingId: opened.firingId });
const serviceSubmissions = [];
const frame = await adapter.renderForegroundOpportunityFrame({
  firingId: opened.firingId,
  frameId,
  requestId: frameId,
  submit(commandBuffers) {
    serviceSubmissions.push(commandBuffers);
    return {
      commandBufferCount: commandBuffers.length,
      submissionStatus: 'queue-submit-returned',
    };
  },
});
assert.equal(frame.status, 'submitted');
assert.equal(frame.encoderIdentity, 'volume-core.renderLiveFrame');
assert.equal(frame.deviceIdentity, 'device-test');
assert.equal(frame.queueIdentity, 'queue-test');
assert.equal(serviceSubmissions.length, 1);
assert.equal(
  submitted.length,
  privateSubmissionsBeforeLease,
  'lease-driven product frames must not privately submit',
);
const closed = adapter.endFireEpisode({ firingId: opened.firingId, status: 'complete' });
assert.equal(closed.status, 'complete');
assert.ok(closed.frameAdvanceCount > 0);
assert.ok(closed.simStepAdvanceCount > 0);
await adapter.setActive(false);
assert.equal(canvas.classList.contains('active'), false);

assert.throws(
  () => createWakeSharpPromotedFireVolumeAdapter({
    viewport,
    camera: {},
    controls: {},
    getControls: () => ({}),
    gpuContext: { device, queue: {} },
    createCore: () => core,
    documentImpl,
  }),
  /GPU context/,
);

console.log('Wake SHARP promoted fire volume adapter contracts verified');
