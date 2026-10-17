// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLivingScene} from '../experiments/creature-motion/living-scene.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene(),callbacks=new Set();let serial=0;
const host={controls:{document},scene:{refreshPresentation(){},objects:()=>[],async open(){const owned=new Set(),stops=new Set();return {async attach(root){owned.add(root);scene.add(root);return {id:'object-'+(++serial),root};},onFrame(fn){callbacks.add(fn);const stop=()=>callbacks.delete(fn);stops.add(stop);return stop;},redraw(){},readView:()=>({}),setView(){},async dispose(){for(const stop of stops)stop();for(const root of owned)root.removeFromParent();}};}}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const transform={position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]},creature={case:'skin',case_sha256:'c'.repeat(64),motion:'motion',motion_sha256:'a'.repeat(64),frame:'frame',frame_sha256:'b'.repeat(64),blend_frames:0,transform,action:'wander',play:false};
const setup={running:false,zones:[{id:'yard',label:'Courtyard',transform:{...transform,scale:[4,1,4]}}],actors:['one','two'].map(id=>({id,label:id,active:true,places:[{zoneId:'yard',enabled:true,preference:1}],creature}))};
const deps={loadSources:async()=>data};const room=await createLivingScene({host,inputs:setup},deps);
assert.equal(typeof room.operations.setRunning,'function','Scene run/hold is not distinct from selected-clip playback');
assert.equal(callbacks.size,0);await room.operations.setRunning({running:true});assert.equal(callbacks.size,2);
await room.operations.setActive({id:'one',active:false});assert.equal(callbacks.size,1);
const held=room.read().actors.find(a=>a.id==='one').state.action.motion;for(const fn of callbacks)fn({deltaSeconds:.1});assert.deepEqual(room.read().actors.find(a=>a.id==='one').state.action.motion,held);
await room.operations.setRunning({running:false});assert.equal(callbacks.size,0);assert.deepEqual(room.read().actors.map(a=>a.active),[false,true],'Scene pause rewrote actor preferences');
await room.operations.setRunning({running:true});assert.equal(callbacks.size,1);
await room.operations.setPlaces({id:'two',places:[{zoneId:'yard',enabled:false,preference:1}]});assert.equal(callbacks.size,0,'All-disabled places fell back to another region');
assert.match(room.read().actors.find(a=>a.id==='two').behavior.status,/zone|place/i);
await room.operations.setPlaces({id:'two',places:[{zoneId:'yard',enabled:true,preference:2}]});assert.equal(callbacks.size,1);
const before=room.read();await assert.rejects(()=>room.operations.setPlaces({id:'two',places:[{zoneId:'invented',enabled:true,preference:1}]}),/zone/i);assert.deepEqual(room.read(),before);
const saved=room.read().recipe;await room.dispose();assert.equal(callbacks.size,0);assert.equal(scene.children.length,0);
const reopened=await createLivingScene({host,inputs:saved},deps);assert.deepEqual(reopened.read().actors.map(a=>({id:a.id,active:a.active,places:a.places})),before.actors.map(a=>({id:a.id,active:a.active,places:a.places})));
assert.deepEqual(reopened.read().actors[1].state.action.motion,before.actors[1].state.action.motion,'Reopening changed active path/RNG continuation');
await reopened.dispose();assert.equal(scene.children.length,0);
await assert.rejects(()=>createLivingScene({host,inputs:{...setup,actors:[{...setup.actors[0],places:[{zoneId:'missing',enabled:true,preference:1}]}]}},deps),/zone/i);assert.equal(scene.children.length,0,'Invalid references leaked a scene');
console.log('Scene run gate, persistent local hold, shared zones, missing/all-disabled references and exact continuation');
