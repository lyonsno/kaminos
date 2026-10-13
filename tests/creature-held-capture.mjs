// kaminos-test: node
import assert from 'node:assert/strict';
import './creature-body-fixture.mjs';
import * as contribution from '../experiments/creature-motion/retained.experiment.mjs';
import * as THREE from '../lib/three.core.js';
assert.equal(typeof contribution.withHeldCreatureFrame,'function','Creature contribution lacks the explicit hold/present/capture/restore operation');
const {withHeldCreatureFrame}=contribution;
function fixture(){
 let state={status:'playing',frame:12,time:.4,rootUuid:'root-one',clipName:'trot',
  source:{source_sha256:'a'.repeat(64),frames:60,fps:30,retargeted:false},
  asset:{id:'one',requested:'/body.glb'},view:{position:[1,2,3],target:[0,0,0],up:[0,1,0],fov:45,zoom:1,near:.01,far:100}};
 const calls=[];
 const entry={state:()=>({id:'marionette/retained-creature'}),read:async()=>structuredClone(state),
  async invoke(name,input){calls.push(name);if(name==='hold'){const priorStatus=state.status;state={...state,status:'paused',frame:input.frame??state.frame};return {priorStatus,state:structuredClone(state),inputs:{asset:'/body.glb',source_sha256:state.source.source_sha256,clip:'trot',frame:state.frame,view:structuredClone(state.view)}};}
   if(name==='resume'){state.status='playing';return structuredClone(state);}throw Error('unknown operation');}};
 return {entry,calls,state:()=>state,change:patch=>state={...state,...patch}};
}
{
 const f=fixture(),state=f.entry.state;f.entry.state=async()=>state();
 const result=await withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>({report:'node-page-bridge'})});
 assert.equal(result.restore.status,'resumed');
}
{
 const f=fixture();let presented=false;
 const result=await withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{presented=true;},
  capture:async held=>{assert.equal(presented,true);assert.equal(f.state().frame,30);assert.equal(f.state().status,'paused');assert.equal(held.inputs.frame,30);return {report:'/retained/report.json'};}});
 assert.equal(result.restore.status,'resumed');assert.equal(f.state().status,'playing');
 assert.equal(result.retained.report,'/retained/report.json');assert.deepEqual(f.calls,['hold','resume']);
}
{
 const f=fixture(),failure=Error('PNG retention failed');
 await assert.rejects(withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>{throw failure;}}),error=>error===failure&&error.restore.status==='resumed');
 assert.equal(f.state().status,'playing');
}
{
 const f=fixture();
 const result=await withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>{f.change({rootUuid:'replacement',asset:{id:'two',requested:'/body.glb'}});return {report:'preserved'};}}).catch(error=>error);
 assert.match(result.message,/changed/);assert.equal(result.retained.report,'preserved');assert.equal(result.restore.status,'skipped-changed');
 assert.deepEqual(f.calls,['hold'],'replacement owner must not receive a stale resume');
}
{
 const f=fixture();f.change({status:'paused'});
 const result=await withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>({report:'paused'})});
 assert.equal(result.restore.status,'not-needed');assert.equal(f.state().status,'paused');
}
{
 const f=fixture(),resume=f.entry.invoke;f.entry.invoke=async(name,input)=>{if(name==='resume')throw Error('resume failed');return resume(name,input);};
 const result=await withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>({report:'retained-despite-restore'})});
 assert.equal(result.retained.report,'retained-despite-restore');assert.equal(result.restore.status,'failed');assert.match(result.restore.error,/resume failed/);
}
{
 const f=fixture();await assert.rejects(withHeldCreatureFrame({entry:f.entry,frame:-1,present:async()=>{},capture:async()=>{}}),/frame/);assert.deepEqual(f.calls,[]);
 const changed=fixture();await assert.rejects(withHeldCreatureFrame({entry:changed.entry,frame:30,present:async()=>changed.change({frame:31}),capture:async()=>assert.fail('wrong frame reached image retention')}),/changed/);
 assert.deepEqual(changed.calls,['hold']);
}
{
 const f=fixture(),invoke=f.entry.invoke;
 f.entry.invoke=async(name,input)=>{if(name==='hold')f.change({rootUuid:'replacement-before-hold',asset:{id:'replacement',requested:'/body.glb'}});return invoke(name,input);};
 await assert.rejects(withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>assert.fail('replacement reached capture')}),/changed/);
 assert.deepEqual(f.calls,['hold'],'replacement before hold must not receive stale restoration');
}
{
 const f=fixture();await assert.rejects(withHeldCreatureFrame({entry:f.entry,frame:30,present:async()=>{},capture:async()=>undefined}),/retention.*report/);
 assert.equal(f.state().status,'playing');
}
console.log('Explicit creature hold/present/capture/restore preserves evidence, prior pause and replacement-owner custody');

// Review F3: the real controller deliberately does not resume an exhausted clip.
{
 const scene=new THREE.Scene(),root=new THREE.Group(),bone=new THREE.Object3D();bone.name='pelvis';root.add(bone);scene.add(root);
 root.userData.native_motion={source_sha256:'a'.repeat(64),frames:60,fps:30,retargeted:false};
 const clip=new THREE.AnimationClip('trot',59/30,[new THREE.VectorKeyframeTrack('pelvis.position',[0,59/30],[0,0,0,0,0,1])]);
 const session={loadAsset:async()=>({id:'endpoint',root,clips:[clip],source:'/body.glb'}),onFrame:()=>()=>{},redraw:()=>{},readView:()=>({}),setView:()=>{},dispose:async()=>scene.remove(root)};
 const owner=await contribution.default.create({host:{scene:{open:()=>session}},inputs:{asset:'/body.glb',source_sha256:'a'.repeat(64)}});
 try {
  owner.operations.seek({frame:30});owner.operations.resume();
  const entry={state:()=>({id:'marionette/retained-creature'}),read:owner.read,invoke:(name,input)=>owner.operations[name](input)};
  const result=await withHeldCreatureFrame({entry,frame:59,present:async()=>{},capture:async()=>({report:'endpoint-retained'})});
  assert.equal(owner.read().status,'held');
  assert.equal(result.restore.status,'endpoint-held','exhausted source is not resumed playback');
  assert.equal(result.restore.effective.status,'held');assert.equal(result.restore.effective.frame,59);
 }finally{await owner.dispose();}
}
