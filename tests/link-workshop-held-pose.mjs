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
for(const pose of ['A','B']){
 const t=pose==='B'?1:0,base=checkedMechanism(m);base.poseHold={objectId:'door',pose,target:holdFrame(root,base,'door',t,entries)};
 const wanted=frameMatrix(base.poseHold.target),offsets=structuredClone(base.attachments.map(a=>a.offset));
 const candidate=structuredClone(base);candidate.attachments[0].axle={position:[0,-.08,.12],rotation:[0,0,0]};
 const result=accommodateHeldPose(root,candidate,'one',t,entries),actual=previewMountMatrix(root,result.recipe,'s2',t,entries);
 assert.ok(distance(actual,wanted)<1e-7,'Changing upstream installation holds the actual complete downstream mounting pose');
 assert.equal(result.status,'held');assert.ok(result.positionError<1e-7);assert.ok(result.angleError<1e-7);
 assert.deepEqual(result.recipe.attachments.map(a=>a.offset),offsets,'Accommodation changes hinge angles, never payload attachment offsets');
 assert.deepEqual(result.recipe.attachments[0].axle,candidate.attachments[0].axle,'Requested installation is accepted without silently restoring the old hinge');
 assert.deepEqual(result.recipe.attachments.map(a=>a.hinge[1-t]),base.attachments.map(a=>a.hinge[1-t]),'The other authored pose is unchanged');
 assert.ok(result.recipe.attachments.some((a,i)=>Math.abs(a.hinge[t]-candidate.attachments[i].hinge[t])>.01),'Connected hinges actually accommodate');
 const far=structuredClone(base);far.attachments[0].axle={position:[0,0,10],rotation:[0,0,0]};const miss=accommodateHeldPose(root,far,'one',t,entries);assert.equal(miss.status,'unreachable');assert.ok(miss.positionError>1);assert.deepEqual(miss.recipe.attachments[0].axle,far.attachments[0].axle);
 const tilted=structuredClone(base);tilted.attachments[1].axle={position:[0,0,0],rotation:[0,.3,0]};assert.equal(accommodateHeldPose(root,tilted,'one',t,entries).status,'unsupported');
 const unrelated=accommodateHeldPose(root,candidate,'elsewhere',t,entries);assert.equal(unrelated.status,'unaffected');assert.deepEqual(unrelated.recipe,candidate);
}
console.log('Actual mounted-panel pose, compensating hinges, preserved offsets/other pose, unreachable and unsupported controls pass');

const {createSceneEdits}=await import('../scene-edit-session.mjs'),{createSceneComponentEdit}=await import('../scene-component-edit.mjs'),{createMechanismController}=await import('../experiments/link-workshop.experiment.mjs');
const scene=new T.Scene();scene.add(root,...entries.map(e=>e.object));root.userData.linkMechanism=checkedMechanism(m);entries.push({id:'mechanism',object:root,type:'pbr'});let selected='mechanism';
const edits=createSceneEdits({read(){throw Error('ordinary edit');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}}),host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'mechanism',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root,mode:'A'}});
try{
 c.operations.selectConnection({objectId:'door'});c.operations.holdPose();const initial=c.read().recipe,goal=entries.find(e=>e.id==='door').object.matrixWorld.clone();
 c.operations.editAxle({objectId:'one'});const target=components.target(),start=target.read();
 edits.begin(target.id);for(const dx of [.03,.07,.12]){edits.preview({position:[start.position[0]+dx,start.position[1],start.position[2]]});assert.equal(c.read().poseHold.status,'held');assert.ok(distance(entries.find(e=>e.id==='door').object.matrixWorld,goal)<1e-7,'The live scene body, not only the solver report, retains the held full pose');}edits.commit();const changed=c.read().recipe;assert.notDeepEqual(changed.attachments.map(a=>a.hinge),initial.attachments.map(a=>a.hinge));edits.undo();assert.deepEqual(c.read().recipe,initial);edits.redo();assert.deepEqual(c.read().recipe,changed);
 edits.begin(target.id);edits.preview({position:[start.position[0]+.2,start.position[1],start.position[2]]});edits.cancel();assert.deepEqual(c.read().recipe,changed,'Cancelling native construction restores the complete held mechanism');
 c.operations.editHeldPose();const held=components.target();assert.equal(held.type,'held-panel-pose');const h=held.read();edits.begin(held.id);edits.preview({position:[h.position[0]-.04,h.position[1]+.02,h.position[2]]});edits.commit();assert.equal(c.read().poseHold.status,'held');assert.ok(distance(frameMatrix(c.read().recipe.poseHold.target),entries.find(e=>e.id==='door').object.matrixWorld.clone().multiply(frameMatrix(m.mounts.find(v=>v.id==='s2'))))<1e-7,'The native goal target moves the connected panel');edits.undo();assert.deepEqual(c.read().recipe,changed);
 const {mechanismRecordDomain}=await import('../experiments/link-workshop/record.mjs');assert.deepEqual(mechanismRecordDomain.check({mechanism:changed}).mechanism.poseHold,changed.poseHold,'Held targets survive ordinary scene record admission');
 assert.throws(()=>checkedMechanism({...changed,poseHold:{...changed.poseHold,target:{...changed.poseHold.target,position:[NaN,0,0]}}}),/Held pose/);
 c.operations.releasePose();assert.equal(c.read().recipe.poseHold,undefined);edits.undo();assert.deepEqual(c.read().recipe,changed);
}finally{edits.clear();await c.dispose();}
console.log('Native continuous installation/goal edits, actual attached body, cancel, undo/redo, release and record roundtrip pass');
