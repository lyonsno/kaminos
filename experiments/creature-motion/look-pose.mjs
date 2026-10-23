// A pure neck/head aim correction over an existing animated pose. The caller
// supplies the rig's actual Bone names and head-local forward/up directions;
// this module claims no anatomy and performs no runtime Bone mutation.
export function createLookPoseModifier({THREE,rigFrame,neck,head,forward,up,maxYaw,maxPitch,neckShare,comfortablePitch=maxPitch,craningNeckShare=neckShare}) {
 const fail=message=>{throw Error(message);};
 if(!Number.isFinite(maxYaw)||maxYaw<0)fail('maxYaw must be a finite nonnegative radian limit');
 if(!Number.isFinite(maxPitch)||maxPitch<0)fail('maxPitch must be a finite nonnegative radian limit');
 if(!Number.isFinite(neckShare)||neckShare<0||neckShare>1)fail('neckShare must be a blend fraction between 0 and 1');
 if(!Number.isFinite(comfortablePitch)||comfortablePitch<0||comfortablePitch>maxPitch)fail('comfortablePitch must be within the pitch budget');
 if(!Number.isFinite(craningNeckShare)||craningNeckShare<neckShare||craningNeckShare>1)fail('craningNeckShare must be between neckShare and 1');
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
 const rightLocal=new THREE.Vector3().crossVectors(upLocal,forwardLocal);
 if(!(rightLocal.length()>1e-6))fail('forward and up must not be parallel');
 rightLocal.normalize();
 const upOrtho=new THREE.Vector3().crossVectors(forwardLocal,rightLocal).normalize();

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
  if(placement.determinant()===0)fail('placementMatrix must be invertible');
  // Pull the target through placement instead of extracting a quaternion from
  // a scaled scene matrix. The latter is not a rotation (even at uniform x2).
  const headWorld=new THREE.Matrix4().fromArray(headBone.worldMatrix);
  const headPosition=new THREE.Vector3().setFromMatrixPosition(headWorld);
  const headOrientation=decompose(headBone.worldMatrix).q;
  const targetInPose=new THREE.Vector3(...target).applyMatrix4(placement.clone().invert());
  const offset=targetInPose.clone().sub(headPosition);
  const distance=offset.length();
  if(!(distance>1e-4))return {...unmodified,reason:'target too near the head: original pose preserved'};
  const dirWorld=offset.multiplyScalar(1/distance);

  // Express the desired aim direction in the head's own local forward/up/right
  // basis so the correction is relative to the animated baseline, not world axes.
  const dirLocal=dirWorld.clone().applyQuaternion(headOrientation.clone().invert());
  const x=dirLocal.dot(rightLocal),y=dirLocal.dot(upOrtho),z=dirLocal.dot(forwardLocal);
  const horizontal=Math.hypot(x,z);
  const yaw=Math.atan2(x,z);
  const pitch=Math.atan2(y,Math.max(horizontal,1e-9));
  if(!Number.isFinite(yaw)||!Number.isFinite(pitch))return {...unmodified,reason:'degenerate aim direction: original pose preserved'};

  const clampedYaw=Math.max(-maxYaw,Math.min(maxYaw,yaw))*strength;
  const clampedPitch=Math.max(-maxPitch,Math.min(maxPitch,pitch))*strength;
  const fullYaw=Math.max(-maxYaw,Math.min(maxYaw,yaw)),fullPitch=Math.max(-maxPitch,Math.min(maxPitch,pitch));

  // Build a bounded correction in the head's forward/up/right basis. Each joint
  // gets a fresh identity->correction rotation (no accumulation).
  const identityQuat=new THREE.Quaternion();
  const correctionOf=(y,p)=>new THREE.Quaternion().setFromAxisAngle(upOrtho,y).multiply(new THREE.Quaternion().setFromAxisAngle(rightLocal,-p)).normalize();
  // The correction was expressed in head-local axes; neck has different
  // animated/rest axes, so conjugate the neck's share into its own frame.
  const headInNeck=decompose(neckBone.worldMatrix).q.invert().multiply(headOrientation);
  const neckShareOf=share=>headInNeck.clone().multiply(identityQuat.clone().slerp(correctionOf(fullYaw,fullPitch),share)).multiply(headInNeck.clone().invert()).normalize();

  const neckOriginal=decompose(neckBone.localMatrix);
  const headOriginal=decompose(headBone.localMatrix);
  const neckLocalWith=q=>compose(neckOriginal.p,neckOriginal.q.clone().multiply(q).normalize(),neckOriginal.s);

  // Any bone whose ancestor chain passes through neck (including neck and
  // head itself, and every descendant of head such as a head-end tip) moves;
  // everything else, including a sibling leg hung off a shared chest parent,
  // keeps its exact original fields untouched.
  const isDescendantOfNeck=name=>{
   let walk=name;
   while(walk!=null){if(walk===neck)return true;walk=byName.get(walk)?.parent??null;}
   return false;
  };
  function resolver(locals){
   const resolved=new Map();
   return function worldOf(name){
    if(resolved.has(name))return resolved.get(name);
    const bone=byName.get(name);
    if(!isDescendantOfNeck(name)){const world=new THREE.Matrix4().fromArray(bone.worldMatrix);resolved.set(name,world);return world;}
    const parentWorld=bone.parent==null?new THREE.Matrix4():worldOf(bone.parent);
    const world=parentWorld.clone().multiply(new THREE.Matrix4().fromArray(locals.get(name)??bone.localMatrix));
    resolved.set(name,world);return world;
   };
  }

  // Rotating the neck moves the head whenever the neck-to-head offset is not
  // along the rotation axis. Aim the head's remaining turn from where it
  // actually ends up, within whatever angular budget the neck left over.
  function distribute(share){
   const neckFull=neckShareOf(share);
   const displacedHead=resolver(new Map([[neck,neckLocalWith(neckFull)]]))(head);
   const residualOffset=targetInPose.clone().sub(new THREE.Vector3().setFromMatrixPosition(displacedHead));
   if(!(residualOffset.length()>1e-4))return {neckFull,headFull:identityQuat.clone(),reaches:false};
   const d=residualOffset.normalize().applyQuaternion(decompose(displacedHead.toArray()).q.invert());
   const rx=d.dot(rightLocal),ry=d.dot(upOrtho),rz=d.dot(forwardLocal);
   const wantYaw=Math.atan2(rx,rz),wantPitch=Math.atan2(ry,Math.max(Math.hypot(rx,rz),1e-9));
   const yawBudget=Math.max(0,maxYaw-share*Math.abs(fullYaw)),pitchBudget=Math.max(0,maxPitch-share*Math.abs(fullPitch));
   const residualYaw=Math.max(-yawBudget,Math.min(yawBudget,wantYaw)),residualPitch=Math.max(-pitchBudget,Math.min(pitchBudget,wantPitch));
   return {neckFull,headFull:correctionOf(residualYaw,residualPitch),reaches:residualYaw===wantYaw&&residualPitch===wantPitch};
  }
  // Near a target the neck can sweep the head past it. When the request is
  // reachable head-only, give the neck the largest share (up to neckShare)
  // that still lets the head finish the aim; beyond reach, keep neckShare.
  const stretch=maxPitch>comfortablePitch?Math.max(0,Math.min(1,(Math.abs(pitch)-comfortablePitch)/(maxPitch-comfortablePitch))):0;
  let effectiveShare=neckShare+(craningNeckShare-neckShare)*stretch*stretch*(3-2*stretch);
  let solution=distribute(effectiveShare);
  if(!solution.reaches&&effectiveShare>0&&fullYaw===yaw&&fullPitch===pitch&&distribute(0).reaches){
   let lo=0,hi=effectiveShare;
   for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(distribute(mid).reaches)lo=mid;else hi=mid;}
   effectiveShare=lo;solution=distribute(lo);
  }
  const {neckFull,headFull}=solution;

  // Strength blends both joints' corrections from identity.
  const neckLocalArray=neckLocalWith(identityQuat.clone().slerp(neckFull,strength));
  const headLocalArray=compose(headOriginal.p,headOriginal.q.clone().multiply(identityQuat.clone().slerp(headFull,strength)).normalize(),headOriginal.s);
  const worldOf=resolver(new Map([[neck,neckLocalArray],[head,headLocalArray]]));

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
   neckShare:effectiveShare,
   residualAngle:forwardLocal.clone().applyQuaternion(decompose(worldOf(head).toArray()).q).angleTo(targetInPose.clone().sub(new THREE.Vector3().setFromMatrixPosition(worldOf(head)))),
   reason:null,
   requestedYaw:yaw,
   requestedPitch:pitch,
   appliedYaw:clampedYaw,
   appliedPitch:clampedPitch,
  };
 }
 return Object.freeze({apply});
}
