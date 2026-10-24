import {checkedActuators} from './scene-actuator.mjs';
import {groupDescendants,groupObjectIds,checkedGroupTopology} from './scene-group-topology.mjs';
import {checkedProceduralMesh} from './scene-geometry.mjs';
import {checkedGroupPose} from './scene-group.mjs';

export const assemblyCatalog=[{id:'piston-arm',label:'Piston arm',description:'An editable arm with a hand crank and powered piston.',url:'./assets/assemblies/piston-arm.json',aliases:['mechanism','hydraulic','actuator','machine','assembly']}];
const copy=v=>structuredClone(v);
const roles=r=>[r.fixedId,r.followerId,r.barrelId,r.rodId,...r.carried];
export function remapActuators(rows,idMap,newId){
 return checkedActuators(rows.flatMap(row=>{
  const ids=roles(row),mapped=ids.filter(id=>idMap.has(id));
  if(!mapped.length)return [];
  if(mapped.length!==ids.length)throw Error('Select the complete mechanism to copy its moving parts');
  return [{...copy(row),id:newId('piston'),...Object.fromEntries(['fixedId','followerId','barrelId','rodId'].map(k=>[k,idMap.get(row[k])])),
   carried:row.carried.map(id=>idMap.get(id)),reference:Object.fromEntries(ids.map(id=>[idMap.get(id),copy(row.reference[id])]))}];
 }));
}
export function assemblySelectionId(id,objects,groups){
 let group=id?.startsWith('@group:')?groups.find(g=>g.id===id.slice(7)):groups.find(g=>g.id===objects.find(o=>o.id===id)?.groupId),result=id;
 while(group){if(group.assembly)result='@group:'+group.id;group=groups.find(g=>g.id===group.parentId);}
 return result;
}
export function instantiateAssembly(source,{newId,position=[0,0,0]}={}){
 if(source?.schema!=='kaminos.assembly.v1')throw Error('Unsupported assembly source');
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Assembly placement needs three finite coordinates');
 if(!Array.isArray(source.objects)||!Array.isArray(source.groups)||!source.objects.length)throw Error('Assembly parts and groups are required');
 if(new Set(source.objects.map(o=>o.id)).size!==source.objects.length)throw Error('Duplicate assembly part ID');
 for(const row of source.objects){if(row.type!=='procedural-mesh')throw Error('Assembly files currently support procedural mesh parts');checkedProceduralMesh(row);}
 for(const group of source.groups)checkedGroupPose(group.transform);
 if(source.origin&&(!Array.isArray(source.origin)||source.origin.length!==3||!source.origin.every(Number.isFinite)))throw Error('Invalid assembly origin');
 checkedGroupTopology(source.groups,source.objects.map(o=>o.id));
 const map=new Map([...source.objects.map(o=>[o.id,newId('mesh')]),...source.groups.map(g=>['@group:'+g.id,'@group:'+newId('group')])]);
 const recipes=checkedActuators(source.actuators||[]);
 if(recipes.some(r=>roles(r).some(id=>!map.has(id))))throw Error('Assembly actuator attachment is missing');
 const roots=source.groups.filter(g=>!g.parentId),existingRoot=roots.length===1&&roots[0].assembly&&source.objects.every(o=>o.groupId)?roots[0]:null;
 const actuators=remapActuators(recipes,map,newId),rootId=existingRoot?map.get('@group:'+existingRoot.id).slice(7):newId('group');
 // Reuse the authored insertion origin; the built-in origin is at its foot.
 const shift=source.origin?position.map((v,i)=>v-source.origin[i]):position;
 const moved=pose=>({...copy(pose),position:pose.position.map((v,i)=>v+shift[i])});
 const objects=source.objects.map(o=>({...copy(o),id:map.get(o.id),groupId:o.groupId?map.get('@group:'+o.groupId).slice(7):rootId,transform:moved(o.transform)}));
 const groups=source.groups.map(g=>({...copy(g),id:map.get('@group:'+g.id).slice(7),parentId:g.parentId?map.get('@group:'+g.parentId).slice(7):existingRoot?null:rootId,objectIds:g.objectIds.map(id=>map.get(id)),transform:moved(g.transform),...(g.assembly?{assembly:{...copy(g.assembly),sourceIds:Object.fromEntries(Object.entries(g.assembly.sourceIds||{}).map(([k,v])=>[k,map.get(v)||v]))}}:{})}));
 if(!existingRoot)groups.push({id:rootId,type:'group',label:source.label,objectIds:source.objects.filter(o=>!o.groupId).map(o=>map.get(o.id)),transform:{position:[...position],rotation:[0,0,0],scale:[1,1,1]},source:copy(source.source),assembly:{kind:source.id,sourceIds:Object.fromEntries(map)}});
 return {objects,groups,actuators,rootId};
}
export function extractAssembly({objects,groups,actuators},rootId){
 const root=groups.find(g=>g.id===rootId);if(!root)throw Error('Choose an assembly group');
 const tree=[root,...groupDescendants(groups,rootId)],ids=new Set(groupObjectIds(groups,rootId));
 const refs=new Set([...ids,...tree.map(g=>'@group:'+g.id)]);
 const selected=(actuators||[]).filter(r=>roles(r).some(id=>refs.has(id)));
 if(selected.some(r=>roles(r).some(id=>!refs.has(id))))throw Error('Assembly has attachments outside this group');
 return {schema:'kaminos.assembly.v1',id:root.assembly?.kind||'saved-assembly',label:root.label,source:copy(root.source),origin:copy(root.transform.position),
  objects:objects.filter(o=>ids.has(o.id)).map(copy),groups:tree.map(g=>({...copy(g),parentId:g.id===rootId?null:g.parentId})),actuators:copy(selected)};
}
