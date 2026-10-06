import { createKilnPerformance } from './kiln-cinematic-cues.mjs';
import {installKilnCueWorkspace} from './kiln-cue-workspace.mjs';
export { sharedGpuBufferRequirements } from './sf3d-host-device.mjs';

const PREVIEW_SHA = 'e1f70de3407df24d571bf68f70fac2b59373bdd948075a2387f1834e4faff8b7';

export async function mountComposition(context) {
  const { host } = context;
  if (!host?.cinematic) throw new Error('Cinematic kiln host is unavailable');
  const style = document.createElement('style');
  style.textContent = `
    body.kiln-cinema #sidebar, body.kiln-cinema #authoring-header,
    body.kiln-cinema #authoring-hierarchy, body.kiln-cinema #authoring-inspector,
    body.kiln-cinema .authoring-splitter, body.kiln-cinema #authoring-viewport-tools,
    body.kiln-cinema #transform-bar, body.kiln-cinema #info-bar,
    body.kiln-cinema #sf3d-hud, body.kiln-cinema #status-bar,
    body.kiln-cinema #navigation-hint, body.kiln-cinema #scene-edit-hud,
    body.kiln-cinema #scene-edit-overlay, body.kiln-cinema #fps-counter { display:none!important; }
    body.kiln-cinema #viewport { position:fixed!important; inset:0!important; width:100%!important; height:100%!important; margin:0!important; }
    #kiln-film { position:fixed; inset:0; z-index:11000; pointer-events:none; color:#ddd;
      font:13px system-ui,sans-serif; letter-spacing:0; }
    body.kiln-cinema #kiln-film { pointer-events:auto; }
    body:not(.kiln-cinema) #kiln-film header { top:auto; bottom:16px; left:auto; right:16px; }
    body:not(.kiln-cinema) #kiln-film header strong, body:not(.kiln-cinema) #kiln-mode,
    body:not(.kiln-cinema) #kiln-film footer { display:none; }
    #kiln-film header { position:absolute; top:24px; left:28px; right:28px; display:flex; align-items:center; gap:18px; }
    #kiln-film header strong { font-size:19px; font-weight:500; }
    #kiln-film header button { margin-left:auto; }
    #kiln-film button { pointer-events:auto; color:#ddd; background:#202322e8; border:1px solid #525855; border-radius:4px; padding:10px 15px; font:inherit; cursor:pointer; }
    #kiln-film button:disabled { opacity:.4; cursor:default; }
    #kiln-film button:hover:not(:disabled) { background:#38423d; }
    #kiln-film footer { position:absolute; bottom:24px; left:28px; right:28px; display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; }
    #kiln-film #kiln-phase { flex-basis:100%; text-align:center; color:#c2c9c5; font-size:12px; overflow-wrap:anywhere; text-shadow:0 1px 5px #000; }
    #kiln-mode { color:#a8b1ab; font-size:12px; }
    #kiln-cue-editor { pointer-events:auto; position:absolute; right:28px; top:76px; width:320px; max-width:calc(100% - 56px); max-height:calc(100% - 190px); overflow:auto; background:#191c1bed; border:1px solid #424845; padding:16px; border-radius:4px; }
    #kiln-cue-editor[hidden] { display:none; }
    #kiln-cue-editor h2 { font-size:14px; margin:8px 0 12px; }
    #kiln-cue-editor table { width:100%; table-layout:fixed; border-collapse:collapse; margin:0 0 14px; }
    #kiln-cue-editor th { text-align:left; color:#9da9a1; font-size:11px; font-weight:400; padding:4px; }
    #kiln-cue-editor input { width:100%; box-sizing:border-box; background:#2b302d; color:#eee; border:1px solid #444e48; border-radius:3px; padding:7px; font:12px monospace; appearance:textfield; }
    #kiln-cue-editor input::-webkit-inner-spin-button { appearance:none; }
    #kiln-cue-editor label { display:grid; grid-template-columns:1fr 100px; gap:10px; align-items:center; margin:8px 0; }
    #kiln-cue-editor .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
    @media(max-width:600px) { #kiln-film header {top:12px;left:14px;right:14px;} #kiln-film footer {left:14px;right:14px;bottom:12px;} #kiln-film button {padding:9px 11px;} #kiln-cue-editor {right:14px;max-width:calc(100% - 28px);} }
  `;
  document.head.append(style);
  const ui = document.createElement('section');
  ui.id = 'kiln-film';
  ui.innerHTML = `<header><strong>Kaminos</strong><span id="kiln-mode">Kiln</span><button id="kiln-authoring">Authoring</button></header>
    <div id="kiln-cue-editor" hidden></div>
    <footer><div id="kiln-phase" role="status">Loading scene</div><button id="kiln-preview">Preview</button><button id="kiln-fire">Fire SF3D</button><button id="kiln-stop" title="Stop preview and return to the authored scene">Stop</button><button id="kiln-edit">Edit cues</button></footer>`;
  document.body.append(ui);
  document.body.classList.add('kiln-cinema');
  const byId = id => ui.querySelector(`#${id}`);
  const status = text => { byId('kiln-phase').textContent = text; };
  let performanceRun = null, producer = null, previewOutput = null, busy = false, live = false, armed = false, previewCompleted = false;
  let disposed = false, frame = null, lastPhase = null, initialArm = true;
  let invocation = null;
  let cueWorkspace = null;
  let performanceRecipe = null;
  const state = { mode: null, phase: 'idle', failure: null, presentation: null, effective: null };
  const outputIds = new Set();
  const controlsDisabled = value => {
    for (const id of ['kiln-preview', 'kiln-fire', 'kiln-edit', 'kiln-authoring']) byId(id).disabled = value;
    byId('kiln-stop').disabled = live;
  };
  function end() {
    if (live) throw new Error('Live inference is still running');
    invocation?.abort(); invocation = null;
    try {host.cinematic.end();}
    finally {
      armed = false; performanceRun = null; lastPhase = null;
      state.phase = 'idle'; state.effective = null; busy = false;
      controlsDisabled(false);
    }
  }
  function arm() {
    if (!armed) { host.cinematic.begin(); armed = true; }
    performanceRecipe = host.cinematic.read();
    performanceRun = createKilnPerformance(performanceRecipe);
    lastPhase = null;
  }
  function fail(error) {
    const message = error?.message || String(error);
    performanceRun?.fail(message); state.failure = message; state.phase = 'failed';
    status(message); controlsDisabled(live);
  }
  async function start(mode) {
    if (busy) return;
    const request = new AbortController();
    invocation = request;
    const current = () => invocation === request && !request.signal.aborted;
    busy = true; live = mode === 'live'; controlsDisabled(true);
    byId('kiln-cue-editor').hidden = true;
    state.failure = null; state.mode = mode; state.presentation = null; previewCompleted = false;
    byId('kiln-mode').textContent = mode === 'preview' ? 'Preview / retained SF3D chair' : 'Live / SF3D';
    try {
      if (armed) { host.cinematic.end(); armed = false; }
      arm();
      const retained = host.cinematic.findOutput(PREVIEW_SHA);
      if (retained) outputIds.add(retained.objectId);
      host.cinematic.hideOutputs([...outputIds]);
      if (mode === 'preview') {
        status('Loading retained output');
        if (previewOutput && !host.cinematic.contains(previewOutput.objectId)) previewOutput = null;
        previewOutput ||= host.cinematic.findOutput(PREVIEW_SHA);
        const temporary = !!previewOutput;
        if (!previewOutput) {
          const response = await fetch(`/api/read?root=generated-meshes&path=${PREVIEW_SHA}.glb`, {signal:request.signal});
          if (!current()) return;
          if (!response.ok) throw new Error(`Retained preview mesh unavailable (${response.status})`);
          const bytes = await response.arrayBuffer();
          if (!current()) return;
          const output = await host.presentGlb(bytes, {runId:'cinematic-preview-retained',sha256:PREVIEW_SHA,signal:request.signal});
          if (!current()) return;
          previewOutput = output;
        }
        outputIds.add(previewOutput.objectId);
        host.cinematic.stage(previewOutput.objectId, {temporary});
        performanceRun.start('preview');
      } else {
        status('Loading SF3D');
        producer ||= await (await import('./sf3d-live-flame-inject.mjs')).mountComposition({
          ...context,
          host: { ...host, async presentGlb(bytes, identity) {
            const presentation = await host.presentGlb(bytes, identity);
            host.cinematic.stage(presentation.objectId);
            outputIds.add(presentation.objectId);
            return presentation;
          } },
          onEvent(event) {
            if (event.type === 'started') performanceRun.start('live');
            if (event.type === 'progress') status(event.message);
            if (event.type === 'presented') { performanceRun.complete(event.presentation); state.presentation = event.presentation; }
            if (event.type === 'failed') fail(new Error(event.error.message));
          },
        });
        const output = await producer.run();
        if (!output) throw new Error(window.__sf3dLiveFlame?.lastError?.message || 'SF3D produced no registered output');
      }
    } catch (error) { if(current()) fail(error); }
    finally { if(current()) {live = false; byId('kiln-stop').disabled = false;} }
  }
  function tick() {
    if (disposed) return;
    try {
      if (initialArm && host.cinematic.available()) {arm();initialArm=false;controlsDisabled(false);}
      if (performanceRun) {
        let sample = performanceRun.sample();
        if (sample.mode === 'preview' && !previewCompleted && sample.elapsed >= performanceRecipe.ignition.at(-1).time + performanceRecipe.previewWorkSeconds) {
          performanceRun.complete(previewOutput); previewCompleted = true; state.presentation = previewOutput; sample = performanceRun.sample();
        }
        host.cinematic.sample(sample);
        Object.assign(state, {phase: sample.phase, effective: sample});
        if (sample.phase !== lastPhase && !state.failure) {
          status(({idle:'Standby',ignition:'Ignition',work:'Firing',extinguish:'Fuel off',reveal:'Revealing',complete:'Complete'})[sample.phase] || sample.phase);
          lastPhase = sample.phase;
        }
        if (['complete','failed'].includes(sample.phase)) { busy = false; controlsDisabled(live); }
      }
    } catch (error) {
      fail(error); performanceRun = null;
      try {host.cinematic.quiesce();}
      catch(stopError) {status(`${state.failure}; source shutdown failed: ${stopError.message}`);}
    }
    frame = requestAnimationFrame(tick);
  }
  function edit() {
    end();
    document.body.classList.remove('kiln-cinema');
    byId('kiln-authoring').textContent='Cinema';
    if(!cueWorkspace)throw Error('Cue workspace is not mounted');
    cueWorkspace.open();
    status('Authoring cues');
  }
  byId('kiln-preview').onclick = () => start('preview');
  byId('kiln-fire').onclick = () => start('live');
  byId('kiln-stop').onclick = () => { try {end();status('Stopped');} catch(error){fail(error);} };
  byId('kiln-edit').onclick = () => { try {edit();} catch(error){fail(error);} };
  byId('kiln-authoring').onclick = () => {
    try {
      end();
      const cinema = document.body.classList.toggle('kiln-cinema');
      byId('kiln-authoring').textContent = cinema ? 'Authoring' : 'Cinema';
      byId('kiln-cue-editor').hidden = true;
      status(cinema ? 'Kiln' : 'Authoring');
    } catch(error){fail(error);}
  };
  window.kaminosCinematic = { state: () => structuredClone({...state,armed}), preview:()=>start('preview'), fire:()=>start('live'), stop:end, read:host.cinematic.read, write:host.cinematic.write, openCues:edit };
  if(host.cinematic.workspace)cueWorkspace=installKilnCueWorkspace({host,
    preview:()=>{document.body.classList.add('kiln-cinema');byId('kiln-authoring').textContent='Authoring';return start('preview');},
    openCinema:()=>{document.body.classList.add('kiln-cinema');byId('kiln-authoring').textContent='Authoring';},
    onError:error=>status(error.message)});
  if(host.cinematic.tuneEditor)window.kaminosCinematic.cueEditor=host.cinematic.tuneEditor();
  window.addEventListener('keydown',event=>{
    if (!document.body.classList.contains('kiln-cinema') || /INPUT|TEXTAREA/.test(event.target?.tagName)) return;
    if (['g','r','s','x','y','z','f','Home','Delete','Backspace','Escape'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();
      if (event.key === 'Escape' && !live) {end();status('Stopped');}
    }
  },true);
  controlsDisabled(true);
  byId('kiln-stop').disabled = true;
  status('Loading scene');
  tick();
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(frame);},{once:true});
  return window.kaminosCinematic;
}
