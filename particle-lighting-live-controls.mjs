import {bindParticleNumber} from './particle-number-control.mjs';
export function mountLiveParticleLightingControls({root,document,read,update,retry}){
 const button=document.createElement('button');button.type='button';button.textContent='Distributed lighting · Alt L';root.append(button);
 const panel=document.createElement('dialog');panel.hidden=true;panel.setAttribute('aria-label','Distributed particle lighting');panel.style.cssText='position:fixed;right:22px;left:auto;top:72px;margin:0;width:min(410px,90vw);height:min(720px,82vh);min-width:min(300px,90vw);min-height:280px;max-width:95vw;max-height:95vh;resize:both;overflow:hidden;background:#202326;color:#eee;border:1px solid #777;border-radius:8px;padding:0;z-index:110;font:13px system-ui';
 const header=document.createElement('div');header.dataset.particleLightingDrag='true';header.style.cssText='display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;height:44px;padding:8px 12px;cursor:move;touch-action:none;background:#303438;border-bottom:1px solid #555;user-select:none';
 const title=document.createElement('strong');title.textContent='Distributed particle lighting';const close=document.createElement('button');close.type='button';close.textContent='Close · Esc';header.append(title,close);panel.append(header);
 const body=document.createElement('div');body.style.cssText='box-sizing:border-box;height:calc(100% - 44px);overflow:auto;padding:4px 14px 12px';panel.append(body);
 const note=document.createElement('p');note.textContent='Current particles supply emission and extinction. Scattered light shows this field’s contribution to the image. Receiver bounds include the Fine box and all luminous or smoky particle support.';body.append(note);
 const fields=new Map(),sliders=new Map(),errors=new Map(),owned=[];let opened=false,disposed=false,pending={},scheduled=null,statusTimer=null,drag=null;
 const view=document.defaultView??{},schedule=view.requestAnimationFrame?.bind(view)??(fn=>setTimeout(fn,16)),unschedule=view.cancelAnimationFrame?.bind(view)??clearTimeout;
 const status=document.createElement('p');status.setAttribute('role','status');status.dataset.particleLightingStatus='true';status.style.cssText='white-space:pre-wrap;font-variant-numeric:tabular-nums';
 function sync(){if(disposed)return;const state=read();for(const [key,input]of fields){if(input.type==='checkbox')input.checked=state.requested[key];else if(!(key in pending)&&document.activeElement!==input)input.value=String(state.requested[key]);const slider=sliders.get(key);if(slider){const value=state.requested[key];slider.min=String(Math.min(Number(slider.min),value));slider.max=String(Math.max(Number(slider.max),value));if(!(key in pending))slider.value=String(value);}}
  const e=state.effective,p=e?.plan,prep=state.preparation;
  const detail=p?`${p.dims?.join('×')??'—'} receivers · ${p.directionCount??state.requested.directions} directions\n${p.active??'—'} optical carriers / ${p.slots??'—'} slots · ${e.sourceUpdatesOld??'—'} material updates behind\n${((e.transferBytes?.source??0)/1024).toFixed(0)} KiB source + ${((e.transferBytes?.result??0)/1024).toFixed(0)} KiB field · last update ${e.pipelineMilliseconds.toFixed(1)} ms`:'';
  const labels={snapshot:'Copying current particles',worker:'Sending particles to worker',device:'Initializing GPU device',compile:'Compiling reusable lighting kernels',prepare:'Preparing field buffers',encode:'Encoding lighting sweeps','gpu-readback':'GPU execution and field readback',validate:'Validating field'};
  const work=prep?`${prep.desiredRevision>prep.revision?'Discarding superseded edit; latest edit follows at the next safe boundary.':labels[prep.stage]??prep.stage}${prep.detail?' · '+prep.detail:''}\n${(prep.elapsedMilliseconds/1000).toFixed(1)} s elapsed · ${(prep.stageMilliseconds/1000).toFixed(1)} s in this stage`:'Waiting for worker';
  status.textContent=errors.size?'Input not applied: '+[...errors.values()].join('; '):state.error?'Previous field retained: '+state.error+'\n'+detail:state.phase==='off'?'Live lighting is off. The native captured-light contribution is active.':state.busy?work+'\nSimulation and the previous field remain available.\n'+detail:e?'Live worker field.\n'+detail:'Waiting for the native particle population.';tryAgain.hidden=!state.error;
 }
 async function apply(patch){try{await update(patch);for(const key of Object.keys(patch))errors.delete(key);}catch(e){for(const key of Object.keys(patch))errors.set(key,e.message);}sync();}
 function flush(){scheduled=null;const patch=pending;pending={};if(!disposed&&Object.keys(patch).length)void apply(patch);}
 function control(label,key,{kind='number',step=1,min=0,max=64,choices}={}){
  const row=document.createElement('label'),caption=document.createElement('span'),input=document.createElement(kind==='select'?'select':'input');row.style.cssText='display:grid;grid-template-columns:1fr 8rem;gap:6px 10px;align-items:center;margin:14px 0';caption.textContent=label;input.dataset.particleLighting=key;input.setAttribute('aria-label',label);input.style.cssText='box-sizing:border-box;width:100%;color:inherit;background:#292c30;border:1px solid #666;border-radius:4px;padding:5px';
  if(kind==='select'){for(const [value,text]of choices){const option=document.createElement('option');option.value=String(value);option.textContent=text;input.append(option);}input.addEventListener('change',()=>void apply({[key]:Number(input.value)}));}
  else if(kind==='checkbox'){input.type='checkbox';input.style.cssText='justify-self:end';input.addEventListener('change',()=>void apply({[key]:input.checked}));}
  else{
   input.type='number';input.step=String(step);input.min=String(min);if(key==='albedo')input.max='1';
   owned.push(bindParticleNumber({input,read:()=>read().requested[key],apply:value=>{delete pending[key];return update({[key]:value});},onError:e=>{errors.set(key,label+': '+e.message);sync();},onAccepted:()=>{errors.delete(key);sync();},delay:180}));
   const slider=document.createElement('input');slider.type='range';slider.min=String(min);slider.max=String(max);slider.step=String(step);slider.dataset.particleLightingSlider=key;slider.setAttribute('aria-label',label+' slider');slider.style.cssText='grid-column:1 / -1;width:100%;margin:0;accent-color:#d6b475;cursor:pointer';sliders.set(key,slider);
   slider.addEventListener('input',()=>{const value=Number(slider.value);input.value=String(value);pending[key]=value;if(scheduled===null)scheduled=schedule(flush);});
   row.append(caption,input,slider);fields.set(key,input);body.append(row);return;
  }
  fields.set(key,input);row.append(caption,input);body.append(row);
 }
 control('Live distributed lighting','enabled',{kind:'checkbox'});
 control('Light contribution','mode',{kind:'select',choices:[[2,'Emission + scattering'],[0,'Intrinsic emission'],[1,'Scattered light']]});
 control('Receiver width (cells)','width',{min:2,max:64});control('Directional grid width (cells)','transportWidth',{min:2,max:64});control('Sphere directions','directions',{min:2,max:192,step:2});
 control('Source smoothing (Fine-local units)','filterLength',{min:0,max:1,step:.01});control('Gaussian support (sigma)','supportSigmas',{min:.25,max:8,step:.25});control('Bounds margin (receiver cells)','padding',{min:0,max:8,step:.25});
 control('Scattering albedo','albedo',{min:0,max:1,step:.01});control('Incoming light gain','gain',{min:0,max:8,step:.05});
 const tryAgain=document.createElement('button');tryAgain.type='button';tryAgain.textContent='Retry lighting worker';tryAgain.addEventListener('click',()=>retry());body.append(status,tryAgain);(document.body??root).append(panel);
 function open(){opened=true;panel.hidden=false;panel.show?.();if(statusTimer===null)statusTimer=setInterval(sync,250);sync();}
 function hide(){opened=false;panel.close?.();panel.hidden=true;clearInterval(statusTimer);statusTimer=null;}
 const down=e=>{if(e.button!==0||e.target?.closest?.('button,input,select'))return;const rect=panel.getBoundingClientRect?.()??{left:Math.max(0,(view.innerWidth??1024)-432),top:72,width:410,height:720};drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,width:rect.width,height:rect.height};header.setPointerCapture?.(e.pointerId);e.preventDefault();};
 const move=e=>{if(!drag||e.pointerId!==drag.pointer)return;const width=view.innerWidth??1024,height=view.innerHeight??768;panel.style.left=Math.max(0,Math.min(width-Math.min(drag.width,width),drag.left+e.clientX-drag.x))+'px';panel.style.top=Math.max(0,Math.min(height-44,drag.top+e.clientY-drag.y))+'px';panel.style.right='auto';};
 const up=e=>{if(drag&&e.pointerId===drag.pointer)drag=null;};
 header.addEventListener('pointerdown',down);document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
 const keyboard=e=>{if(e.repeat)return;if(e.altKey&&e.code==='KeyL'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();opened?hide():open();}else if(opened&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();hide();}};
 document.addEventListener('keydown',keyboard,true);button.addEventListener('click',open);close.addEventListener('click',hide);sync();
 return {open,sync,dispose(){if(disposed)return;disposed=true;if(scheduled!==null)unschedule(scheduled);clearInterval(statusTimer);document.removeEventListener('keydown',keyboard,true);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);owned.forEach(x=>x?.dispose?.());panel.remove();button.remove();}};
}
