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
  applyCamera: applyHostCamera,
  readCamera,
  readActor = () => ({ transform: { translate: [0, 0, 0], scale: 1 } }),
  readFallbackReason,
}) {
  const descriptorPromise = createFireActorLiveParityDescriptor();
  let arm = 'composite';
  let exactPauseReceipt = null;

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
      await instance.sampleFrame({ advanceSim: false, includeRgba: false });
    }
    return { ...presentation, compositionReceipt, smokeReceipt };
  }

  async function begin(options = {}) {
    await engine();
    await applyCamera(options.camera);
    await setArm(options.arm || arm);
    return state();
  }

  async function pauseAtExactStep(target = null) {
    const descriptor = await descriptorPromise;
    const requested = target ?? descriptor.state.targetSimStep;
    const receipt = await (await engine()).pauseSelectiveHeadLiveAtSimStep(requested);
    if (!receipt?.ok || receipt.paused !== true || receipt.gpuComplete !== true) {
      throw new Error(`exact parity pause failed: ${receipt?.reason || 'missing receipt'}`);
    }
    exactPauseReceipt = receipt;
    return receipt;
  }

  async function play() {
    exactPauseReceipt = null;
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
    const value = {
      schema: 'kaminos.fire-actor-live-parity-receipt.v1',
      status: 'effective',
      surface,
      descriptorId: descriptor.descriptorId,
      basin: clone(descriptor.basin),
      engine: clone(descriptor.engine),
      state: {
        requestedSimStep: exactPauseReceipt?.requestedSimStepCount ?? null,
        effectiveSimStep: debug.simStepCount,
        paused: debug.selectiveHeadLiveCapturePaused === true,
        gpuComplete: exactPauseReceipt?.gpuComplete === true,
        pauseAuthority: exactPauseReceipt?.authority || null,
        controlsSignature: descriptor.state.controlsSignature,
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
      engine: clone(readEngine()?.debugState?.() || null),
      camera: readCamera(),
    };
  }

  const api = {
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
