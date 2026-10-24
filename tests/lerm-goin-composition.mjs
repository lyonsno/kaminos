// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGoinPursuit} from '../experiments/lerms/goin-pursuit.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...xs){this.children.push(...xs);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene(),ticks=new Set();
let opens=0,closes=0;
const host={controls:{document},scene:{refreshPresentation(){},async open(){opens++;const own=[];return {async attach(root){scene.add(root);own.push(root);return {id:root.uuid,root,owned:true};},onFrame(fn){ticks.add(fn);return ()=>ticks.delete(fn);},redraw(){},readView:()=>({}),setView(){},async dispose(){closes++;for(const root of own)root.removeFromParent();}};}}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const inputs={creature:{blend_frames:1,radius:10},goin:{position:[0,0,5]},running:false};
await assert.rejects(()=>createGoinPursuit({host,inputs:{...inputs,arrivalRadius:-1}}),/radius/);assert.equal(opens,0);
await assert.rejects(()=>createGoinPursuit({host,inputs},{loadSources:async()=>{throw Error('source digest mismatch');}}),/digest/);
assert.equal(scene.children.length,0);assert.equal(opens,closes);
const entry=await createGoinPursuit({host,inputs},{loadSources:async()=>data});
assert.equal(ticks.size,0);assert.equal(entry.read().route,'shared-owner-scene');
entry.operations.advance({seconds:1/30});assert.equal(entry.read().task.phase,'approaching');
assert.ok(entry.read().creature.action.motion.path.distance>0);
entry.operations.interruptTest({seconds:1});const before=entry.read().creature.action.motion.path.position;
entry.operations.advance({seconds:.5});assert.deepEqual(entry.read().creature.action.motion.path.position,before);
entry.operations.moveGoin({position:[3,0,4]});entry.operations.advance({seconds:.6});
assert.deepEqual(entry.read().task.destination,[3,0,4]);assert.notDeepEqual(entry.read().creature.action.motion.path.position,before);
const goin=scene.children.find(r=>r.name==='Goin');goin.visible=false;const held=entry.read().creature.action.motion.path.position;
entry.operations.advance({seconds:.5});assert.equal(entry.read().task.phase,'waiting-target');assert.deepEqual(entry.read().creature.action.motion.path.position,held);
goin.visible=true;entry.operations.moveGoin({position:[-5,0,5]});entry.operations.setRunning({running:true});assert.equal(ticks.size,1);
for(const tick of ticks)tick({deltaSeconds:1/30});assert.equal(entry.read().task.phase,'approaching');
await entry.dispose();assert.equal(ticks.size,0);assert.equal(scene.children.length,0);assert.equal(opens,closes);
assert.throws(()=>entry.operations.interruptTest(),/disposed/);
console.log('Live goin composition moves, interrupts, reacquires current targets and releases every owned session');
