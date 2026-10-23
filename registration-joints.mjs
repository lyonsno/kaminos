import * as T from './lib/three.core.js';

const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(`Invalid joint ${name}`);return new T.Vector3(...v);};
export function sourceJoints(scene){
 return (scene.actuators||[]).flatMap(a=>{
  const axis=vector(a.axis,'axis');if(!axis.lengthSq())throw Error('Invalid joint axis');axis.normalize();
  const base=vector(a.baseMount,'base mount'),moving=vector(a.movingMount,'moving mount'),hinge=vector(a.hinge,'hinge');
  const slide=moving.clone().sub(base);if(!slide.lengthSq())throw Error('Invalid slide axis');slide.normalize();
  return [['hinge','Boom hinge',hinge,axis],['base','Piston base pin',base,axis],['moving','Piston moving pin',moving,axis],['slide','Piston sliding axis',base.clone().lerp(moving,.5),slide]].map(([kind,label,center,direction])=>({id:`${a.id}:${kind}`,kind,label,center:center.toArray(),axis:direction.toArray(),source:'authored actuator'}));
 });
}
export function jointWorldFrame(source,joint){source.updateWorldMatrix(true,false);return {center:vector(joint.center,'center').applyMatrix4(source.matrixWorld).toArray(),axis:vector(joint.axis,'axis').transformDirection(source.matrixWorld).toArray()};}
/** Rigid center/axis match. Leaves axial roll and scale as authored, not inferred. */
export function snapSourceJoint(source,joint,guess){
 if(source.parent && !source.parent.matrixWorld.equals(new T.Matrix4()))throw Error('Joint snap requires an untransformed scene parent');
 if(source.scale.toArray().some(n=>!Number.isFinite(n)||n===0))throw Error('Joint snap requires nondegenerate source scale');
 source.updateWorldMatrix(true,false);guess.updateWorldMatrix(true,false);
 const from=jointWorldFrame(source,joint),to=guess.getWorldPosition(new T.Vector3()),axis=new T.Vector3(0,0,1).transformDirection(guess.matrixWorld);
 if(!axis.toArray().every(Number.isFinite)||axis.lengthSq()===0)throw Error('Invalid target guess axis; restore its scale with the native gizmo');
 const delta=new T.Quaternion().setFromUnitVectors(new T.Vector3(...from.axis),axis),rotation=delta.multiply(source.quaternion.clone());
 const local=vector(joint.center,'center').multiply(source.scale).applyQuaternion(rotation);
 return {position:to.sub(local).toArray(),rotation:new T.Euler().setFromQuaternion(rotation).toArray().slice(0,3),scale:source.scale.toArray()};
}
/** +Z is the visible/pickable axis. Ring marks its center plane. */
export function createJointMarker({color,radius=.06}){
 const root=new T.Group(),material=new T.MeshBasicMaterial({color,transparent:true,opacity:.9,depthTest:false,depthWrite:false});
 const ring=new T.Mesh(new T.TorusGeometry(radius,radius*.065,6,48),material);root.add(ring);
 const center=new T.Mesh(new T.SphereGeometry(radius*.13,10,8),material);root.add(center);
 const axis=new T.Mesh(new T.CylinderGeometry(radius*.035,radius*.035,radius*5,8),material);axis.rotation.x=Math.PI/2;root.add(axis);
 const tip=new T.Mesh(new T.ConeGeometry(radius*.13,radius*.45,10),material);tip.rotation.x=Math.PI/2;tip.position.z=radius*2.5;root.add(tip);
 root.traverse(n=>{n.renderOrder=40;n.castShadow=false;n.receiveShadow=false;});return root;
}
