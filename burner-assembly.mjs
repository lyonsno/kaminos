import {Matrix4,Vector3,Quaternion,Euler} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
import {normalizeBurner} from './annular-burner.mjs';
export const BURNER_BED_TYPE='burner-bed';
export const BURNER_BED_SOURCE='kaminos:annular-bed';
export const BURNER_ASSEMBLY_TYPE='burner-assembly';
export const identityAssemblyPose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export function checkedAssemblyPose(value) {
 const pose=checkedPose(value),scale=pose.scale[0];
 if(!(scale>0)||pose.scale.some(v=>Math.abs(v-scale)>1e-10*scale))throw Error('Assembly requires positive uniform scale; use S without an axis');
 return pose;
}
export function checkedBurnerBed(record) {
 if(record.source!==BURNER_BED_SOURCE)throw Error('Unsupported burner bed source');
 const burner=normalizeBurner(record.burner);
 if(!burner)throw Error('Burner bed requires its geometry recipe');
 return {...record,transform:checkedAssemblyPose(record.transform),burner};
}
const matrix=pose=>new Matrix4().compose(new Vector3(...pose.position),new Quaternion().setFromEuler(new Euler(...pose.rotation)),new Vector3(...pose.scale));
export function moveAssemblyMembers(before,after,members) {
 before=checkedAssemblyPose(before);after=checkedAssemblyPose(after);
 if(JSON.stringify(before)===JSON.stringify(after))return structuredClone(members);
 const delta=matrix(after).multiply(matrix(before).invert());
 return Object.fromEntries(Object.entries(members).map(([id,pose])=>{
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
  delta.clone().multiply(matrix(checkedPose(pose))).decompose(position,rotation,scale);
  const euler=new Euler().setFromQuaternion(rotation);
  return [id,{position:position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:scale.toArray()}];
 }));
}
export function checkedAssemblyEdit(value) {
 const pose=checkedAssemblyPose(value),frame=checkedAssemblyPose(value.frame);
 if(!value.members||typeof value.members!=='object'||Array.isArray(value.members))throw Error('Assembly edit requires member poses');
 return {...pose,frame,members:Object.fromEntries(Object.entries(value.members).map(([id,pose])=>[id,checkedPose(pose)]))};
}

// Turn an already placed housing into a burner using ordinary source/group
// records. The initial upright outlet is a starting frame, not recovered bore
// geometry. An explicit authored frame overrides it; Tab edits native members.
export function meshBurnerPlan({scene,bodyId,template,kind='nozzle',bounds,sourceId,groupId,outlet=null,reuseSourceId=null}){
 if(!['rack','ring','nozzle'].includes(kind))throw Error('Choose a rack, ring or nozzle burner kind');
 const body=scene.objects.find(o=>o.id===bodyId);
 if(!body||!['glb','procedural-mesh','pbr'].includes(body.type))throw Error('Choose a placed mesh for the burner housing');
 if(scene.groups.some(g=>g.assembly&&g.objectIds.includes(bodyId)))throw Error('This housing already belongs to an assembly; use Tab to edit its components');
 if(template?.type!=='flame-emitter'||template.emission?.settings?.['volume-emitter-source-law']?.value!=='immersed-source')throw Error('Choose an immersed-source fire basin first');
 if(!sourceId||!groupId||sourceId===bodyId||scene.groups.some(g=>g.id===groupId)||scene.objects.some(o=>o.id===sourceId&&o.id!==reuseSourceId))throw Error('Burner member identity is already in use');
 for(const key of ['min','max'])if(!Array.isArray(bounds?.[key])||bounds[key].length!==3||!bounds[key].every(Number.isFinite))throw Error('Housing bounds must be finite');
 const spans=bounds.max.map((v,i)=>v-bounds.min[i]);if(spans.some(v=>v<0)||Math.max(spans[0],spans[2])<=0)throw Error('Housing has no usable aperture extent');
 const position=outlet?.position??bounds.max.map((v,i)=>i===1?v+spans[1]*.02:(v+bounds.min[i])/2),rotation=outlet?.rotation??[0,0,0];
 const radius=outlet?.radius??(kind==='nozzle'?Math.min(spans[0],spans[2])*.12:Math.max(spans[0],spans[2])*.45);
 if(!Number.isFinite(radius)||radius<=0)throw Error('Outlet radius must be positive');
 const source={...structuredClone(template),id:sourceId,groupId,fileName:'Flame source',label:kind==='rack'?'Slot outlet':kind==='ring'?'Ring outlets':'Nozzle outlet',createdAt:new Date().toISOString(),transform:checkedAssemblyPose({position,rotation,scale:[1,1,1]})};
 const patch={'volume-emitter-aperture-pattern':{rack:'slot',ring:'jets',nozzle:'shape'}[kind],'volume-immersed-radius':radius};
 for(const [id,value] of Object.entries(patch)){
  const descriptor=source.emission.settings[id];if(!descriptor)throw Error('Fire basin has no '+id+' setting');descriptor.value=value;if(Object.hasOwn(descriptor,'rawValue'))descriptor.rawValue=String(value);
 }
 const result=structuredClone(scene);result.objects=result.objects.filter(o=>o.id!==reuseSourceId);result.objects.push(source);
 result.objects.find(o=>o.id===bodyId).groupId=groupId;
 result.groups=result.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>id!==bodyId&&id!==reuseSourceId)})).filter(g=>g.objectIds.length);
 result.groups.push({id:groupId,type:'group',label:kind==='rack'?'Rack burner':kind==='ring'?'Ring burner':'Nozzle burner',transform:{position:[...position],rotation:[0,0,0],scale:[1,1,1]},objectIds:[bodyId,sourceId],assembly:{kind:'burner',roles:{[bodyId]:'body',[sourceId]:'outlet'}},createdAt:new Date().toISOString()});
 result.selection={ids:['@group:'+groupId],activeId:'@group:'+groupId};result.field=null;return result;
}
