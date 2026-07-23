import {
  createFireActorLiveParityDescriptor,
  fireActorLiveParityPresentation,
  validateFireActorLiveParityReceipt,
} from './fire-actor-live-parity-contract.mjs';

function clone(value) {
  return structuredClone(value);
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
}) {
  const descriptorPromise = createFireActorLiveParityDescriptor();
  let arm = 'composite';
  let exactPauseReceipt = null;
  let deterministicClockReceipt = null;
  let gpuStageTimingReceipt = null;

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
      const frame = await instance.captureSelectiveHeadLiveFrame({
        advanceSim: false,
        presentToCanvas: true,
        collectGpuTiming: true,
        presentationArm: nextArm,
      });
      if (!frame?.ok || frame.simStepCount !== instance.debugState().simStepCount) {
        throw new Error(`${surface} live parity arm presentation failed: ${frame?.reason || 'simulation step changed'}`);
      }
      if (frame.gpuStageTiming?.timestampStatus !== 'available'
        || frame.gpuStageTiming?.sample?.arm !== nextArm
        || frame.gpuStageTiming?.sample?.simStepCount !== frame.simStepCount) {
        throw new Error(`${surface} live parity arm GPU timing failed: ${frame.gpuStageTiming?.reason || 'sample identity mismatch'}`);
      }
      gpuStageTimingReceipt = clone(frame.gpuStageTiming);
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
