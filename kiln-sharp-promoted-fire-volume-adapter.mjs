import { createFireEpisodeHooks } from './fire-episode-hooks.mjs';
import {
  createKaminosVolumePrototype as createPromotedFireVolumePrototype,
} from './kiln-promoted-fire-volume-core.js';

export const WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY =
  'kaminos.wake-sharp-promoted-fire-volume-adapter.v1';

const GPU_CONTEXT_SCHEMA = 'kaminos.volume-foreground-gpu-context.v0';
const FRAME_RECEIPT_SCHEMA = 'kaminos.volume-foreground-frame-receipt.v0';
const FRAME_ENCODER_IDENTITY = 'volume-core.renderLiveFrame';
const CARRIER_TIMING_IDENTITY = 'wake-sharp-promoted-fire-carrier-timing-v0';
const REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE = 10;

function requireString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function validateGpuContext(gpuContext) {
  if (gpuContext?.schema !== GPU_CONTEXT_SCHEMA
    || !gpuContext.device
    || !gpuContext.queue
    || gpuContext.queue !== gpuContext.device.queue) {
    throw new Error('Wake SHARP promoted fire adapter requires an exact product GPU context');
  }
  requireString(gpuContext.deviceIdentity, 'product device identity');
  requireString(gpuContext.queueIdentity, 'product queue identity');
  return gpuContext;
}

export async function createWakeSharpPromotedFireGpuContext({
  navigatorGpu = globalThis.navigator?.gpu,
  identitySuffix = globalThis.crypto?.randomUUID?.() || Date.now().toString(36),
} = {}) {
  if (!navigatorGpu?.requestAdapter) throw new Error('Wake SHARP promoted fire requires WebGPU');
  const adapter = await navigatorGpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Wake SHARP promoted fire GPU adapter is unavailable');
  const supportedStorageBuffers = adapter.limits?.maxStorageBuffersPerShaderStage ?? 0;
  if (supportedStorageBuffers < REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE) {
    throw new Error(
      `Wake SHARP promoted fire storage-buffer limit:`
      + ` required=${REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE}, supported=${supportedStorageBuffers}`,
    );
  }
  const requiredLimits = {
    maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE,
  };
  if ((adapter.limits?.maxBufferSize ?? 0) > 0) {
    requiredLimits.maxBufferSize = adapter.limits.maxBufferSize;
  }
  if ((adapter.limits?.maxStorageBufferBindingSize ?? 0) > 0) {
    requiredLimits.maxStorageBufferBindingSize = adapter.limits.maxStorageBufferBindingSize;
  }
  const requiredFeatures = [];
  if (adapter.features?.has?.('timestamp-query')) requiredFeatures.push('timestamp-query');
  const descriptor = { requiredLimits };
  if (requiredFeatures.length) descriptor.requiredFeatures = requiredFeatures;
  const device = await adapter.requestDevice(descriptor);
  if (!device?.queue) throw new Error('Wake SHARP promoted fire GPU device queue is unavailable');
  const suffix = requireString(identitySuffix, 'promoted fire GPU identity suffix');
  return {
    schema: GPU_CONTEXT_SCHEMA,
    adapter,
    device,
    queue: device.queue,
    deviceIdentity: `kaminos-wake-sharp-promoted-device:${suffix}`,
    queueIdentity: `kaminos-wake-sharp-promoted-queue:${suffix}`,
    requestedLimits: { ...requiredLimits },
    requestedFeatures: [...requiredFeatures],
  };
}

