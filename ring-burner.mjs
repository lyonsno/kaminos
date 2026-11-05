import {checkedGroupPose} from './scene-group.mjs';
import {checkedFireSourceRecord} from './scene-fire-domain.mjs';
import {FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE} from './scene-flame-emitter.mjs';
import {checkedProceduralMesh,PROCEDURAL_MESH_TYPE,PROCEDURAL_MESH_SOURCE} from './scene-geometry.mjs';
import {BURNER_DEFAULTS} from './annular-burner.mjs';
import {Matrix4,Vector3,Quaternion,Euler} from './lib/three.core.js';
const clone=value=>structuredClone(value);
function meshBody(id,mesh,transform){
 if(mesh==null)return checkedProceduralMesh({id,type:PROCEDURAL_MESH_TYPE,source:PROCEDURAL_MESH_SOURCE,label:'Ring housing',fileName:'Ring housing',transform,
  geometry:{kind:'annular',parameters:{...BURNER_DEFAULTS,innerRadius:.25,outerRadius:.5,ringCount:1}},surface:{fieldBinding:'flame-field'}});
 if(mesh.kind!=='mesh'||mesh.visibility?.status==='withheld')throw Error('Choose an available mesh body; withheld assets cannot be used');
 if(typeof mesh.source!=='string'||!(/^(\/api\/|https?:\/\/|demos\/)/.test(mesh.source)))throw Error('Mesh body needs a retained source');
 return {id,type:'glb',source:mesh.source,fileName:mesh.name||'burner-body.glb',label:mesh.label||mesh.name||'Burner body',transform,
  ...(mesh.generation?{generation:clone(mesh.generation)}:{}),...(mesh.assetOrigin?{assetOrigin:clone(mesh.assetOrigin)}:{})};
}
function freeId(state,id){if(typeof id!=='string'||!id||state.objects.some(o=>o.id===id)||state.groups.some(g=>g.id===id))throw Error('Burner identity is already in use');}
function belowOutlet(pose){
 const q=new Quaternion().setFromEuler(new Euler(...pose.rotation)),m=new Matrix4().compose(new Vector3(...pose.position),q,new Vector3(...pose.scale));
 return {...clone(pose),position:new Vector3(0,-.06,0).applyMatrix4(m).toArray()};
}
// Ordinary membership is the entire authored state: no parallel burner store.
export function planRingBurner(state,{groupId,bodyId,outletId,template,pose=template?.transform,mesh=null,reuseSource=false}){
 freeId(state,groupId);freeId(state,bodyId);if(groupId===bodyId||[groupId,bodyId].includes(outletId))throw Error('Burner identity collision');
 if(!reuseSource)freeId(state,outletId);
 else if(!state.objects.some(o=>o.id===outletId&&o.type===FLAME_EMITTER_TYPE)||state.groups.some(g=>g.objectIds.includes(outletId)))throw Error('Source is absent or already grouped');
 const transform=checkedGroupPose(pose),source=checkedFireSourceRecord({...clone(template),id:outletId,type:FLAME_EMITTER_TYPE,source:FLAME_EMITTER_SOURCE,label:'Ring outlet',transform,
  emission:{domainId:'flame-field',settings:{...clone(template?.emission?.settings??{}),
   'emitter-assay-family':{type:'select-one',value:'ring'},'volume-emitter-source-law':{type:'select-one',value:'immersed-source'},
   'volume-immersed-radius':{type:'range',value:.38},'volume-input-radius':{type:'range',value:.38}}}});
 const body=meshBody(bodyId,mesh,belowOutlet(transform)),next=clone(state);
 next.objects=next.objects.filter(o=>!reuseSource||o.id!==outletId);next.objects.push(body,source);
 next.groups.push({id:groupId,type:'group',label:'Ring burner',transform,objectIds:[bodyId,outletId],assembly:{kind:'burner',roles:{[bodyId]:'body',[outletId]:'outlet'}}});
 next.selection={ids:['@group:'+groupId],activeId:'@group:'+groupId};return next;
}
export function planBurnerBodyReplacement(state,{groupId,oldBodyId,bodyId,mesh}){
 freeId(state,bodyId);const group=state.groups.find(g=>g.id===groupId&&g.assembly?.kind==='burner');
 const old=state.objects.find(o=>o.id===oldBodyId);
 if(!group?.objectIds.includes(oldBodyId)||group.assembly.roles[oldBodyId]!=='body'||!old)throw Error('Choose the burner body to replace');
 const body=meshBody(bodyId,mesh,clone(old.transform)),next=clone(state),owner=next.groups.find(g=>g.id===groupId);
 next.objects.splice(next.objects.findIndex(o=>o.id===oldBodyId),1,body);
 owner.objectIds=owner.objectIds.map(id=>id===oldBodyId?bodyId:id);delete owner.assembly.roles[oldBodyId];owner.assembly.roles[bodyId]='body';
 next.selection={ids:['@group:'+groupId],activeId:'@group:'+groupId};return next;
}
