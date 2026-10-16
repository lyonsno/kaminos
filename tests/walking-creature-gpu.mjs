// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {createGpuSkinDeformer} from '../experiments/creature-motion/gpu-skin-deformer.mjs';

class Element {
 constructor(){this.children=[];this.style={};this.value='0';this.checked=true;}
 append(...nodes){this.children.push(...nodes);} setAttribute(){} remove(){} dispatchEvent(){}
}
const controls=new Map(['composition-ground-height','composition-ground-visible'].map(id=>[id,new Element()]));
const document={createElement:()=>new Element(),getElementById:id=>controls.get(id)??null};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,-2,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
let opened=0,loads=0,imports=0,callback=null;
const scene=new THREE.Scene();
const session={async attach(root){scene.add(root);return {id:root.uuid,root,owned:true};},onFrame(fn){assert.equal(callback,null);callback=fn;return ()=>callback=null;},redraw(){},setView(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){scene.clear();callback=null;}};
const host={controls:{document},scene:{open:async()=>{opened++;return session;},refreshPresentation(){}}};
const dependencies={loadSources:async()=>{loads++;return data;},loadGpuDeformer:async()=>{imports++;return createGpuSkinDeformer;}};
const inputs={blend_frames:0,radius:4,ground:'source-start'};

// Unknown/failed backend requests cannot quietly mount a CPU creature.
await assert.rejects(()=>createWalkingCreature({host,inputs:{...inputs,deformation:'invented'}},dependencies),/deformation|backend/i);
assert.equal(loads,0);assert.equal(opened,0);
await assert.rejects(()=>createWalkingCreature({host,inputs:{...inputs,deformation:'gpu'}},{...dependencies,loadGpuDeformer:async()=>{throw Error('GPU module unavailable');}}),/GPU module unavailable/);
assert.equal(opened,0);

const oldWindow=globalThis.window;globalThis.window={};
try {
 const cpu=await createWalkingCreature({host,inputs},dependencies);
 assert.equal(imports,0,'CPU setup must not import the GPU implementation');
 assert.equal(cpu.read().deformation.requested,'cpu');assert.equal(cpu.read().deformation.effective,'cpu-reference');
 const floor=cpu.read().referenceFloor.height;
 cpu.operations.seek({frame:2});const expected=window.kaminosWalkingCreature().vertices;
 await assert.rejects(()=>window.kaminosWalkingCreature({geometry:'gpu'}),/CPU reference is not GPU evidence/);
 await cpu.dispose();

 const gpu=await createWalkingCreature({host,inputs:{...inputs,deformation:'gpu'}},dependencies);
 assert.equal(imports,1);assert.equal(gpu.read().deformation.requested,'gpu');
 assert.equal(gpu.read().deformation.effective,'webgpu-dense-dq');
 assert.equal(gpu.read().skin.deformation.dispatches,0,'Node setup is not a native GPU dispatch witness');
 assert.equal(gpu.read().referenceFloor.height,floor,'Ground must consume XYZ posed geometry, not packed vec4 rest storage');
 await assert.rejects(()=>window.kaminosWalkingCreature({geometry:'gpu'}),/not been rendered/);
 const before=gpu.read().skin.poseCache.deformations;
 gpu.operations.play();callback({deltaSeconds:1/30});callback({deltaSeconds:1/30});gpu.operations.pause();
 for(let i=0;i<3;i++)window.kaminosWalkingCreature({geometry:false});
 assert.equal(gpu.read().skin.poseCache.deformations,before,'Normal playback and property reads must not solve CPU vertices');
 gpu.operations.seek({frame:2});const inspected=window.kaminosWalkingCreature();
 assert.deepEqual(inspected.vertices,expected,'Explicit inspection must return current XYZ posed triangles');
 assert.equal(inspected.vertices.length,9);assert.equal(inspected.geometrySource,'cpu-current-pose');
 const solved=gpu.read().skin.poseCache.deformations;window.kaminosWalkingCreature();
 assert.equal(gpu.read().skin.poseCache.deformations,solved,'A held pose mirror is reused');
 const recipe=gpu.read().recipe;assert.equal(recipe.deformation,'gpu');await gpu.dispose();
 const reopened=await createWalkingCreature({host,inputs:recipe},dependencies);
 assert.equal(reopened.read().deformation.effective,'webgpu-dense-dq');
 assert.deepEqual(window.kaminosWalkingCreature().vertices,expected,'GPU setup reconstruction preserves the held source pose');
 await reopened.dispose();assert.equal(scene.children.length,0);assert.equal(callback,null);
} finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
console.log('Walking selects the requested deformer, preserves CPU default, and uses explicit current-pose geometry without per-frame CPU skinning');
