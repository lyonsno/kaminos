// kaminos-test: node
import assert from 'node:assert/strict';
let module={};
try { module=await import('../experiments/creature-motion/binding.experiment.mjs'); }
catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
assert.equal(module.default?.id,'marionette/creature-binding','automatic skin has no ordinary Workbench inspection tool');
import * as THREE from 'three';
class Element {append(){} remove(){} setAttribute(){}}
const document={createElement:()=>new Element()};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I}];
const skin={manifest:{vertices:3,triangles:1,bones,channels:['fixed','pelvis'],presets:[{name:'rest',palette:[I,I]}]},
 rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),source:{caseSha256:'a'.repeat(64)}};
const scene=new THREE.Scene();let frame,disposed=0,registered;
const session={attach:async root=>{scene.add(root);registered=root;return {id:'owned-body',root,owned:true};},onFrame:fn=>{frame=fn;return()=>{frame=null;}},redraw(){},readView:()=>({}),setView(){},dispose:async()=>{scene.clear();disposed++;}};
const entry=await module.createCreatureBinding({host:{controls:{document},scene:{open:()=>session}},inputs:{}},{loadSkin:async()=>skin});
assert.equal(entry.read().source.caseSha256,'a'.repeat(64));assert.equal(scene.children.length,1);
const bone=registered.children.find(x=>x.isBone);bone.position.x=2;frame();
assert.equal(entry.read().editedSincePreset,true);
const mesh=registered.children.find(x=>x.isMesh);assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),[2,0,0,3,0,0,2,1,0]);
entry.operations.pose({name:'rest'});assert.equal(entry.read().editedSincePreset,false);assert.equal(bone.position.x,0);
assert.throws(()=>entry.operations.pose({name:'unknown'}),/preset/);
await entry.dispose();assert.equal(frame,null);assert.equal(scene.children.length,0);assert.equal(disposed,1);
console.log('Binding inspection uses the shared scene and preserves editable actual Bones, source identity and disposal');
