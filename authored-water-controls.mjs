import {normalizeAuthoredWaterDrop} from './authored-water-drop.mjs';
/** Fluid instruments on the shared left surface; the existing right inspector
 * continues to own selection transforms, lighting and rendering. */
export function mountAuthoredWaterControls({document,root,sourceRoot=null,controls,api}) {
 const node=document.createElement('section');node.className='panel authored-water-controls';
 node.innerHTML=`<style>.authored-water-controls [data-bounds] label{display:grid;grid-template-columns:4.5em repeat(3,minmax(0,1fr));align-items:center;gap:4px}.authored-water-controls [data-bounds] input{min-width:0;width:100%}.authored-water-controls [data-actions]{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}</style><h2>Water</h2><button class="btn" data-add>Add water</button><button class="btn" data-select-simulation>Simulation properties</button><p class="hint">Select a water source to edit its properties in the right inspector. Place the initial preview, then release it.</p><div data-run><button class="btn" data-release>Release / reset water</button><button class="btn" data-pause>Pause water</button><p class="hint" data-state role="status"></p></div><div data-simulation><label>Density passes<input class="transform-input" type="number" step="1" min="1" data-passes></label><button class="btn" data-simulation-apply>Apply for next release</button></div>
 <div data-selected hidden><p class="hint" data-label></p><label>Source mode<select class="select-input" data-mode><option value="finite_drop">Finite drop</option><option value="continuous">Continuous flow</option></select></label>
 <div data-actions><button class="btn" data-apply>Apply source settings</button></div><div data-drop><label>Initial width<input class="transform-input" type="number" step="0.01" data-width></label><label>Samples across<input class="transform-input" type="number" step="1" min="1" data-samples></label><p class="hint" data-proposed></p><label><input type="checkbox" data-container>Invisible container</label><div data-bounds></div><p class="hint">Bounds are world coordinates. Without the container, they define the neighbor-search region; they add no walls or floor. Ordinary scene meshes are not yet finite-water colliders.</p></div>
 <div data-flow hidden><label>Particles / second<input class="transform-input" type="number" min="0" step="100" data-rate></label><label>Aperture radius<input class="transform-input" type="number" min="0.035" max="0.18" step=".001" data-radius></label><label>Flow strength<input class="transform-input" type="number" min=".25" max="2.6" step=".01" data-strength></label><button class="btn" data-stop>Stop emission</button></div></div><p role="alert"></p>`;
 node.querySelectorAll('label').forEach(label=>label.classList.add('field'));root.prepend(node);const sourcePanel=node.querySelector('[data-selected]'),$=q=>node.querySelector(q)??sourcePanel.querySelector(q);let selected=null,dirty=false,simulationDirty=false,revision=0,scrubs=[];
 sourcePanel.classList.add('authored-water-controls');
 const error=$('[role=alert]');
 const call=async(action,{clearDraft=false}={})=>{const id=selected?.id,version=revision;try{error.textContent='';await action();if(clearDraft&&selected?.id===id&&revision===version)dirty=false;refresh();}catch(e){error.textContent=e.message;}};
 $('[data-add]').onclick=()=>call(()=>api.add());
 $('[data-select-simulation]').onclick=()=>call(()=>api.selectSimulation());
 $('[data-simulation-apply]').onclick=()=>call(async()=>{await api.editSimulation({densityIterations:Number($('[data-passes]').value)});simulationDirty=false;});
 for(const name of ['min','max']){const row=document.createElement('label');row.textContent=name==='min'?'Min XYZ':'Max XYZ';for(let k=0;k<3;k++){const input=document.createElement('input');input.type='number';input.className='transform-input';input.step='.1';input.dataset.bound=name;input.dataset.axis=k;input.setAttribute('aria-label',`${name} ${'XYZ'[k]}`);row.append(input);} $('[data-bounds]').append(row);}
 const proposal=()=>({mode:$('[data-mode]').value,...($('[data-mode]').value==='continuous'?{rate:Number($('[data-rate]').value),baseRadius:Number($('[data-radius]').value),strength:Number($('[data-strength]').value)}:{}),drop:{width:Number($('[data-width]').value),samplesPerUnit:Number($('[data-samples]').value)/Number($('[data-width]').value),container:$('[data-container]').checked?bounds():null,...(!$('[data-container]').checked?{worldBounds:bounds()}:{})}});
 const bounds=()=>Object.fromEntries(['min','max'].map(name=>[name,[...(sourceRoot?sourcePanel:node).querySelectorAll(`[data-bound=${name}]`)].map(input=>Number(input.value))]));
 const preview=()=>{revision++;dirty=true;const n=Number($('[data-samples]').value),w=Number($('[data-width]').value);$('[data-proposed]').textContent=Number.isSafeInteger(n)&&n>0&&w>0?`${(n**3).toLocaleString()} particles · volume ${(w**3).toPrecision(4)} · spacing ${(w/n).toPrecision(4)} before source scale`:'Enter a positive width and whole number of samples.';$('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';$('[data-flow]').hidden=$('[data-mode]').value!=='continuous';};
 for(const input of node.querySelectorAll('input[type=number]')){input.addEventListener('input',input===$('[data-passes]')?()=>simulationDirty=true:preview);const drag=controls.installNumberDrag({input,step:Number(input.step),onStart:()=>{},onEnd:()=>{}});scrubs.push(drag);input.addEventListener('pointercancel',()=>{if(input===$('[data-passes]'))simulationDirty=false;else dirty=false;refresh();});}
 $('[data-mode]').onchange=preview;$('[data-container]').onchange=preview;
 $('[data-stop]').onclick=()=>call(()=>api.edit(selected.id,{mode:'continuous',rate:0}),{clearDraft:true});
 $('[data-apply]').onclick=()=>call(()=>api.edit(selected.id,proposal()),{clearDraft:true});
 $('[data-release]').onclick=()=>call(()=>api.release(selected?.id??api.read().sources?.[0]?.id));
 $('[data-pause]').onclick=()=>call(()=>api.pause());
 function refresh(){const s=api.read();if(s.selected?.id!==selected?.id){dirty=false;revision++;}selected=s.selected;sourcePanel.hidden=!selected;
  const simulation=s.simulation;$('[data-simulation]').hidden=!simulation?.present;$('[data-select-simulation]').disabled=!simulation?.present;
  if(simulation?.settings&&!simulationDirty)$('[data-passes]').value=simulation.settings.densityIterations;
  $('[data-release]').disabled=!(s.sources?.length||selected);
  if(selected){$('[data-label]').textContent=selected.label;
   if(!dirty){const finite=selected.settings.mode==='finite_drop';$('[data-mode]').value=finite?'finite_drop':'continuous';$('[data-rate]').value=selected.settings.rate;$('[data-radius]').value=selected.settings.baseRadius;$('[data-strength]').value=selected.settings.strength;const d=normalizeAuthoredWaterDrop(selected.settings.drop);$('[data-width]').value=d.width;$('[data-samples]').value=Math.round(d.width*d.samplesPerUnit);$('[data-container]').checked=d.container!==null;const b=d.container??d.worldBounds;for(const input of node.querySelectorAll('[data-bound]').length?node.querySelectorAll('[data-bound]'):sourcePanel.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];preview();dirty=false;}
   $('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';$('[data-flow]').hidden=$('[data-mode]').value!=='continuous';
  }
  refreshStatus(s);
 }
 function refreshStatus(s=api.read()){
  const text=s.runtime?`${s.runtime.paused?'Paused':'Playing'} · tick ${s.runtime.step??0} · ${s.runtime.particleCount?.toLocaleString()??'unknown'} particles`:s.failure?`Water stopped: ${s.failure}`:'Initial preview; release starts a new water allocation.';
  const status=text+(s.runtime?.pendingSourceChanges?' · Source edits apply on next release.':'');if($('[data-state]').textContent!==status)$('[data-state]').textContent=status;
  $('[data-pause]').disabled=!s.runtime;$('[data-pause]').textContent=s.runtime?.paused?'Resume water':'Pause water';
 }
 if(sourceRoot)sourceRoot.append(sourcePanel);
 refresh();return {node,refresh,refreshStatus,dispose(){sourcePanel.remove?.();for(const drag of scrubs)drag?.stop?.();node.remove();}};
}
