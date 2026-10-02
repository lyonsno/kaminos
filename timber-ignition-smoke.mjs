export const TIMBER_IGNITION_BASIN = 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b';
const sourceId = 'sinter-source-timber';
const receiverId = 'sinter-receiver-timber';
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireState = (condition, message) => { if (!condition) throw new Error(message); };

export function createTimberIgnitionSmoke({volume, basin, objects, moveObject, onChange = () => {}}) {
  let state = {phase: 'loading', running: false, paused: true, simStepCount: null, error: null, receipts: []};
  const status = () => structuredClone(state);
  const publish = changes => { state = {...state, ...changes}; onChange(status()); };
  const validate = () => {
    const live = volume.debugState();
    requireState(!live.error, live.error || 'Volume failed');
    requireState(live.active && /^WebGPU:/.test(live.backend), 'Active WebGPU is required');
    requireState(live.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0', 'Unexpected volume route');
    requireState(live.simGrid === 48 && equal(live.simGridDimensions, [48, 96, 48]), 'Expected the local48 domain');
    requireState(basin() === TIMBER_IGNITION_BASIN, 'Unexpected saved fire basin');
    const assembly = live.gpuStructuralCombustionAssembly;
    requireState(assembly?.structureCount === 2 && assembly.meshTriangleCount === 1728 && assembly.dispatchCount > 0,
      'The two timber structures must be mounted and dispatched');
    requireState(assembly.presentationDebugMode === 'off', 'Expected the ordinary wood view');
    requireState(assembly.runtimeReadbackCount === 0 && assembly.hostCausalFeedbackCount === 0,
      'Unexpected host material feedback');
    requireState(live.combustibleObjectSource?.sameDevice === true, 'Timber emission must share the Pyro device');
    requireState(equal(objects().map(object => object.id), [sourceId, receiverId]), 'Unexpected scene objects');
    requireState(objects().every(object => object.combustionBinding?.emissionEnabled === true), 'Timber emission is disabled');
    return live;
  };
  const advance = async steps => {
    const target = validate().simStepCount + steps;
    const receipt = await volume.pauseSelectiveHeadLiveAtSimStep(target);
    requireState(receipt.ok && receipt.gpuComplete && receipt.paused && receipt.effectiveSimStepCount === target,
      `GPU-complete step pause failed: ${receipt.reason || 'invalid receipt'}`);
    validate();
    state.receipts.push(receipt);
    publish({simStepCount: target});
  };
  const presentPausedSimulation = () => {
    requireState(volume.setSimulationPaused(true).paused === true, 'Simulation inspection pause failed');
    requireState(volume.setSelectiveHeadLiveCapturePaused(false).paused === false, 'Live camera presentation failed');
  };
  const fail = error => {
    volume.setSimulationPaused(true);
    publish({phase: 'failed', running: false, paused: true, error: String(error.message || error)});
    throw error;
  };
  return {
    status,
    async initialize() {
      try {
        validate();
        requireState(volume.debugState().controls.flowRate > 0, 'The original burner must start enabled');
        const [source, receiver] = objects();
        requireState(equal(source.transform.position, [0, -0.5, 0]) && equal(source.transform.rotation, [0, 0, 0.35])
          && equal(source.transform.scale, [0.8, 0.8, 0.8]) && equal(receiver.transform.position, [2.5, 0.1, 0])
          && equal(receiver.transform.scale, [0.35, 0.35, 0.35]), 'Unexpected initial timber pose');
        await advance(1);
        presentPausedSimulation();
        publish({phase: 'paused'});
      } catch (error) { fail(error); }
    },
    async run() {
      requireState(state.phase === 'paused' && !state.running, 'Use reset before running the sequence again');
      try {
        volume.setSimulationPaused(false);
        publish({phase: 'burner-on', running: true, paused: false});
        await advance(240);
        volume.setControls({flowRate: 0});
        const shutdown = volume.setAnalyticEmitterDescriptor(null);
        const live = validate();
        requireState(shutdown?.mode === 'off' && shutdown.count === 0 && shutdown.sourceLaw === 'inactive'
          && live.controls.flowRate === 0 && live.analyticEmitterDispatchActive === false, 'Original burner shutdown failed');
        state.receipts.push({burnerShutdown: shutdown, simStepCount: live.simStepCount});
        for (const [id, position] of [[sourceId, [0.4, -0.55, 0]], [receiverId, [0.4, 0.6, 0]]]) {
          const moved = moveObject(id, {position});
          requireState(moved?.id === id && equal(moved.transform.position, position), `Timber placement failed: ${id}`);
        }
        publish({phase: 'burner-off-transfer'});
        await advance(360);
        const paused = state.paused;
        requireState(volume.setSimulationPaused(paused).paused === paused, 'Live simulation continuation failed');
        requireState(volume.setSelectiveHeadLiveCapturePaused(false).paused === false, 'Live camera presentation failed');
        publish({phase: 'live', running: true, paused});
      } catch (error) { fail(error); }
    },
    togglePause() {
      requireState(state.running, 'Pause is available while the preview is live');
      const paused = !state.paused;
      const receipt = volume.setSimulationPaused(paused);
      requireState(receipt.paused === paused, 'Simulation pause failed');
      publish({paused, simStepCount: volume.debugState().simStepCount});
    },
  };
}

export async function mountTimberIgnitionSmoke() {
  const root = document.getElementById('volume-primary-control-root');
  requireState(root, 'Volume controls are unavailable');
  const section = document.createElement('section');
  section.id = 'timber-ignition-smoke';
  section.dataset.volumeBasinDriveIgnore = '';
  section.dataset.volumeCockpitLayoutUi = '';
  section.style.cssText = 'padding:8px 0 12px;border-bottom:1px solid #444;margin-bottom:10px;';
  section.innerHTML = '<strong style="font-size:13px">Timber ignition</strong><div role="status" style="font-size:11px;line-height:1.5;margin:7px 0;overflow-wrap:anywhere">Loading</div><div class="volume-actions"><button class="btn" data-action="pause" disabled>Pause</button><button class="btn" data-action="reset">Restart</button></div>';
  root.prepend(section);
  const label = section.querySelector('[role="status"]');
  const pause = section.querySelector('[data-action="pause"]');
  const phaseLabels = {loading: 'Loading', paused: 'Paused', 'burner-on': 'Burner on',
    'burner-off-transfer': 'Burner off / transfer', live: 'Burner off / live', failed: 'Failed'};
  const volume = window.__kaminosVolumePrototype;
  const smoke = createTimberIgnitionSmoke({volume,
    basin: () => window.__kaminosDefaultVolumeSmokeBasin?.presetId,
    objects: () => window.kaminosSceneObjectDebugState(),
    moveObject: (id, pose) => window.kaminosSetSceneObjectTransform(id, pose),
    onChange(state) {
      label.textContent = state.error || `${phaseLabels[state.phase]}${state.running && state.paused ? ' (paused)' : ''}${state.simStepCount === null || !state.paused ? '' : ` | Step ${state.simStepCount}`}`;
      label.style.color = state.error ? '#ef9a9a' : '#ccc';
      pause.disabled = !state.running;
      pause.textContent = state.running && state.paused ? 'Resume' : 'Pause';
    },
  });
  window.__kaminosTimberIgnitionSmoke = smoke;
  pause.addEventListener('click', () => smoke.togglePause());
  section.querySelector('[data-action="reset"]').addEventListener('click', () => location.reload());
  try {
    // Saved-scene restoration precedes the first structural GPU dispatch.
    while (!volume.debugState().gpuStructuralCombustionAssembly?.dispatchCount) {
      const live = volume.debugState();
      if (live.error) throw new Error(live.error);
      await new Promise(requestAnimationFrame);
    }
    await smoke.initialize();
    void smoke.run().catch(error => console.error('Timber ignition sequence failed:', error));
  } catch (error) {
    label.textContent = `Failed: ${error.message || error}`;
    throw error;
  }
  return smoke;
}
