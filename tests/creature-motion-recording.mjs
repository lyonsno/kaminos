// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/creature-motion/retained.experiment.mjs';
import {createOwnerSceneSession} from '../owner-scene-session.mjs';
import {createInvestigationRecording,investigationOperations} from '../investigation-recording.mjs';

const scene=new THREE.Scene(),root=new THREE.Group(),bone=new THREE.Object3D();
bone.name='pelvis';root.add(bone);scene.add(root);
const source={frames:31,fps:30,source_sha256:'a'.repeat(64),retargeted:false};
root.userData.native_motion=source;
const clip=new THREE.AnimationClip('recorded source',1,[new THREE.VectorKeyframeTrack('pelvis.position',[0,1],[0,0,0,0,0,.6])]);
const callbacks=new Set();let view={position:[1,2,3],target:[0,0,0]};
const session=createOwnerSceneSession({loadAsset:async()=>({id:'body',root,clips:[clip],source:'/body.glb',owned:true}),
 attach:()=>{},remove:()=>scene.remove(root),redraw:()=>{},readView:()=>view,setView:next=>view=next,
 onFrame:callback=>(callbacks.add(callback),()=>callbacks.delete(callback))});
const owner=await definition.create({host:{scene:{open:()=>session}},inputs:{asset:'/body.glb',source_sha256:source.source_sha256},record:operation=>investigationOperations.emit(operation)});
const recording=createInvestigationRecording({id:'creature-events',source:{route:'actual-owner/shared-recorder'},
 initial:owner.read(),startingConditions:{kind:'retained-source-frame'}});
try {
 owner.operations.seek({frame:15});
 let prefix=recording.snapshot();
 assert.equal(prefix.complete,true,'requested creature operation must be retained, not dropped as malformed');
 assert.deepEqual(prefix.operations.map(row=>row.phase),['requested','applied']);
 assert.equal(prefix.operations[0].effective.frame,0,'requested phase retains observed pre-operation state');
 assert.equal(prefix.operations[1].effective.frame,15);
 assert.throws(()=>owner.operations.seek({frame:-1}),/outside/);
 prefix=recording.snapshot();
 assert.equal(prefix.complete,true,'failed creature operation must retain its error and actual state');
 assert.deepEqual(prefix.operations.map(row=>row.phase),['requested','applied','requested','failed']);
 assert.equal(prefix.operations[3].effective.frame,15);
 assert.match(prefix.operations[3].error,/outside/);
 assert.deepEqual(prefix.issues,[]);
 owner.operations.resume();
 for(const deltaSeconds of [0,.1])for(const tick of [...callbacks])tick({deltaSeconds});
 const before=owner.read(),held=owner.operations.hold();
 assert.equal(held.priorStatus,'playing');assert.equal(held.inputs.frame,before.frame);
 assert.equal(owner.read().status,'paused');assert.equal(callbacks.size,0);
} finally {recording.finish();await owner.dispose();}
console.log('Actual creature producer retains requested/applied/failed phases and current-frame hold through shared recorder');
