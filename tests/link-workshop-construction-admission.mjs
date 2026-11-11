// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {emptyMechanism} from '../experiments/link-workshop/model.mjs';
import {frameMatrix} from '../experiments/link-workshop/mounts.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
async function fixture(count=3){
 const root=new T.Group(),scene=new T.Scene(),entries=['fixed','one','two','door'].map(id=>({id,type:'pbr',object:new T.Group()}));scene.add(root,...entries.map(e=>e.object));entries.push({id:'mechanism',type:'pbr',object:root});
 const m={...emptyMechanism(),mounts:[],attachments:[]};for(let i=0;i<count;i++){const objectId=entries[i+1].id;m.mounts.push({id:'s'+i,owner:{objectId},position:[-.36,0,1.02],rotation:[0,-Math.PI/2,0]},{id:'t'+i,owner:{objectId:entries[i].id},position:i?[.8,0,1.02]:[0,0,0],rotation:[0,-Math.PI/2,0]});m.attachments.push({objectId,sourceMount:'s'+i,targetMount:'t'+i,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[[.6,-1,.4][i],[.5,-.7,.2][i]],hardware:{family:'clevis',size:.15,mounting:'part-frames'}});}
 root.userData.linkMechanism=m;let selected='mechanism';const edits=createSceneEdits({read(){throw Error('ordinary read');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}});
 const host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'mechanism',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
 const c=await createMechanismController({host,inputs:{root,mode:'A'}});return {c,edits,components,entries};
}
test('moving an anchored selection refuses the conflicting request without displacing its goal or body',async()=>{
 const {c,edits,components,entries}=await fixture();try{
  c.operations.anchorConstruction({objectIds:['door']});c.operations.selectConstruction({objectIds:['door']});const target=components.target(),before=c.read().recipe,pose=target.read(),object=entries.find(e=>e.id==='door').object,world=object.matrixWorld.toArray();edits.begin(target.id);
  assert.throws(()=>edits.preview({position:[pose.position[0]+.1,...pose.position.slice(1)]}),/Free.*anchor|anchored.*Free/i);assert.deepEqual(c.read().recipe,before);assert.deepEqual(object.matrixWorld.toArray(),world);edits.cancel();
  c.operations.freeConstruction({objectIds:['door']});const free=components.target().read();edits.begin(target.id);assert.doesNotThrow(()=>edits.preview({position:[free.position[0]+.01,...free.position.slice(1)]}));edits.cancel();
 }finally{await c.dispose();}
});
test('seating gizmo and numeric coordinates denote the same body frame before the first drag',async()=>{
 const {c,edits,components}=await fixture();try{
  c.operations.anchorConstruction({objectIds:['door']});c.operations.editAxle({objectId:'two'});c.operations.editSeat();const target=components.target(),input=target.read(),world=target.coordinateFrame().toWorld(input);target.object.updateWorldMatrix(true,false);
  const actual=target.object.matrixWorld,expected=frameMatrix(world);assert.ok(actual.elements.every((v,i)=>Math.abs(v-expected.elements[i])<1e-9),'idle native gizmo must coincide with the world image of the authored coordinates');
  const before=c.read().recipe;edits.begin(target.id);edits.preview(target.coordinateFrame().fromWorld(world));edits.commit();assert.deepEqual(c.read().recipe,before,'a zero-distance gizmo event does not reseat or rotate the body');
 }finally{await c.dispose();}
});

test('one-axis Inspector input constrains that coordinate without requesting the old coordinates on a hinge arc',async()=>{
 const {c,edits,components}=await fixture(1);try{
  c.operations.construction();c.operations.selectConstruction({objectIds:['one']});const target=components.target(),start=target.read(),wanted=start.position[0]+.02;
  edits.begin(target.id,'Edit position.x');edits.preview({position:[wanted,...start.position.slice(1)],transformField:'position.x'});edits.commit();
  const result=c.read().recipe,accepted=components.target().read();assert.ok(Math.abs(accepted.position[0]-wanted)<1e-7,'reachable X is achieved while Y is free to follow the hinge arc');
  edits.begin(target.id,'Edit position.x');edits.preview({position:[wanted,...accepted.position.slice(1)],transformField:'position.x'});edits.commit();assert.deepEqual(c.read().recipe,result,'retyping the same coordinate after commit does not walk around the arc');
 }finally{await c.dispose();}
});
test('a rotation Inspector field requests its Euler coordinate without freezing the other achieved coordinates',async()=>{
 const {c,edits,components,entries}=await fixture(1);try{
  entries[0].object.rotation.set(.35,.4,0);const tilted=c.read().recipe;tilted.attachments[0].offset.rotation=[.2,.15,.3];c.operations.restore(tilted);c.operations.construction();c.operations.selectConstruction({objectIds:['one']});const target=components.target(),start=target.read(),wanted=start.rotation[0]+.01;
  edits.begin(target.id,'Edit rotation.x');edits.preview({rotation:[wanted,...start.rotation.slice(1)],transformField:'rotation.x'});edits.commit();const once=c.read().recipe,achieved=components.target().read();assert.ok(Math.abs(achieved.rotation[0]-wanted)<1e-7,JSON.stringify({wanted,achieved:achieved.rotation,request:c.read().construction.requested}));
  edits.begin(target.id,'Edit rotation.x');edits.preview({rotation:[wanted,...achieved.rotation.slice(1)],transformField:'rotation.x'});edits.commit();assert.deepEqual(c.read().recipe,once,'repeating a committed Euler coordinate does not walk through other coordinates');
 }finally{await c.dispose();}
});
