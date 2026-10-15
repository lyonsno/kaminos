// Reuses the recovered locomotion rail's distance -> position/tangent contract.
// This first flat broad-curve consumer does not borrow its crawler support law.
export function createWalkingPoseAdapter({THREE,adapter,radius=10,blendFrames=6}) {
 if(!Number.isFinite(radius)||radius<=0)throw Error('Path radius must be positive');
 if(!Number.isInteger(blendFrames)||blendFrames<0||blendFrames>=adapter.frames)throw Error('Seam blend frames must fit the actual source');
 const poses=Array.from({length:adapter.frames},(_,i)=>adapter.frame(i));
 const root=poses[0].bones.findIndex(b=>b.parent===null),points=poses.map(p=>p.bones[root].worldMatrix.slice(12,15)),distance=[0];
 for(let i=1;i<points.length;i++)distance.push(distance[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2]));
 const length=distance.at(-1);if(!(length>0))throw Error('Source has no horizontal travel to advance the route');
 const delta=points.at(-1).map((v,i)=>v-points[0][i]),net=Math.hypot(delta[0],delta[2]);if(!(net>0))throw Error('Source has no net forward direction');
 const forward=[delta[0]/net,delta[2]/net],right=[forward[1],-forward[0]];
 function pathPoint(d){
  if(!Number.isFinite(d)||d<0)throw Error('Path distance must be finite and nonnegative');
  const angle=d/radius;
  return [points[0][0]+forward[0]*radius*Math.sin(angle)+right[0]*radius*(1-Math.cos(angle)),points[0][1],points[0][2]+forward[1]*radius*Math.sin(angle)+right[1]*radius*(1-Math.cos(angle))];
 }
 function guidePoints(mode){
  if(!['source','cycle','path'].includes(mode))throw Error('Unknown walking mode');
  if(mode!=='path')return points.map(p=>[...p]);
  // 128-segment editor circle; this tessellation does not sample or limit motion.
  const guide=Array.from({length:128},(_,i)=>pathPoint(i/128*2*Math.PI*radius));guide.push([...guide[0]]);return guide;
 }
 const matrix=a=>new THREE.Matrix4().fromArray(a);
 const blend=(a,b,t)=>{const ap=new THREE.Vector3(),aq=new THREE.Quaternion(),as=new THREE.Vector3(),bp=new THREE.Vector3(),bq=new THREE.Quaternion(),bs=new THREE.Vector3();matrix(a).decompose(ap,aq,as);matrix(b).decompose(bp,bq,bs);return new THREE.Matrix4().compose(ap.lerp(bp,t),aq.slerp(bq,t),as.lerp(bs,t)).toArray();};
 function frame(index,{mode='source',cycle=0}={}) {
  if(!['source','cycle','path'].includes(mode))throw Error('Unknown walking mode');
  if(!Number.isInteger(index)||index<0||index>=poses.length||!Number.isSafeInteger(cycle)||cycle<0)throw Error('Invalid walking source frame or cycle');
  const raw=poses[index];if(mode==='source')return raw;
  const actor=matrix(raw.actorMatrix),bones=raw.bones.map(b=>({name:b.name,parent:b.parent,localMatrix:[...b.localMatrix]}));
  if(blendFrames&&index>=poses.length-blendFrames){
   const t=(index-(poses.length-blendFrames)+1)/blendFrames;
   actor.fromArray(blend(raw.actorMatrix,poses[0].actorMatrix,t));
   for(let j=0;j<bones.length;j++)bones[j].localMatrix=blend(raw.bones[j].localMatrix,poses[0].bones[j].localMatrix,t);
   // Blend local posture, never pull the traveling pelvis back to the start.
   const resultingRoot=matrix(bones[root].localMatrix).premultiply(actor).elements;
   actor.elements[12]+=points[index][0]-resultingRoot[12];actor.elements[14]+=points[index][2]-resultingRoot[14];
  }
  if(mode==='cycle'){actor.elements[12]+=cycle*delta[0];actor.elements[14]+=cycle*delta[2];}
  else{
   const d=cycle*length+distance[index],angle=d/radius;
   const desired=pathPoint(d);
   const warp=new THREE.Matrix4().makeTranslation(desired[0],0,desired[2]).multiply(new THREE.Matrix4().makeRotationY(angle)).multiply(new THREE.Matrix4().makeTranslation(-points[index][0],0,-points[index][2]));
   actor.premultiply(warp);
  }
  return {frame:index,time:index/adapter.fps,actorMatrix:actor.toArray(),bones,derived:true};
 }
 return Object.freeze({frames:adapter.frames,fps:adapter.fps,jointNames:adapter.jointNames,frame,pathPoint,guidePoints,
  identity:Object.freeze({sourceDistance:length,radius,seam:{kind:blendFrames?'derived-pose-crossfade':'unblended-repeat',frames:blendFrames},path:'flat-circular-rail',contactSolver:false})});
}
