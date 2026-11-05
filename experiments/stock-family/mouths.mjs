import {Matrix4,Vector3,Quaternion,Euler} from '../../lib/three.core.js';

export function stockMouths(profile,value){
  const mouths=value===undefined?{start:{station:profile.min,x:Math.max(profile.xMin,Math.min(0,profile.xMax)),y:0},end:{station:profile.max,x:Math.max(profile.xMin,Math.min(0,profile.xMax)),y:0}}:structuredClone(value);
  for(const side of ['start','end']){
    const m=mouths?.[side];
    if(!m||![m.station,m.x,m.y].every(Number.isFinite))throw Error('Mouth needs finite station, X and Y');
    if(m.station<profile.min||m.station>profile.max||m.x<profile.xMin||m.x>profile.xMax)throw Error('Mouth is outside the source profile');
  }
  if(mouths.start.station>=mouths.end.station)throw Error('Mouth stations must be ordered');
  return mouths;
}

export function stockMouthFrame(warp,profile,mouths,side){
  if(!['start','end'].includes(side))throw Error('Unknown stock mouth');
  const m=stockMouths(profile,mouths)[side],q=warp.point([m.x,m.y,m.station]);
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),q.theta+(side==='start'?Math.PI:0));
  return {position:q.position,quaternion:rotation.toArray()};
}
function frameMatrix(frame){return new Matrix4().compose(new Vector3(...frame.position),new Quaternion(...frame.quaternion),new Vector3(1,1,1));}
function rigidScale(matrix){
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();matrix.decompose(position,rotation,scale);
  const rebuilt=new Matrix4().compose(position,rotation,scale),s=scale.toArray();
  if(!matrix.elements.every(Number.isFinite)||s.some(v=>v<=0)||s.some(v=>Math.abs(v-s[0])>1e-7*Math.max(1,...s))||matrix.elements.some((v,i)=>Math.abs(v-rebuilt.elements[i])>1e-7*Math.max(1,Math.abs(v))))throw Error('Mouth alignment requires positive uniform scale without shear');
  return {position,rotation,scale};
}
export function alignStockMouth({moving,target,movingWorld,targetWorld,parentWorld=new Matrix4()}){
  const current=rigidScale(movingWorld);rigidScale(targetWorld);rigidScale(parentWorld);
  const targetFrame=targetWorld.clone().multiply(frameMatrix(target)),fixed=rigidScale(targetFrame);
  // The mouths face each other, with their section-up axes agreeing.
  const rotation=fixed.rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI)).multiply(new Quaternion(...moving.quaternion).invert());
  const position=fixed.position.sub(new Vector3(...moving.position).multiply(current.scale).applyQuaternion(rotation));
  const local=parentWorld.clone().invert().multiply(new Matrix4().compose(position,rotation,current.scale)),result=rigidScale(local),euler=new Euler().setFromQuaternion(result.rotation);
  return {position:result.position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:result.scale.toArray()};
}
export function stockMouthGap(moving,movingWorld,target,targetWorld){
  const a=frameMatrix(moving).premultiply(movingWorld),b=frameMatrix(target).premultiply(targetWorld);
  const normal=m=>new Vector3(0,0,1).transformDirection(m);
  const na=normal(a),nb=normal(b).negate();
  return {distance:new Vector3().setFromMatrixPosition(a).distanceTo(new Vector3().setFromMatrixPosition(b)),facingDegrees:Math.atan2(na.clone().cross(nb).length(),na.dot(nb))*180/Math.PI};
}
