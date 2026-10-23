// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],data={manifest:{bones:[{name:'pelvis',parent:null,restMatrix:I}],channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])};
let epoch=0,offset=0;
const r=createFullBodyRuntime({THREE,...data,deformerFactory:()=>({update(){},flush(){},dispose(){},read:()=>({backend:'local-test-double'}),mirrorKey:()=>epoch,cpuPositions:base=>Float32Array.from(base,(v,i)=>v+(i%3===0?offset:0))})});
r.syncCpuGeometry();offset=.25;epoch++;
assert.equal(r.syncCpuGeometry().attributes.position.array[0],.25,'held bones must not cache away a changed physical shape');
r.bones.get('pelvis').position.x=2;r.update();assert.equal(r.syncCpuGeometry().attributes.position.array[0],2.25,'physical residual composes with the current skeletal pose');r.dispose();
console.log('Current-shape mirror follows physical epoch while bones are held');
let picked=false;const live=createFullBodyRuntime({THREE,...data,deformerFactory:()=>({update(){},flush(){},dispose(){},read:()=>({backend:'local-test-double'}),raycast(){picked=true;}})});live.mesh.raycast(new THREE.Raycaster(),[]);assert.equal(picked,true,'a live GPU body can supply its selection hit shapes without a dense CPU skin solve');live.dispose();
const playing=createFullBodyRuntime({THREE,...data,deformerFactory:()=>{let running=false;return {update(){},flush(){},dispose(){},setRunning:v=>{running=v;},read:()=>({flesh:{running}})};}});
playing.flesh.setRunning(true);playing.replaceSkin(data);assert.equal(playing.flesh.read().running,true,'Cast replacement must preserve physical running state');
playing.flesh.setRunning(false);playing.replaceSkin(data);assert.equal(playing.flesh.read().running,false);playing.dispose();
