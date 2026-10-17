import {normalizeAuthoredWaterDrop,describeAuthoredWaterDrop} from './authored-water-drop.mjs';
/** Water properties use the ordinary scene edit API. Debounce typing; finish a
 * numeric drag before committing, so Escape still cancels one whole gesture. */
export function mountAuthoredWaterControls({document,root,sourceRoot=null,simulationRoot=null,controls,api,schedule=setTimeout,cancel=clearTimeout}) {
 const node=document.createElement('section');node.className='panel authored-water-controls';
 node.innerHTML=`<style>.authored-water-controls [hidden]{display:none!important}.authored-water-controls .hint{font-size:12px;line-height:1.45;color:#a9b8be;margin:8px 0}.authored-water-controls [data-bounds] label{display:grid;grid-template-columns:4.5em repeat(3,minmax(0,1fr));align-items:center;gap:4px}.authored-water-controls [data-bounds] input{min-width:0;width:100%}.authored-water-controls [data-actions]{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}</style><h2>Water</h2><button class="btn" data-add>Add water drop</button><button class="btn" data-select-simulation>Shared water settings</button><p class="hint">Place drops, then play. Select a water object for its properties.</p><div data-run><button class="btn" data-reset>Reset</button><button class="btn" data-release>Replay</button><button class="btn" data-pause>Play</button><p class="hint" data-state role="status"></p><p class="hint" data-play-blocked role="status"></p><button class="btn" data-fit-bounds hidden>Fit bounds to water</button></div><div data-compatibility><p class="hint" data-compatibility-status role="status"></p><p class="hint" data-match-plan></p><button class="btn" data-match>Match drops to selected setup</button><p role="alert" data-match-error></p></div><div data-simulation><label>Rough particle target · all water<input class="transform-input" type="number" step="256" min="1" data-target></label><p class="hint" data-resolution-summary></p><label><input type="checkbox" data-container>Invisible container · all water</label><div data-bounds></div><p class="hint">Shared world bounds. Scene meshes are not water colliders yet.</p><label>Density passes · all drops<input class="transform-input" type="number" step="1" min="1" data-passes></label><p class="hint">One shared solver applies this count to every drop, so their particles interact. Changes save automatically for the next Replay.</p><p role="alert" data-simulation-error></p></div>
 <div data-selected hidden><p class="hint" data-label></p><p class="hint">Initial particles at rest; no simulation steps. Changes save automatically. Released water moves independently; edits apply on the next release.</p><label>Water mode<select class="select-input" data-mode><option value="finite_drop">Finite drop</option><option value="continuous">Continuous flow</option></select></label>
 <div data-drop><label>Drop width<input class="transform-input" type="number" step="0.01" data-width></label><label hidden>Legacy particles across<input class="transform-input" type="number" step="1" min="1" readonly data-samples></label><p class="hint" data-proposed></p><p class="hint">Particle count follows the shared target automatically. Size is requested; initial water is quantized to particle layers.</p></div>
 <div data-flow hidden><label>Particles / second<input class="transform-input" type="number" min="0" step="100" data-rate></label><label>Aperture radius<input class="transform-input" type="number" min="0.035" max="0.18" step=".001" data-radius></label><label>Flow strength<input class="transform-input" type="number" min=".25" max="2.6" step=".01" data-strength></label><button class="btn" data-stop>Stop emission</button></div><p role="status" data-source-status></p><p role="alert" data-source-error></p></div><p role="alert" data-run-error></p>`;
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
  return {mode:$('[data-mode]').value,...($('[data-mode]').value==='continuous'?{rate:value('[data-rate]'),baseRadius:value('[data-radius]'),strength:value('[data-strength]')}:{}),drop:{...selected.settings.drop,width:value('[data-width]')}};
 };
 const simulationProposal=()=>{
  const patch={densityIterations:number($('[data-passes]'))};
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
  $('[data-resolution-summary]').textContent=sampling?`${count?.toLocaleString()??'—'} ${preview?'preview':'actual quantized'} particles · derived spacing ${sampling.spacing.toPrecision(4)} · ${(error*100).toFixed(2)}% total volume error. Target is shared across all drops; adding water makes resolution coarser at the same target. Changes apply to initial particles and the next Replay.`:'';
 }
 function showProposal(){
  const w=Number($('[data-width]').value),shared=previewInfo?.sampling??api.read().simulation?.sampling;let d=null;try{d=selected?describeAuthoredWaterDrop({...selected.settings.drop,width:w},selected.transform??{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},shared):null;}catch{}
  const n=d?.samplesAcross??Number($('[data-samples]').value),spacing=d?.spacing??w/n;
  $('[data-proposed]').textContent=d?`${d.particleCount.toLocaleString()} particles · ${n} across · world spacing ${spacing.toPrecision(4)} · support radius ${d.supportRadius.toPrecision(4)} · collision radius ${d.collisionRadius.toPrecision(4)}. World width ${d.width.toPrecision(4)} → ${d.representedWidth.toPrecision(4)}. Requested volume ${d.requestedVolume.toPrecision(4)} → represented ${d.worldVolume.toPrecision(4)} (${(d.relativeVolumeError*100).toFixed(2)}%).${Math.abs(d.relativeVolumeError)>.10?' Coarse sampling: volume error exceeds 10%; increase the particle target for a closer fit.':''}`:'Enter a positive drop width.';
  $('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';$('[data-flow]').hidden=$('[data-mode]').value!=='continuous';
  $('[data-source-status]').textContent=dirty?'Pending property changes…':'';showResolutionSummary();refreshCompatibility();
 }
 function preview(){revision++;dirty=true;showProposal();queuePreview();queue('source');}
 for(const input of node.querySelectorAll('input[type=number]')){
  const kind=input===$('[data-passes]')||input===$('[data-target]')||input.dataset.bound?'simulation':'source';
  input.addEventListener('input',kind==='simulation'?()=>{simulationRevision++;simulationDirty=true;showProposal();queuePreview();queue(kind);}:preview);
  const drag=controls.installNumberDrag({input,step:Number(input.step),onStart:()=>{gestures.add(kind);stopTimer(kind);},onEnd:()=>{gestures.delete(kind);if((kind==='source'?dirty:simulationDirty)&&!disposed)void flush(kind);}});scrubs.push(drag);
  input.addEventListener('pointercancel',()=>{restorePreview();stopTimer(kind);if(kind==='simulation'){simulationDirty=false;simulationRevision++;}else{dirty=false;revision++;sourceError.textContent='';}refresh();});
 }
 $('[data-mode]').onchange=preview;$('[data-container]').onchange=()=>{simulationRevision++;simulationDirty=true;queuePreview();queue('simulation');};
 $('[data-add]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.add();});
 $('[data-select-simulation]').onclick=()=>call(()=>api.selectSimulation());
 $('[data-stop]').onclick=()=>{stopTimer('source');revision++;dirty=false;return call(()=>api.edit(selected.id,{mode:'continuous',rate:0}),{error:sourceError});};
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
  const simulation=s.simulation;simulationPanel.hidden=!simulation?.present;$('[data-select-simulation]').disabled=!simulation?.present;
  if(!simulation?.present){stopTimer('simulation');simulationDirty=false;simulationRevision++;}
  if(simulation?.settings&&!simulationDirty){$('[data-passes]').value=simulation.settings.densityIterations;if(simulation.sampling){$('[data-target]').value=simulation.sampling.particleTarget??Math.round(simulation.requestedVolume/simulation.sampling.spacing**3);$('[data-container]').checked=simulation.sampling.container!==null;const b=simulation.sampling.container??simulation.sampling.worldBounds;for(const input of simulationPanel.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];}}
  showResolutionSummary(simulation);
  $('[data-release]').disabled=!(s.sources?.length||selected);
  if(selected){
   $('[data-label]').textContent=selected.label;
   if(!dirty){
    const finite=selected.settings.mode==='finite_drop';$('[data-mode]').value=finite?'finite_drop':'continuous';$('[data-rate]').value=selected.settings.rate;$('[data-radius]').value=selected.settings.baseRadius;$('[data-strength]').value=selected.settings.strength;
    const d=normalizeAuthoredWaterDrop(selected.settings.drop);$('[data-width]').value=d.width;$('[data-samples]').value=Math.round(d.width*d.samplesPerUnit);if(!s.simulation?.sampling)$('[data-container]').checked=d.container!==null;
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
  const text=s.runtime?`${s.runtime.paused?'Paused':'Playing'} · tick ${s.runtime.step??0} · ${s.runtime.particleCount?.toLocaleString()??'unknown'} particles`:s.failure?`Water stopped: ${s.failure}`:'Initial particles at rest. Play starts water; Replay starts over.';
  const blocker=!s.runtime&&s.simulation?.compatibility?.compatible===false?s.simulation.compatibility.message:'';
  $('[data-play-blocked]').textContent=blocker?`Play unavailable: ${blocker}`:'';
  const fit=s.simulation?.boundsFit;$('[data-fit-bounds]').hidden=!fit?.changed;$('[data-fit-bounds]').disabled=dirty||simulationDirty;
  $('[data-fit-bounds]').title=fit?.changed?'Enlarge the shared box to include the placed water. Drop positions, sizes and particle target stay unchanged. Undo restores the previous box.':'';
  const status=text+(s.runtime?.pendingSourceChanges?' · Initial setup changed; displayed water is from the previous run. Reset or Replay to use the edited setup.':'');if($('[data-state]').textContent!==status)$('[data-state]').textContent=status;
  const hasSources=Boolean(s.sources?.length||s.selected);
  $('[data-reset]').disabled=!s.runtime&&!hasSources;$('[data-release]').disabled=!hasSources||s.simulation?.compatibility?.compatible===false;$('[data-release]').textContent='Replay';$('[data-pause]').disabled=!s.runtime&&(!hasSources||s.simulation?.compatibility?.compatible===false);$('[data-pause]').textContent=s.runtime&&!s.runtime.paused?'Pause':'Play';
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
