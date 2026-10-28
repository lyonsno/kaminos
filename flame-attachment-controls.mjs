import {defaultFlameAttachment} from './flame-attachment.mjs';
export function installFlameAttachmentControls({document,host,selected,outputs,edits,history,numberDrag,target,set,mechanismTarget,readSupport,onError}){
 const panel=document.createElement('section');panel.id='selected-flame-attachment';
 panel.innerHTML='<style>#selected-flame-attachment [hidden]{display:none!important}#selected-flame-attachment h3{font-size:13px;margin:14px 0 8px}#selected-flame-attachment .flame-scope{font-size:11px;line-height:1.4}#selected-flame-attachment select{max-width:180px}</style><h3>Flame attachment</h3><button type="button" class="btn" data-attach>Attach flame</button><div data-fields hidden><p class="flame-scope">Round-source approximation. +Y is the local outlet axis. Feed is exit speed; opening changes total supply. The shared simulation box stays in world space.</p></div>';
 const fields=panel.querySelector('[data-fields]'),inputs=new Map(),drags=[];
 const row=(label,input)=>{const line=document.createElement('label');line.className='slider-row';const caption=document.createElement('span');caption.className='slider-label';caption.textContent=label;line.append(caption,input);fields.append(line);return caption;};
 function get(){return selected()?.flameAttachment;}

 const mode=document.createElement('select');mode.setAttribute('aria-label','Aperture radius input');row('Radius from',mode);inputs.set('mode',mode);
 mode.addEventListener('change',()=>{try{const r=structuredClone(get());r.radius=mode.value?{output:mode.value,factor:1}:{value:.2};set(selected().id,r);}catch(e){onError(e);}});
 for(const [key,label,step,min,max]of [['enabled','Supply on'],['radius','Radius · asset units',.01,0],['factor','Output multiplier',.01,0],['feed','Exit speed · solver',.01,0,1],['fuel','Fuel fraction',.01,0,1],['heat','Inlet heat',.01,0,2],...['X','Y','Z'].map((axis,i)=>['centre'+i,'Outlet '+axis,.01]),...['X','Y','Z'].map((axis,i)=>['rotation'+i,'Aim '+axis+' °',1])]){
  const input=document.createElement('input');input.type=key==='enabled'?'checkbox':'number';input.className='transform-input';input.dataset.attachment=key;input.setAttribute('aria-label','Attachment '+label);
  if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;input.step='any';
  const grip=row(label,input);inputs.set(key,input);
  input.addEventListener('input',()=>{try{if(!get()||input.type!=='checkbox'&&(!input.value.trim()||!input.validity.valid))return;const id=target(selected().id);if(edits.state().active?.id===id){const r=structuredClone(get()),value=input.type==='checkbox'?input.checked:input.valueAsNumber;if(key==='radius')r.radius={value};else if(key==='factor')r.radius.factor=value;else if(key.startsWith('centre'))r.centre[Number(key.at(-1))]=value;else if(key.startsWith('rotation'))r.rotation[Number(key.at(-1))]=value*Math.PI/180;else r[key]=value;edits.preview({attachment:r});}}catch(e){onError(e);}});
  history({controls:[input],edits,id:()=>target(selected().id),label:'Edit flame attachment',onError});
  if(input.type==='number')drags.push(numberDrag({input,grip,step}));
 }
 const mechanism=document.createElement('div');mechanism.innerHTML='<h3>Compound Crown mechanism</h3>';panel.prepend(mechanism);
 const mechanismInputs=new Map();
 for(const [key,label,min,max,step]of [['opening','Iris opening',0,1,.01],['swirl','Vane drive',-1,1,.01]]){
  const line=document.createElement('label');line.className='slider-row';const grip=document.createElement('span');grip.className='slider-label';grip.textContent=label;
  const input=document.createElement('input');input.type='number';input.className='transform-input';input.min=min;input.max=max;input.step='any';input.setAttribute('aria-label',label);line.append(grip,input);mechanism.append(line);mechanismInputs.set(key,input);
  input.addEventListener('input',()=>{try{if(input.value.trim()&&input.validity.valid&&edits.state().active?.id===mechanismTarget(selected().id))edits.preview({recipe:{...selected().compoundCrown,[key]:input.valueAsNumber}});}catch(e){onError(e);}});
  history({controls:[input],edits,id:()=>mechanismTarget(selected().id),label:'Set '+label,onError});drags.push(numberDrag({input,grip,step}));
 }
 const status=document.createElement('p');status.className='flame-scope';status.setAttribute('role','status');fields.append(status);
 const remove=document.createElement('button');remove.type='button';remove.className='btn';remove.textContent='Remove flame attachment';fields.append(remove);
 remove.onclick=()=>{try{set(selected().id,null);}catch(e){onError(e);}};
 panel.querySelector('[data-attach]').onclick=()=>{try{set(selected().id,defaultFlameAttachment());}catch(e){onError(e);}};
 host.append(panel);edits.subscribe(state=>{if(!state.active)for(const drag of drags)drag.stop();});
 function sync(){
  const entry=selected();panel.hidden=!entry||!['glb','pbr','procedural-mesh'].includes(entry.type);if(panel.hidden)return;
  mechanism.hidden=!entry.compoundCrown;for(const [key,input]of mechanismInputs)if(!mechanism.hidden&&(document.activeElement!==input||!edits.state().active))input.value=entry.compoundCrown[key];
  const r=get();fields.hidden=!r;panel.querySelector('[data-attach]').hidden=!!r;if(!r)return;
  const keys=Object.keys(outputs(entry));if(mode.dataset.keys!==JSON.stringify(keys)){mode.replaceChildren(...[['','Manual radius'],...keys.map(key=>[key,key==='clearRadius'?'Iris · clear inscribed radius':key])].map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));mode.dataset.keys=JSON.stringify(keys);}mode.value=r.radius.output??'';
  for(const [key,input]of inputs){if(key==='mode')continue;input.closest('label').hidden=key==='radius'?!!r.radius.output:key==='factor'?!r.radius.output:false;
   const v=key==='radius'?r.radius.value:key==='factor'?r.radius.factor:key.startsWith('centre')?r.centre[Number(key.at(-1))]:key.startsWith('rotation')?r.rotation[Number(key.at(-1))]*180/Math.PI:r[key];
   if(input.type==='checkbox')input.checked=v;else if(document.activeElement!==input||!edits.state().active)input.value=v??'';
  }
  try{const s=readSupport(entry);status.textContent=s===null?'No Fire & smoke field. Add one to receive this source.':`${s.inside?'Source centre inside field':'Source centre outside field — supply disabled'} · Ø ${s.diameterCells.toFixed(2)} cells${s.footprintFloor?' · solver enlarges this aperture to its 0.02 domain-radius floor':''}${!s.enabled?' · supply off':''}${s.geometryInstances>1?' · '+s.geometryInstances+' geometry instances share this one source; Duplicate creates independent sources':''}`;}catch(e){status.textContent=e.message;}
 }
 return {panel,sync};
}
