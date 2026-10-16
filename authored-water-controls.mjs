import {normalizeAuthoredWaterDrop} from './authored-water-drop.mjs';
/** Water properties use the ordinary scene edit API. Debounce typing; finish a
 * numeric drag before committing, so Escape still cancels one whole gesture. */
export function mountAuthoredWaterControls({document,root,sourceRoot=null,simulationRoot=null,controls,api,schedule=setTimeout,cancel=clearTimeout}) {
 const node=document.createElement('section');node.className='panel authored-water-controls';
 node.innerHTML=`<style>.authored-water-controls .hint{font-size:12px;line-height:1.45;color:#a9b8be;margin:8px 0}.authored-water-controls [data-bounds] label{display:grid;grid-template-columns:4.5em repeat(3,minmax(0,1fr));align-items:center;gap:4px}.authored-water-controls [data-bounds] input{min-width:0;width:100%}.authored-water-controls [data-actions]{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}</style><h2>Water</h2><button class="btn" data-add>Add water drop</button><button class="btn" data-select-simulation>Shared water settings</button><p class="hint">Place drops, then release all. Select a water object for its properties.</p><div data-run><button class="btn" data-release>Release all drops</button><button class="btn" data-pause>Pause water</button><p class="hint" data-state role="status"></p></div><div data-simulation><label>Density passes<input class="transform-input" type="number" step="1" min="1" data-passes></label><p class="hint">Changes save automatically for the next release.</p><p role="alert" data-simulation-error></p></div>
 <div data-selected hidden><p class="hint" data-label></p><p class="hint">Initial particles at rest; no simulation steps. Changes save automatically. Released water moves independently; edits apply on the next release.</p><label>Water mode<select class="select-input" data-mode><option value="finite_drop">Finite drop</option><option value="continuous">Continuous flow</option></select></label>
 <div data-drop><label>Drop width<input class="transform-input" type="number" step="0.01" data-width></label><label>Particles across<input class="transform-input" type="number" step="1" min="1" data-samples></label><p class="hint" data-proposed></p><label><input type="checkbox" data-container>Invisible container</label><div data-bounds></div><p class="hint">All drops share world bounds and particle spacing. The container adds walls and a floor. Scene meshes are not water colliders yet.</p></div>
 <div data-flow hidden><label>Particles / second<input class="transform-input" type="number" min="0" step="100" data-rate></label><label>Aperture radius<input class="transform-input" type="number" min="0.035" max="0.18" step=".001" data-radius></label><label>Flow strength<input class="transform-input" type="number" min=".25" max="2.6" step=".01" data-strength></label><button class="btn" data-stop>Stop emission</button></div><p role="status" data-source-status></p><p role="alert" data-source-error></p></div><p role="alert" data-run-error></p>`;
 node.querySelectorAll('label').forEach(label=>label.classList.add('field'));root.prepend(node);
 const sourcePanel=node.querySelector('[data-selected]'),simulationPanel=node.querySelector('[data-simulation]');
 sourcePanel.classList.add('authored-water-controls');simulationPanel.classList.add('authored-water-controls');
 const $=q=>node.querySelector(q)??sourcePanel.querySelector(q)??simulationPanel.querySelector(q);
 const sourceError=$('[data-source-error]'),runError=$('[data-run-error]'),simulationError=$('[data-simulation-error]');
 let selected=null,dirty=false,simulationDirty=false,revision=0,simulationRevision=0,disposed=false,inFlight=null;
 const timers=new Map(),gestures=new Set(),scrubs=[];
 const stopTimer=kind=>{if(timers.has(kind)){cancel(timers.get(kind));timers.delete(kind);}};
 const current=(id,version)=>!disposed&&selected?.id===id&&revision===version;
 const call=async(action,{error=runError}={})=>{if(disposed)return;const id=selected?.id,version=revision;try{error.textContent='';await action();if(!disposed)refresh();return true;}catch(e){if(!disposed&&(error!==sourceError||current(id,version)))error.textContent=e.message;return false;}};
 for(const name of ['min','max']){
  const row=document.createElement('label');row.textContent=name==='min'?'Min XYZ':'Max XYZ';
  for(let k=0;k<3;k++){const input=document.createElement('input');input.type='number';input.className='transform-input';input.step='.1';input.dataset.bound=name;input.dataset.axis=k;input.setAttribute('aria-label',`${name} ${'XYZ'[k]}`);row.append(input);}
  $('[data-bounds]').append(row);
 }
 const bounds=()=>Object.fromEntries(['min','max'].map(name=>[name,[...(sourceRoot?sourcePanel:node).querySelectorAll(`[data-bound=${name}]`)].map(input=>Number(input.value))]));
 const proposal=()=>{
  // Number('') is zero; incomplete keyboard input must remain an invalid draft.
  const number=selector=>{const value=$(selector).value;if(String(value).trim()==='')throw Error('Complete the water property value.');return Number(value);};
  return {mode:$('[data-mode]').value,...($('[data-mode]').value==='continuous'?{rate:number('[data-rate]'),baseRadius:number('[data-radius]'),strength:number('[data-strength]')}:{}),drop:{width:number('[data-width]'),samplesPerUnit:number('[data-samples]')/number('[data-width]'),container:$('[data-container]').checked?bounds():null,...(!$('[data-container]').checked?{worldBounds:bounds()}:{})}};
 };
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
  let patch;try{patch=kind==='source'?proposal():{densityIterations:Number($('[data-passes]').value)};}catch(e){sourceError.textContent=e.message;return false;}
  const error=kind==='source'?sourceError:simulationError;error.textContent='';
  const operation=(async()=>{
   try{
    await (kind==='source'?api.edit(id,patch):api.editSimulation(patch));
    if(disposed)return false;
    if(kind==='source'&&current(id,version))dirty=false;
    if(kind==='simulation'&&simulationRevision===simVersion)simulationDirty=false;
    refresh();return true;
   }catch(e){if(!disposed&&(kind!=='source'||current(id,version)))error.textContent=e.message;return false;}
  })();
  inFlight=operation;try{return await operation;}finally{if(inFlight===operation)inFlight=null;}
 }
 function queue(kind){stopTimer(kind);if(!disposed&&!gestures.has(kind))timers.set(kind,schedule(()=>{timers.delete(kind);return flush(kind);},250));}
 function showProposal(){
  const n=Number($('[data-samples]').value),w=Number($('[data-width]').value),spacing=w/n;
  $('[data-proposed]').textContent=Number.isSafeInteger(n)&&n>0&&w>0?`${(n**3).toLocaleString()} particles · volume ${(w**3).toPrecision(4)} · spacing ${spacing.toPrecision(4)} · support radius ${(3.3640491076*spacing).toPrecision(4)} before source scale`:'Enter a positive width and whole number of samples.';
  $('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';$('[data-flow]').hidden=$('[data-mode]').value!=='continuous';
  $('[data-source-status]').textContent=dirty?'Pending property changes…':'';
 }
 function preview(){revision++;dirty=true;showProposal();queue('source');}
 for(const input of node.querySelectorAll('input[type=number]')){
  const kind=input===$('[data-passes]')?'simulation':'source';
  input.addEventListener('input',kind==='simulation'?()=>{simulationRevision++;simulationDirty=true;queue(kind);}:preview);
  const drag=controls.installNumberDrag({input,step:Number(input.step),onStart:()=>{gestures.add(kind);stopTimer(kind);},onEnd:()=>{gestures.delete(kind);if((kind==='source'?dirty:simulationDirty)&&!disposed)queue(kind);}});scrubs.push(drag);
  input.addEventListener('pointercancel',()=>{stopTimer(kind);if(kind==='simulation'){simulationDirty=false;simulationRevision++;}else{dirty=false;revision++;sourceError.textContent='';}refresh();});
 }
 $('[data-mode]').onchange=preview;$('[data-container]').onchange=preview;
 $('[data-add]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.add();});
 $('[data-select-simulation]').onclick=()=>call(()=>api.selectSimulation());
 $('[data-stop]').onclick=()=>{stopTimer('source');revision++;dirty=false;return call(()=>api.edit(selected.id,{mode:'continuous',rate:0}),{error:sourceError});};
 $('[data-release]').onclick=()=>call(async()=>{if(await flush('source')&&await flush('simulation'))await api.release(selected?.id??api.read().sources?.[0]?.id);});
 $('[data-pause]').onclick=()=>call(()=>api.pause());
 function refresh(){
  if(disposed)return;const s=api.read();
  if(s.selected?.id!==selected?.id){stopTimer('source');dirty=false;revision++;sourceError.textContent='';}
  selected=s.selected;sourcePanel.hidden=!selected;
  const simulation=s.simulation;simulationPanel.hidden=!simulation?.present;$('[data-select-simulation]').disabled=!simulation?.present;
  if(!simulation?.present){stopTimer('simulation');simulationDirty=false;simulationRevision++;}
  if(simulation?.settings&&!simulationDirty)$('[data-passes]').value=simulation.settings.densityIterations;
  $('[data-release]').disabled=!(s.sources?.length||selected);
  if(selected){
   $('[data-label]').textContent=selected.label;
   if(!dirty){
    const finite=selected.settings.mode==='finite_drop';$('[data-mode]').value=finite?'finite_drop':'continuous';$('[data-rate]').value=selected.settings.rate;$('[data-radius]').value=selected.settings.baseRadius;$('[data-strength]').value=selected.settings.strength;
    const d=normalizeAuthoredWaterDrop(selected.settings.drop);$('[data-width]').value=d.width;$('[data-samples]').value=Math.round(d.width*d.samplesPerUnit);$('[data-container]').checked=d.container!==null;
    const b=d.container??d.worldBounds;for(const input of node.querySelectorAll('[data-bound]').length?node.querySelectorAll('[data-bound]'):sourcePanel.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];
   }
   showProposal();
  }
  refreshStatus(s);
 }
 function refreshStatus(s=api.read()){
  const text=s.runtime?`${s.runtime.paused?'Paused':'Playing'} · tick ${s.runtime.step??0} · ${s.runtime.particleCount?.toLocaleString()??'unknown'} particles`:s.failure?`Water stopped: ${s.failure}`:'Initial particles at rest; release starts a new water allocation.';
  const status=text+(s.runtime?.pendingSourceChanges?' · Source edits apply on next release.':'');if($('[data-state]').textContent!==status)$('[data-state]').textContent=status;
  $('[data-release]').textContent=s.runtime?'Reset & release all drops':'Release all drops';$('[data-pause]').disabled=!s.runtime;$('[data-pause]').textContent=s.runtime?.paused?'Resume water':'Pause water';
 }
 if(sourceRoot)sourceRoot.append(sourcePanel);if(simulationRoot)simulationRoot.append(simulationPanel);
 refresh();return {node,refresh,refreshStatus,flush:async()=>await flush('source')&&await flush('simulation'),dispose(){disposed=true;stopTimer('source');stopTimer('simulation');for(const drag of scrubs)drag?.stop?.();sourcePanel.remove?.();simulationPanel.remove?.();node.remove();}};
}
