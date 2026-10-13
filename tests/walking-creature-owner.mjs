// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module={};try{module=await import('../experiments/creature-motion/walking.experiment.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(module.default?.id,'marionette/walking-creature','full-body walking is not a discoverable shared-host owner experiment');
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){this.removed=true;}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();
let frameCallback=null,attached=0,closed=0;
const session={async attach(root){scene.add(root);attached++;return {id:'actual-owner-root',root,owned:true};},onFrame(fn){assert.equal(frameCallback,null,'one shared frame subscription');frameCallback=fn;return ()=>{frameCallback=null;};},redraw(){},setView(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){closed++;scene.clear();frameCallback=null;}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const entry=await module.createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{blend_frames:0,radius:4}},{loadSources:async()=>data});
assert.equal(attached,1);assert.equal(entry.read().host.id,'actual-owner-root');
const mountRoot=new Element();entry.mount({root:mountRoot,invoke:(name,input)=>entry.operations[name](input)});
const allNodes=node=>[node,...node.children.flatMap(allNodes)];
assert.ok(!allNodes(mountRoot).some(node=>node.textContent==='Play source'),'legacy direct controls must not bypass the shared owner clock/operation surface');
await entry.operations.mode({mode:'path'});await entry.operations.play();
frameCallback({deltaSeconds:1/30});assert.equal(entry.read().playback.frame,1);
frameCallback({deltaSeconds:1/30});assert.equal(entry.read().cycle,1);assert.equal(entry.read().playback.status,'playing');
await entry.operations.pause();assert.equal(frameCallback,null);
assert.throws(()=>entry.operations.mode({mode:'invented'}),/mode/);
const before=entry.read().mode;await assert.rejects(()=>module.createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{}},{loadSources:async()=>{throw Error('wrong source digest');}}),/wrong source digest/);
assert.equal(entry.read().mode,before);
await entry.dispose();assert.equal(closed,1);assert.equal(scene.children.length,0);assert.equal(frameCallback,null);
console.log('Full-body walking consumes one actual shared scene attachment/clock and releases its own instance');
