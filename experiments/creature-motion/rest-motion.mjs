// A retained standing clip supplies posture; the journey still owns position
// and heading. No stopped gait frame or accumulated source drift drives it.
export function createRestMotion({THREE,adapter,blendSeconds=.3,seamFrames=Math.min(6,adapter.frames-1)}){
 if(!Number.isFinite(blendSeconds)||blendSeconds<=0)throw Error('Rest blend duration must be positive');
 if(!Number.isInteger(seamFrames)||seamFrames<1||seamFrames>=adapter.frames)throw Error('Rest seam must fit the retained clip');
 const poses=Array.from({length:adapter.frames},(_,i)=>adapter.frame(i));
 if(poses.length<2)throw Error('Rest requires a multi-frame retained motion');
 const root=poses[0].bones.findIndex(b=>b.parent===null);
 let amount=0,elapsed=0,resting=false;
 const matrix=a=>new THREE.Matrix4().fromArray(a);
 function blendMatrix(a,b,t){
  const ap=new THREE.Vector3(),aq=new THREE.Quaternion(),as=new THREE.Vector3(),bp=new THREE.Vector3(),bq=new THREE.Quaternion(),bs=new THREE.Vector3();
  matrix(a).decompose(ap,aq,as);matrix(b).decompose(bp,bq,bs);
  return new THREE.Matrix4().compose(ap.lerp(bp,t),aq.slerp(bq,t),as.lerp(bs,t)).toArray();
 }
 const blend=(a,b,t)=>({...a,actorMatrix:blendMatrix(a.actorMatrix,b.actorMatrix,t),bones:a.bones.map((row,i)=>{
  if(row.name!==b.bones[i]?.name||row.parent!==b.bones[i]?.parent)throw Error('Rest and locomotion Bone hierarchies differ');
  return {...row,localMatrix:blendMatrix(row.localMatrix,b.bones[i].localMatrix,t)};
 })});
 function advance(seconds,hold){
  if(!Number.isFinite(seconds)||seconds<0||typeof hold!=='boolean')throw Error('Rest requires explicit elapsed time and hold');
  if(hold&&!resting&&amount===0)elapsed=0;
  if(hold||amount>0)elapsed+=seconds;
  amount=Math.max(0,Math.min(1,amount+(hold?1:-1)*seconds/blendSeconds));resting=hold;
 }
 function frame(pose,reference){
  if(amount===0)return pose;
  const source=(elapsed*adapter.fps)%(poses.length-1),index=Math.floor(source),fraction=source-index;
  let target=blend(poses[index],poses[index+1],fraction);
  const seamStart=poses.length-1-seamFrames;
  if(source>seamStart)target=blend(target,poses[0],(source-seamStart)/seamFrames);
  const point=matrix(target.actorMatrix).multiply(matrix(target.bones[root].localMatrix)).elements;
  const origin=matrix(reference.actorMatrix).multiply(matrix(reference.bones[root].localMatrix)).elements;
  // Factor the actual journey warp out of this candidate, including proposed
  // contact poses. Do not consult a second, possibly older path position.
  const warp=matrix(pose.actorMatrix).multiply(matrix(reference.actorMatrix).invert()).multiply(new THREE.Matrix4().makeTranslation(origin[12],0,origin[14])).multiply(new THREE.Matrix4().makeTranslation(-point[12],0,-point[14]));
  target={...target,actorMatrix:warp.multiply(matrix(target.actorMatrix)).toArray()};
  const weight=amount*amount*(3-2*amount),result=blend(pose,target,weight),rows=new Map(result.bones.map(row=>[row.name,row]));
  const world=row=>row.worldMatrix=matrix(row.parent===null?result.actorMatrix:world(rows.get(row.parent))).multiply(matrix(row.localMatrix)).toArray();
  for(const row of result.bones)world(row);
  return {...result,derived:true};
 }
 return {advance,frame,read:()=>({resting,weight:amount,elapsed,blendSeconds,seamFrames,frames:adapter.frames,fps:adapter.fps,rootTravel:'journey-owned',sourceVertical:true})};
}
