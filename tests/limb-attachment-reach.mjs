// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const bones=[['torso',null,'spine-chest'],['arm','torso','forelimb-left-shoulder'],['hand','arm','forelimb-left-wrist'],['head','torso','head']].map(([name,parent,semanticRole])=>({name,parent,semanticRole,restMatrix:I}));
const data={manifest:{bones,channels:['fixed',...bones.map(b=>b.name)],vertices:3,triangles:1},rest:new Float32Array([1,0,0,0,1,0,1,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([.1,.6,.1,.1,.1, 0,.5,.5,0,0, 0,1,0,0,0])};
const original=data.weights.slice(),seen=[],runtime=createFullBodyRuntime({THREE,...data,deformerFactory:({weights})=>{seen.push(weights.slice());return {update(){},read:()=>({backend:'test'}),dispose(){}};}});
assert.equal(typeof runtime.setLimbAttachmentReach,'function','creature runtime must expose its binding reach, not a display-only property');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const first=runtime.mesh.geometry;runtime.bones.get('arm').rotation.z=Math.PI/2;runtime.update();const before=runtime.syncCpuGeometry().attributes.position.array.slice();
runtime.setLimbAttachmentReach(Math.log(3));const w=seen.at(-1);
near(w[1],.4);near(w[2],.2);near(w[3],.2);assert.equal(w[0],original[0]);assert.equal(w[4],original[4]);near(w[6],.25);near(w[7],.75);
assert.deepEqual(w.slice(10),original.slice(10),'no limb support must stay unchanged');
for(let v=0;v<3;v++)near(w.slice(v*5,v*5+5).reduce((a,b)=>a+b),original.slice(v*5,v*5+5).reduce((a,b)=>a+b));
assert.notDeepEqual(runtime.syncCpuGeometry().attributes.position.array,before,'held-pose CPU mirror must use effective weights');
const peer=createFullBodyRuntime({THREE,...data});assert.equal(peer.read().binding.limbAttachmentReach,0);
const after=runtime.mesh.geometry;assert.throws(()=>runtime.setLimbAttachmentReach(NaN),/finite/);assert.equal(runtime.mesh.geometry,after);assert.equal(runtime.read().binding.limbAttachmentReach,Math.log(3));
for(const value of [Number.MAX_VALUE,-Number.MAX_VALUE]){runtime.setLimbAttachmentReach(value);assert(seen.at(-1).every(Number.isFinite));}
runtime.setLimbAttachmentReach(Math.log(3));assert.deepEqual(seen.at(-1),w,'every change starts from original binding, never accumulates');
runtime.replaceSkin({...data,weights:new Float32Array(original)});assert.deepEqual(seen.at(-1),w,'cast exchange reapplies authored reach');
runtime.setLimbAttachmentReach(0);assert.deepEqual(seen.at(-1),original);assert.deepEqual(data.weights,original);assert.deepEqual(runtime.syncCpuGeometry().attributes.position.array,before);assert.equal(runtime.bones.get('arm').rotation.z,Math.PI/2);
const count=seen.length;runtime.setLimbAttachmentReach(0);assert.equal(seen.length,count,'unchanged property does not rebuild skin');
runtime.dispose();peer.dispose();assert.throws(()=>runtime.setLimbAttachmentReach(1),/disposed/);
console.log('Limb reach changes live weights and held geometry, preserves unrelated shares, restores exactly and remains per creature');
