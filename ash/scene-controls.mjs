import {installRelativeNumberDrag,installSceneControlHistory} from '../scene-control-history.mjs';
import {installAshRefinementControls} from './refinement-controls.mjs';
import {checkedAshSettings} from './scene-record.mjs';
// Native selection inspector; all controls call the same authored operations.
export function installAshInspector({document,anchor,selected,read,edit,regrid,cover,burst,diagnostics,showRefinement,changed,error,edits,target,ownHistory}){
 const panel=document.createElement('section');panel.id='selected-ash-properties';panel.hidden=true;anchor.after(panel);
 panel.innerHTML='<h3>Ash field</h3><p data-ash-status class="hint"></p><p data-ash-size class="hint"></p><label class="slider-row"><span>Cell width</span><input data-ash-cell class="transform-input" type="number" min="0" step="any"></label><button class="btn" type="button" data-ash-regrid>Reset at cell width</button><p class="hint">Clears deposited and falling ash. Keeps field placement and connected sources. This reset cannot be undone.</p><label class="slider-row"><span>Pause ash</span><input data-ash-key="paused" type="checkbox"></label><label class="slider-row"><span>Fallout across field</span><input data-ash-key="fallout" type="checkbox"></label><div data-ash-fields></div><label class="slider-row"><span>Smooth lighting (preview)</span><input data-ash-key="softNormals" type="checkbox"></label><label class="slider-row"><span>Layer depth</span><input data-ash-layer class="transform-input" type="number" value="0.04" step="any" min="0"></label><button class="btn" type="button" data-ash-cover>Add layer</button><details><summary>Legacy field source</summary><label class="slider-row"><span>Emit from legacy source</span><input data-ash-key="emitting" type="checkbox"></label><div data-legacy-fields></div><label class="slider-row"><span>Burst volume</span><input data-ash-volume class="transform-input" type="number" value="0.02" step="any" min="0"></label><button class="btn" type="button" data-ash-burst>Release burst</button></details><p class="hint">Variation changes local resistance; release controls how far a slip relaxes. Editing either wakes the field once. Move or scale this field with the scene tools. Sources are separate objects; removing a source leaves its deposited ash here. Save retains deposited and falling material.</p>';

 for(const [key,label]of [['slideVariation','Slide variation'],['slideScale','Variation scale'],['slideRelease','Slide release'],['rate','Fallout volume / second'],['spread','Source radius'],['sourceX','Source X'],['sourceY','Source height'],['sourceZ','Source Z']]){
  const row=document.createElement('label');row.className='slider-row';row.textContent=label;
  const input=document.createElement('input');input.type='number';input.step='any';if(!key.startsWith('source'))input.min='0';if(key==='slideVariation'||key==='slideRelease')input.max='1';input.className='transform-input';input.dataset.ashKey=key;row.append(input);panel.querySelector(['rate','slideVariation','slideScale','slideRelease'].includes(key)?'[data-ash-fields]':'[data-legacy-fields]').append(row);
 }
 const act=async fn=>{try{const pending=fn();sync();await pending;error('');changed();sync();}catch(e){error(e.message);sync();}};
 for(const input of panel.querySelectorAll('[data-ash-key]')){
  input.addEventListener(input.type==='checkbox'?'change':'input',()=>{
   if(input.type==='number'&&(input.value.trim()===''||!Number.isFinite(input.valueAsNumber)))return;
   act(()=>{
    const id=selected(),s=read(id).settings,key=input.dataset.ashKey,value=input.type==='checkbox'?input.checked:input.valueAsNumber;
    if(key.startsWith('source')){const position=[...s.sourcePosition];position[['sourceX','sourceY','sourceZ'].indexOf(key)]=value;return edit(id,{sourcePosition:position});}
    return edit(id,{[key]:value});
   });
  });
  if(input.type==='number')input.addEventListener('blur',()=>sync());
 }
 for(const input of panel.querySelectorAll('[data-ash-key]')){
  ownHistory(installSceneControlHistory({controls:[input],edits,id:()=>target(selected()),label:'Edit ash',onError:e=>error(e.message)}));
  if(input.type==='number')installRelativeNumberDrag({input,grip:input,step:input.dataset.ashKey==='rate'?.0001:.01});
 }
 for(const input of panel.querySelectorAll('[data-ash-layer],[data-ash-volume]'))installRelativeNumberDrag({input,grip:input,step:.001});
 const inspect=document.createElement('button');inspect.type='button';inspect.className='btn';inspect.textContent='Inspect fine residency';inspect.dataset.ashInspectResidency='';
 const residency=document.createElement('p');residency.className='hint';residency.dataset.ashResidency='';
 inspect.addEventListener('click',()=>act(async()=>{const result=await diagnostics(selected());const a=result.allocation;const d=result.detailAllocation;residency.textContent=a?`${a.resident}/${a.capacity} fine bricks · ${a.pinned} retaining deposited history · ${a.unmet} unmet requests.${d?` Close detail: ${d.resident}/${d.capacity} bricks · ${d.pinned} retaining history · ${d.unmet} unmet (${d.balanceBlocked} need middle support).`:""} Snapshot on request; no live CPU readback.`:'This field uses a fixed lattice.';}));
 const showRow=document.createElement('label');showRow.className='slider-row';showRow.textContent='Show fine bricks';const show=document.createElement('input');show.type='checkbox';show.dataset.ashShowRefinement='';show.addEventListener('change',()=>showRefinement(selected(),show.checked));showRow.append(show);
 const cellInput=panel.querySelector('[data-ash-cell]');
 const refinementControls=installAshRefinementControls({document,panel,anchor:cellInput});
 refinementControls.element.append(showRow,inspect,residency);
 const dimInputs={cellSize:cellInput};
 for(const [key,label]of [['width','Width'],['depth','Depth'],['height','Height']]){
  const row=document.createElement('label');row.className='slider-row';row.textContent=label;
  const input=document.createElement('input');input.type='number';input.step='any';input.min='0';input.className='transform-input';input.dataset.ashDim=key;
  row.append(input);cellInput.parentElement?.before?.(row);
  installRelativeNumberDrag({input,grip:input,step:.1});
  dimInputs[key]=input;
 }
 installRelativeNumberDrag({input:cellInput,grip:cellInput,step:.001});
 let syncedCellId=null,syncedDims={};
 const runRegrid=()=>act(async()=>{
  const id=selected(),s=read(id).settings,nextCell=cellInput.valueAsNumber;
  const nextWidth=Number.isFinite(dimInputs.width.valueAsNumber)?dimInputs.width.valueAsNumber:s.width;
  const nextDepth=Number.isFinite(dimInputs.depth.valueAsNumber)?dimInputs.depth.valueAsNumber:s.depth;
  const nextHeight=Number.isFinite(dimInputs.height.valueAsNumber)?dimInputs.height.valueAsNumber:s.height;
  const dimsChanged=nextWidth!==s.width||nextDepth!==s.depth||nextHeight!==s.height;
  syncedDims={};
  const dimensions={width:nextWidth,depth:nextDepth,height:nextHeight,cellSize:nextCell};
  const refinement=refinementControls.read(dimensions);
  const refinementChanged=JSON.stringify(refinement)!==JSON.stringify(s.refinement??null);
  await regrid(id,dimsChanged||refinementChanged?{...dimensions,refinement}:nextCell);
 });
 panel.querySelector('[data-ash-regrid]').onclick=runRegrid;
 for(const input of Object.values(dimInputs))input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runRegrid();}});
 panel.querySelector('[data-ash-cover]').onclick=()=>act(()=>cover(selected(),Number(panel.querySelector('[data-ash-layer]').value)));
 panel.querySelector('[data-ash-burst]').onclick=()=>act(()=>burst(selected(),Number(panel.querySelector('[data-ash-volume]').value)));
 function sync(){const id=selected();panel.hidden=!id;if(!id)return;const state=read(id),s=state.settings;refinementControls.sync(id,s);show.checked=!!state.showRefinement;inspect.hidden=s.refinement?.mode!=='adaptive';residency.hidden=inspect.hidden;showRow.hidden=inspect.hidden;
  for(const [key,input]of Object.entries(dimInputs)){
   if(document.activeElement!==input&&(id!==syncedCellId||s[key]!==syncedDims[key])){input.value=String(s[key]);syncedDims[key]=s[key];}
  }
  syncedCellId=id;
  panel.querySelector('[data-ash-regrid]').disabled=state.busy;
  panel.querySelector('[data-ash-status]').textContent=state.failure?`Ash stopped: ${state.failure}`:`${s.paused?'Paused':'Running'} · ${state.runtime.steps} steps · ${state.runtime.volume.toFixed(3)} introduced volume`;
  panel.querySelector('[data-ash-size]').textContent=`${s.width} × ${s.depth} × ${s.height} local field · ${s.cellSize} cell width${s.refinement?.levels===3?` · ${state.runtime.layout.cellSize} close detail`:""} · ${(state.runtime.allocatedBytes/1048576).toFixed(1)} MiB allocated`;
  for(const input of panel.querySelectorAll('[data-ash-key]')){const key=input.dataset.ashKey,value=key.startsWith('source')?s.sourcePosition[['sourceX','sourceY','sourceZ'].indexOf(key)]:(s[key]??((key==='slideVariation'||key==='slideRelease')?0:key==='slideScale'?.24:undefined));if(input.type==='checkbox')input.checked=value;else if(document.activeElement!==input)input.value=String(value);}
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
