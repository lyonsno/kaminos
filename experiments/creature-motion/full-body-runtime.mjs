import {skinTransport} from '../../hindquarter-live-core.mjs';

// The verified Mushfinger body/weights and same rigid DQ transport, with scene
// attachment left to Hotwet's owner session. No renderer or frame loop here.
export function createFullBodyRuntime({THREE,manifest,rest,triangles,weights}) {
 const rig=manifest.bones.map(b=>({name:b.name,parent:b.parent,restMatrix:b.restMatrix.flat()})),channels=[...manifest.channels];
 let skin={manifest,rest,triangles,weights},disposed=false,skinRevision=0;
 const cleanupFailures=[];
 function validate(candidate){
  const m=candidate?.manifest;
  if(!m||!Number.isInteger(m.vertices)||m.vertices<1||!Number.isInteger(m.triangles)||m.triangles<1||candidate.rest?.length!==m.vertices*3||candidate.triangles?.length!==m.triangles*3||candidate.weights?.length!==m.vertices*channels.length)throw Error('Incomplete full-body arrays');
  if(!Array.isArray(m.channels)||m.channels.length!==channels.length||m.channels.some((name,i)=>name!==channels[i]))throw Error('Skin channel order differs from the live rig');
  if(!Array.isArray(m.bones)||m.bones.length!==rig.length||rig.some(original=>{
   const next=m.bones.find(b=>b.name===original.name),matrix=next?.restMatrix?.flat();
   return !next||next.parent!==original.parent||matrix?.length!==16||matrix.some((v,i)=>v!==original.restMatrix[i]);
  }))throw Error('Skin rig parent or rest frame differs from the live rig');
  if(!candidate.rest.every(Number.isFinite)||!candidate.weights.every(Number.isFinite))throw Error('Skin arrays must be finite');
  if(candidate.weights.some(v=>v<0))throw Error('Skin weights must be nonnegative');
  if(candidate.triangles.some(i=>!Number.isInteger(i)||i<0||i>=m.vertices))throw Error('Skin triangle index is outside the body');
 }
 validate(skin);
 const group=new THREE.Group();group.name='Creature · generated walking';
 let geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xd6b17c,roughness:.72,side:THREE.DoubleSide}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.kaminosDynamicGeometry=true;group.add(mesh);
 const bones=new Map(),inverseRest=new Map();
 for(const spec of manifest.bones){const bone=new THREE.Bone();bone.name=spec.name;bones.set(spec.name,bone);inverseRest.set(spec.name,new THREE.Matrix4().set(...spec.restMatrix.flat()).invert());}
 for(const spec of manifest.bones){
  const bone=bones.get(spec.name),matrix=new THREE.Matrix4().set(...spec.restMatrix.flat());
  if(spec.parent){matrix.premultiply(inverseRest.get(spec.parent));bones.get(spec.parent).add(bone);}else group.add(bone);
  matrix.decompose(bone.position,bone.quaternion,bone.scale);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.035,12,8),new THREE.MeshBasicMaterial({color:0x37d7eb,depthTest:false}));marker.renderOrder=100;Object.assign(marker.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosHelperKind:'bones'});bone.add(marker);
 }
 let cached='',updates=0,lastUpdateMs=0;
 function active(){if(disposed)throw Error('Full-body runtime is disposed');}
 function palette(){
  group.updateMatrixWorld(true);const inverseGroup=group.matrixWorld.clone().invert();
  return [new THREE.Matrix4().elements,...channels.slice(1).map(name=>new THREE.Matrix4().multiplyMatrices(inverseGroup,bones.get(name).matrixWorld).multiply(inverseRest.get(name)).elements)];
 }
 function update(){
  active();const matrices=palette();
  const key=matrices.flat().join(',');if(key===cached)return;
  const begin=performance.now(),result=skinTransport(skin.rest,skin.weights,matrices);
  geometry.attributes.position.array.set(result);geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
  cached=key;updates++;lastUpdateMs=performance.now()-begin;
 }
 function replaceSkin(candidate){
  active();validate(candidate);
  const begin=performance.now(),matrices=palette(),result=skinTransport(candidate.rest,candidate.weights,matrices);
  if(!result.every(Number.isFinite))throw Error('Exchanged skin deformation must be finite');
  const next=new THREE.BufferGeometry();
  try{
   next.setAttribute('position',new THREE.Float32BufferAttribute(result,3));next.setIndex(new THREE.BufferAttribute(candidate.triangles,1));
   next.computeVertexNormals();next.computeBoundingSphere();next.computeBoundingBox();
  }catch(error){next.dispose();throw error;}
  // Commit only skin state. Actual Bone/mesh/group handles, material, placement
  // and the attached player's update function stay intact at their current pose.
  const previous=geometry;geometry=next;mesh.geometry=next;skin=candidate;cached=matrices.flat().join(',');skinRevision++;updates++;lastUpdateMs=performance.now()-begin;
  try{previous.dispose();}catch(error){cleanupFailures.push({geometry:previous.uuid,message:error.message});}
  return runtime.read();
 }
 const runtime={group,bones,mesh,update,replaceSkin,read:()=>({route:'shared-owner-scene-full-body-dq',vertices:skin.manifest.vertices,bones:bones.size,skinRevision,updates,lastUpdateMs,cleanupFailure:cleanupFailures.at(-1)??null,cleanupFailures:structuredClone(cleanupFailures)}),dispose(){if(disposed)return;disposed=true;group.traverse(object=>{object.geometry?.dispose();for(const material of [object.material].flat().filter(Boolean))material.dispose();});}};
 update();return runtime;
}
