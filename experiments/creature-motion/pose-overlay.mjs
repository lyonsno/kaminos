// Resolve a stateful pose modifier once on a detached skeleton. Its local
// transforms can then be composed into every contact candidate and the final
// presented pose without advancing perception or publishing skin repeatedly.
export function createPoseOverlay({THREE}){
 const group=new THREE.Group(),bones=new Map();
 function resolve(pose,world,modify){
  if(!bones.size){
   for(const row of pose.bones){const bone=new THREE.Bone();bone.name=row.name;bones.set(row.name,bone);}
   for(const row of pose.bones)(row.parent===null?group:bones.get(row.parent)).add(bones.get(row.name));
  }
  world.clone().multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)).decompose(group.position,group.quaternion,group.scale);
  for(const row of pose.bones)new THREE.Matrix4().fromArray(row.localMatrix).decompose(bones.get(row.name).position,bones.get(row.name).quaternion,bones.get(row.name).scale);
  group.updateMatrixWorld(true);modify({bones,group});group.updateMatrixWorld(true);
  const offsets=new Map(pose.bones.map(row=>[row.name,bones.get(row.name).matrix.clone().multiply(new THREE.Matrix4().fromArray(row.localMatrix).invert())]));
  return source=>{
   const rows=source.bones.map(row=>({...row,localMatrix:offsets.get(row.name).clone().multiply(new THREE.Matrix4().fromArray(row.localMatrix)).toArray()})),byName=new Map(rows.map(row=>[row.name,row]));
   const worldOf=row=>row.worldMatrix=new THREE.Matrix4().fromArray(row.parent===null?source.actorMatrix:worldOf(byName.get(row.parent))).multiply(new THREE.Matrix4().fromArray(row.localMatrix)).toArray();
   for(const row of rows)worldOf(row);
   return {...source,bones:rows};
  };
 }
 return {resolve};
}
