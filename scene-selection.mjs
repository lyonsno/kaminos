import { Box3, Vector3 } from './lib/three.core.js';
import { checkedPose } from './scene-edit-session.mjs';
import { moveGroupMembers } from './scene-group.mjs';

export function checkedSelection(ids, activeId = ids.at(-1) ?? null) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id))throw Error('Selection requires scene IDs');
  ids=[...new Set(ids)];
  if(activeId!==null&&!ids.includes(activeId))throw Error('Active item must be selected');
  return {ids,activeId:ids.length?activeId??ids.at(-1):null};
}
export function changeSelection(previous,id,{extend=false}={}) {
  previous=checkedSelection(previous.ids,previous.activeId);
  if(!id)return checkedSelection([]);
  if(!extend)return checkedSelection([id],id);
  if(previous.ids.includes(id)){
    const ids=previous.ids.filter(item=>item!==id);
    return checkedSelection(ids,previous.activeId===id?ids.at(-1)??null:previous.activeId);
  }
  return checkedSelection([...previous.ids,id],id);
}
export function selectionTransformRoots(ids,groups) {
  const selectedGroups=groups.filter(g=>ids.includes(`@group:${g.id}`));
  const children=new Set(selectedGroups.flatMap(g=>g.objectIds));
  return ids.filter(id=>!children.has(id));
}
export function selectionFrame(poses,activeId,{pivot='median',orientation='world',activePose=null}={}) {
  const entries=Object.entries(poses);if(!entries.length)return null;
  if(!['median','active','individual'].includes(pivot)||!['world','local'].includes(orientation))throw Error('Unknown transform preference');
  const active=checkedPose(activePose??poses[activeId]??entries.at(-1)[1]);
  const position=pivot==='active'?[...active.position]:[0,1,2].map(i=>entries.reduce((v,[,p])=>v+p.position[i],0)/entries.length);
  return {position,rotation:orientation==='local'?[...active.rotation]:[0,0,0],scale:[1,1,1]};
}
export function mixedSelectionValue(values) {
  if(!values.length)return {mixed:false,value:null};
  return values.every(v=>JSON.stringify(v)===JSON.stringify(values[0]))?{mixed:false,value:structuredClone(values[0])}:{mixed:true,value:null};
}
export function objectsInScreenBox(entries,camera,rect,viewport) {
  camera.updateMatrixWorld(true);
  const x0=Math.min(rect.x0,rect.x1),x1=Math.max(rect.x0,rect.x1),y0=Math.min(rect.y0,rect.y1),y1=Math.max(rect.y0,rect.y1);
  return entries.filter(({object})=>{
    if(!object.visible)return false;
    object.updateWorldMatrix(true,true);
    const box=new Box3().setFromObject(object);if(box.isEmpty())return false;
    const points=[];
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new Vector3(x,y,z),view=point.clone().applyMatrix4(camera.matrixWorldInverse);
      if(-view.z<camera.near||-view.z>camera.far)continue;
      point.project(camera);points.push({x:viewport.left+(point.x+1)*viewport.width/2,y:viewport.top+(1-point.y)*viewport.height/2});
    }
    if(!points.length)return false;
    return Math.min(...points.map(p=>p.x))<=x1&&Math.max(...points.map(p=>p.x))>=x0&&Math.min(...points.map(p=>p.y))<=y1&&Math.max(...points.map(p=>p.y))>=y0;
  }).map(entry=>entry.id);
}

// The target stores ordinary root snapshots. History replay therefore restores
// the chosen roots even after the current UI selection has changed.
export function createSelectionTransformTarget({edits,selection,groups,preferences,read,write,check,changed=()=>{}}) {
  const id='@selection-transform';let context=null;
  const roots=()=>selectionTransformRoots(selection().ids,groups());
  function frame(){const ids=roots(),poses=Object.fromEntries(ids.map(id=>[id,read(id)]));return selectionFrame(poses,selection().activeId,{...preferences(),activePose:selection().activeId?read(selection().activeId):null});}
  function prepare(){
    const ids=roots();if(!ids.length)throw Error('Choose scene objects');
    context={ids,activeId:selection().activeId,pose:frame(),preferences:structuredClone(preferences())};
    return id;
  }
  function snapshot(){
    if(!context)prepare();
    return {...structuredClone(context.pose),frame:structuredClone(context.pose),roots:Object.fromEntries(context.ids.map(id=>[id,read(id)])),preferences:structuredClone(context.preferences)};
  }
  function checked(value){
    const result=structuredClone(value);Object.assign(result,checkedPose(value));result.frame=checkedPose(value.frame);
    if(!result.roots||!Object.keys(result.roots).length||!['median','active','individual'].includes(result.preferences?.pivot)||!['world','local'].includes(result.preferences?.orientation))throw Error('Selection transform requires roots and preferences');
    for(const pose of Object.values(result.roots))checkedPose(pose);
    return result;
  }
  function put(raw){
    const value=checked(raw),before=Object.fromEntries(Object.keys(value.roots).map(id=>[id,read(id)]));
    const poses=moveGroupMembers(value.frame,value,value.roots,value.preferences);
    const next=Object.fromEntries(Object.entries(value.roots).map(([id,state])=>[id,{...state,...poses[id]}]));
    // Validate every provider before the first write. Roll back all roots if a
    // provider fails after admission; no selected sibling can remain moved.
    for(const [id,state] of Object.entries(next))check(id,state);
    try{for(const [id,state] of Object.entries(next))write(id,state);}
    catch(error){for(const [id,state] of Object.entries(before))write(id,state);throw error;}
    context={ids:Object.keys(next),pose:checkedPose(value),preferences:value.preferences};changed(context.pose);
  }
  edits.register(id,{read:snapshot,check:checked,write:put});
  return {id,prepare,read:snapshot,write:put,frame,pose:()=>edits.state().active?.id===id?structuredClone(context.pose):frame(),
    apply(patch,label='Transform selection'){prepare();try{return edits.apply(id,patch,label);}catch(error){if(edits.state().active?.id===id)edits.cancel();throw error;}}};
}
