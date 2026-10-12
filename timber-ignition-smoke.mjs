export const TIMBER_IGNITION_BASIN = 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b';
const sourceId = 'sinter-source-timber';
const receiverId = 'sinter-receiver-timber';
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireState = (condition, message) => { if (!condition) throw new Error(message); };

export function createTimberIgnitionSmoke({volume, basin, objects, moveObject, restoreScene, setBurner, onChange = () => {}}) {
  let state = {phase: 'loading', running: false, busy: false, paused: true, simStepCount: null, error: null, receipts: []};
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
    requireState(assembly?.structureCount === 2 && assembly.meshTriangleCount === 1728 && assembly.dispatchCount >= 0,
      'The two timber structures must be mounted');
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
    volume.setSelectiveHeadLiveCapturePaused(false);
    publish({phase: 'failed', running: false, busy: false, paused: true, error: String(error.message || error)});
    throw error;
  };
  const burnerOff = () => {
    setBurner(false);
    const shutdown = volume.setAnalyticEmitterDescriptor(null);
    const live = validate();
    requireState(shutdown?.mode === 'off' && shutdown.count === 0 && shutdown.sourceLaw === 'inactive'
      && live.controls.flowRate === 0 && live.analyticEmitterDispatchActive === false, 'Original burner shutdown failed');
    return shutdown;
  };
  const prepare = async () => {
    validate();
    presentPausedSimulation();
    // Finish prior GPU work before replacing the scene's resident resources.
    await advance(0);
    burnerOff();
    const restored = await restoreScene();
    requireState(restored?.freshFluid === true && restored.freshMaterial === true, 'Scene restoration did not establish fresh fluid and material');
    burnerOff();
    const live = validate();
    requireState(live.simStepCount === 0 && live.gpuStructuralCombustionAssembly.dispatchCount === 0,
      'Fresh scene advanced before the operator started it');
    const [source, receiver] = objects();
    requireState(equal(source.transform.position, [0, -0.5, 0]) && equal(source.transform.rotation, [0, 0, 0.35])
      && equal(source.transform.scale, [0.8, 0.8, 0.8]) && equal(receiver.transform.position, [2.5, 0.1, 0])
      && equal(receiver.transform.scale, [0.35, 0.35, 0.35]), 'Unexpected initial timber pose');
    presentPausedSimulation();
    publish({phase: 'cold', running: false, paused: true, simStepCount: 0, error: null, receipts: [{restored}]});
  };
  return {
    status,
    async initialize() {
      try {
        publish({busy: true});
        await prepare();
        publish({busy: false});
      } catch (error) { fail(error); }
    },
    async reset() {
      requireState(!state.busy, 'An experiment is already in progress');
      publish({phase: 'restoring', busy: true, running: false, paused: true});
      try { await prepare(); publish({busy: false}); } catch (error) { fail(error); }
    },
    async run() {
      requireState(!state.busy, 'An experiment is already in progress');
      requireState(state.phase === 'cold' || state.phase === 'live', 'Restore the cold scene before running');
      publish({busy: true});
      try {
        if (state.phase === 'live') { publish({phase: 'restoring', running: false, paused: true}); await prepare(); }
        setBurner(true);
        const priming = validate();
        requireState(priming.controls.flowRate > 0 && priming.analyticEmitterDispatchActive === true, 'Original burner restoration failed');
        volume.setSimulationPaused(false);
        publish({phase: 'burner-on', running: true, paused: false});
        await advance(240);
        const shutdown = burnerOff();
        const live = validate();
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
        publish({phase: 'live', running: true, busy: false, paused});
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

export async function mountTimberIgnitionSmoke({restoreScene, setBurner}) {
  const root = document.getElementById('viewport');
  requireState(root, 'Scene viewport is unavailable');
  const section = document.createElement('section');
  section.id = 'timber-ignition-smoke';
  section.dataset.volumeBasinDriveIgnore = '';
  section.dataset.volumeCockpitLayoutUi = '';
  section.style.cssText = 'position:absolute;bottom:var(--timber-controls-bottom,42px);left:12px;right:12px;z-index:6;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;background:rgba(0,0,0,.8);';
  section.innerHTML = '<strong style="font-size:13px">Timber transfer</strong><span role="status" style="font-size:12px;overflow-wrap:anywhere">Loading</span><div class="volume-actions"><button class="btn" data-action="run" disabled>Run transfer</button><button class="btn" data-action="pause" disabled>Pause</button><button class="btn" data-action="reset" disabled>Reset</button></div>';
  for (const type of ['pointerdown', 'mousedown', 'click']) {
    section.addEventListener(type, event => event.stopPropagation());
  }
  root.prepend(section);
  const label = section.querySelector('[role="status"]');
  const pause = section.querySelector('[data-action="pause"]');
  const run = section.querySelector('[data-action="run"]');
  const reset = section.querySelector('[data-action="reset"]');
  const phaseLabels = {loading: 'Loading', restoring: 'Restoring', cold: 'Cold', 'burner-on': 'Heating source',
    'burner-off-transfer': 'Burner off / transfer', live: 'Burner off / live', failed: 'Failed'};
  const volume = window.__kaminosVolumePrototype;
  const smoke = createTimberIgnitionSmoke({volume, restoreScene, setBurner,
    basin: () => window.__kaminosDefaultVolumeSmokeBasin?.presetId,
    objects: () => window.kaminosSceneObjectDebugState(),
    moveObject: (id, pose) => window.kaminosSetSceneObjectTransform(id, pose),
    onChange(state) {
      label.textContent = state.error || `${phaseLabels[state.phase]}${state.running && state.paused ? ' (paused)' : ''}${state.simStepCount === null || !state.paused ? '' : ` | Step ${state.simStepCount}`}`;
      label.style.color = state.error ? '#ef9a9a' : '#ccc';
      pause.disabled = !state.running;
      pause.textContent = state.running && state.paused ? 'Resume' : 'Pause';
      run.disabled = state.busy || !['cold', 'live'].includes(state.phase);
      run.textContent = state.phase === 'live' ? 'Repeat transfer' : 'Run transfer';
      reset.disabled = state.busy;
    },
  });
  window.__kaminosTimberIgnitionSmoke = smoke;
  pause.addEventListener('click', () => { try { smoke.togglePause(); } catch (error) { console.error('Timber pause failed:', error); } });
  run.addEventListener('click', () => void smoke.run().catch(error => console.error('Timber transfer failed:', error)));
  reset.addEventListener('click', () => void smoke.reset().catch(error => console.error('Timber reset failed:', error)));
  try {
    await smoke.initialize();
  } catch (error) {
    label.textContent = `Failed: ${error.message || error}`;
    throw error;
  }
  return smoke;
}
