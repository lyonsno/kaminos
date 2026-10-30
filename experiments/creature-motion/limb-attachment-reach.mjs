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
export function mountLimbAttachmentReach({document,read,invoke}){
 const node=document.createElement('label');node.style.cssText='display:grid;gap:5px;margin:10px 0';
 const title=document.createElement('span');title.textContent='Limb attachment reach';
 const input=document.createElement('input');input.type='number';input.step='0.25';input.setAttribute('aria-label','Limb attachment reach');input.style.cssText='width:100%;box-sizing:border-box;background:#292e32;color:inherit;border:1px solid #505d64;padding:7px;border-radius:4px';
 const note=document.createElement('small');note.textContent='0 keeps the original binding. Increase to carry more surface with the limbs; decrease to keep more with the body.';
 const error=document.createElement('span');error.setAttribute('role','alert');node.append(title,input,note,error);
 let disposed=false;
 const update=()=>{if(disposed)return;const state=read();node.hidden=!state?.supported;if(document.activeElement!==input)input.value=String(state?.limbAttachmentReach??0);};
 input.onchange=async()=>{try{if(!input.value.trim())throw Error('Enter a finite attachment reach');await invoke({value:checkLimbAttachmentReach(Number(input.value))});error.textContent='';}catch(e){error.textContent=e.message;}finally{if(!disposed){input.value=String(read()?.limbAttachmentReach??0);update();}}};
 update();return {node,update,dispose(){disposed=true;input.onchange=null;node.remove();}};
}

export function registerLimbAttachmentReach({edits,runtime,changed=()=>{}}){
 const id='@creature-attachment:'+runtime.group.uuid;
 const check=state=>{const value=checkLimbAttachmentReach(state.value);if(value!==0&&!runtime.read().binding.supported)throw Error('Limb attachment reach requires mapped limb and body bones');return {value};};
 const write=state=>{runtime.setLimbAttachmentReach(state.value);changed();};
 edits?.register(id,{read:()=>({value:runtime.read().binding.limbAttachmentReach}),check,write});
 return {async set(value){const state=check({value});if(edits)await edits.applySettled(id,state,'Change limb attachment reach');else write(state);},dispose(){edits?.discard(e=>e.id===id);edits?.unregister(id);}};
}
