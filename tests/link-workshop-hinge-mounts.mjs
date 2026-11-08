// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import * as H from '../experiments/link-workshop/hinge-primitives.mjs';
import {adjustSeating,seatingFrame} from '../experiments/link-workshop/seating.mjs';
import {attachmentBase,hingeWorldFrame,frameMatrix,previewMountMatrix} from '../experiments/link-workshop/mounts.mjs';
const close=(a,b,message)=>assert.ok(a.elements.every((v,i)=>Math.abs(v-b.elements[i])<1e-8),message);
const scene=new T.Scene(),root=new T.Group(),fixed=new T.Group(),moving=new T.Group();scene.add(root,fixed,moving);fixed.position.set(2,3,1);fixed.rotation.set(.2,.4,.1);moving.scale.set(1.2,.8,1.1);
const entries=[{id:'root',object:root},{id:'fixed',object:fixed},{id:'moving',object:moving}];
const model={schema:'kaminos.links.v1',period:3,nodes:[],pistons:[],mounts:[{id:'s',owner:{objectId:'moving'},position:[.3,.2,0],rotation:[.1,0,.3]},{id:'t',owner:{objectId:'fixed'},position:[.2,.4,.1],rotation:[.2,.3,0]}],attachments:[{objectId:'moving',sourceMount:'s',targetMount:'t',offset:{position:[0,0,0],rotation:[0,0,0],scale:moving.scale.toArray()},hinge:[0,.8],hardware:{family:'clevis',size:1,mounting:'part-frames'}}]};
const a=model.attachments[0],F={position:[-.61,0,0],rotation:[0,-Math.PI/2,0]},target=previewMountMatrix(root,model,'t',0,entries);
close(hingeWorldFrame(root,model,a,0,entries).multiply(frameMatrix(F)),target,'The actual fixed hardware mounting face must seat on the receiving mount');
assert.equal(typeof H.hingeMountFrames,'function');
for(const family of Object.keys(H.hingeFamilies)){
 a.hardware={family,size:.8,mounting:'part-frames'};const mounts=H.hingeMountFrames(a.hardware),parts=H.buildHingeParts(a.hardware);
 for(const [i,name]of ['fixed','moving'].entries()){
  const f=frameMatrix(mounts[name]),normal=new T.Vector3(0,0,i?-1:1).transformDirection(f),p=new T.Vector3().setFromMatrixPosition(f);parts[i].updateMatrixWorld(true);
  const hit=new T.Raycaster(p.clone().addScaledVector(normal,.05),normal.clone().negate()).intersectObject(parts[i],true)[0];assert.ok(hit&&Math.abs(hit.distance-.05)<1e-6,`${family} ${name} mount lies on its analytical mounting face`);
 }
 for(const t of [0,.37,1]){
  const axis=hingeWorldFrame(root,model,a,t,entries),base=attachmentBase(root,model,a,t,entries),world=base.clone().multiply(frameMatrix(a.offset));world.decompose(moving.position,moving.quaternion,moving.scale);moving.updateMatrixWorld(true);
  close(axis.clone().multiply(frameMatrix(mounts.fixed)),target,`${family} fixed half stays seated through swing`);
  const expected=axis.clone().multiply(new T.Matrix4().makeRotationZ(.8*t)).multiply(frameMatrix(mounts.moving));
  close(previewMountMatrix(root,model,'s',t,entries),expected,`${family} payload contact follows the actual moving hardware mount`);
 }
 const before=seatingFrame(root,model,'moving',0,entries),mountNormal=new T.Vector3(0,0,1).transformDirection(hingeWorldFrame(root,model,a,0,entries).multiply(frameMatrix(mounts.moving))),oldPoint=new T.Vector3().setFromMatrixPosition(before),rotation=new T.Euler().setFromRotationMatrix(before),adjusted=adjustSeating(root,model,'moving',0,entries,{position:oldPoint.clone().add(mountNormal).toArray(),rotation:[rotation.x,rotation.y,rotation.z],mode:'build'});
 assert.ok(new T.Vector3().setFromMatrixPosition(seatingFrame(root,adjusted,'moving',0,entries)).distanceTo(oldPoint)<1e-8,`${family} seating uses the moving hardware face, including a flange perpendicular to its fixed face`);
 parts.forEach(H.disposePart);
 const packet=H.exportHinge(a.hardware);for(const part of packet.parts.filter(p=>p.id!=='pin'))assert.deepEqual(part.mount,mounts[part.id],'Known attachment frames survive the part export seam');
}
console.log('Analytical mounting faces seat fixed and moving bodies through arbitrary rigid frames and authored swing');
// Hardware already supplies identified mounting patches and its real axle;
// generic circular markers would look like additional, conflicting hinge axes.
const {createMountView}=await import('../experiments/link-workshop/mount-view.mjs');
const markers=createMountView(root);markers.update(model,0,entries,null,true,false,null,'moving');
assert.equal(markers.object('s').visible,false,'Analytical hardware hides redundant generic mount rings');
markers.update(model,0,entries,'s',true,false,null,'moving');assert.equal(markers.object('s').visible,true,'Direct mount editing still exposes its native selectable mount');markers.dispose();
