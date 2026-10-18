import {restShapeValues} from './rest-skeleton-edit.mjs';
import {installSceneControlHistory} from '../../scene-control-history.mjs';

// Contextual controls operate on the same snapshot target as viewport edits.
export function mountSkeletonShapeControls({document,properties,invoke,edits,target,host,read,onError}){
 const select=(label,choices)=>{const row=document.createElement('label'),input=document.createElement('select');row.style.cssText='display:block;margin:6px 0';input.style.cssText='display:block;width:100%;max-width:100%;background:#25262a;color:#d6d7db;border:1px solid #424348;border-radius:4px;padding:5px';row.append(label+' ',input);input.setAttribute('aria-label',label);for(const [value,text] of choices){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}return {row,input};};
 const {atlas}=read(),seed=select('Start from',[['','Choose starting body…'],['opened','Opened skeleton'],...(atlas?.references??[]).map(r=>[r.id,r.label])]);
 seed.input.onchange=()=>{const id=seed.input.value;seed.input.blur();if(id)invoke('startFrom',{id}).catch(onError);seed.input.value='';};properties.append(seed.row);
 const section=document.createElement('section'),title=document.createElement('h4'),hint=document.createElement('p');title.textContent='Body structure';section.append(title);properties.append(section);
 const part=select('Structure',[['fore','Forelimbs / shoulders'],['hind','Hindlimbs / hips'],['trunk','Trunk']]);section.append(part.row);
 const pin=select('Hold',[['pelvis','Pelvis'],['front','Front trunk landmark'],['feet','Terminal feet (changes limb lengths)']]);section.append(pin.row);
 const segment=select('Segment',[]);section.append(segment.row);
 let currentPart='fore',signature='',disposed=false;const fields=new Map(),drags=[];
 for(const [key,label] of [['width','Origin width / trunk'],['height','Origin height / trunk'],['forward','Origin forward / trunk'],['reach','Limb reach / trunk'],['proximalFraction','First segment / limb'],['segment','Segment length / trunk'],['length','Trunk length ×']]){
  const row=document.createElement('label'),input=document.createElement('input');row.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0';input.type='number';input.step='.005';input.style.width='85px';input.setAttribute('aria-label',label);input.dataset.shape=key;row.append(label,input);section.append(row);fields.set(key,{row,input});
  input.addEventListener?.('input',()=>{if(input.value==='')return;invoke('shape',{part:currentPart,property:key,value:Number(input.value),...(key==='segment'?{index:Number(segment.input.value)}:{}),...(key==='length'?{pin:pin.input.value}:{})}).catch(e=>{edits.cancel();onError(e);});});
  if(host.controls.installNumberDrag&&input.addEventListener){drags.push(host.controls.installNumberDrag({grip:row,input,step:.005}));input.style.width='100%';input.parentNode.style.flex='0 0 85px';}
 }
 const history=fields.values().next().value.input.addEventListener?installSceneControlHistory({controls:[...fields.values()].map(f=>f.input),edits,id:target,label:'Shape body proportions',onError}):null;
 part.input.onchange=()=>{part.input.blur();invoke('structure',{part:part.input.value}).catch(onError);};segment.input.onchange=()=>refresh();section.append(hint);
 function refresh(){
  if(disposed)return;const state=read();seed.row.hidden=!state.atlas;section.hidden=!state.editMode||!state.atlas;if(section.hidden)return;
  const p=state.atlas.profile;if(!state.selected.length){section.hidden=true;return;}
  const selectedPart=['fore','hind'].find(l=>['left','right'].some(s=>p[l][s].some(n=>state.selected.includes(n))));currentPart=selectedPart??'trunk';part.input.value=currentPart;
  try{
   const values=restShapeValues(state.plan,p,currentPart);hint.textContent=currentPart==='trunk'?'Changes trunk span. Feet hold preserves terminal points, not limb lengths or joint angles.':'Paired branches move together. Reach scales the chain; first-segment fraction redistributes its existing length. Feet are not pinned.';
   pin.row.hidden=currentPart!=='trunk';pin.row.style.display=pin.row.hidden?'none':'block';segment.row.hidden=currentPart==='trunk';segment.row.style.display=segment.row.hidden?'none':'block';
   const names=currentPart==='trunk'?[]:p[currentPart].left,sig=names.join('|');if(signature!==sig){signature=sig;segment.input.replaceChildren();for(let i=1;i<names.length;i++){const o=document.createElement('option');o.value=String(i-1);o.textContent=i+' · '+names[i-1].replace(/^Bip01_[LR]_/,'')+' → '+names[i].replace(/^Bip01_[LR]_/,'');segment.input.append(o);}segment.input.value='0';}
   for(const [key,{row,input}] of fields){row.hidden=currentPart==='trunk'?key!=='length':key==='length';row.style.display=row.hidden?'none':'flex';input.disabled=false;if(!row.hidden&&document.activeElement!==input&&!edits.state().active){const v=key==='length'?1:key==='segment'?values.segments[Number(segment.input.value)]:values[key];input.value=String(v);}}
  }catch(e){for(const f of fields.values())f.input.disabled=true;hint.textContent=e.message;}
 }
 return {refresh,dispose(){disposed=true;history?.dispose();for(const drag of drags)drag.dispose();}};
}
