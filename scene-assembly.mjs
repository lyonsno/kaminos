// An assembly is a selection boundary over ordinary scene members. Their poses,
// source settings, collision and lifetime remain owned by the existing records.
const roles=new Set(['body','outlet','collision']);
export function checkedAssembly(value,objectIds){
 if(value==null)return null;
 if(!['assembly','burner'].includes(value.kind)||!value.roles||typeof value.roles!=='object'||Array.isArray(value.roles))throw Error('Invalid assembly description');
 const present=new Set(objectIds),result={};
 for(const [id,role] of Object.entries(value.roles)){
  if(!roles.has(role))throw Error(`Unknown assembly role: ${role}`);
  if(present.has(id))result[id]=role;
 }
 for(const id of objectIds)result[id]??='body';
 return {kind:value.kind,roles:result};
}
// Explicit promotion of an existing group uses authored component capabilities
// and local visibility, never names or inherited visibility from its parent.
export function assemblyForMembers(members,hiddenIds=[]){
 const hidden=new Set(hiddenIds),roles=Object.fromEntries(members.map(member=>[member.id,
  member.type==='flame-emitter'?'outlet':hidden.has(member.id)&&member.type==='procedural-mesh'
   &&['plane','sphere','bowl','box'].includes(member.geometry?.kind)&&member.waterCollision!==false?'collision':'body']));
 return {kind:Object.values(roles).includes('outlet')?'burner':'assembly',roles};
}
export function copyAssembly(group,copies){
 if(!group.assembly)return null;
 return {kind:group.assembly.kind,roles:Object.fromEntries(group.objectIds.filter(id=>copies.has(id)).map(id=>[copies.get(id),group.assembly.roles[id]??'body']))};
}
export function assemblySelection(selection,groups,scope=null){
 const map=id=>{
  if(scope?.objectIds.includes(id)||id==='@group:'+scope?.id)return id;
  const group=groups.find(g=>g.assembly&&g.objectIds.includes(id));return group?'@group:'+group.id:id;
 };
 const ids=[...new Set(selection.ids.map(map))];
 return {ids,activeId:selection.activeId==null?null:map(selection.activeId)};
}

// Shared component Edit Mode delegates ordinary member operations back to the
// scene editor. No second transform/history service or setting store is added.
export function createAssemblyEditing({scene,components,select,changed=()=>{}}){
 const registrations=new Map();let editing=null;
 const scope=()=>editing?scene.groups.find(g=>g.id===editing&&g.assembly)??null:null;
 function sync(){
  const ids=new Set(scene.groups.filter(g=>g.assembly).map(g=>g.id));
  for(const [id,seat] of registrations)if(!ids.has(id)){registrations.delete(id);seat.dispose();}
  for(const id of ids)if(!registrations.has(id)){
   registrations.set(id,components.register('@group:'+id,{
    target:()=>null,scope,
    isCurrent:()=>!!scope()&&scene.selection.ids.every(member=>scope().objectIds.includes(member)||member==='@group:'+id),
    enter(){editing=id;const group=scope();select([group.objectIds[0]],group.objectIds[0]);changed();},
    exit(){const group=scope(),returnToOwner=group&&scene.selection.ids.every(member=>group.objectIds.includes(member)||member==='@group:'+id);editing=null;if(returnToOwner)select(['@group:'+id],'@group:'+id);changed();},
   }));
  }
 }
 return {sync,scope,read:()=>({mode:scope()?'edit':'object',assemblyId:scope()?.id??null}),
  enter(id){sync();if(scope()?.id===id)return true;if(components.active())components.exit();select(['@group:'+id],'@group:'+id);return components.toggle('@group:'+id);},
  exit:()=>components.exit(),
 };
}
