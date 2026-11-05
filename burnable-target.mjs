export function resolveBurnableHeroMesh(object){
 if(!object?.isObject3D)throw Error('Select an existing mesh to make burnable');
 const meshes=[];object.traverse(node=>{
  if(!node.isMesh)return;
  for(let p=node;p;p=p.parent)if(p.userData?.kaminosBeautyLodProxy||p.userData?.kaminosEditorHelper||p.userData?.kaminosEditorOnly||p.userData?.kaminosRepetitionCopy)return;
  meshes.push(node);
 });
 if(meshes.length!==1)throw Error('Burnable wood currently supports one volumetric mesh per object');
 const mesh=meshes[0];
 if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.length)throw Error('Burnable wood requires a static mesh');
 const position=mesh.geometry?.getAttribute('position');
 if(!position||position.count<3)throw Error('Burnable wood requires triangle geometry');
 mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
 if(![bounds.min.x,bounds.min.y,bounds.min.z,bounds.max.x,bounds.max.y,bounds.max.z].every(Number.isFinite)||bounds.max.x<=bounds.min.x||bounds.max.y<=bounds.min.y||bounds.max.z<=bounds.min.z)throw Error('Burnable wood requires volumetric bounds');
 return mesh;
}
export function resolveBurnableTarget(objects,id){
 const entry=objects.find(item=>item.id===id);
 if(!entry?.object?.isObject3D)throw Error('Select an existing mesh to make burnable');
 resolveBurnableHeroMesh(entry.object);
 return entry;
}
