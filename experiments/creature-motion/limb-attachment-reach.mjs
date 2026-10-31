import {installRelativeNumberDrag,installSceneControlHistory} from '../../scene-control-history.mjs';
// Authored offset of limb/body log odds, not sharpening of every influence.
// Unknown/head/tail/fixed channels keep their original share. Within each of
// the two groups relative influences stay intact, including left/right limbs.
export function checkLimbAttachmentReach(value=0){
 if(typeof value!=='number'||!Number.isFinite(value))throw Error('Limb attachment reach must be finite');
 return value;
}
export function limbAttachmentGroups(manifest){
 const bones=new Map(manifest.bones.map(b=>[b.name,b]));
 const role=b=>b.semanticRole??b.name;
 const roots=new Set(manifest.bones.filter(b=>/^(forelimb-(left|right)-shoulder|hindlimb-(left|right)-hip)$/.test(role(b))).map(b=>b.name));
 const limb=[],body=[];
 for(let i=0;i<manifest.channels.length;i++){
  const b=bones.get(manifest.channels[i]);if(!b)continue;
  let at=b;const seen=new Set();let moving=false;
  while(at){if(seen.has(at.name))throw Error('Cyclic binding hierarchy');seen.add(at.name);if(roots.has(at.name)){moving=true;break;}at=bones.get(at.parent);}
  if(moving)limb.push(i);
  else if(/^(pelvis|spine(?:-.+)?|neck(?:-.+)?|forelimb-(left|right)-scapula)$/.test(role(b)))body.push(i);
 }
 return {limb,body,supported:limb.length>0&&body.length>0};
}
export function withLimbAttachmentReach(skin,value){
 checkLimbAttachmentReach(value);
 if(value===0)return skin;
 const {limb,body,supported}=limbAttachmentGroups(skin.manifest);
 if(!supported)throw Error('Limb attachment reach requires mapped limb and body bones');
 const weights=skin.weights.slice(),n=skin.manifest.channels.length;
 for(let base=0;base<weights.length;base+=n){
  let l=0,b=0;for(const j of limb)l+=skin.weights[base+j];for(const j of body)b+=skin.weights[base+j];
  // A zero-support family cannot gain tissue from an authoring bias alone.
  if(l===0||b===0)continue;
  const odds=Math.log(l)-Math.log(b)+value;
  const e=Math.exp(-Math.abs(odds));
  const share=odds>=0?1/(1+e):e/(1+e),total=l+b;
  for(const j of limb)weights[base+j]=skin.weights[base+j]*(total*share/l);
  for(const j of body)weights[base+j]=skin.weights[base+j]*(total*(1-share)/b);
 }
 return {...skin,weights};
}

// Same native property in the posed-skeleton and walking-creature inspectors.
export function mountLimbAttachmentReach({document,read,invoke,edit}){
 const node=document.createElement('section');node.style.cssText='display:grid;gap:5px;margin:10px 0';
 const row=document.createElement('label');row.className='slider-row';row.style.cssText='display:grid;gap:5px';
 const title=document.createElement('span');title.textContent='Limb attachment reach';
 const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label','Limb attachment reach');input.style.cssText='width:100%;box-sizing:border-box';row.append(title,input);
 const note=document.createElement('small');note.textContent='0 keeps the original binding. Increase to carry more surface with the limbs; decrease to keep more with the body.';
 const keepLabel=document.createElement('label'),keep=document.createElement('input');keep.type='checkbox';keep.setAttribute('aria-label','Keep attachment heatmap visible');keepLabel.style.cssText='display:flex;gap:6px;align-items:center';const keepText=document.createElement('span');keepText.textContent='Keep heatmap visible';keepLabel.append(keep,keepText);keepLabel.hidden=!edit;
 const legend=document.createElement('small');legend.setAttribute('aria-label','Attachment influence legend');legend.textContent='Blue: body · Amber: limbs · Gray: other influences';legend.style.cssText='padding:6px;border-left:3px solid #f7ad35';
 const error=document.createElement('span');error.setAttribute('role','alert');node.append(row,note,keepLabel,legend,error);
 let disposed=false;
 const editing=()=>Boolean(edit&&edit.edits?.state().active?.id===edit.id);
 const update=()=>{if(disposed)return;const state=read();node.hidden=!state?.supported;legend.hidden=!state?.heatmap;if(document.activeElement!==input||!editing())input.value=String(state?.limbAttachmentReach??0);};
 const show=()=>{edit?.heatmap(Boolean(read()?.supported&&(keep.checked||editing())));update();};
 const fail=e=>{error.textContent=e.message;input.value=String(read()?.limbAttachmentReach??0);};
 const history=edit?.edits?installSceneControlHistory({controls:[input],edits:edit.edits,id:edit.id,label:'Change limb attachment reach',onError:fail}):null;
 const scrub=installRelativeNumberDrag({input,grip:title,step:.025});
 const preview=async()=>{try{if(!input.value.trim()){error.textContent='';return;}const value=checkLimbAttachmentReach(Number(input.value));if(history){if(!editing())return;edit.edits.preview({value});}else await invoke({value});error.textContent='';}catch(e){fail(e);}};
 input.addEventListener('input',preview);keep.addEventListener('change',show);
 const unsubscribe=edit?.edits?.subscribe(()=>{if(!editing())scrub.stop();show();});
 update();return {node,update,dispose(){if(disposed)return;history?.dispose();unsubscribe?.();scrub.dispose();edit?.heatmap(false);disposed=true;input.removeEventListener('input',preview);keep.removeEventListener('change',show);node.remove();}};
}

export function registerLimbAttachmentReach({edits,runtime,changed=()=>{}}){
 const id='@creature-attachment:'+runtime.group.uuid;
 const check=state=>{const value=checkLimbAttachmentReach(state.value);if(value!==0&&!runtime.read().binding.supported)throw Error('Limb attachment reach requires mapped limb and body bones');return {value};};
 const write=state=>{runtime.setLimbAttachmentReach(state.value);changed();};
 edits?.register(id,{read:()=>({value:runtime.read().binding.limbAttachmentReach}),check,write});
 return {id,edits,heatmap(value){if(runtime.read().binding.heatmap!==value){runtime.setAttachmentHeatmap(value);changed();}},async set(value){const state=check({value});if(edits)await edits.applySettled(id,state,'Change limb attachment reach');else write(state);},dispose(){edits?.discard(e=>e.id===id);edits?.unregister(id);}};
}
