import {skinTransport} from '../../hindquarter-live-core.mjs';
import {registerExportGeometrySnapshot} from '../../scene-export-geometry.mjs';

// The verified Mushfinger body/weights and same rigid DQ transport, with scene
// attachment left to Hotwet's owner session. No renderer or frame loop here.
export function createFullBodyRuntime({THREE,manifest,rest,triangles,weights,fleshPrepared=null,retainPoses=false,deformerFactory=null}) {
 if(typeof retainPoses!=='boolean')throw Error('Pose retention must be boolean');
 const rig=manifest.bones.map(b=>({name:b.name,parent:b.parent,restMatrix:b.restMatrix.flat()})),channels=[...manifest.channels];
 let skin={manifest,rest,triangles,weights,fleshPrepared},disposed=false,skinRevision=0;
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
 let cached='',updates=0,lastUpdateMs=0,deformations=0,cacheHits=0,cacheBytes=0;
 let deformer=null,cpuKey='',cpuGeometry=null,physicalRunning=false;
 const makeDeformer=(target,data)=>{
  if(!deformerFactory)return null;
  const next=deformerFactory({geometry:target,...data,channels:channels.length});
  target.addEventListener('dispose',()=>next.dispose());return next;
 };
 deformer=makeDeformer(geometry,skin);
 if(deformer){retainPoses=false;mesh.frustumCulled=false;mesh.onBeforeRender=renderer=>deformer.flush(renderer);}
 const poses=new Map();
 const clearPoses=()=>{poses.clear();cacheBytes=0;};
 function active(){if(disposed)throw Error('Full-body runtime is disposed');}
 function palette(){
  group.updateMatrixWorld(true);const inverseGroup=group.matrixWorld.clone().invert();
  return [new THREE.Matrix4().elements,...channels.slice(1).map(name=>new THREE.Matrix4().multiplyMatrices(inverseGroup,bones.get(name).matrixWorld).multiply(inverseRest.get(name)).elements)];
 }
 function update(){
  active();const matrices=palette();
  const key=matrices.flat().join(',');if(key===cached)return;
  const begin=performance.now(),retained=retainPoses?poses.get(key):null;
  if(deformer){deformer.update(matrices);cached=key;updates++;lastUpdateMs=performance.now()-begin;return;}
  if(retained){
   geometry.attributes.position.array.set(retained.positions);geometry.attributes.normal.array.set(retained.normals);geometry.attributes.normal.needsUpdate=true;
   geometry.boundingSphere.copy(retained.sphere);geometry.boundingBox.copy(retained.box);cacheHits++;
  }else{
   const result=skinTransport(skin.rest,skin.weights,matrices);deformations++;
   geometry.attributes.position.array.set(result);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
   if(retainPoses){const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice();poses.set(key,{positions,normals,sphere:geometry.boundingSphere.clone(),box:geometry.boundingBox.clone()});cacheBytes+=positions.byteLength+normals.byteLength;}
  }
  geometry.attributes.position.needsUpdate=true;
  cached=key;updates++;lastUpdateMs=performance.now()-begin;
 }
 // Picking, held-pose bounds, export and diagnostics are explicit CPU consumers.
 // Updating the CPU mirror does not mark GPU-owned output buffers for upload.
 function syncCpuGeometry(){
  active();if(!deformer)return geometry;const key=cached+':'+(deformer.mirrorKey?.()??'');if(cpuKey===key)return cpuGeometry;
  const base=skinTransport(skin.rest,skin.weights,palette()),points=deformer.cpuPositions?.(base)??base;
  const mirror=new THREE.BufferGeometry();mirror.setAttribute('position',new THREE.BufferAttribute(points,3));deformations++;
  mirror.setIndex(new THREE.BufferAttribute(skin.triangles,1));mirror.computeVertexNormals();mirror.computeBoundingSphere();mirror.computeBoundingBox();
  geometry.boundingSphere=mirror.boundingSphere.clone();geometry.boundingBox=mirror.boundingBox.clone();
  cpuGeometry?.dispose();cpuGeometry=mirror;cpuKey=key;return mirror;
 }
 if(deformer){const raycast=mesh.raycast;mesh.raycast=function(...args){if(deformer.raycast)return deformer.raycast(...args,this);const visible=mesh.geometry;try{mesh.geometry=syncCpuGeometry();return raycast.apply(this,args);}finally{mesh.geometry=visible;}};}
 registerExportGeometrySnapshot(mesh,syncCpuGeometry);
 function replaceSkin(candidate){
  active();validate(candidate);
  const begin=performance.now(),matrices=palette();let nextDeformer;
  const result=deformer?candidate.rest:skinTransport(candidate.rest,candidate.weights,matrices);if(!deformer)deformations++;
  if(!result.every(Number.isFinite))throw Error('Exchanged skin deformation must be finite');
  const next=new THREE.BufferGeometry();
  try{
   next.setAttribute('position',new THREE.Float32BufferAttribute(result,3));next.setIndex(new THREE.BufferAttribute(candidate.triangles,1));
   next.computeVertexNormals();next.computeBoundingSphere();next.computeBoundingBox();
   nextDeformer=makeDeformer(next,candidate);nextDeformer?.setRunning?.(physicalRunning);nextDeformer?.update(matrices);
  }catch(error){next.dispose();throw error;}
  // Commit only skin state. Actual Bone/mesh/group handles, material, placement
  // and the attached player's update function stay intact at their current pose.
  const previous=geometry;geometry=next;deformer=nextDeformer;mesh.geometry=next;skin=candidate;clearPoses();cpuGeometry?.dispose();cpuGeometry=null;cpuKey='';cached=matrices.flat().join(',');skinRevision++;updates++;lastUpdateMs=performance.now()-begin;
  try{previous.dispose();}catch(error){cleanupFailures.push({geometry:previous.uuid,message:error.message});}
  return runtime.read();
 }
 const runtime={group,bones,mesh,update,replaceSkin,syncCpuGeometry,flesh:{advance:(...args)=>deformer?.advance?.(...args),setRunning:value=>{if(typeof value!=='boolean')throw Error('Boolean flesh run state required');physicalRunning=value;deformer?.setRunning?.(value);},setEnabled:value=>deformer?.setEnabled?.(value),setContacts:value=>deformer?.setContacts?.(value),capsules:()=>deformer?.capsules?.()??[],snapshot:()=>deformer?.snapshot?.(),read:()=>deformer?.read().flesh??null},async readGpuGeometry(){active();if(!deformer)throw Error('CPU reference is not GPU evidence');return deformer.readback();},setPoseRetention(enabled){active();if(typeof enabled!=='boolean')throw Error('Pose retention must be boolean');retainPoses=deformer?false:enabled;if(!retainPoses)clearPoses();},read:()=>({route:'shared-owner-scene-full-body-dq',deformation:deformer?.read()??{backend:'cpu-reference'},vertices:skin.manifest.vertices,bones:bones.size,skinRevision,updates,lastUpdateMs,poseCache:{enabled:retainPoses,entries:poses.size,hits:cacheHits,bytes:cacheBytes,deformations},cleanupFailure:cleanupFailures.at(-1)??null,cleanupFailures:structuredClone(cleanupFailures)}),dispose(){if(disposed)return;disposed=true;clearPoses();cpuGeometry?.dispose();cpuGeometry=null;group.traverse(object=>{object.geometry?.dispose();for(const material of [object.material].flat().filter(Boolean))material.dispose();});}};
 update();return runtime;
}
