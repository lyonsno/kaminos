import {bindParticleNumber} from './particle-number-control.mjs';
export function mountLiveParticleLightingControls({root,document,controls,read,update,retry}){
 const button=document.createElement('button');button.type='button';button.textContent='Distributed lighting · Alt L';root.append(button);
 const panel=document.createElement('dialog');panel.hidden=true;panel.setAttribute('aria-label','Distributed particle lighting');panel.style.cssText='position:fixed;right:22px;left:auto;top:72px;margin:0;width:min(460px,90vw);max-height:calc(100vh - 110px);overflow:auto;background:#202326;color:#eee;border:1px solid #777;border-radius:8px;padding:16px;z-index:110;font:13px system-ui';
 const title=document.createElement('strong');title.textContent='Distributed particle lighting';const close=document.createElement('button');close.type='button';close.textContent='Close · Esc';close.style.cssText='float:right';panel.append(title,close);
 const note=document.createElement('p');note.textContent='Live particles supply emission and extinction to the lighting worker. The native particle image keeps its own detail. Receiver bounds include the Fine box and current luminous or smoky particle support.';panel.append(note);
 const fields=new Map(),errors=new Map(),owned=[];let opened=false,disposed=false;
 const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='white-space:pre-wrap;font-variant-numeric:tabular-nums';
 function sync(){if(disposed)return;const state=read();for(const [key,input]of fields){if(input.type==='checkbox')input.checked=state.requested[key];else if(document.activeElement!==input&&!input.classList.contains('scrubbing'))input.value=String(state.requested[key]);}
  const e=state.effective,p=e?.plan;const detail=p?`${p.dims?.join('×')??'—'} receivers · ${p.directionCount??state.requested.directions} directions\n${p.active??'—'} optical carriers / ${p.slots??'—'} slots · source step ${e.sourceStep} · ${e.sourceUpdatesOld??'—'} material updates behind\n${((e.transferBytes?.source??0)/1024).toFixed(0)} KiB source + ${((e.transferBytes?.result??0)/1024).toFixed(0)} KiB field per update · last update pipeline ${e.pipelineMilliseconds.toFixed(1)} ms`:'';
  status.textContent=errors.size?'Input not applied: '+[...errors.values()].join('; '):state.error?'Previous field retained: '+state.error+'\n'+detail:state.phase==='off'?'Live lighting is off. The native captured-light contribution is active.':state.busy?'Preparing live lighting in the worker. Simulation and the previous image remain available.\n'+detail:e?'Live worker field.\n'+detail:'Waiting for the native particle population.';tryAgain.hidden=!state.error;
 }
 function control(label,key,{kind='number',step=1,min,max,choices}={}){
  const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement(kind==='select'?'select':'input');row.style.cssText='display:grid;grid-template-columns:1fr 9rem;gap:10px;align-items:center;margin:12px 0';grip.textContent=label;input.className='transform-input';input.dataset.particleLighting=key;input.setAttribute('aria-label',label);
  if(kind==='select'){for(const [value,text]of choices){const option=document.createElement('option');option.value=String(value);option.textContent=text;input.append(option);}input.addEventListener('change',async()=>{try{await update({[key]:Number(input.value)});errors.delete(key);}catch(e){errors.set(key,label+': '+e.message);}sync();});}
  else if(kind==='checkbox'){input.type='checkbox';input.addEventListener('change',async()=>{try{await update({[key]:input.checked});errors.delete(key);}catch(e){errors.set(key,label+': '+e.message);}sync();});}
  else{input.type='number';input.step=String(step);if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);
   if(key==='directions')input.addEventListener('input',()=>{if(input.classList.contains('scrubbing')&&Number.isFinite(Number(input.value)))input.value=String(Math.max(2,2*Math.round(Number(input.value)/2)));});
   owned.push(controls.installNumberDrag({input,grip,step}),bindParticleNumber({input,read:()=>read().requested[key],apply:value=>update({[key]:value}),onError:e=>{errors.set(key,label+': '+e.message);sync();},onAccepted:()=>{errors.delete(key);sync();},delay:300}));
  }
  fields.set(key,input);row.append(grip,input);panel.append(row);
 }
 control('Live distributed lighting','enabled',{kind:'checkbox'});
 control('Light contribution','mode',{kind:'select',choices:[[2,'Emission + scattering'],[0,'Intrinsic emission'],[1,'Scattered light']]});
 control('Receiver width (cells)','width',{min:2});control('Directional grid width (cells)','transportWidth',{min:2});control('Sphere directions','directions',{min:2,step:2});
 control('Source smoothing (Fine-local units)','filterLength',{min:0,step:.02});control('Gaussian support (sigma)','supportSigmas',{min:0,step:.25});control('Bounds margin (receiver cells)','padding',{min:0,step:.25});
 control('Scattering albedo','albedo',{min:0,max:1,step:.05});control('Incoming light gain','gain',{min:0,step:.1});
 const tryAgain=document.createElement('button');tryAgain.type='button';tryAgain.textContent='Retry lighting worker';tryAgain.addEventListener('click',()=>retry());panel.append(status,tryAgain);(document.body??root).append(panel);
 function open(){opened=true;panel.hidden=false;panel.show?.();sync();}
 function hide(){opened=false;panel.close?.();panel.hidden=true;}
 const keyboard=e=>{if(e.repeat)return;if(e.altKey&&e.code==='KeyL'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();opened?hide():open();}else if(opened&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();hide();}};
 document.addEventListener('keydown',keyboard,true);button.addEventListener('click',open);close.addEventListener('click',hide);sync();
 return {open,sync,dispose(){if(disposed)return;disposed=true;document.removeEventListener('keydown',keyboard,true);owned.forEach(x=>x?.dispose?.());panel.remove();button.remove();}};
}
