import {
  createFireActorLiveParityDescriptor,
  fireActorLiveParityPresentation,
  validateFireActorLiveParityReceipt,
} from './fire-actor-live-parity-contract.mjs';

function clone(value) {
  return structuredClone(value);
}

export function recoverQuantizedGpuStageTiming(frame, presentation, arm, simStepCount) {
  const match = /^timestamp-query-nonmonotonic:([\d,]+)$/.exec(frame?.reason || '');
  if (!match) return null;
  const names = ['sidecar'];
  if (presentation.splats === 'on') names.push('compaction', 'finalize', 'indirectSetup');
  if (presentation.smoke === 'on') names.push('matchedRaymarchRaster');
  if (presentation.splats === 'on') names.push('splatRaster');
  const timestamps = match[1].split(',').map(value => BigInt(value));
  if (timestamps.length !== names.length * 2 || timestamps.some(value => value === 0n)) return null;
  const pairs = Object.fromEntries(names.map((name, index) => [
    name,
    { start: timestamps[index * 2], end: timestamps[index * 2 + 1] },
  ]));
  const reversed = names.filter(name => pairs[name].end < pairs[name].start);
  if (reversed.length !== 1 || reversed[0] !== 'indirectSetup') return null;
  const frameStart = pairs[names[0]].start;
  const frameEnd = pairs[names.at(-1)].end;
  if (frameEnd < frameStart) return null;
  const sampled = name => ({
    status: 'sampled',
    ms: Number(pairs[name].end - pairs[name].start) / 1_000_000,
  });
  const notRequested = { status: 'not-requested-by-presentation', ms: 0 };
  return {
    identity: 'selective-head-live-arm-gpu-timestamp-profile-v0',
    timestampStatus: 'available',
    reason: 'timestamp-query-sampled',
    sample: {
      authority: 'same-state-selective-render-composition-gpu-timestamp-v0',
      arm,
      simStepCount,
      advanceSim: false,
      presentation,
    },
    stages: {
      simulation: { status: 'not-run-frozen-state', ms: 0 },
      sidecar: sampled('sidecar'),
      compaction: pairs.compaction ? sampled('compaction') : notRequested,
      finalize: pairs.finalize ? sampled('finalize') : notRequested,
      candidateCopy: { status: 'removed', ms: 0 },
      indirectSetup: {
        status: 'quantized-below-resolution',
        ms: 0,
        rawStartNs: pairs.indirectSetup.start.toString(),
        rawEndNs: pairs.indirectSetup.end.toString(),
        quantizationAuthority: 'implementation-defined-webgpu-timestamp-query-quantization-v0',
      },
      splatRaster: pairs.splatRaster ? sampled('splatRaster') : notRequested,
      matchedRaymarchRaster: pairs.matchedRaymarchRaster ? sampled('matchedRaymarchRaster') : notRequested,
      total: { status: 'sampled', ms: Number(frameEnd - frameStart) / 1_000_000 },
    },
  };
}

