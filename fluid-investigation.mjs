import {mountInvestigation} from './investigation-mount.mjs';

// Fluid owns its context and presentation handoff; page lifetime and retention
// are shared with other owner experiments.
export function mountFluidInvestigation({page, out, source, guide}) {
  return mountInvestigation({page, out, source, install: async ({id, binding}) => {
    await page.evaluate(async ({id, binding, source, guide}) => {
      const {createInvestigationRecording} = await import('./investigation-recording.mjs');
      const {createInvestigationGuide} = await import('./investigation-guide.mjs');
      if (!window.kaminosFluidWorkbenchSetInvestigation) throw Error('Fluid investigation mount unavailable');
      window.__kaminosInvestigations ??= new Map();
      if ([...window.__kaminosInvestigations.values()].some(item => item.read().recording.status === 'recording')) {
        throw Error('This page already has an active investigation');
      }
      // A held witness stops presentation scheduling. Restore the interactive
      // presenter at handoff, preserving the source-owned simulation pause.
      const before = window.kaminosFingerFluidBenchSessionState();
      window.kaminosFingerFluidBenchResumeAfterWitness();
      const after = window.kaminosFingerFluidBenchSessionState();
      if (!after.running || ['generation', 'step', 'paused'].some(key => before[key] !== after[key])) {
        throw Error('Fluid presentation handoff changed the water or remained stopped');
      }
      const context = () => ({clock: window.kaminosFingerFluidBenchSessionState(),
        controls: window.kaminosFingerFluidPressureCockpitState(),
        camera: window.kaminosNavigationState(), scene: window.kaminosSceneAuthoring.read(),
        edits: window.kaminosSceneEdits.state(), viewport: {width: innerWidth, height: innerHeight}});
      const recording = createInvestigationRecording({id, source, initial: context(),
        startingConditions: {kind: 'live-runtime', reconstructAfterRestart: false}});
      const component = createInvestigationGuide({document, ...guide,
        onCapture: note => window[binding]({action: 'capture', note}),
        onFinish: note => window[binding]({action: 'finish', note})});
      const read = () => ({recording: recording.snapshot(), context: context()});
      window.__kaminosInvestigations.set(id, {read, finish: () => {
        recording.finish(); component.freeze('Recording stopped; saving'); return read();
      }, disconnect: message => component.disconnect(message), saveFailed: message => component.saveFailed(message)});
      try {window.kaminosFluidWorkbenchSetInvestigation(component.node);}
      catch (error) {recording.finish(); component.disconnect(); throw error;}
    }, {id, binding, source, guide});
    return {
      read: () => page.evaluate(id => window.__kaminosInvestigations.get(id).read(), id),
      finish: () => page.evaluate(id => window.__kaminosInvestigations.get(id).finish(), id),
      disconnect: message => page.evaluate(({id, message}) => window.__kaminosInvestigations.get(id).disconnect(message), {id, message}),
      saveFailed: message => page.evaluate(({id, message}) => window.__kaminosInvestigations.get(id).saveFailed(message), {id, message}),
      isPresent: () => page.evaluate(id => window.__kaminosInvestigations?.has(id) === true, id),
    };
  }});
}
