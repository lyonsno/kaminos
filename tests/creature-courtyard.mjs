// kaminos-test: node
import assert from 'node:assert/strict';
import {validateCourtyardProgram} from '../experiments/creature-motion/courtyard.experiment.mjs';
const valid={duration:8,events:[{at:0,source:'fire',patch:{flow:0}},{at:2,source:'beacon',patch:{visible:true,scale:.5}}]};
assert.deepEqual(validateCourtyardProgram(valid),valid);
for(const event of [{at:0,source:'hidden-author-state',patch:{flow:1}},{at:0,source:'fire',patch:{scale:3}},{at:0,source:'fire',patch:{}},{at:0,source:'beacon',patch:{scale:NaN}},{at:0,source:'beacon',patch:{visible:'yes'}}])assert.throws(()=>validateCourtyardProgram({...valid,events:[event]}),'Invalid actuation must fail before applying any source change');
console.log('Courtyard rejects unknown, empty, mistyped and cross-source patches before actuation');
// Exercise the actual composition adapter with a small living-consumer double.
// Native rendering/creature behavior has a separate browser witness.
import * as THREE from '../lib/three.core.js';
import {createCourtyard} from '../experiments/creature-motion/courtyard.experiment.mjs';
const attached=[],frames=new Set(),scene=new THREE.Scene();let id=0,join,liveRunning=false,flow=1;
const session={async attach(root){scene.add(root);const asset={root,id:'court-'+(++id)};attached.push(asset);return asset;},onFrame(fn){frames.add(fn);return()=>frames.delete(fn);},setView(){},redraw(){},async dispose(){for(const a of attached)a.root.removeFromParent();frames.clear();}};
const host={controls:{document:{}},scene:{open:async()=>session}};
const room=await createCourtyard({host,inputs:{actors:[],zones:[],attention:{},program:valid,view:{}}},{openFlame:()=>({read:()=>({active:true,flow}),setControls:patch=>{flow=patch['volume-flow-rate'];}}),createLivingScene:async(_,dependencies)=>{join=dependencies;return {read:()=>({actors:[],running:liveRunning}),operations:{setRunning:async({running})=>{liveRunning=running;},advance:async({seconds})=>{for(const step of join.worldSteps(seconds))join.beforeStep(step);},replace:async()=>{}},mount(){},dispose:async()=>{}};}});
assert.equal(flow,0,'The first real world edit applies at the initial simulation boundary');
await room.operations.advance({seconds:2});assert.equal(room.read().sources.beacon.visible,true);assert.equal(room.read().sources.beacon.scale[0],.5);assert.equal(room.read().time,2);
const unchanged=room.read();assert.throws(()=>room.operations.program({...valid,events:[{at:1,source:'unknown',patch:{flow:1}}]}));assert.deepEqual(room.read(),unchanged,'Bad program cannot replace a valid live program');
room.operations.manual({source:'fire',patch:{flow:3}});await room.operations.advance({seconds:2});assert.equal(flow,3);assert.equal(room.read().program.time,2,'Manual intervention holds the event clock');assert.equal(room.read().time,4,'The world and creature clock still advance in manual mode');
room.operations.repeat();assert.equal(flow,0);assert.equal(room.read().automatic,true);assert.equal(room.read().program.time,0);assert.equal(room.read().time,4,'Repeating events cannot rewind consumer experience');
await room.operations.restart();assert.equal(room.read().time,0);assert.equal(liveRunning,false);
await room.operations.advance({seconds:17});for(const row of room.read().log.filter(x=>x.kind==='courtyard.event'))assert.equal(row.clock.program.time,row.effective.event.time,'Event evidence must retain its own simulation boundary, even in a long advance');
await room.dispose();assert.equal(scene.children.length,0);assert.equal(frames.size,0);
console.log('Actual courtyard adapter applies scheduled edits, holds automation for manual edits, preserves experience on repeat and releases its scene');
