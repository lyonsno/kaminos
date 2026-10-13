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

// Pick the drawn outline in CSS pixels, never the empty volume it encloses.
export function pointerHitsBoxOutline(box, camera, pointer, viewport, radius = 6) {
  if (!box || box.isEmpty() || viewport.width <= 0 || viewport.height <= 0) return false;
  if (pointer.x < viewport.left || pointer.x > viewport.left + viewport.width || pointer.y < viewport.top || pointer.y > viewport.top + viewport.height) return false;
  camera.updateMatrixWorld(true);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    corners.push(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
    const j = i ^ bit;
    if (j <= i) continue;
    const a = corners[i].clone(), b = corners[j].clone();
    // Clip before projection so edges crossing the eye cannot become phantom lines.
    let lo = 0, hi = 1;
    const dz = b.z - a.z;
    if (dz === 0) { if (a.z > -camera.near || a.z < -camera.far) continue; }
    else {
      const near = (-camera.near - a.z) / dz, far = (-camera.far - a.z) / dz;
      lo = Math.max(lo, Math.min(near, far)); hi = Math.min(hi, Math.max(near, far));
      if (lo > hi) continue;
    }
    const end = a.clone().lerp(b, hi).applyMatrix4(camera.projectionMatrix);
    a.lerp(b, lo).applyMatrix4(camera.projectionMatrix);
    const ax = viewport.left + (a.x + 1) * viewport.width / 2, ay = viewport.top + (1 - a.y) * viewport.height / 2;
    const bx = viewport.left + (end.x + 1) * viewport.width / 2, by = viewport.top + (1 - end.y) * viewport.height / 2;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((pointer.x - ax) * dx + (pointer.y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(pointer.x - ax - t * dx, pointer.y - ay - t * dy) <= radius) return true;
  }
  return false;
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
  edits.register(id,{read:snapshot,check:checked,write:put,
    readForReplay:value=>{
      const saved=checked(value),pose=checkedPose(saved);
      // A neutral frame makes this an exact rollback snapshot of the captured
      // roots. The current UI selection and its remembered preview are irrelevant.
      return {...pose,frame:structuredClone(pose),roots:Object.fromEntries(Object.keys(saved.roots).map(id=>[id,read(id)])),preferences:saved.preferences};
    }});
  return {id,prepare,read:snapshot,write:put,frame,pose:()=>edits.state().active?.id===id?structuredClone(context.pose):frame(),
    apply(patch,label='Transform selection'){prepare();try{return edits.apply(id,patch,label);}catch(error){if(edits.state().active?.id===id)edits.cancel();throw error;}}};
}
