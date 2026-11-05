// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createFasteningView} from '../experiments/link-workshop/fastening-view.mjs';
import {identityFrame} from '../experiments/link-workshop/mounts.mjs';
const root=new T.Group(),moving=new T.Group(),fixed=new T.Group(),scene=new T.Scene();scene.add(root,moving,fixed);
const entries=[{id:'root',object:root},{id:'moving',object:moving},{id:'fixed',object:fixed}];
const recipe={schema:'kaminos.links.v1',nodes:[],pistons:[],period:3,mounts:[{id:'s',owner:{objectId:'moving'},position:[0,0,0],rotation:[0,0,0]},{id:'t',owner:{objectId:'fixed'},position:[0,0,0],rotation:[0,0,0]}],attachments:[{objectId:'moving',sourceMount:'s',targetMount:'t',offset:identityFrame(),hinge:[0,1],hardware:{family:'clevis',size:1}}]};
const view=createFasteningView(root);
view.update(recipe,0,entries,'moving');
const parts=[];view.group.traverse(o=>{if(o.userData.hingePart)parts.push(o.userData.hingePart);});
assert.deepEqual(parts.map(p=>p.id).sort(),['fixed','moving','pin'],'analytical hinges expose independent rigid part slots');
const firstGeometry=[];view.group.traverse(o=>{if(o.userData.hingePart)o.traverse(m=>{if(m.geometry)firstGeometry.push(m.geometry);});});view.update(structuredClone(recipe),.5,entries,'moving');const secondGeometry=[];view.group.traverse(o=>{if(o.userData.hingePart)o.traverse(m=>{if(m.geometry)secondGeometry.push(m.geometry);});});assert.ok(firstGeometry.every((g,i)=>g===secondGeometry[i]),'pose edits reuse unchanged analytical geometry');view.dispose();
const {buildHingeParts,exportHinge,importHinge,disposePart}=await import('../experiments/link-workshop/hinge-primitives.mjs');
const {checkedMechanism}=await import('../experiments/link-workshop/model.mjs');
const {hingeWorldFrame,attachmentBase,frameMatrix}=await import('../experiments/link-workshop/mounts.mjs');
for(const family of ['clevis','knuckle','flange']){
 const h={family,size:.8},packet=exportHinge(h);assert.equal(packet.parts.length,3);
 const objects=buildHingeParts(h);for(const p of objects){p.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(p);assert.ok(!bounds.isEmpty());}
 for(const part of objects.filter(p=>p.userData.hingePart.id!=='pin')){
  const ray=new T.Raycaster(new T.Vector3(0,0,-5),new T.Vector3(0,0,1));assert.equal(ray.intersectObject(part,true).length,0,'moving and fixed halves retain an open coaxial bore');
 }
 packet.parts.find(p=>p.id==='moving').object.materials[0].color=0xff00ff;
 const returned=importHinge(h,packet),returnedObjects=buildHingeParts(returned);assert.ok((()=>{let found=false;returnedObjects[1].traverse(c=>{if(c.material?.color.getHex()===0xff00ff)found=true;});return found;})());
 assert.throws(()=>importHinge({...h,size:2},packet),/different/);assert.throws(()=>importHinge(h,{...packet,parts:[packet.parts[0],packet.parts[0],packet.parts[2]]}),/distinct/);
 const saved=checkedMechanism({...recipe,attachments:[{...recipe.attachments[0],hardware:returned,axle:{position:[.3,.4,0],rotation:[Math.PI/2,0,0]}}]});assert.equal(JSON.parse(JSON.stringify(saved)).attachments[0].hardware.parts.moving.materials[0].color,0xff00ff);
 objects.forEach(disposePart);returnedObjects.forEach(disposePart);
}
const a=recipe.attachments[0];a.axle={position:[.5,0,0],rotation:[Math.PI/2,0,0]};a.hinge=[0,Math.PI/2];
const base=attachmentBase(root,recipe,a,0,entries).multiply(frameMatrix(a.offset)),end=attachmentBase(root,recipe,a,1,entries).multiply(frameMatrix(a.offset));
const pivot=new T.Vector3().setFromMatrixPosition(hingeWorldFrame(root,recipe,a,0,entries));assert.ok(pivot.distanceTo(new T.Vector3(.5,0,0))<1e-8);
const normal=new T.Vector3(0,0,1).transformDirection(hingeWorldFrame(root,recipe,a,0,entries));assert.ok(normal.distanceTo(new T.Vector3(0,-1,0))<1e-8);
const expected=new T.Vector3().setFromMatrixPosition(base).sub(pivot).applyAxisAngle(normal,Math.PI/2).add(pivot);assert.ok(expected.distanceTo(new T.Vector3().setFromMatrixPosition(end))<1e-8,'payload orbits authored pivot and axis');
console.log('Three bored hinge families retain independent part slots, distinct appearance returns, canonical serialization and custom pivot/axis motion');

const packet=exportHinge({family:'clevis',size:1});const part=packet.parts.find(p=>p.id==='moving');part.object.object.matrixAutoUpdate=false;part.object.object.matrix[12]=2;const h=importHinge({family:'clevis',size:1},packet);recipe.attachments[0].hardware=h;recipe.attachments[0].axle=undefined;const returnedView=createFasteningView(root);returnedView.update(recipe,0,entries,'moving');let wrapper;returnedView.group.traverse(o=>{if(o.userData.hingePart?.id==='moving')wrapper=o;});const returned=wrapper.children[0];returnedView.group.updateMatrixWorld(true);const start=returned.matrixWorld.clone();assert.ok(Math.abs(new T.Vector3().setFromMatrixPosition(start).x-2)<1e-8,'return retains root-local placement');returnedView.update(recipe,1,entries,'moving');returnedView.group.updateMatrixWorld(true);assert.ok(!returned.matrixWorld.equals(start),'fixed-matrix returned root moves through the driven wrapper');returnedView.dispose();
