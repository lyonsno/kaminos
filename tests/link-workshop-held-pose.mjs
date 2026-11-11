// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {emptyMechanism,checkedMechanism} from '../experiments/link-workshop/model.mjs';
import {frameMatrix,previewMountMatrix,hingeWorldFrame} from '../experiments/link-workshop/mounts.mjs';
import {holdFrame,accommodateHeldPose} from '../experiments/link-workshop/held-pose.mjs';
const root=new T.Group(),entries=['fixed','one','two','door'].map(id=>({id,object:new T.Group(),type:'pbr'}));
const m={...emptyMechanism(),mounts:[],attachments:[]};
for(let i=0;i<3;i++){
 const source='s'+i,target='t'+i,objectId=entries[i+1].id;
 m.mounts.push({id:source,owner:{objectId},position:[0,0,0],rotation:[0,-Math.PI/2,0]},{id:target,owner:{objectId:entries[i].id},position:i?[1.1,0,0]:[0,0,0],rotation:[0,-Math.PI/2,0]});
 m.attachments.push({objectId,sourceMount:source,targetMount:target,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[[.6,-1,.4][i],[.7,-.7,.2][i]],hardware:{family:'clevis',size:.1,mounting:'part-frames'}});
}
const distance=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
for(const pose of ['A','B'])for(const edited of ['one','two','door']){
 const t=pose==='B'?1:0,base=checkedMechanism(m);base.poseHold={objectId:'door',pose,target:holdFrame(root,base,'door',t,entries)};
 const wanted=frameMatrix(base.poseHold.target),offsets=structuredClone(base.attachments.map(a=>a.offset));
 const candidate=structuredClone(base);candidate.attachments[['one','two','door'].indexOf(edited)].axle={position:[0,-.08,.12],rotation:[0,0,0]};
 const result=accommodateHeldPose(root,candidate,edited,t,entries),actual=previewMountMatrix(root,result.recipe,'s2',t,entries);
 assert.ok(distance(actual,wanted)<1e-7,`Editing ${edited} in Pose ${pose} holds the actual complete downstream mounting pose`);
 assert.equal(result.status,'held');assert.ok(result.positionError<1e-7);assert.ok(result.angleError<1e-7);
 assert.deepEqual(result.recipe.attachments.map(a=>a.offset),offsets,'Accommodation changes hinge angles, never payload attachment offsets');
 assert.deepEqual(result.recipe.attachments[['one','two','door'].indexOf(edited)].axle,candidate.attachments[['one','two','door'].indexOf(edited)].axle,'Requested installation is accepted without silently restoring the old hinge');
 assert.deepEqual(result.recipe.attachments.map(a=>a.hinge[1-t]),base.attachments.map(a=>a.hinge[1-t]),'The other authored pose is unchanged');
 assert.ok(result.recipe.attachments.some((a,i)=>Math.abs(a.hinge[t]-candidate.attachments[i].hinge[t])>.01),'Connected hinges actually accommodate');
 const far=structuredClone(base);far.attachments[0].axle={position:[0,0,10],rotation:[0,0,0]};const miss=accommodateHeldPose(root,far,'one',t,entries);assert.equal(miss.status,'unreachable');assert.ok(miss.positionError>1);assert.deepEqual(miss.recipe.attachments[0].axle,far.attachments[0].axle);
 const tilted=structuredClone(base);tilted.attachments[1].axle={position:[0,0,0],rotation:[0,.3,0]};assert.equal(accommodateHeldPose(root,tilted,'one',t,entries).status,'unsupported');
 const unrelated=accommodateHeldPose(root,candidate,'elsewhere',t,entries);assert.equal(unrelated.status,'unaffected');assert.deepEqual(unrelated.recipe,candidate);
}
const nearlyAligned=structuredClone(m);nearlyAligned.attachments[2].hinge[0]=.40006;const captured=holdFrame(root,nearlyAligned,'door',0,entries);assert.ok(distance(frameMatrix(captured),previewMountMatrix(root,nearlyAligned,'s2',0,entries))<1e-10,'Capturing a near-pole mounting orientation preserves small real rotations');
console.log('Actual mounted-panel pose, compensating hinges, preserved offsets/other pose, unreachable and unsupported controls pass');

