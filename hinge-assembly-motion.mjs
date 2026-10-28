import {Quaternion,Vector3} from './lib/three.core.js';

export function hingePartPose({home,exploded,role,origin,axis,angleDegrees,separation,offset}) {
  for(const v of [home,exploded,origin,axis,offset])if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error('Hinge frame requires finite XYZ vectors');
  if(!['fixed-fork','rotating-hub','axle-pin'].includes(role))throw Error('Unknown hinge part role');
  if(!Number.isFinite(angleDegrees)||!Number.isFinite(separation)||separation<0)throw Error('Finite angle and nonnegative separation required');
  const a=new Vector3(...axis);if(a.lengthSq()===0)throw Error('Hinge axis must be nonzero');
  const q=new Quaternion();
  const position=new Vector3(...home).addScaledVector(new Vector3(...exploded),separation-1);
  if(role==='rotating-hub'){
    q.setFromAxisAngle(a.normalize(),angleDegrees*Math.PI/180);
    position.sub(new Vector3(...origin)).applyQuaternion(q).add(new Vector3(...origin));
  }
  position.add(new Vector3(...offset));
  return {position:position.toArray(),quaternion:q.toArray()};
}
