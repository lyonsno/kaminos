import {loadFullBodySkin} from './full-body-source.mjs';

// Skin-owned control seam for the existing shared creature. It owns neither
// scene attachment nor a frame clock, and never seeks/rebuilds the live rig.
export function createSkinCaseSelection({runtime,choices,currentCaseSha256,loadCase=loadFullBodySkin,onApplied=()=>{}}) {
 if(typeof runtime?.replaceSkin!=='function'||typeof runtime?.read!=='function')throw Error('Skin selection requires the existing exchangeable body runtime');
 if(!Array.isArray(choices)||!choices.length)throw Error('Explicit skin choices required');
 const entries=structuredClone(choices),keys=new Set();
 for(const choice of entries){
  for(const key of ['cast','label','attachment','case'])if(typeof choice[key]!=='string'||!choice[key].trim())throw Error(`Skin choice ${key} is required`);
  if(!/^[a-f0-9]{64}$/i.test(choice.case_sha256??''))throw Error('Skin choice digest is required');
  choice.case_sha256=choice.case_sha256.toLowerCase();
  const key=JSON.stringify([choice.cast,choice.attachment]);if(keys.has(key))throw Error('Duplicate cast/attachment choice');keys.add(key);
 }
 const initial=entries.filter(c=>c.case_sha256===currentCaseSha256?.toLowerCase());
 if(initial.length!==1)throw Error('Current skin identity must name exactly one explicit choice');
 let current=initial[0],pending=null,error=null,generation=0,disposed=false;
 const listeners=new Set(),notify=()=>{for(const listener of listeners)listener();};
 const read=()=>({current:structuredClone(current),pending:pending?structuredClone(pending):null,error,disposed,choices:structuredClone(entries)});
 async function select(input){
  if(disposed)throw Error('Skin selection is disposed');
  const choice=entries.find(c=>c.cast===input?.cast&&c.attachment===input?.attachment);
  if(!choice)throw Error('Cast/attachment choice is not registered');
  const request=++generation;pending=choice;error=null;notify();
  try{
   const data=await loadCase({case:choice.case,case_sha256:choice.case_sha256});
   if(disposed)return {status:'disposed'};
   if(request!==generation)return {status:'superseded'};
   if(data?.source?.caseSha256!==choice.case_sha256)throw Error('Loaded skin source digest differs from the requested identity');
   runtime.replaceSkin(data);current=choice;pending=null;notify();
   await onApplied(read());
   return {status:'applied',...read()};
  }catch(failure){
   if(!disposed&&request===generation){pending=null;error=failure.message;notify();}
   throw failure;
  }
 }
 function mount({document,root,invoke,operation='skin'}){
  if(disposed)throw Error('Skin selection is disposed');
  if(!document||!root||typeof invoke!=='function')throw Error('Skin controls require the shared room operation invoker');
  const panel=document.createElement('section'),cast=document.createElement('select'),attachment=document.createElement('select'),status=document.createElement('output'),failure=document.createElement('output');
  cast.setAttribute('aria-label','Creature cast');attachment.setAttribute('aria-label','Skin attachment');failure.setAttribute('role','alert');
  const label=(text,control)=>{const node=document.createElement('label');node.textContent=text;node.append(control);return node;};
  const casts=[...new Map(entries.map(c=>[c.cast,c])).values()];
  for(const item of casts){const option=document.createElement('option');option.value=item.cast;option.textContent=item.label;cast.append(option);}
  panel.append(label('Creature cast ',cast),label('Skin attachment ',attachment),status,failure);root.append(panel);
  function refresh(){
   cast.value=current.cast;
   const variants=entries.filter(c=>c.cast===current.cast);
   attachment.replaceChildren(...variants.map(c=>{const option=document.createElement('option');option.value=c.attachment;option.textContent=c.attachmentLabel??c.attachment;return option;}));
   attachment.value=current.attachment;
   status.textContent=pending?`Loading ${pending.label} · ${pending.attachmentLabel??pending.attachment}`:`${current.label} · ${current.attachmentLabel??current.attachment}`;
   failure.textContent=error??runtime.read().cleanupFailure?.message??'';
  }
  const call=async input=>{try{failure.textContent='';await invoke(operation,input);}catch(e){failure.textContent=e.message;refresh();if(!error)failure.textContent=e.message;}};
  cast.onchange=()=>{const candidates=entries.filter(c=>c.cast===cast.value),choice=candidates.find(c=>c.attachment===current.attachment)??candidates[0];return call({cast:cast.value,attachment:choice?.attachment});};
  attachment.onchange=()=>call({cast:cast.value,attachment:attachment.value});
  listeners.add(refresh);refresh();
  return {dispose(){listeners.delete(refresh);panel.remove();}};
 }
 return {read,select,mount,dispose(){if(disposed)return;disposed=true;generation++;pending=null;notify();listeners.clear();}};
}
