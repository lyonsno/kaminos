// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLivingScene} from '../experiments/creature-motion/living-scene.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}setAttribute(){}remove(){}}
const scene=new THREE.Scene(),callbacks=new Set(),document={createElement:()=>new Element(),getElementById:()=>null};
const host={controls:{document},scene:{refreshPresentation(){},async open(){const owned=[],stops=[];return {async attach(root){scene.add(root);owned.push(root);return{id:root.uuid,root};},onFrame(fn){callbacks.add(fn);const stop=()=>callbacks.delete(fn);stops.push(stop);return stop;},redraw(){},readView:()=>({}),setView(){},async dispose(){stops.forEach(f=>f());owned.forEach(r=>r.removeFromParent());}};}}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]},{name:'spine-chest',parent:'pelvis',restMatrix:I.map((r,i)=>r.map((v,j)=>i===2&&j===3?1:v)),tail:[0,1,1]}];
const data={manifest:{bones,channels:['fixed','pelvis','spine-chest'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,0,1,0,0,1,0]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:2,skeleton:{fps:30,jointNames:['pelvis','spine-chest'],parents:[-1,0]},positions:[0,.2,0,0,.2,1,0,.2,.01,0,.2,1.01,0,.2,.02,0,.2,1.02],localRotations:Array.from({length:6},()=>[1,0,0,0]).flat()},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const recipe={encounters:{response:'physical',avoidance:false},actors:[{id:'a',label:'A',creature:{action:'wander',play:false,blend_frames:0,transform:{position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]}}},{id:'b',label:'B',creature:{action:'wander',play:false,blend_frames:0,transform:{position:[.7,0,0],quaternion:[0,0,0,1],scale:[1,1,1]}}}]};
const room=await createLivingScene({host,inputs:recipe},{loadSources:async()=>data});
try{
 const initial=room.read();await room.operations.advance({seconds:1/30});const stepped=room.read();
 assert.equal(stepped.encounters.physics.backend,'cannon-es-cpu');assert.equal(stepped.encounters.physics.steps,4,'Both actors share one step');
 assert.ok(stepped.encounters.physics.contacts.length);
 assert.ok(stepped.actors.every((a,i)=>a.state.transform.position.some((x,j)=>x!==initial.actors[i].state.transform.position[j])),'Both accepted roots must be presented');
 for(const id of ['a','b'])await room.operations.actor({id,operation:'play'});
 assert.equal(callbacks.size,1,'Coupled bodies need one shared clock subscription');
 for(const cb of [...callbacks])cb({deltaSeconds:1/30,timestampMs:300});
 assert.equal(room.read().encounters.physics.steps,4);
 for(const id of ['a','b'])await room.operations.actor({id,operation:'pause'});assert.equal(callbacks.size,0);
 const saved=room.read().recipe;assert.equal(saved.encounters.response,'physical');
 await room.dispose();const reopened=await createLivingScene({host,inputs:saved},{loadSources:async()=>data});
 assert.deepEqual(reopened.read().actors.map(a=>a.state.action.motion.path.position),saved.actors.map(a=>a.creature.wander.motion.path.points[0]));
 await reopened.operations.contactBodies({visible:true});await reopened.dispose();
}finally{await room.dispose();}
assert.equal(callbacks.size,0);assert.equal(scene.children.length,0);
console.log('Actual scene batches root response, exact advance, clocks, pause and saved physical route');
