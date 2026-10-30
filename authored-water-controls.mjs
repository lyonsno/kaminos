import {normalizeAuthoredWaterDrop,describeAuthoredWaterDrop} from './authored-water-drop.mjs';
/** Water properties use the ordinary scene edit API. Debounce typing; finish a
 * numeric drag before committing, so Escape still cancels one whole gesture. */
export function mountAuthoredWaterControls({document,root,sourceRoot=null,simulationRoot=null,controls,api,schedule=setTimeout,cancel=clearTimeout}) {
 const node=document.createElement('section');node.className='panel authored-water-controls';
 node.innerHTML=`<style>
 .authored-water-controls [hidden]{display:none!important}
 .authored-water-controls .hint{font-size:12px;line-height:1.45;color:#a9b8be;margin:8px 0}
 .authored-water-controls [data-bounds] label{display:grid;grid-template-columns:4.5em repeat(3,minmax(0,1fr));align-items:center;gap:4px}
 .authored-water-controls [data-bounds] input{min-width:0;width:100%}
 .authored-water-controls [data-actions]{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
 </style>
 <h2>Water sources</h2><div data-actions><button class="btn" data-add>Add water volume</button><button class="btn" data-add-flow>Add water emitter</button></div>
 <button class="btn" data-select-simulation>Select Water simulation</button>
 <p class="hint">Select a source in the scene to edit it. Playback, capacity and world bounds belong to Water simulation in the scene outline.</p>
 <div data-simulation>
  <div data-run><div data-actions><button class="btn" data-reset>Reset to initial state</button><button class="btn" data-release>Restart</button><button class="btn" data-pause>Play</button></div>
   <p class="hint" data-state role="status"></p><details><summary>Simulation timing</summary><p class="hint" data-cadence></p></details><p class="hint" data-play-blocked role="status"></p><button class="btn" data-fit-bounds hidden>Fit bounds to water</button><p role="alert" data-run-error></p>
  </div>
  <h3>Particle allocation</h3>
  <label>Additional particle slots<input class="transform-input" type="number" step="256" min="1" data-capacity></label>
  <p class="hint">Added to the initial water particles to form one shared, recyclable pool. Departed initial water also frees slots for emitters. A full pool stops new emission until water leaves or retires. This changes capacity, not flow rate or particle size.</p>
  <p class="hint" data-allocation-summary></p><div data-initial-resolution><label>Initial volume particle target<input class="transform-input" type="number" step="256" min="1" data-target></label><p class="hint" data-resolution-summary></p></div>
  <h3>Simulation bounds</h3><label><input type="checkbox" data-container>Contain water at the bounds</label><div data-bounds></div>
  <p class="hint">Water collides with scene planes, spheres and bowls. Without boundary walls, water that leaves this box is removed.</p>
  <h3>Optical rendering</h3>
  <label>Minimum transmission ray contribution<input class="transform-input" type="number" min="0" max="1" step="0.05" data-transmission-cutoff></label>
  <p class="hint">Skips expensive refraction and exit-cone rays when transmitted weight (1 − Fresnel) × Beer-Lambert transmittance falls below this threshold (default 0.25). Applies immediately.</p>
  <p class="hint">Settings save automatically. Restart applies allocation and bounds changes to the simulation.</p><p role="alert" data-simulation-error></p>
  <div data-compatibility><p class="hint" data-compatibility-status role="status"></p><p class="hint" data-match-plan></p><button class="btn" data-match>Match initial volumes to selected setup</button><p role="alert" data-match-error></p></div>
 </div>
 <div data-selected hidden>
  <p class="hint" data-label></p>
  <label>Source type<select class="select-input" data-mode><option value="finite_drop">Initial water volume</option><option value="continuous">Continuous emitter</option></select></label>
  <div data-drop><label>Initial volume width<input class="transform-input" type="number" min="0" step="0.01" data-width></label><p class="hint" data-proposed></p><p class="hint">Places water once at the start. Move and size this object in the viewport; Restart uses its new initial shape. Resolution belongs to Water simulation.</p></div>
  <div data-flow hidden>
   <label>Flow · litres/s<input class="transform-input" type="number" min="0" step="0.1" data-rate></label>
   <label>Aperture radius<input class="transform-input" type="number" min="0.035" max="0.18" step=".001" data-radius></label>
   <label>Launch speed · m/s<input class="transform-input" type="number" min=".25" max="2.6" step=".01" data-strength></label>
   <label><input type="checkbox" data-retire>Retire emitted water after a time</label><label data-lifetime-field>Lifetime · simulation seconds<input class="transform-input" type="number" min="0" step="1" data-lifetime></label>
   <p class="hint">Without timed retirement, water stays until it leaves the simulation bounds or you reset it. Placement, rate and speed affect new water immediately.</p>
   <button class="btn" data-stop>Stop emission</button>
  </div>
  <p role="status" data-source-status></p><p role="alert" data-source-error></p>
  <button class="btn" data-source-simulation>Select Water simulation</button>
 </div>`;
 node.querySelectorAll('label').forEach(label=>label.classList.add('field'));root.prepend(node);
 const sourcePanel=node.querySelector('[data-selected]'),simulationPanel=node.querySelector('[data-simulation]');
 sourcePanel.classList.add('authored-water-controls');simulationPanel.classList.add('authored-water-controls');
 const $=q=>node.querySelector(q)??sourcePanel.querySelector(q)??simulationPanel.querySelector(q);
 const sourceError=$('[data-source-error]'),runError=$('[data-run-error]'),simulationError=$('[data-simulation-error]');
 let selected=null,dirty=false,simulationDirty=false,revision=0,simulationRevision=0,disposed=false,inFlight=null,ownWrite=null,acceptedSource=null,acceptedSimulation=null,runRevision=0,previewInfo=null;
 const timers=new Map(),gestures=new Set(),scrubs=[];
 const stopTimer=kind=>{if(timers.has(kind)){cancel(timers.get(kind));timers.delete(kind);}};
 const current=(id,version)=>!disposed&&selected?.id===id&&revision===version;
 const call=async(action,{error=runError}={})=>{if(disposed)return;const id=selected?.id,version=revision,runVersion=error===runError?++runRevision:runRevision;try{error.textContent='';await action();if(!disposed)refresh();return true;}catch(e){if(!disposed&&(error!==sourceError||current(id,version))&&(error!==runError||runVersion===runRevision))error.textContent=e.message;return false;}};
 for(const name of ['min','max']){
  const row=document.createElement('label');row.textContent=name==='min'?'Min XYZ':'Max XYZ';
  for(let k=0;k<3;k++){const input=document.createElement('input');input.type='number';input.className='transform-input';input.step='.1';input.dataset.bound=name;input.dataset.axis=k;input.setAttribute('aria-label',`${name} ${'XYZ'[k]}`);row.append(input);}
  $('[data-bounds]').append(row);
 }
 const number=input=>{if(String(input.value).trim()==='')throw Error('Complete the water property value.');return Number(input.value);};
 const bounds=()=>Object.fromEntries(['min','max'].map(name=>[name,[...simulationPanel.querySelectorAll(`[data-bound=${name}]`)].map(number)]));
 const proposal=()=>{
  // Number('') is zero; incomplete keyboard input must remain an invalid draft.
  const value=selector=>number($(selector));
  return {mode:$('[data-mode]').value,...($('[data-mode]').value==='continuous'?{volumeRate:value('[data-rate]')/1000,baseRadius:value('[data-radius]'),strength:value('[data-strength]'),lifetimeSeconds:$('[data-retire]').checked?value('[data-lifetime]'):null}:{}),drop:{...selected.settings.drop,width:value('[data-width]')}};
 };
 const simulationProposal=()=>{
  const patch={particleCount:number($('[data-capacity]')),transmissionMinContribution:number($('[data-transmission-cutoff]'))};
  if(api.read().simulation?.sampling)patch.waterSampling={...api.read().simulation.sampling,particleTarget:number($('[data-target]')),container:$('[data-container]').checked?bounds():null,...(!$('[data-container]').checked?{worldBounds:bounds()}:{})};
  return patch;
 };
 const restorePreview=()=>{stopTimer('preview');previewInfo=null;api.preview?.(null);};
 function queuePreview(){
  if(!api.preview)return;stopTimer('preview');
  timers.set('preview',schedule(()=>{timers.delete('preview');if(disposed)return;try{previewInfo=api.preview({id:selected?.id,source:dirty&&selected?proposal():null,waterSampling:simulationDirty?simulationProposal().waterSampling:null});showProposal();}catch(e){(simulationDirty?simulationError:sourceError).textContent=e.message;}},0));
 }
 async function flush(kind){
  stopTimer(kind);
  const entryId=selected?.id,entryRevision=revision,entrySimulationRevision=simulationRevision;
  if(inFlight){await inFlight;if(disposed)return false;
   if(kind==='source'&&(selected?.id!==entryId||revision!==entryRevision))return false;
   if(kind==='simulation'&&simulationRevision!==entrySimulationRevision)return false;
  }
  // A selection can change while awaiting an older edit. refresh cancels its
  // draft/timer; never infer a new edit from the former source's completion.
  if(disposed)return false;
  if(kind==='source'&&(!dirty||!selected))return true;
  if(kind==='simulation'&&!simulationDirty)return true;
  const id=selected?.id,version=revision,simVersion=simulationRevision;
  let patch;try{patch=kind==='source'?proposal():simulationProposal();}catch(e){(kind==='simulation'?simulationError:sourceError).textContent=e.message;return false;}
  restorePreview();
  const error=kind==='source'?sourceError:simulationError;error.textContent='';
  const operation=(async()=>{
   try{
    let result;ownWrite=kind;
    try{result=kind==='source'?api.edit(id,patch):api.editSimulation(patch);}finally{ownWrite=null;}
    await result;
    if(disposed)return false;
    if(kind==='source'&&current(id,version))dirty=false;
    if(kind==='simulation'&&simulationRevision===simVersion)simulationDirty=false;
    refresh();return true;
   }catch(e){if(!disposed&&(kind!=='source'||current(id,version)))error.textContent=e.message;return false;}
  })();
  inFlight=operation;try{return await operation;}finally{if(inFlight===operation)inFlight=null;}
 }
 function queue(kind){stopTimer(kind);if(!disposed&&!gestures.has(kind))timers.set(kind,schedule(()=>{timers.delete(kind);return flush(kind);},250));}
 function showResolutionSummary(simulation=api.read().simulation){
  const preview=previewInfo?.draft?previewInfo:null,sampling=preview?.sampling??simulation?.sampling,count=preview?.particleCount??simulation?.proposedParticleCount,error=preview?.relativeVolumeError??simulation?.relativeVolumeError;
  $('[data-resolution-summary]').textContent=sampling?`${count?.toLocaleString()??'—'} ${preview?'preview':'initial'} particles · derived spacing ${sampling.spacing.toPrecision(4)} · ${(error*100).toFixed(2)}% total volume error. Target is shared across all drops; adding water makes resolution coarser at the same target. Applies on Restart; this changes initial sampling, not the volume of water.`:'';
 }
 function showProposal(){
  const w=Number($('[data-width]').value),shared=previewInfo?.sampling??api.read().simulation?.sampling;let d=null;try{d=selected?describeAuthoredWaterDrop({...selected.settings.drop,width:w},selected.transform??{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},shared):null;}catch{}
  const n=d?.samplesAcross??0,spacing=d?.spacing??w/n;
  $('[data-proposed]').textContent=d?`${d.particleCount.toLocaleString()} particles · ${n} across · world spacing ${spacing.toPrecision(4)}. World width ${d.width.toPrecision(4)} → ${d.representedWidth.toPrecision(4)}. Requested volume ${d.requestedVolume.toPrecision(4)} → represented ${d.worldVolume.toPrecision(4)} (${(d.relativeVolumeError*100).toFixed(2)}%).${Math.abs(d.relativeVolumeError)>.10?' Coarse sampling: volume error exceeds 10%; increase the particle target for a closer fit.':''}`:'Enter a positive drop width.';
  $('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';$('[data-flow]').hidden=$('[data-mode]').value!=='continuous';
  $('[data-lifetime-field]').hidden=!$('[data-retire]').checked;
  $('[data-source-status]').textContent=dirty?'Pending property changes…':'';showResolutionSummary();refreshCompatibility();
 }
 function preview(){revision++;dirty=true;showProposal();queuePreview();queue('source');}
 for(const input of node.querySelectorAll('input[type=number]')){
  const kind=input===$('[data-capacity]')||input===$('[data-target]')||input===$('[data-transmission-cutoff]')||input.dataset.bound?'simulation':'source';
  input.addEventListener('input',kind==='simulation'?()=>{simulationRevision++;simulationDirty=true;showProposal();queuePreview();queue(kind);}:preview);
  const drag=controls.installNumberDrag({input,step:Number(input.step),onStart:()=>{gestures.add(kind);stopTimer(kind);},onEnd:()=>{gestures.delete(kind);if((kind==='source'?dirty:simulationDirty)&&!disposed)void flush(kind);}});scrubs.push(drag);
  input.addEventListener('pointercancel',()=>{restorePreview();stopTimer(kind);if(kind==='simulation'){simulationDirty=false;simulationRevision++;}else{dirty=false;revision++;sourceError.textContent='';}refresh();});
 }
 $('[data-mode]').onchange=preview;$('[data-retire]').onchange=preview;$('[data-container]').onchange=()=>{simulationRevision++;simulationDirty=true;queuePreview();queue('simulation');};
 $('[data-add]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.add();});
 $('[data-add-flow]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.add({mode:'continuous'});});
 $('[data-source-simulation]').onclick=()=>call(()=>api.selectSimulation(),{error:sourceError});
 $('[data-select-simulation]').onclick=()=>call(()=>api.selectSimulation());
 $('[data-stop]').onclick=()=>{stopTimer('source');revision++;dirty=false;return call(()=>api.edit(selected.id,{mode:'continuous',volumeRate:0}),{error:sourceError});};
 $('[data-match]').onclick=()=>call(()=>api.match(selected?.id??api.read().simulation?.compatibility?.match?.referenceId),{error:$('[data-match-error]')});
 $('[data-fit-bounds]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.fitBounds();});
 $('[data-reset]').onclick=()=>call(()=>api.reset());
 $('[data-release]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.release(selected?.id??api.read().sources?.[0]?.id);});
 $('[data-pause]').onclick=()=>call(async()=>{if(api.read().runtime)return api.pause();if(await flush('source')&&await flush('simulation'))return api.release(selected?.id??api.read().sources?.[0]?.id);});
 function refresh(){
  if(disposed)return;const s=api.read();
  const sourceSignature=JSON.stringify(s.selected?.settings),simulationSignature=JSON.stringify(s.simulation?.settings);
  const sourceChanged=s.selected?.id!==selected?.id||(acceptedSource!==sourceSignature&&ownWrite!=='source');
  if(sourceChanged){restorePreview();stopTimer('source');dirty=false;revision++;sourceError.textContent='';}
  if(acceptedSimulation!==simulationSignature&&ownWrite!=='simulation'){stopTimer('simulation');simulationDirty=false;simulationRevision++;simulationError.textContent='';}
  acceptedSource=sourceSignature;acceptedSimulation=simulationSignature;
  selected=s.selected;sourcePanel.hidden=!selected;
  const simulation=s.simulation;simulationPanel.hidden=!simulation?.present||simulation.selected===false;$('[data-select-simulation]').disabled=!simulation?.present;
  if(!simulation?.present){stopTimer('simulation');simulationDirty=false;simulationRevision++;}
  if(simulation?.settings&&!simulationDirty){$('[data-capacity]').value=simulation.settings.particleCount??12000;$('[data-transmission-cutoff]').value=simulation.settings.transmissionMinContribution??.25;if(simulation.sampling){$('[data-target]').value=simulation.sampling.particleTarget??Math.round(simulation.requestedVolume/simulation.sampling.spacing**3);$('[data-container]').checked=simulation.sampling.container!==null;const b=simulation.sampling.container??simulation.sampling.worldBounds;$('[data-bounds]').hidden=false;for(const input of simulationPanel.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];}}
  $('[data-allocation-summary]').textContent=simulation?.present?`On Restart: ${(simulation.proposedParticleCount??0).toLocaleString()} initial + ${(s.sources?.some(r=>r.mode!=='finite_drop')?(simulation.settings?.particleCount??12000):0).toLocaleString()} additional = ${((simulation.proposedParticleCount??0)+(s.sources?.some(r=>r.mode!=='finite_drop')?(simulation.settings?.particleCount??12000):0)).toLocaleString()} total slots.`:'';
  showResolutionSummary(simulation);$('[data-initial-resolution]').hidden=!s.sources?.some(r=>r.mode==='finite_drop')&&selected?.settings?.mode!=='finite_drop';
  $('[data-release]').disabled=!(s.sources?.length||selected);
  if(selected){
   $('[data-label]').textContent=selected.label;
   if(!dirty){
    const finite=selected.settings.mode==='finite_drop';$('[data-mode]').value=finite?'finite_drop':'continuous';$('[data-rate]').value=(selected.settings.volumeRate??selected.settings.rate*.05**3/3)*1000;$('[data-radius]').value=selected.settings.baseRadius;$('[data-strength]').value=selected.settings.strength;$('[data-retire]').checked=selected.settings.lifetimeSeconds!=null;$('[data-lifetime]').value=selected.settings.lifetimeSeconds??6;
    const d=normalizeAuthoredWaterDrop(selected.settings.drop);$('[data-width]').value=d.width;if(!s.simulation?.sampling)$('[data-container]').checked=d.container!==null;
    if(!s.simulation?.sampling){const b=d.container??d.worldBounds;for(const input of simulationPanel.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];}
   }
   showProposal();
  }
  refreshCompatibility(s);refreshStatus(s);
 }
 function refreshCompatibility(s=api.read()){
  const status=s.simulation?.compatibility,plan=status?.match;
  $('[data-compatibility]').hidden=!status||(status.sourceCount<2&&status.compatible);
  $('[data-compatibility-status]').textContent=status?.compatible?'Drops share compatible sampling and container.':status?.message??'';
  $('[data-match-plan]').textContent=plan?.changes.length?`Use ${plan.referenceLabel}: spacing ${plan.spacing.toPrecision(5)}; ${plan.containerEnabled?'container walls on':'container walls off'}. `+plan.changes.map(c=>`${c.label}: world width ${c.previousWorldWidth.toPrecision(5)} → ${c.worldWidth.toPrecision(5)}, ${c.previousParticleCount.toLocaleString()} → ${c.particleCount.toLocaleString()} particles`).join('; ')+`. Total ${plan.particleCount.toLocaleString()} particles. Matching rounds widths to whole particle spacings and is undoable.`:status?.matchError!==status?.message?(status?.matchError??''):'';
  $('[data-match]').disabled=dirty||simulationDirty||!plan?.changes.length||!api.match;
  $('[data-match]').hidden=!plan?.changes.length;
 }
 function refreshStatus(s=api.read()){
  const runtime=s.runtime,population=runtime?.population,capacity=runtime?.capacity??runtime?.particleCount;
  const text=runtime?`${runtime.paused?'Paused':'Playing'} · tick ${runtime.clock?.completedStep??runtime.step??0} · ${population?.active!=null?population.active.toLocaleString()+' live':'live count pending'} / ${capacity?.toLocaleString()??'unknown'} capacity`:s.failure?`Water stopped: ${s.failure}`:'Initial state. Play starts water; Restart begins again from the sources.';
  const timing=runtime?.cadence,clock=runtime?.clock;
  $('[data-cadence]').textContent=timing?`Fluid updates ${timing.completedBatches} · last batch ${timing.lastBatchSteps} steps (${(timing.lastBatchSteps*(clock?.dt??1/240)*1000).toFixed(0)} ms simulated) · ${(1000*(clock?.backlogSeconds??0)).toFixed(0)} ms waiting. Scene FPS is independent of fluid updates.`:'';
  const blocker=!s.runtime&&s.simulation?.compatibility?.compatible===false?s.simulation.compatibility.message:'';
  $('[data-play-blocked]').textContent=blocker?`Play unavailable: ${blocker}`:'';
  const fit=s.simulation?.boundsFit;$('[data-fit-bounds]').hidden=!fit?.changed||s.simulation?.sampling?.container===null;$('[data-fit-bounds]').disabled=dirty||simulationDirty;
  $('[data-fit-bounds]').title=fit?.changed?'Enlarge the shared box to include the placed water. Drop positions, sizes and particle target stay unchanged. Undo restores the previous box.':'';
  const status=text+(s.runtime?.pendingSourceChanges?' · Initial setup changed. Restart to apply it; displayed water is from the current run.':'');if($('[data-state]').textContent!==status)$('[data-state]').textContent=status;
  if(!dirty){
   const inlet=runtime?.liveInlets?.inlets.find(row=>row.id===s.selected?.id);
   const reason=inlet?.blockedReason;
   const message=reason==='capacity'?'Particle capacity is full. New emission is blocked; existing water continues moving. Select Water simulation to increase capacity and Restart, or let water leave open bounds.':
    reason==='outside_domain'||reason==='aperture_outside_domain'?'Emitter is outside the simulation bounds, or its aperture crosses them. Move it inside or enlarge the bounds and Restart.':
    reason==='stale_input'?'Emitter input is stale; new emission is stopped.':reason==='stopped'?'Flow is stopped. Existing water continues moving.':'';
   $('[data-source-status]').textContent=message+(runtime?.pendingSourceChanges?' Initial setup changed. Select Water simulation and Restart to apply it.':'');
  }
  const hasSources=Boolean(s.sources?.length||s.selected);
  $('[data-reset]').disabled=!s.runtime&&!hasSources;$('[data-release]').disabled=!hasSources||s.simulation?.compatibility?.compatible===false;$('[data-release]').textContent='Restart';$('[data-pause]').disabled=!s.runtime&&(!hasSources||s.simulation?.compatibility?.compatible===false);$('[data-pause]').textContent=s.runtime&&!s.runtime.paused?'Pause':'Play';
 }
 let historyState={undoCount:0,redoCount:0};
 const unsubscribe=api.subscribeEdits?.(state=>{
  const historyBoundary=state.replaying||state.undoCount<historyState.undoCount||state.redoCount!==historyState.redoCount;
  historyState=state;
  if(!disposed&&!ownWrite&&historyBoundary){
   restorePreview();stopTimer('source');stopTimer('simulation');dirty=false;simulationDirty=false;revision++;simulationRevision++;sourceError.textContent='';simulationError.textContent='';refresh();
  }
 });
 if(sourceRoot)sourceRoot.append(sourcePanel);if(simulationRoot)simulationRoot.append(simulationPanel);
 refresh();return {node,refresh,refreshStatus,flush:async()=>await flush('source')&&await flush('simulation'),dispose(){restorePreview();disposed=true;unsubscribe?.();stopTimer('source');stopTimer('simulation');for(const drag of scrubs)drag?.stop?.();sourcePanel.remove?.();simulationPanel.remove?.();node.remove();}};
}
