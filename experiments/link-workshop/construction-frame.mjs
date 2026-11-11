import * as T from '../../lib/three.core.js';
import {rigidFrame} from './held-pose.mjs';
import {frameMatrix} from './mounts.mjs';
// Capture once per native gesture. Numbers remain in authored part coordinates;
// mouse motion is measured in the world frame the gesture actually began in.
export function constructionFrame(matrix){
 const frame=matrix.clone(),inverse=frame.clone().invert(),q=new T.Quaternion();frame.decompose(new T.Vector3(),q,new T.Vector3());q.normalize();
 const convert=(pose,back)=>{const rotation=new T.Quaternion().setFromEuler(new T.Euler(...pose.rotation));rotation.premultiply(back?q.clone().invert():q);const rigid=rigidFrame(new T.Matrix4().compose(new T.Vector3(...pose.position).applyMatrix4(back?inverse:frame),rotation,new T.Vector3(1,1,1)));return {...pose,...rigid,scale:[...pose.scale]};};
 return {toWorld:pose=>convert(pose,false),fromWorld:pose=>convert(pose,true)};
}
export const localHingePose=a=>({...rigidFrame(frameMatrix({position:a.axle?.position??[0,0,0],rotation:a.axle?.rotation??[0,0,0]}).multiply(frameMatrix(a.fixedMount).invert())),scale:[a.hardware.size,a.hardware.size,a.hardware.size]});
