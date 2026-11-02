// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createPosedSkeleton} from '../experiments/creature-motion/posed-skeleton.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {Element,controlDocument} from './helpers/control-document.mjs';
import {sessionMotions,motionDigest,motionText} from '../experiments/creature-motion/motion-collection.mjs';
Element.prototype.replaceChildren=function(...nodes){this.children=[...nodes];};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I}];
const motion={status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',cooperative:true,controllerNorm:'valid-joints',assetCondSha256:'d'.repeat(64),frames:3,joints:1,skeleton:{name:'Fixture',fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,0,0,0,0,1,0,0,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]};
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion,source:{caseSha256:'a'.repeat(64),motionSha256:'b'.repeat(64),frameSha256:'c'.repeat(64)}};
const scene=new T.Scene(),document=controlDocument(),edits=createSceneEdits({read:()=>null,write:()=>{}});Object.assign(document.defaultView,{kaminosSceneEdits:edits,kaminosSelection:{set(){}}});
const callbacks=new Set();let provider,presentation;
const session={attach:async root=>{scene.add(root);return {id:root.uuid,root};},onFrame(fn){callbacks.add(fn);return()=>callbacks.delete(fn);},redraw(){},setView(){},readView:()=>({position:[3,2,3],target:[0,0,0]}),dispose:async()=>scene.clear()};
const host={controls:{document,components:{register:(_id,p)=>{provider=p;return {changed:f=>f(),dispose(){}};}},mountObject(p){presentation=p;return {dispose(){}};}},scene:{open:async()=>session}};
const entry=await createPosedSkeleton({host,inputs:{}},{loadSources:async()=>data});
try{
 assert.equal(typeof entry.operations.play,'function','Native posed creature must expose playback for retained generated motion');
 entry.mount({root:document.createElement('section'),document,invoke:(n,v)=>entry.operations[n](v)});
 assert(presentation.playback,'Playback uses the native selected-object dock');
 entry.operations.play();for(const fn of [...callbacks])fn({deltaSeconds:1/30});
 assert.equal(entry.read().playback.frame,1);assert.equal(entry.read().pose.pose.actor[14],1,'Actual same Bones/actor follow source');
 provider.enter();assert.equal(entry.read().playback.playing,false,'Entering native pose mode pauses motion');
 assert.equal(callbacks.size,0,'Paused motion releases the shared clock');
 entry.operations.rotate({joint:'pelvis',degrees:[25,0,0]});const held=entry.operations.snapshot();
 assert.equal(held.motionState.assigned.motion.frames,3,'Saved pose retains assigned generated motion');
 entry.operations.replay();entry.operations.seek({frame:2});assert.equal(entry.read().playback.frame,2);
 await entry.operations.restore(held);assert.deepEqual(entry.read().pose.pose,held.pose,'Reopening preserves the edited held frame');
 const wrong=await sessionMotions.add({...motion,assetCondSha256:'e'.repeat(64)}),before=entry.operations.snapshot();
 assert.throws(()=>entry.operations.assignMotion({id:wrong.id}),/another skeleton/);assert.deepEqual(entry.operations.snapshot(),before);
 const bad=structuredClone(held);bad.motionState.frame=999;assert.throws(()=>entry.operations.restore(bad),/frame/);assert.deepEqual(entry.operations.snapshot(),before,'Bad saved motion cannot partially change pose');
 entry.operations.seek({frame:0});const beforeEdit=entry.operations.snapshot();edits.begin(provider.target().id,'Rotate joint');
 for(const [name,input]of [['seek',{frame:2}],['step',{direction:1}],['replay'],['previewMotion',{id:beforeEdit.motionState.displayed.id}],['assignMotion',{id:beforeEdit.motionState.assigned.id}],['restoreMotion'],['restore',beforeEdit]])assert.throws(()=>entry.operations[name](input),/native.*edit/i,'Motion operations must respect an active native joint edit: '+name);
 edits.cancel();assert.deepEqual(entry.operations.snapshot().pose,beforeEdit.pose);assert.equal(entry.read().playback.frame,0);
 const importedMotion={...motion,prompt:'An independently reopened take',seed:742},importedId=await motionDigest(motionText(importedMotion)),imported=structuredClone(held);imported.motionState.assigned={id:importedId,motion:importedMotion};const previewMotion={...motion,prompt:'A separately reopened preview',seed:743},previewId=await motionDigest(motionText(previewMotion));imported.motionState.displayed={id:previewId,motion:previewMotion};
 assert.equal(sessionMotions.get(importedId),undefined);await entry.operations.restore(imported);assert(sessionMotions.get(importedId),'Opening a saved pose restores its take into the reusable motion collection');assert(sessionMotions.get(previewId));assert(sessionMotions.export().motions.some(r=>r.id===previewId));entry.operations.previewMotion({id:importedId});entry.operations.assignMotion({id:previewId});const stable=entry.operations.snapshot(),badDigest=structuredClone(stable);badDigest.motionState.assigned.id='f'.repeat(64);await assert.rejects(entry.operations.restore(badDigest),/digest/);assert.deepEqual(entry.operations.snapshot(),stable);
 const newA={...motion,prompt:'Rejected first unregistered take',seed:9031},newB={...motion,prompt:'Rejected second unregistered take',seed:9032},invalid=structuredClone(stable),beforeCollection=sessionMotions.export();invalid.motionState.assigned={id:await motionDigest(motionText(newA)),motion:newA};invalid.motionState.displayed={id:'9'.repeat(64),motion:newB};await assert.rejects(entry.operations.restore(invalid),/digest/);assert.deepEqual(sessionMotions.export(),beforeCollection,'Rejected pose restore must not publish embedded rows');assert.deepEqual(entry.operations.snapshot(),stable);
 let notifications=0;const unsubscribe=sessionMotions.subscribe(()=>notifications++);
 for(const role of ['assigned','displayed'])for(const id of [undefined,null,'','wrong',17,'g'.repeat(64)]){
  const rejected=structuredClone(stable);if(id===undefined)delete rejected.motionState[role].id;else rejected.motionState[role].id=id;
  const collectionBefore=sessionMotions.export(),countBefore=notifications;
  await assert.rejects(async()=>entry.operations.restore(rejected),/saved motion.*id/i);
  assert.deepEqual(entry.operations.snapshot(),stable);assert.deepEqual(sessionMotions.export(),collectionBefore);assert.equal(notifications,countBefore);
 }
 unsubscribe();
 entry.operations.replay();for(const fn of [...callbacks])fn({deltaSeconds:1});assert.equal(entry.read().playback.frame,2);assert.equal(callbacks.size,0,'Source endpoint holds and releases clock');
}finally{await entry.dispose();}assert.equal(callbacks.size,0);assert.equal(scene.children.length,0);
console.log('Native posed creature plays, pauses into editing, saves and restores actual motion, rejects wrong sources and releases its clock');