const {createSceneEdits}=await import('../scene-edit-session.mjs'),{createSceneComponentEdit}=await import('../scene-component-edit.mjs'),{createMechanismController}=await import('../experiments/link-workshop.experiment.mjs');
const scene=new T.Scene();scene.add(root,...entries.map(e=>e.object));root.userData.linkMechanism=checkedMechanism(m);entries.push({id:'mechanism',object:root,type:'pbr'});let selected='mechanism';
const edits=createSceneEdits({read(){throw Error('ordinary edit');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}}),host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'mechanism',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root,mode:'A'}});
try{
 c.operations.selectConnection({objectId:'door'});c.operations.holdPose();const initial=c.read().recipe;assert.ok(distance(frameMatrix(initial.poseHold.target),entries.find(e=>e.id==='door').object.matrixWorld)<1e-7,'A panel hold captures the body pose independently of its editable mounting frame');const goal=entries.find(e=>e.id==='door').object.matrixWorld.clone();
 c.operations.editAxle({objectId:'one'});const target=components.target(),start=target.read();
 edits.begin(target.id);for(const dx of [.03,.07,.12]){edits.preview({position:[start.position[0]+dx,start.position[1],start.position[2]]});assert.equal(c.read().poseHold.status,'held');assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,goal)<1e-7,'The live scene body, not only the solver report, retains the held full pose');}edits.commit();const changed=c.read().recipe;assert.notDeepEqual(changed.attachments.map(a=>a.hinge),initial.attachments.map(a=>a.hinge));edits.undo();assert.deepEqual(c.read().recipe,initial);edits.redo();assert.deepEqual(c.read().recipe,changed);
 edits.begin(target.id);edits.preview({position:[start.position[0]+.2,start.position[1],start.position[2]]});edits.cancel();assert.deepEqual(c.read().recipe,changed,'Cancelling native construction restores the complete held mechanism');
 c.operations.editHeldPose();const held=components.target();assert.equal(held.type,'held-panel-pose');const h=held.read();edits.begin(held.id);edits.preview({position:[h.position[0]-.04,h.position[1]+.02,h.position[2]]});edits.commit();assert.equal(c.read().poseHold.status,'held');assert.ok(distance(frameMatrix(c.read().recipe.poseHold.target),entries.find(e=>e.id==='door').object.matrixWorld)<1e-7,'The native goal target moves the connected panel');edits.undo();assert.deepEqual(c.read().recipe,changed);

 for(const pose of ['A','B']){
  c.operations.mode({value:pose});c.operations.holdPose({objectId:'door'});
  const baseline=c.read().recipe,body=entries.find(e=>e.id==='door').object.matrixWorld.clone();
  for(const objectId of ['one','two','door']){
   c.operations.editAxle({objectId});const native=components.target(),before=native.read(),axis=c.operations.hingeFrames({objectId}).axle;
   assert.ok(distance(frameMatrix({...before,scale:[1,1,1]}),frameMatrix(axis))<1e-7,`Native ${objectId} axle uses live Pose ${pose}, not the other pose`);
   edits.begin(native.id);
   for(const dx of [.01,.025,.04]){
    edits.preview({position:[before.position[0]+dx,before.position[1],before.position[2]]});
    assert.equal(c.read().poseHold.status,'held',`${objectId} native construction in ${pose} retains the held pose`);
    assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7,`Live door remains held when editing ${objectId} in ${pose}`);
   }
   edits.commit();const result=c.read().recipe;assert.notDeepEqual(result,baseline);edits.undo();assert.deepEqual(c.read().recipe,baseline);edits.redo();assert.deepEqual(c.read().recipe,result);edits.undo();
   edits.begin(native.id);edits.preview({scale:before.scale.map(x=>x*1.1)});assert.equal(c.read().poseHold.status,'held',`${objectId} native resize accommodates in ${pose}`);assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7);edits.cancel();assert.deepEqual(c.read().recipe,baseline);
   edits.begin(native.id);edits.preview({rotation:[before.rotation[0],before.rotation[1],before.rotation[2]+.03]});assert.equal(c.read().poseHold.status,'held',`${objectId} native rotation accommodates in ${pose}`);assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7);edits.cancel();assert.deepEqual(c.read().recipe,baseline);
   c.operations.hingeHardware({objectId,size:baseline.attachments.find(a=>a.objectId===objectId).hardware.size*1.08});
   assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7,`${objectId} hardware sizing accommodates in ${pose}`);edits.undo();assert.deepEqual(c.read().recipe,baseline);
   c.operations.hingeHardware({objectId,family:'knuckle'});assert.equal(c.read().poseHold.status,'unsupported','Changing to a nonparallel hinge family reports its actual support boundary');edits.undo();assert.deepEqual(c.read().recipe,baseline);
   c.operations.editAxle({objectId});c.operations.editSeat();const seating=components.target(),seatStart=seating.read();
   edits.begin(seating.id);edits.preview({position:[seatStart.position[0]+.02,seatStart.position[1],seatStart.position[2]]});assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7,`${objectId} seating accommodates in ${pose}: ${JSON.stringify(c.read().poseHold)}`);edits.cancel();assert.deepEqual(c.read().recipe,baseline);
   components.back();
   for(const id of baseline.mounts.filter(m=>m.owner.objectId===objectId).map(m=>m.id)){
    c.operations.selectMount({id});const mount=components.target();assert.equal(mount.type,'mount');const start=mount.read();edits.begin(mount.id);edits.preview({position:[start.position[0]+.01,start.position[1],start.position[2]]});assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,body)<1e-7,`Editing mount ${id} in ${pose} keeps the actual held body still`);edits.cancel();assert.deepEqual(c.read().recipe,baseline);
   }
  }
 }
 c.operations.mode({value:'A'});c.operations.holdPose({objectId:'door'});
 const {mechanismRecordDomain}=await import('../experiments/link-workshop/record.mjs');assert.deepEqual(mechanismRecordDomain.check({mechanism:c.read().recipe}).mechanism.poseHold,c.read().recipe.poseHold,'Held targets survive ordinary scene record admission');
 assert.throws(()=>checkedMechanism({...changed,poseHold:{...changed.poseHold,target:{...changed.poseHold.target,position:[NaN,0,0]}}}),/Held pose/);
 c.operations.releasePose();assert.equal(c.read().recipe.poseHold,undefined);edits.undo();assert.ok(c.read().recipe.poseHold);
}finally{edits.clear();await c.dispose();}
console.log('Native continuous installation/goal edits, actual attached body, cancel, undo/redo, release and record roundtrip pass');
