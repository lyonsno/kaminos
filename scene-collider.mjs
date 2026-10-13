import {FIRE_DOMAIN_ID,FIRE_DOMAIN_TYPE} from './scene-fire-domain.mjs';

export const SCENE_COLLIDER_SOURCE_ID='authored-fire-solids';
export const canCollideWithFire=record=>['glb','pbr','procedural-mesh'].includes(record?.type);
export function checkedObjectCollision(record,value=record?.collision) {
  if(value==null)return null;
  if(!canCollideWithFire(record))throw Error('Fire collision requires a mesh object');
  if(value.domainId!==FIRE_DOMAIN_ID || typeof value.enabled!=='boolean')throw Error('Invalid object collision membership');
  return {...structuredClone(value),domainId:FIRE_DOMAIN_ID,enabled:value.enabled};
}
export function checkSceneCollisionReferences(records,{implicitFireDomain=false}={}) {
  const domains=new Set(records.filter(record=>record.type===FIRE_DOMAIN_TYPE).map(record=>record.id));
  if(implicitFireDomain)domains.add(FIRE_DOMAIN_ID);
  for(const record of records)if(record.collision && !domains.has(checkedObjectCollision(record).domainId))throw Error('Object collision references a missing fire domain');
}

function eligibleMesh(mesh) {
  if(!mesh.isMesh)return false;
  for(let node=mesh;node;node=node.parent)if(!node.visible || node.userData?.kaminosEditorHelper || node.userData?.kaminosEditorOnly)return false;
  return true;
}

// Stable per-object groups supply world triangles without reparenting authored
// objects or copying geometry buffers. The engine caches each object's mask.
export function createSceneColliderCollection(THREE) {
  const object=new THREE.Group(),wrappers=new Map(),groups=new Map();object.name='Authored fire obstacles';
  let memberIds=[];
  function clear(){object.clear();wrappers.clear();groups.clear();memberIds=[];}
  function update(records) {
    const meshes=new Map();memberIds=[];
    for(const record of records) {
      if(!checkedObjectCollision(record)?.enabled)continue;
      record.object.updateWorldMatrix(true,true);
      let included=false;
      record.object.traverse(mesh=>{if(eligibleMesh(mesh)){meshes.set(mesh.uuid,{mesh,recordId:record.id});included=true;}});
      if(included)memberIds.push(record.id);
    }
    for(const [id,wrapper] of wrappers)if(!meshes.has(id)){wrapper.removeFromParent();wrappers.delete(id);}
    for(const [id,{mesh,recordId}] of [...meshes].sort(([a],[b])=>a.localeCompare(b))) {
      let group=groups.get(recordId);if(!group){group=new THREE.Group();group.name=recordId;groups.set(recordId,group);object.add(group);}
      let wrapper=wrappers.get(id);
      if(!wrapper){wrapper=new THREE.Mesh(mesh.geometry,mesh.material);wrapper.matrixAutoUpdate=false;wrappers.set(id,wrapper);}
      if(wrapper.parent!==group)group.add(wrapper);
      wrapper.geometry=mesh.geometry;wrapper.material=mesh.material;wrapper.matrix.copy(mesh.matrixWorld);
    }
    memberIds.sort();
    for(const [id,group] of groups)if(!memberIds.includes(id)){group.removeFromParent();groups.delete(id);}
    return object.children.length?{requested:true,id:SCENE_COLLIDER_SOURCE_ID,object,objects:memberIds.map(id=>({id,object:groups.get(id)})),memberIds:[...memberIds]}:null;
  }
  return {update,clear,state:()=>({memberIds:[...memberIds],meshCount:wrappers.size})};
}