export function createWakeSharpPromotedFireVolumeAdapter({
  THREE,
  viewport,
  camera,
  controls,
  getControls,
  onStatus,
  gpuContext,
  productTransform = { translate: [0, 0, 0], scale: 1 },
  createCore = createPromotedFireVolumePrototype,
  documentImpl = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  devicePixelRatio = globalThis.devicePixelRatio || 1,
} = {}) {
  const exactGpu = validateGpuContext(gpuContext);
  if (!viewport?.appendChild || !documentImpl?.createElement || !requestFrame || !cancelFrame) {
    throw new Error('Wake SHARP promoted fire adapter requires a browser viewport and RAF');
  }
  const device = exactGpu.device;
  const queue = exactGpu.queue;
  const colorFormat = globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
  const depthFormat = 'depth24plus';
  const textureUsage = globalThis.GPUTextureUsage || {
    TEXTURE_BINDING: 0x04,
    RENDER_ATTACHMENT: 0x10,
  };
  const canvas = documentImpl.createElement('canvas');
  canvas.id = 'kaminos-wake-sharp-promoted-fire-canvas';
  canvas.dataset.prototype = WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY;
  viewport.appendChild(canvas);
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Wake SHARP promoted fire adapter could not create a WebGPU canvas');
  context.configure({
    device,
    format: colorFormat,
    alphaMode: 'opaque',
    usage: textureUsage.RENDER_ATTACHMENT,
  });

  const core = createCore({
    THREE,
    viewport,
    camera,
    controls,
    getControls,
    onStatus,
    productFrameOwner: 'caller',
    externalDevice: device,
    externalAdapterInfo: exactGpu.adapter?.info || null,
    externalColorFormat: colorFormat,
    externalDepthFormat: depthFormat,
    externalProductTransform: productTransform,
  });
  let active = false;
  let initialized = false;
  let leaseDriven = false;
  let raf = 0;
  let depthTexture = null;
  let sceneDepthTexture = null;
  let width = 0;
  let height = 0;
  let opportunityOrdinal = 0;
  let submissionSequence = 0;
  let lastQueueDoneMs = null;
  let lastProductFrameTimestampMs = null;
  let queueProbePending = false;
  let stageTimingReceipt = null;
  let error = null;
  let fireEpisodeHooks = null;
  const frameGapSamples = [];
  const cpuFrameSamples = [];
  const queueDoneSamples = [];

  function pushTimingSample(samples, value, maxSamples = 120) {
    if (!Number.isFinite(value)) return;
    samples.push(value);
    if (samples.length > maxSamples) samples.shift();
  }

  function percentile(samples, fraction) {
    if (!samples.length) return null;
    const ordered = [...samples].sort((left, right) => left - right);
    return ordered[Math.min(
      ordered.length - 1,
      Math.max(0, Math.ceil(fraction * ordered.length) - 1),
    )];
  }

  function carrierTiming() {
    const frameP95Ms = percentile(frameGapSamples, 0.95);
    return {
      identity: CARRIER_TIMING_IDENTITY,
      timingEvidenceSource: 'product-carrier-raf-cpu-and-queue-proxy',
      timingDisclaimer: 'RAF and CPU encode timing are not GPU-exclusive or presentation latency',
      rafFps: frameP95Ms ? 1000 / frameP95Ms : 0,
      frameDeltaMs: frameGapSamples.at(-1) ?? 0,
      frameP95Ms: frameP95Ms ?? 0,
      frameSamples: frameGapSamples.length,
      cpuFrameMs: cpuFrameSamples.at(-1) ?? 0,
      cpuFrameP95Ms: percentile(cpuFrameSamples, 0.95) ?? 0,
      queueDoneMs: lastQueueDoneMs,
      queueDoneP95Ms: percentile(queueDoneSamples, 0.95),
      queueProbePending,
      queueSamples: queueDoneSamples.length,
      queueTimingAvailable: typeof queue.onSubmittedWorkDone === 'function',
    };
  }

  function resetCarrierTimingWindow() {
    frameGapSamples.length = 0;
    cpuFrameSamples.length = 0;
    queueDoneSamples.length = 0;
    lastProductFrameTimestampMs = null;
    lastQueueDoneMs = null;
  }

  function ensureTargets() {
    const nextWidth = Math.max(1, Math.round((canvas.clientWidth || viewport.clientWidth || 1) * devicePixelRatio));
    const nextHeight = Math.max(1, Math.round((canvas.clientHeight || viewport.clientHeight || 1) * devicePixelRatio));
    if (nextWidth === width && nextHeight === height && depthTexture && sceneDepthTexture) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    depthTexture?.destroy?.();
    sceneDepthTexture?.destroy?.();
    depthTexture = device.createTexture({
      label: 'Wake SHARP promoted fire product depth',
      size: [width, height],
      format: depthFormat,
      usage: textureUsage.RENDER_ATTACHMENT,
    });
    sceneDepthTexture = device.createTexture({
      label: 'Wake SHARP promoted fire scene depth',
      size: [width, height],
      format: depthFormat,
      usage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING,
    });
  }

  function clearTargets(commandEncoder, colorView, depthView, sceneDepthView) {
    const colorPass = commandEncoder.beginRenderPass({
      label: 'Wake SHARP promoted fire clear',
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    colorPass.end();
    const sceneDepthPass = commandEncoder.beginRenderPass({
      label: 'Wake SHARP promoted fire scene depth clear',
      colorAttachments: [],
      depthStencilAttachment: {
        view: sceneDepthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    sceneDepthPass.end();
  }

  function recordFrame(now, cpuFrameMs) {
    const rafGapMs = lastProductFrameTimestampMs === null
      ? null
      : Math.max(0, now - lastProductFrameTimestampMs);
    lastProductFrameTimestampMs = now;
    pushTimingSample(frameGapSamples, rafGapMs);
    pushTimingSample(cpuFrameSamples, cpuFrameMs);
    fireEpisodeHooks?.recordFrame({
      rafGapMs,
      cpuFrameMs,
    });
    fireEpisodeHooks?.recordQueueProxy({
      completionSequence: submissionSequence,
      available: true,
      pending: false,
      lastDoneMs: lastQueueDoneMs,
    });
  }

  function probeQueueTiming() {
    if (queueProbePending || typeof queue.onSubmittedWorkDone !== 'function') return;
    queueProbePending = true;
    const submittedAt = performance.now();
    queue.onSubmittedWorkDone()
      .then(() => {
        lastQueueDoneMs = performance.now() - submittedAt;
        pushTimingSample(queueDoneSamples, lastQueueDoneMs, 80);
      })
      .catch((queueError) => {
        error = `product queue timing failed: ${queueError?.message || String(queueError)}`;
      })
      .finally(() => {
        queueProbePending = false;
      });
  }

  function encodeFrame({ now = performance.now(), submit = null, submissionInput = null } = {}) {
    if (!active) throw new Error('Wake SHARP promoted fire frame requires an active adapter');
    const cpuStartedAt = performance.now();
    ensureTargets();
    const commandEncoder = device.createCommandEncoder({
      label: 'Wake SHARP promoted fire product frame',
    });
    const colorView = context.getCurrentTexture().createView();
    const depthView = depthTexture.createView();
    const sceneDepthView = sceneDepthTexture.createView();
    clearTargets(commandEncoder, colorView, depthView, sceneDepthView);
    const productReceipt = core.encodeProductFrame({
      commandEncoder,
      colorView,
      sceneDepthView,
      depthView,
      now,
    });
    if (productReceipt?.status !== 'effective' || productReceipt.fallbackReason) {
      throw new Error(productReceipt?.fallbackReason || 'promoted product frame was not effective');
    }
    const commandBuffers = [commandEncoder.finish()];
    const submission = submit
      ? submit(commandBuffers, submissionInput || {})
      : (() => {
          queue.submit(commandBuffers);
          return null;
        })();
    submissionSequence += 1;
    recordFrame(now, performance.now() - cpuStartedAt);
    probeQueueTiming();
    return { productReceipt, commandBuffers, submission };
  }

  function schedule() {
    if (!active || leaseDriven || raf) return;
    raf = requestFrame(now => {
      raf = 0;
      if (!active || leaseDriven) return;
      try {
        encodeFrame({ now });
      } catch (frameError) {
        error = frameError?.message || String(frameError);
        active = false;
        canvas.classList.remove('active');
        onStatus?.({ phase: 'render-error', error });
        return;
      }
      schedule();
    });
  }

  function cancelScheduledFrame() {
    if (!raf) return;
    cancelFrame(raf);
    raf = 0;
  }

  function ensureFireEpisodeHooks() {
    fireEpisodeHooks ||= createFireEpisodeHooks({
      readCounters: () => {
        const state = core.debugState();
        return { frameCount: state.frameCount, simStepCount: state.simStepCount };
      },
      readQueueProxy: () => ({ completionSequence: submissionSequence }),
      readRouteIdentity: () => {
        const state = core.debugState();
        return {
          effectiveRoute: state.effectiveRoute || state.routeIdentity || null,
          prototypeIdentity: state.prototypeIdentity || null,
          volumeScene: state.volumeScene || null,
          flameRendererIdentity: state.boundarySplatRendererIdentity || null,
          learnedModelIdentity: state.boundarySplatAttributeModelIdentity || null,
          fallbackReason: state.error
            || state.boundarySplatPresentationModeFallbackReason
            || state.raymarchSmokePresentationModeFallbackReason
            || null,
          compositionRequested: state.boundarySplatCompositionRequested || null,
          compositionEffective: state.boundarySplatCompositionEffective || null,
          compositionFallbackReason: state.boundarySplatCompositionFallbackReason
            || state.boundarySplatFallbackReason
            || null,
          adapterIdentity: WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY,
          deviceIdentity: exactGpu.deviceIdentity,
          queueIdentity: exactGpu.queueIdentity,
        };
      },
    });
    return fireEpisodeHooks;
  }

  return {
    identity: WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY,
    setControls(next) {
      core.setControls(next);
    },
    setRaymarchSmokePresentationMode(value) {
      return core.setRaymarchSmokePresentationMode(value);
    },
    foregroundGpuContext() {
      return exactGpu;
    },
    beginFireEpisode({ firingId } = {}) {
      return ensureFireEpisodeHooks().begin({ firingId });
    },
    endFireEpisode({ firingId, status } = {}) {
      return ensureFireEpisodeHooks().end({ firingId, status });
    },
    recordMainPageKilnRaf(timestampMs, { frameGapMs = null } = {}) {
      ensureFireEpisodeHooks().recordFrame({
        rafGapMs: frameGapMs,
        cpuFrameMs: carrierTiming().cpuFrameMs,
      });
    },
    async sampleLiveStageTimings() {
      if (!active) throw new Error('live stage timing requires an active promoted product volume');
      if (leaseDriven) {
        throw new Error('live stage timing is unavailable while the SHARP submission lease is active');
      }
      leaseDriven = true;
      cancelScheduledFrame();
      try {
        await queue.onSubmittedWorkDone?.();
        const before = core.debugState();
        const sample = await core.sampleFrame?.({
          advanceSim: true,
          includeRgba: false,
          sameStateCaptureId: `wake-product-stage-timing:${before.frameCount}:${before.simStepCount}`,
        });
        const profile = sample?.boundarySplatGpuProfile;
        if (!sample?.ok
          || profile?.timestampStatus !== 'available'
          || profile?.reason !== 'timestamp-query-sampled'
          || profile?.stages?.total?.status !== 'sampled'
          || !Number.isFinite(profile.stages.total.ms)) {
          throw new Error(
            `promoted product GPU stage timing unavailable:`
            + ` ${sample?.reason || profile?.reason || 'missing-profile'}`,
          );
        }
        stageTimingReceipt = {
          schema: 'kaminos.wake-sharp-promoted-fire-stage-timing.v0',
          status: 'sampled',
          authority: 'same-controls-same-device-separate-diagnostic-submit',
          productFramePaused: true,
          profile,
          before: {
            frameCount: before.frameCount,
            simStepCount: before.simStepCount,
          },
          after: {
            frameCount: sample.frameCount,
            simStepCount: sample.simStepCount,
          },
          carrierTimingReset: true,
        };
        resetCarrierTimingWindow();
        return structuredClone(stageTimingReceipt);
      } finally {
        leaseDriven = false;
        schedule();
      }
    },
    async quiesceFireEpisodeFrames() {
      leaseDriven = true;
      cancelScheduledFrame();
      const startedAt = performance.now();
      await queue.onSubmittedWorkDone?.();
      lastQueueDoneMs = performance.now() - startedAt;
      pushTimingSample(queueDoneSamples, lastQueueDoneMs, 80);
      return { active, leaseDriven, gpuComplete: true };
    },
    async setForegroundOpportunityMode(value) {
      leaseDriven = value === true;
      cancelScheduledFrame();
      if (!leaseDriven) schedule();
      return {
        active,
        foregroundOpportunityMode: leaseDriven ? 'lease-driven' : 'ordinary-raf',
      };
    },
    nextForegroundOpportunityFrameId({ firingId } = {}) {
      const exactFiringId = requireString(firingId, 'foreground firing id');
      return `${exactFiringId}:${opportunityOrdinal + 1}`;
    },
    async renderForegroundOpportunityFrame({
      firingId,
      frameId,
      requestId,
      signal,
      submit,
    } = {}) {
      const exactFiringId = requireString(firingId, 'foreground firing id');
      const exactFrameId = requireString(frameId, 'foreground frame id');
      const exactRequestId = requireString(requestId, 'foreground request id');
      if (!active || !leaseDriven) throw new Error('foreground product frame requires an active submission lease');
      if (signal?.aborted) throw new Error('foreground product frame was canceled');
      if (typeof submit !== 'function') throw new Error('foreground product frame requires service submit');
      const expectedFrameId = `${exactFiringId}:${opportunityOrdinal + 1}`;
      if (exactFrameId !== expectedFrameId) {
        throw new Error(`foreground product frame identity mismatch: expected ${expectedFrameId}, got ${exactFrameId}`);
      }
      const frame = encodeFrame({
        submit,
        submissionInput: {
          submissionId: `${exactRequestId}:kiln-submit`,
          metadata: {
            workloadIdentity: 'actual-volume-core-kiln-frame-v0',
            firingId: exactFiringId,
            frameId: exactFrameId,
            requestId: exactRequestId,
            encoderIdentity: FRAME_ENCODER_IDENTITY,
            deviceIdentity: exactGpu.deviceIdentity,
            queueIdentity: exactGpu.queueIdentity,
          },
        },
      });
      opportunityOrdinal += 1;
      return {
        schema: FRAME_RECEIPT_SCHEMA,
        status: 'submitted',
        firingId: exactFiringId,
        frameId: exactFrameId,
        requestId: exactRequestId,
        encoderIdentity: FRAME_ENCODER_IDENTITY,
        deviceIdentity: exactGpu.deviceIdentity,
        queueIdentity: exactGpu.queueIdentity,
        commandBufferCount: frame.commandBuffers.length,
        submission: frame.submission,
        clocks: {
          renderFrameCount: frame.productReceipt.frameCount,
          sourceRenderFrameCount: frame.productReceipt.frameCount,
          simulatorStep: frame.productReceipt.simStepCount,
        },
      };
    },
    async setActive(value) {
      if (value === true) {
        if (!initialized) {
          const receipt = await core.initializeProductFrame();
          if (receipt?.status !== 'initialized' || receipt.fallbackReason) {
            throw new Error(receipt?.fallbackReason || 'promoted product frame initialization failed');
          }
          initialized = true;
        }
        active = true;
        error = null;
        leaseDriven = false;
        canvas.classList.add('active');
        schedule();
        onStatus?.({ phase: 'active' });
      } else {
        active = false;
        leaseDriven = false;
        cancelScheduledFrame();
        canvas.classList.remove('active');
        onStatus?.({ phase: 'inactive' });
      }
    },
    debugState() {
      const coreState = core.debugState();
      return {
        ...coreState,
        active,
        error: error || coreState.error || null,
        adapterIdentity: WAKE_SHARP_PROMOTED_FIRE_VOLUME_ADAPTER_IDENTITY,
        foregroundOpportunityMode: leaseDriven ? 'lease-driven' : 'ordinary-raf',
        deviceIdentity: exactGpu.deviceIdentity,
        queueIdentity: exactGpu.queueIdentity,
        coreTiming: coreState.timing ? { ...coreState.timing } : null,
        timing: carrierTiming(),
        liveStageTimingReceipt: stageTimingReceipt ? structuredClone(stageTimingReceipt) : null,
        fireEpisodeHooks: fireEpisodeHooks?.snapshot?.() || null,
      };
    },
    canvasElement() {
      return canvas;
    },
    dispose() {
      active = false;
      cancelScheduledFrame();
      depthTexture?.destroy?.();
      sceneDepthTexture?.destroy?.();
      core.dispose?.();
      canvas.remove?.();
    },
  };
}
