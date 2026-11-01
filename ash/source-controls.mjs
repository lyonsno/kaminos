import {installRelativeNumberDrag,installSceneControlHistory} from '../scene-control-history.mjs';
export function installAshSourceInspector({document,anchor,selected,read,set,selectField,edits,target,ownHistory,error}){
 const panel=document.createElement('section');panel.id='selected-ash-source-properties';panel.hidden=true;anchor.after(panel);
 panel.innerHTML='<h3>Ash source</h3><p class="hint" data-status></p><label class="slider-row"><span>Emitting</span><input type="checkbox" data-key="enabled"></label><label class="slider-row"><span>Volume / second</span><input class="transform-input" type="number" min="0" step="any" data-key="rate"></label><label class="slider-row"><span>Radius</span><input class="transform-input" type="number" min="0" step="any" data-key="spread"></label><button class="btn" type="button">Select ash field</button><p class="hint">Move this source with the scene tools. Removing it leaves deposited ash in its field.</p>';
 for(const input of panel.querySelectorAll('[data-key]')){
  input.addEventListener(input.type==='checkbox'?'change':'input',()=>{try{set(selected(),{[input.dataset.key]:input.type==='checkbox'?input.checked:input.valueAsNumber});sync();}catch(e){error(e.message);}});
  ownHistory(installSceneControlHistory({controls:[input],edits,id:()=>target(selected()),label:'Edit ash source',onError:e=>error(e.message)}));
  if(input.type==='number')installRelativeNumberDrag({input,grip:input,step:input.dataset.key==='rate'?.0001:.01});
 }
 panel.querySelector('button').onclick=()=>selectField(selected());
 function sync(){const id=selected();panel.hidden=!id;if(!id)return;const state=read(id);panel.querySelector('[data-status]').textContent=state.status;
  for(const input of panel.querySelectorAll('[data-key]')){const value=state.settings[input.dataset.key];if(input.type==='checkbox')input.checked=value;else if(document.activeElement!==input)input.value=String(value);}}
 return {sync};
}
