import {installRelativeNumberDrag,installSceneControlHistory} from '../scene-control-history.mjs';
import {checkedAshSettings} from './scene-record.mjs';
// Native selection inspector; all controls call the same authored operations.
export function installAshInspector({document,anchor,selected,read,edit,cover,burst,changed,error,edits,target,ownHistory}){
 const panel=document.createElement('section');panel.id='selected-ash-properties';panel.hidden=true;anchor.after(panel);
 panel.innerHTML='<h3>Retained ash</h3><p data-ash-status class="hint"></p><p data-ash-size class="hint"></p><label><input data-ash-key="paused" type="checkbox"> Pause ash</label><label><input data-ash-key="emitting" type="checkbox"> Emit falling ash</label><div data-ash-fields></div><label>Layer depth <input data-ash-layer type="number" value="0.04" step="any" min="0"></label><button type="button" data-ash-cover>Add layer</button><label>Burst volume <input data-ash-volume type="number" value="0.02" step="any" min="0"></label><button type="button" data-ash-burst>Release burst</button><p class="hint">The field moves and scales with this object. Existing rigid meshes interact with its ash. Save retains deposited and falling material.</p>';
 for(const [key,label]of [['rate','Fallout volume / second'],['spread','Source radius'],['sourceX','Source X'],['sourceY','Source height'],['sourceZ','Source Z']]){
  const row=document.createElement('label');row.className='slider-row';row.textContent=label;
  const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';input.dataset.ashKey=key;row.append(input);panel.querySelector('[data-ash-fields]').append(row);
 }
 const act=async fn=>{try{await fn();changed();sync();}catch(e){error(e.message);sync();}};
 for(const input of panel.querySelectorAll('[data-ash-key]'))input.addEventListener(input.type==='checkbox'?'change':'input',()=>act(()=>{
  const id=selected(),s=read(id).settings,key=input.dataset.ashKey,value=input.type==='checkbox'?input.checked:Number(input.value);
  if(input.value==='')throw Error('Enter an ash value');
  if(key.startsWith('source')){const position=[...s.sourcePosition];position[['sourceX','sourceY','sourceZ'].indexOf(key)]=value;return edit(id,{sourcePosition:position});}
  return edit(id,{[key]:value});
 }));
 for(const input of panel.querySelectorAll('[data-ash-key]')){
  ownHistory(installSceneControlHistory({controls:[input],edits,id:()=>target(selected()),label:'Edit ash',onError:e=>error(e.message)}));
  if(input.type==='number')installRelativeNumberDrag({input,grip:input,step:input.dataset.ashKey==='rate'?.0001:.01});
 }
 for(const input of panel.querySelectorAll('[data-ash-layer],[data-ash-volume]'))installRelativeNumberDrag({input,grip:input,step:.001});
 panel.querySelector('[data-ash-cover]').onclick=()=>act(()=>cover(selected(),Number(panel.querySelector('[data-ash-layer]').value)));
 panel.querySelector('[data-ash-burst]').onclick=()=>act(()=>burst(selected(),Number(panel.querySelector('[data-ash-volume]').value)));
 function sync(){const id=selected();panel.hidden=!id;if(!id)return;const state=read(id),s=state.settings;
  panel.querySelector('[data-ash-status]').textContent=state.failure?`Ash stopped: ${state.failure}`:`${s.paused?'Paused':'Running'} · ${state.runtime.steps} steps · ${state.runtime.volume.toFixed(3)} introduced volume`;
  panel.querySelector('[data-ash-size]').textContent=`${s.width} × ${s.depth} × ${s.height} local field · ${s.cellSize} cell width · ${(state.runtime.allocatedBytes/1048576).toFixed(1)} MiB allocated`;
  for(const input of panel.querySelectorAll('[data-ash-key]')){const key=input.dataset.ashKey,value=key.startsWith('source')?s.sourcePosition[['sourceX','sourceY','sourceZ'].indexOf(key)]:s[key];if(input.type==='checkbox')input.checked=value;else if(document.activeElement!==input)input.value=String(value);}
 }
 return {sync};
}

export function askAshSetup(document,defaults){return new Promise(resolve=>{
 const disposers=[];
 let accepted=null;
 const dialog=document.createElement('dialog');
 dialog.id='ash-setup-dialog';
 dialog.setAttribute('aria-labelledby','ash-setup-title');
 dialog.innerHTML='<form method="dialog"><h2 id="ash-setup-title">Add ash field</h2><p class="ash-setup-description">Position and scale it with the scene tools. Cell width controls detail and memory.</p><div data-fields></div><p data-error role="alert"></p><div class="ash-setup-actions"><button type="button" value="cancel" class="btn">Cancel</button><button type="submit" value="add" class="btn">Add ash</button></div></form>';
 for(const [key,label]of [['width','Width'],['depth','Depth'],['height','Height'],['cellSize','Cell width'],['initialDepth','Initial ash layer']]){
  const row=document.createElement('label');row.textContent=label;
  const input=document.createElement('input');input.type='number';input.step='any';input.min='0';input.required=true;input.className='transform-input';input.value=String(defaults[key]);input.dataset.key=key;
  row.append(input);dialog.querySelector('[data-fields]').append(row);
  disposers.push(installRelativeNumberDrag({input,grip:input,step:key==='cellSize'||key==='initialDepth'?.01:.1}));
 }
 dialog.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();
  const values=Object.fromEntries([...dialog.querySelectorAll('input[data-key]')].map(input=>[input.dataset.key,input.valueAsNumber]));
  try{checkedAshSettings({...defaults,...values});}
  catch(error){dialog.querySelector('[data-error]').textContent=error.message;return;}
  accepted=values;dialog.close('add');
 });
 dialog.querySelector('[value="cancel"]').addEventListener('click',()=>dialog.close('cancel'));
 dialog.addEventListener('close',()=>{
  for(const handle of disposers)handle.dispose();
  dialog.remove();resolve(accepted);
 },{once:true});
 document.body.append(dialog);dialog.showModal();
 });}
