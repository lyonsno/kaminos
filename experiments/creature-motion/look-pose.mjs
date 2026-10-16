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
  if(strength<=0)return {...unmodified,reason:'zero strength: original pose preserved'};

  const byName=new Map(pose.bones.map(b=>[b.name,b]));
  const neckBone=byName.get(neck),headBone=byName.get(head);
  if(!neckBone)fail(`pose has no Bone named "${neck}" for neck`);
  if(!headBone)fail(`pose has no Bone named "${head}" for head`);

  // pose.bones[*].worldMatrix is already actor-inclusive (the given-motion/
  // walking-pose schema's "world" frame); only placementMatrix remains to
  // reach true world space.
  const placement=new THREE.Matrix4().fromArray(placementMatrix??new THREE.Matrix4().identity().toArray());
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

  const pelvisLike=pose.bones.filter(b=>b.name!==neck&&b.name!==head);
  const neckOriginal=decompose(neckBone.localMatrix);
  const headOriginal=decompose(headBone.localMatrix);
  const neckLocal={p:neckOriginal.p,q:neckOriginal.q.clone().multiply(neckCorrection).normalize(),s:neckOriginal.s};
  const headLocal={p:headOriginal.p,q:headOriginal.q.clone().multiply(headCorrection).normalize(),s:headOriginal.s};

  // Recompute world/skin fields coherently from the parent chain rather than
  // leaving pre-correction world/skin matrices stranded under a new local pose.
  const resolved=new Map(pelvisLike.map(b=>[b.name,new THREE.Matrix4().fromArray(b.worldMatrix)]));
  function worldOf(name){
   if(resolved.has(name))return resolved.get(name);
   const bone=byName.get(name),local=name===neck?compose(neckLocal.p,neckLocal.q,neckLocal.s):name===head?compose(headLocal.p,headLocal.q,headLocal.s):bone.localMatrix;
   const parentWorld=bone.parent==null?new THREE.Matrix4():worldOf(bone.parent);
   const world=parentWorld.clone().multiply(new THREE.Matrix4().fromArray(local));
   resolved.set(name,world);return world;
  }
  const neckWorld=worldOf(neck),headWorldNew=worldOf(head);

  const neckRest=specs.get(neck),headRest=specs.get(head);
  const restMatrixOf=spec=>new THREE.Matrix4().set(...spec.restMatrix.flat());
  const inverseActorForSkin=new THREE.Matrix4().fromArray(pose.actorMatrix).invert();
  const skinOf=(world,restSpec)=>inverseActorForSkin.clone().multiply(world).multiply(restMatrixOf(restSpec).clone().invert());

  const bones=pose.bones.map(b=>{
   if(b.name===neck)return {...b,localMatrix:compose(neckLocal.p,neckLocal.q,neckLocal.s),worldMatrix:neckWorld.toArray(),skinMatrix:skinOf(neckWorld,neckRest).toArray()};
   if(b.name===head)return {...b,localMatrix:compose(headLocal.p,headLocal.q,headLocal.s),worldMatrix:headWorldNew.toArray(),skinMatrix:skinOf(headWorldNew,headRest).toArray()};
   return b;
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
