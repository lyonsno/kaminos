// A pure neck/head aim correction over an existing animated pose. The caller
// supplies the rig's actual Bone names and head-local forward/up directions;
// this module claims no anatomy and performs no runtime Bone mutation.
export function createLookPoseModifier({THREE,rigFrame,neck,head,forward,up,maxYaw,maxPitch,neckShare}) {
 const fail=message=>{throw Error(message);};
 if(!Number.isFinite(maxYaw)||maxYaw<0)fail('maxYaw must be a finite nonnegative radian limit');
 if(!Number.isFinite(maxPitch)||maxPitch<0)fail('maxPitch must be a finite nonnegative radian limit');
 if(!Number.isFinite(neckShare)||neckShare<0||neckShare>1)fail('neckShare must be a blend fraction between 0 and 1');
 const specs=new Map((rigFrame?.bones??[]).map(b=>[b.name,b]));
 if(!specs.has(neck))fail(`rigFrame has no Bone named "${neck}" for neck`);
 if(!specs.has(head))fail(`rigFrame has no Bone named "${head}" for head`);
 {
  let walk=specs.get(head).parent,descends=false;
  while(walk){if(walk===neck){descends=true;break;}walk=specs.get(walk)?.parent;}
  if(!descends)fail(`head Bone "${head}" does not descend from neck Bone "${neck}" in rigFrame hierarchy`);
 }
 const forwardLocal=new THREE.Vector3(...forward),upLocal=new THREE.Vector3(...up);
 if(!(forwardLocal.length()>1e-8)||!(upLocal.length()>1e-8))fail('forward and up must be nonzero head-local directions');
 forwardLocal.normalize();
 const rightLocal=new THREE.Vector3().crossVectors(forwardLocal,upLocal);
 if(!(rightLocal.length()>1e-6))fail('forward and up must not be parallel');
 rightLocal.normalize();
 const upOrtho=new THREE.Vector3().crossVectors(rightLocal,forwardLocal).normalize();

 function decompose(array){
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  new THREE.Matrix4().fromArray(array).decompose(p,q,s);return {p,q,s};
 }
 function compose(p,q,s){return new THREE.Matrix4().compose(p,q,s).toArray();}

 function apply(pose,{target,placementMatrix,strength}={}) {
  const unmodified={applied:false,reason:null,requestedYaw:0,requestedPitch:0,appliedYaw:0,appliedPitch:0,pose};
  if(target==null)return {...unmodified,reason:'no target: original pose preserved'};
  if(!Number.isFinite(strength))fail('strength must be a finite blend fraction');
  if(strength<0||strength>1)fail('strength must be a blend fraction in [0,1]');
  if(strength<=0)return {...unmodified,reason:'zero strength: original pose preserved'};
  if(!Array.isArray(target)||target.length!==3||!target.every(Number.isFinite))fail('target must be a finite [x,y,z] world point');

  const byName=new Map(pose.bones.map(b=>[b.name,b]));
  const neckBone=byName.get(neck),headBone=byName.get(head);
  if(!neckBone)fail(`pose has no Bone named "${neck}" for neck`);
  if(!headBone)fail(`pose has no Bone named "${head}" for head`);

  // pose.bones[*].worldMatrix is already actor-inclusive (the given-motion/
  // walking-pose schema's "world" frame); only placementMatrix remains to
  // reach true world space.
  const placementArray=placementMatrix??new THREE.Matrix4().identity().toArray();
  if(!Array.isArray(placementArray)||placementArray.length!==16||!placementArray.every(Number.isFinite))fail('placementMatrix must be a finite 16-element array');
  const placement=new THREE.Matrix4().fromArray(placementArray);
  const headWorldFull=placement.clone().multiply(new THREE.Matrix4().fromArray(headBone.worldMatrix));
  const headPosWorld=new THREE.Vector3().setFromMatrixPosition(headWorldFull);
  const headQuatFull=new THREE.Quaternion().setFromRotationMatrix(headWorldFull);

  const targetVec=new THREE.Vector3(...target);
  const offset=targetVec.clone().sub(headPosWorld);
  const distance=offset.length();
  if(!(distance>1e-4))return {...unmodified,reason:'target too near the head: original pose preserved'};
  const dirWorld=offset.multiplyScalar(1/distance);

  // Express the desired aim direction in the head's own local forward/up/right
  // basis so the correction is relative to the animated baseline, not world axes.
  const dirLocal=dirWorld.clone().applyQuaternion(headQuatFull.clone().invert());
  const x=dirLocal.dot(rightLocal),y=dirLocal.dot(upOrtho),z=dirLocal.dot(forwardLocal);
  const horizontal=Math.hypot(x,z);
  const yaw=Math.atan2(x,z);
  const pitch=Math.atan2(y,Math.max(horizontal,1e-9));
  if(!Number.isFinite(yaw)||!Number.isFinite(pitch))return {...unmodified,reason:'degenerate aim direction: original pose preserved'};

  const clampedYaw=Math.max(-maxYaw,Math.min(maxYaw,yaw))*strength;
  const clampedPitch=Math.max(-maxPitch,Math.min(maxPitch,pitch))*strength;

  // Build the bounded, strength-scaled correction once, in the shared
  // forward/up/right basis, then distribute fractions across neck and head
  // as local rotations via a fresh identity->correction slerp (no accumulation).
  const yawQuat=new THREE.Quaternion().setFromAxisAngle(upOrtho,clampedYaw);
  const pitchQuat=new THREE.Quaternion().setFromAxisAngle(rightLocal,-clampedPitch);
  const fullCorrection=yawQuat.clone().multiply(pitchQuat).normalize();
  const identityQuat=new THREE.Quaternion();
  const neckCorrection=identityQuat.clone().slerp(fullCorrection,neckShare);
  const headCorrection=identityQuat.clone().slerp(fullCorrection,1-neckShare);

  const neckOriginal=decompose(neckBone.localMatrix);
  const headOriginal=decompose(headBone.localMatrix);
  const neckLocalArray=compose(neckOriginal.p,neckOriginal.q.clone().multiply(neckCorrection).normalize(),neckOriginal.s);
  const headLocalArray=compose(headOriginal.p,headOriginal.q.clone().multiply(headCorrection).normalize(),headOriginal.s);

  // Any bone whose ancestor chain passes through neck (including neck and
  // head itself, and every descendant of head such as a head-end tip) moves;
  // everything else, including a sibling leg hung off a shared chest parent,
  // keeps its exact original fields untouched.
  const isDescendantOfNeck=name=>{
   let walk=name;
   while(walk!=null){if(walk===neck)return true;walk=byName.get(walk)?.parent??null;}
   return false;
  };
  const resolvedWorld=new Map();
  function worldOf(name){
   if(resolvedWorld.has(name))return resolvedWorld.get(name);
   const bone=byName.get(name);
   if(!isDescendantOfNeck(name)){const world=new THREE.Matrix4().fromArray(bone.worldMatrix);resolvedWorld.set(name,world);return world;}
   const local=name===neck?neckLocalArray:name===head?headLocalArray:bone.localMatrix;
   const parentWorld=bone.parent==null?new THREE.Matrix4():worldOf(bone.parent);
   const world=parentWorld.clone().multiply(new THREE.Matrix4().fromArray(local));
   resolvedWorld.set(name,world);return world;
  }

  const restMatrixOf=name=>{const spec=specs.get(name);if(!spec)fail(`rigFrame has no Bone named "${name}" to recompute a coherent skin matrix`);return new THREE.Matrix4().set(...spec.restMatrix.flat());};
  const inverseActorForSkin=new THREE.Matrix4().fromArray(pose.actorMatrix).invert();
  const skinOf=(world,name)=>inverseActorForSkin.clone().multiply(world).multiply(restMatrixOf(name).clone().invert());

  const bones=pose.bones.map(b=>{
   if(!isDescendantOfNeck(b.name))return b;
   const world=worldOf(b.name);
   const local=b.name===neck?neckLocalArray:b.name===head?headLocalArray:b.localMatrix;
   return {...b,localMatrix:local,worldMatrix:world.toArray(),skinMatrix:skinOf(world,b.name).toArray()};
  });

  return {
   pose:{...pose,bones},
   applied:true,
   reason:null,
   requestedYaw:yaw,
   requestedPitch:pitch,
   appliedYaw:clampedYaw,
   appliedPitch:clampedPitch,
  };
 }
 return Object.freeze({apply});
}
