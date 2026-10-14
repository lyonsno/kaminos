/** Fluid instruments on the shared left surface; the existing right inspector
 * continues to own selection transforms, lighting and rendering. */
export function mountAuthoredWaterControls({document,root,controls,api}) {
 const node=document.createElement('section');node.className='panel authored-water-controls';
 node.innerHTML=`<h2>Water source</h2><button class="btn" data-add>Add finite drop</button>
 <div data-selected hidden><p data-label></p><label>Source mode<select data-mode><option value="finite_drop">Finite drop</option><option value="continuous">Continuous flow</option></select></label>
 <div data-drop><label>Initial width<input type="number" step="0.01" data-width></label><label>Samples across<input type="number" step="1" min="1" data-samples></label><p data-proposed></p><label><input type="checkbox" data-container>Invisible container</label><div data-bounds></div><p class="hint">Bounds are world coordinates. Without the container, they define the neighbor-search region; they add no walls or floor. Ordinary scene meshes are not yet finite-water colliders.</p></div>
 <button class="btn" data-apply>Apply initial setup</button><button class="btn" data-release>Release / reset water</button><button class="btn" data-pause>Pause water</button><p data-state role="status"></p></div><p role="alert"></p>`;
 root.prepend(node);const $=q=>node.querySelector(q);let selected=null,dirty=false,scrubs=[];
 const error=$('[role=alert]');
 const call=async action=>{try{error.textContent='';await action();dirty=false;refresh();}catch(e){error.textContent=e.message;}};
 $('[data-add]').onclick=()=>call(()=>api.add());
 for(const name of ['min','max']){const row=document.createElement('label');row.textContent=name==='min'?'World minimum':'World maximum';for(let k=0;k<3;k++){const input=document.createElement('input');input.type='number';input.step='.1';input.dataset.bound=name;input.dataset.axis=k;input.setAttribute('aria-label',`${name} ${'XYZ'[k]}`);row.append(input);} $('[data-bounds]').append(row);}
 const proposal=()=>({mode:$('[data-mode]').value,drop:{width:Number($('[data-width]').value),samplesPerUnit:Number($('[data-samples]').value)/Number($('[data-width]').value),container:$('[data-container]').checked?bounds():null,...(!$('[data-container]').checked?{worldBounds:bounds()}:{})}});
 const bounds=()=>Object.fromEntries(['min','max'].map(name=>[name,[...node.querySelectorAll(`[data-bound=${name}]`)].map(input=>Number(input.value))]));
 const preview=()=>{dirty=true;const n=Number($('[data-samples]').value),w=Number($('[data-width]').value);$('[data-proposed]').textContent=Number.isSafeInteger(n)&&n>0&&w>0?`${(n**3).toLocaleString()} particles · volume ${(w**3).toPrecision(4)} · spacing ${(w/n).toPrecision(4)} before source scale`:'Enter a positive width and whole number of samples.';$('[data-drop]').hidden=$('[data-mode]').value!=='finite_drop';};
 for(const input of node.querySelectorAll('input[type=number]')){input.addEventListener('input',preview);const drag=controls.installNumberDrag({input,step:Number(input.step),onStart:()=>{},onEnd:()=>{}});scrubs.push(drag);input.addEventListener('pointercancel',()=>{dirty=false;refresh();});}
 $('[data-mode]').onchange=preview;$('[data-container]').onchange=preview;
 $('[data-apply]').onclick=()=>call(()=>api.edit(selected.id,proposal()));
 $('[data-release]').onclick=()=>call(()=>api.release(selected.id));
 $('[data-pause]').onclick=()=>call(()=>api.pause());
 function refresh(){const s=api.read();selected=s.selected;$('[data-selected]').hidden=!selected;if(!selected)return;$('[data-label]').textContent=selected.label;const finite=selected.settings.mode==='finite_drop';$('[data-drop]').hidden=!finite;
  if(!dirty){$('[data-mode]').value=finite?'finite_drop':'continuous';if(finite){const d=selected.settings.drop;$('[data-width]').value=d.width;$('[data-samples]').value=Math.round(d.width*d.samplesPerUnit);$('[data-container]').checked=d.container!==null;const b=d.container??d.worldBounds;for(const input of node.querySelectorAll('[data-bound]'))input.value=b[input.dataset.bound][Number(input.dataset.axis)];preview();dirty=false;}}
  $('[data-state]').textContent=s.runtime?`${s.runtime.paused?'Paused':'Playing'} · tick ${s.runtime.step??0} · ${s.runtime.particleCount?.toLocaleString()??'unknown'} particles`:'Initial preview; release starts a new water allocation.';
  $('[data-pause]').disabled=!s.runtime;$('[data-pause]').textContent=s.runtime?.paused?'Resume water':'Pause water';
 }
 refresh();return {node,refresh,dispose(){for(const drag of scrubs)drag?.stop?.();node.remove();}};
}