export function installFireActorLiveParitySurface({
  surface,
  ensureEngine,
  readEngine,
  readEngineIdentity,
  applyCamera: applyHostCamera,
  readCamera,
  readActor = () => ({ transform: { translate: [0, 0, 0], scale: 1 } }),
  readFallbackReason,
  prepareSurface = async () => {},
  runControlRebake,
}) {
  const descriptorPromise = createFireActorLiveParityDescriptor();
  let arm = 'composite';
  let exactPauseReceipt = null;
  let deterministicClockReceipt = null;
  let gpuStageTimingReceipt = null;
  let controlRebakeReceipt = null;

  async function engine() {
    const candidate = await ensureEngine();
    if (!candidate) throw new Error(`${surface} live parity engine is unavailable`);
    return candidate;
  }

  async function applyCamera(cameraSpec = null) {
    const descriptor = await descriptorPromise;
    const requested = clone(cameraSpec || descriptor.camera);
    await applyHostCamera(requested);
    return readCamera();
  }

  async function setArm(nextArm = 'composite') {
    const instance = await engine();
    const presentation = fireActorLiveParityPresentation(nextArm);
    const compositionReceipt = instance.setSelectiveHeadLiveRenderComposition(presentation.composition);
    const smokeReceipt = instance.setRaymarchSmokePresentationMode(presentation.smoke);
    arm = nextArm;
    if (instance.debugState()?.selectiveHeadLiveCapturePaused === true) {
      const capturedFrame = await instance.captureSelectiveHeadLiveFrame({
        advanceSim: false,
        presentToCanvas: true,
        collectGpuTiming: true,
        presentationArm: nextArm,
      });
      const effectiveSimStep = instance.debugState().simStepCount;
      const recoveredTiming = recoverQuantizedGpuStageTiming(
        capturedFrame,
        { arm: nextArm, ...presentation },
        nextArm,
        effectiveSimStep,
      );
      const frame = recoveredTiming
        ? { ...capturedFrame, ok: true, simStepCount: effectiveSimStep, gpuStageTiming: recoveredTiming }
        : capturedFrame;
      if (!frame?.ok || frame.simStepCount !== instance.debugState().simStepCount) {
        throw new Error(`${surface} live parity arm presentation failed: ${frame?.reason || 'simulation step changed'}`);
      }
      if (frame.gpuStageTiming?.timestampStatus !== 'available'
        || frame.gpuStageTiming?.sample?.arm !== nextArm
        || frame.gpuStageTiming?.sample?.simStepCount !== frame.simStepCount) {
        throw new Error(`${surface} live parity arm GPU timing failed: ${frame.gpuStageTiming?.reason || 'sample identity mismatch'}`);
      }
      gpuStageTimingReceipt = {
        ...clone(frame.gpuStageTiming),
        aggregationAuthority: 'independent-pass-intervals-may-overlap-total-is-envelope-not-sum-v0',
      };
    }
    return { ...presentation, compositionReceipt, smokeReceipt };
  }

  async function begin(options = {}) {
    await prepareSurface();
    const instance = await engine();
    instance.setSelectiveHeadLiveCapturePaused(true);
    await applyCamera(options.camera);
    await setArm(options.arm || arm);
    return state();
  }

  async function pauseAtExactStep(target = null) {
    const descriptor = await descriptorPromise;
    const requested = target ?? descriptor.state.targetSimStep;
    const instance = await engine();
    const before = instance.debugState();
    if (before.simStepCount !== requested || !deterministicClockReceipt) {
      instance.setSelectiveHeadLiveCapturePaused(true);
      const clock = descriptor.state.deterministicClock;
      const replay = await instance.sampleDeterministicReplayFrame({
        steps: requested,
        startTimeMs: clock.startNowMs,
        timeStepMs: clock.stepDeltaMs,
        restoreControls: true,
      });
      if (!replay?.ok || replay.completedSteps !== requested || replay.authority !== clock.authority) {
        throw new Error(`deterministic parity replay failed: ${replay?.reason || replay?.completedSteps}`);
      }
      deterministicClockReceipt = {
        authority: replay.authority,
        startNowMs: replay.startTimeMs,
        stepDeltaMs: replay.timeStepMs,
      };
    }
    const receipt = await instance.pauseSelectiveHeadLiveAtSimStep(requested);
    if (!receipt?.ok || receipt.paused !== true || receipt.gpuComplete !== true) {
      throw new Error(`exact parity pause failed: ${receipt?.reason || 'missing receipt'}`);
    }
    exactPauseReceipt = receipt;
    await setArm(arm);
    return receipt;
  }

  async function play() {
    exactPauseReceipt = null;
    deterministicClockReceipt = null;
    gpuStageTimingReceipt = null;
    return (await engine()).setSelectiveHeadLiveCapturePaused(false);
  }

  async function pause() {
    exactPauseReceipt = null;
    return (await engine()).setSelectiveHeadLiveCapturePaused(true);
  }

  async function rebake(request = {}) {
    if (typeof runControlRebake !== 'function') {
      throw new Error(`${surface} live parity control rebake is unavailable`);
    }
    const instance = await engine();
    const before = instance.debugState();
    const result = await runControlRebake({ engine: instance, request: clone(request) });
    const after = instance.debugState();
    if (result?.receipt?.status !== 'applied' || !(result.pixels instanceof Uint8ClampedArray)) {
      throw new Error(`${surface} live parity control rebake returned an invalid result`);
    }
    controlRebakeReceipt = clone(result.receipt);
    return {
      ...result,
      engineBefore: {
        simStepCount: before.simStepCount,
        cameraSignature: before.cameraSignature,
        paused: before.selectiveHeadLiveCapturePaused === true,
      },
      engineAfter: {
        simStepCount: after.simStepCount,
        cameraSignature: after.cameraSignature,
        paused: after.selectiveHeadLiveCapturePaused === true,
      },
    };
  }

  async function receipt() {
    const descriptor = await descriptorPromise;
    const instance = readEngine();
    if (!instance) throw new Error(`${surface} live parity engine is unavailable`);
    const debug = instance.debugState();
    const canvas = instance.canvasElement();
    const bounds = canvas.getBoundingClientRect();
    const presentation = fireActorLiveParityPresentation(arm);
    const fallbackReason = readFallbackReason(debug, presentation) || null;
    const measuredEngineIdentity = await readEngineIdentity();
    const value = {
      schema: 'kaminos.fire-actor-live-parity-receipt.v1',
      status: 'effective',
      surface,
      descriptorId: descriptor.descriptorId,
      basin: clone(descriptor.basin),
      engine: clone(measuredEngineIdentity),
      state: {
        requestedSimStep: exactPauseReceipt?.requestedSimStepCount ?? null,
        effectiveSimStep: debug.simStepCount,
        paused: debug.selectiveHeadLiveCapturePaused === true,
        gpuComplete: exactPauseReceipt?.gpuComplete === true,
        pauseAuthority: exactPauseReceipt?.authority || null,
        controlsSignature: descriptor.state.controlsSignature,
        deterministicClock: clone(deterministicClockReceipt),
      },
      camera: readCamera(),
      actor: readActor(),
      viewport: {
        cssWidth: bounds.width,
        cssHeight: bounds.height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        dpr: globalThis.devicePixelRatio || 1,
      },
      presentation,
      controls: clone(descriptor.controls),
      fallbackReason,
      timing: clone(debug.timing || {}),
      gpuStageTiming: clone(gpuStageTimingReceipt),
    };
    validateFireActorLiveParityReceipt(value, descriptor);
    return value;
  }

  async function state() {
    const descriptor = await descriptorPromise;
    return {
      surface,
      descriptor,
      arm,
      exactPauseReceipt: clone(exactPauseReceipt),
      deterministicClockReceipt: clone(deterministicClockReceipt),
      gpuStageTimingReceipt: clone(gpuStageTimingReceipt),
      controlRebakeReceipt: clone(controlRebakeReceipt),
      engine: clone(readEngine()?.debugState?.() || null),
      camera: readCamera(),
    };
  }

  const api = {
    ping: async () => ({ surface, status: 'installed' }),
    descriptor: () => descriptorPromise,
    begin,
    pauseAtExactStep,
    setArm,
    applyCamera,
    play,
    pause,
    rebake,
    receipt,
    state,
  };
  window.kaminosFireActorParity = api;

  window.addEventListener('message', async event => {
    if (event.data?.type !== 'kaminos-fire-parity-command') return;
    const command = String(event.data.command || '');
    const requestId = event.data.requestId || null;
    try {
      if (typeof api[command] !== 'function') throw new Error(`unknown live parity command: ${command}`);
      const result = await api[command](event.data.payload);
      event.source?.postMessage({ type: 'kaminos-fire-parity-result', requestId, surface, ok: true, result }, event.origin || '*');
    } catch (error) {
      event.source?.postMessage({
        type: 'kaminos-fire-parity-result',
        requestId,
        surface,
        ok: false,
        error: error?.message || String(error),
      }, event.origin || '*');
    }
  });
  window.parent?.postMessage({ type: 'kaminos-fire-parity-surface', surface, status: 'installed' }, '*');
  return api;
}
