// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {adjustSeating,seatingFrame} from '../experiments/link-workshop/seating.mjs';
import {mountMatrix,matrixFrame,identityFrame} from '../experiments/link-workshop/mounts.mjs';
import {createAttachmentFollower} from '../experiments/link-workshop/attachments.mjs';
import {transformPose} from '../scene-edit-session.mjs';
const scene=new T.Scene(),root=new T.Group(),receiver=new T.Object3D(),payload=new T.Object3D(),child=new T.Object3D();scene.add(root,receiver,payload,child);
receiver.position.set(3,4,5);receiver.rotation.set(.7,-.4,.6);receiver.scale.set(2,3,1);
payload.scale.set(1.3,.7,2);
let model={schema:'kaminos.links.v1',period:3,nodes:[],pistons:[],mounts:[{id:'s',owner:{objectId:'payload'},position:[.5,.4,-.2],rotation:[.2,-.1,.4]},{id:'t',owner:{objectId:'receiver'},position:[.3,0,.2],rotation:[-.4,.2,.1]},{id:'cs',owner:{objectId:'child'},position:[0,0,0],rotation:[0,0,0]},{id:'ct',owner:{objectId:'payload'},position:[0,1,0],rotation:[0,0,0]}],attachments:[{objectId:'payload',sourceMount:'s',targetMount:'t',offset:{...identityFrame(),scale:payload.scale.toArray()}},{objectId:'child',sourceMount:'cs',targetMount:'ct',offset:identityFrame()}]};
const entries=[{id:'root',object:root},{id:'receiver',object:receiver},{id:'payload',object:payload},{id:'child',object:child}],follower=createAttachmentFollower(root,()=>entries);
follower.update(model,0);const original=JSON.stringify(model),p=matrixFrame(seatingFrame(root,model,'payload',0,entries)),target=mountMatrix(root,model,'t',0,entries),q=new T.Quaternion().setFromRotationMatrix(target),normal=new T.Vector3(0,0,1).applyQuaternion(q),along=new T.Vector3(1,0,0).applyQuaternion(q),oldChild=child.position.clone();
const desiredQ=new T.Quaternion().setFromAxisAngle(normal,.45).multiply(new T.Quaternion().setFromEuler(new T.Euler(...p.rotation))),e=new T.Euler().setFromQuaternion(desiredQ);
model=adjustSeating(root,model,'payload',0,entries,{position:new T.Vector3(...p.position).addScaledVector(along,.7).addScaledVector(normal,9).toArray(),rotation:[e.x,e.y,e.z]});
assert.notEqual(JSON.stringify(model),original);follower.reset();follower.update(model,0);
const actual=matrixFrame(seatingFrame(root,model,'payload',0,entries)),delta=new T.Vector3(...actual.position).sub(new T.Vector3(...p.position));
assert.ok(Math.abs(delta.dot(normal))<1e-8);assert.ok(Math.abs(delta.dot(along)-.7)<1e-8);assert.ok(Math.abs(new T.Quaternion().setFromEuler(new T.Euler(...actual.rotation)).dot(desiredQ))>1-1e-8);assert.ok(child.position.distanceTo(oldChild)>.1,'dependent stock follows seating edits');
assert.ok(payload.scale.distanceTo(new T.Vector3(1.3,.7,2))<1e-8);
// An unconstrained view-axis rotation (nearly grazing the seat plane) still turns by the requested angle about the seat normal.
const grazingAxis=along.clone().multiplyScalar(.99).addScaledVector(normal,.14).normalize();
const baseSeat=matrixFrame(seatingFrame(root,model,'payload',0,entries)),baseQ=new T.Quaternion().setFromEuler(new T.Euler(...baseSeat.rotation));
const grazingQ=new T.Quaternion().setFromAxisAngle(grazingAxis,.35).multiply(baseQ),ge=new T.Euler().setFromQuaternion(grazingQ);
const expectedGrazingQ=new T.Quaternion().setFromAxisAngle(normal,.35).multiply(baseQ);
model=adjustSeating(root,model,'payload',0,entries,{position:baseSeat.position,rotation:[ge.x,ge.y,ge.z]});
follower.reset();follower.update(model,0);
const grazingActual=matrixFrame(seatingFrame(root,model,'payload',0,entries));
assert.ok(Math.abs(new T.Quaternion().setFromEuler(new T.Euler(...grazingActual.rotation)).dot(expectedGrazingQ))>1-1e-8,'grazing view-axis R must twist around the contact normal by the full requested angle');
// Multi-step interactive R previews keep base.recipe fixed while follower updates live object matrices each frame.
const dragBase={recipe:structuredClone(model),...matrixFrame(seatingFrame(root,model,'payload',0,entries))},dragStartQ=new T.Quaternion().setFromEuler(new T.Euler(...dragBase.rotation));
for(const angle of [-.4,-.2,.15,.3,.45]){
 const stepPose=transformPose(dragBase,{operation:'rotate',amount:angle,viewAxis:grazingAxis.toArray()});
 model=adjustSeating(root,dragBase.recipe,'payload',0,entries,{...dragBase,...stepPose});
 follower.reset();follower.update(model,0);
 const stepActual=matrixFrame(seatingFrame(root,model,'payload',0,entries)),expectedStepQ=new T.Quaternion().setFromAxisAngle(normal,angle).multiply(dragStartQ);
 assert.ok(Math.abs(new T.Quaternion().setFromEuler(new T.Euler(...stepActual.rotation)).dot(expectedStepQ))>1-1e-8,`multi-step R drag must track angle ${angle} monotonically without live-scene feedback`);
}
const persisted=JSON.parse(JSON.stringify(model)),before=payload.matrixWorld.clone();follower.dispose();const next=createAttachmentFollower(root,()=>entries);next.update(persisted,0);assert.ok(before.elements.every((v,i)=>Math.abs(v-payload.matrixWorld.elements[i])<1e-8));next.dispose();
console.log('Seating follows rotated/scaled receiver planes, turns about the contact normal, preserves payload scale and downstream attachments, and reconstructs from saved recipe');
