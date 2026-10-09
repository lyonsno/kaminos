// A binding to the existing Fluid bench. The bench owns its scene and clock.
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertFluidObservationStable(before, after) {
  for (const key of ['generation', 'step', 'paused', 'available']) {
    requireValue(before.clock[key] === after.clock[key], `Fluid ${key} changed during observation`);
  }
  for (const key of ['camera', 'controls']) {
    requireValue(JSON.stringify(before[key]) === JSON.stringify(after[key]), `Fluid ${key} changed during observation`);
  }
}

export function createFluidWorkingSession(host) {
  const api = name => {
    const fn = host[name];
    requireValue(typeof fn === 'function', `Fluid operation unavailable: ${name}`);
    return fn;
  };
  const clock = () => api('kaminosFingerFluidBenchSessionState')();
  const initial = clock();
  requireValue(initial.available && Number.isSafeInteger(initial.generation), 'Fluid bench is unavailable');
  let busy = false;

  function current({held = false} = {}) {
    const state = clock();
    requireValue(state.generation === initial.generation, 'Fluid runtime changed; attach explicitly to the new water');
    requireValue(state.available && Number.isSafeInteger(state.step), 'Fluid bench is unavailable');
    if (held) requireValue(state.paused, 'Fluid operation requires paused water');
    return state;
  }
  function read() {
    const state = current();
    return structuredClone({clock: state,
      bench: api('kaminosFingerFluidBenchDebugState')(),
      controls: api('kaminosFingerFluidPressureCockpitState')(),
      camera: api('kaminosFingerFluidCompositionCameraState')(),
      viewport: api('kaminosFingerFluidBenchViewportState')(),
    });
  }
  async function exclusively(action) {
    requireValue(!busy, 'Fluid session operation already in progress');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  function redraw() {
    const config = api('kaminosFingerFluidBenchDebugState')().config;
    return api('kaminosFingerFluidBenchRenderCurrentStateForWitness')(
      config.effectiveRendererMode, config.effectiveOpticalDebugMode,
      config.effectiveOpticalLightingMode, config.effectiveOpticalFootprintMode,
      config.effectiveTransmissionFootprintMode, config.effectiveBodyTransportMode,
      config.effectiveInterfaceFrequencyMode);
  }
  async function heldRead({captureParticleState = true} = {}) {
    const before = current({held: true});
    const receipt = await api('kaminosFingerFluidBenchRequestDiagnostics')({captureParticleState});
    const after = current({held: true});
    requireValue(before.step === after.step, 'Fluid advanced during held diagnostics');
    requireValue(receipt?.diagnosticsStepCount === after.step, 'Fluid diagnostics are missing or stale');
    redraw();
    const result = read();
    const runtime = result.bench?.runtime;
    requireValue(runtime?.available && runtime.solver_backend === 'webgpu_compute', 'Fluid live GPU route unavailable');
    requireValue(runtime.diagnostics?.stepCount === after.step && !runtime.diagnosticsPending,
      'Fluid diagnostics did not complete at the held step');
    requireValue(result.viewport?.effective === 'shared' && !result.viewport.failure
      && result.viewport.lastFrame?.presentedByHost, 'Fluid shared viewport unavailable');
    if (captureParticleState) {
      const particles = runtime.diagnostics?.particleSnapshot;
      requireValue(particles?.stepCount === after.step && particles.words?.length === runtime.particleCount * 16,
        'Fluid full particle readback is missing or partial');
    }
    return result;
  }

  return {
    read,
    hold: options => exclusively(async () => {
      current();
      api('kaminosFingerFluidBenchSetSimulationPausedForWitness')(true);
      return heldRead(options);
    }),
    advanceTo: (step, options) => exclusively(async () => {
      const before = current({held: true});
      requireValue(Number.isSafeInteger(step) && step > before.step, 'Fluid target must advance to a safe-integer step');
      // Preserve the host's declared target restriction and scheduling semantics.
      const receipt = api('kaminosFingerFluidBenchAdvanceToStepForWitness')(step);
      requireValue(receipt?.endStep === step && current({held: true}).step === step,
        'Fluid did not reach the requested step');
      return heldRead(options);
    }),
    apply: patch => exclusively(async () => {
      const before = current({held: true});
      const receipt = api('kaminosFingerFluidPressureCockpitApply')(patch);
      requireValue(current({held: true}).step === before.step, 'Fluid control application advanced the water');
      return structuredClone({...receipt, application: receipt.effectiveGeneration === receipt.generation ? 'applied' : 'pending'});
    }),
    view: patch => exclusively(async () => {
      const before = current({held: true});
      api('kaminosFingerFluidBenchSetCameraForWitness')(patch);
      redraw();
      requireValue(current({held: true}).step === before.step, 'Fluid camera change advanced the water');
      return read();
    }),
  };
}

// Playwright is a caller-supplied transport. The in-page binding is also usable
// directly by other tools; neither route creates a second solver or scene.
export async function bindFluidWorkingSession(page, {id = null} = {}) {
  const binding = await page.evaluate(async id => {
    const {createFluidWorkingSession} = await import('/fluid-working-session.mjs');
    const sessions = window.__kaminosFluidWorkingSessions ||= new Map();
    if (id) {
      if (!sessions.has(id)) throw new Error('Fluid session expired; select a new runtime explicitly');
      sessions.get(id).read();
      return id;
    }
    const key = crypto.randomUUID();
    sessions.set(key, createFluidWorkingSession(window));
    return key;
  }, id);
  const call = (method, args = []) => page.evaluate(async ({id, method, args}) => {
    const session = window.__kaminosFluidWorkingSessions?.get(id);
    if (!session) throw new Error('Fluid session expired');
    return session[method](...args);
  }, {id: binding, method, args});
  return {
    id: binding,
    read: () => call('read'), hold: options => call('hold', [options]),
    advanceTo: (step, options) => call('advanceTo', [step, options]),
    apply: patch => call('apply', [patch]), view: patch => call('view', [patch]),
    async observe(retain, name) {
      const before = await call('hold');
      return retain({name, observe: async () => before,
        verify: async () => assertFluidObservationStable(before, await call('read'))});
    },
  };
}
