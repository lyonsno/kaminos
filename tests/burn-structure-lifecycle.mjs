// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneBurnStructure} from '../scene-burn-structure.mjs';
const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial()),parent=new THREE.Group();
mesh.geometry.computeBoundingBox();let starts=0,stops=0,payload;
const field={residentState:()=>({mesh,bounds:mesh.geometry.boundingBox,dimensions:[4,4,4],initial:new Uint32Array(64).fill(1)})};
const structure=createSceneBurnStructure({renderer:{},field,parent,workerFactory:()=>{starts++;return {terminate(){stops++;},postMessage(data){payload=data;}};}});
await structure.configure(false);assert.equal(starts,0);
const pending=structure.configure(true);assert.equal(starts,1);assert.equal(structure.read().status,'preparing');assert.equal(payload.material.initial.length,64);
await structure.configure(true);assert.equal(starts,1,'A frame sync must not repeat structural preparation');
await structure.configure(false);await pending;assert.equal(structure.read().status,'off');assert.equal(stops,1);assert.equal(parent.children.length,0);
const late=structure.configure(true);structure.dispose();await late;assert.equal(structure.read().status,'disposed');assert.equal(stops,2);

let workerRef,prepared=0,released=0;
const resident={overlay:new THREE.Group(),dispose(){released++;this.overlay.removeFromParent();},read:()=>({regions:2}),resident:()=>({buffer:'sections'}),encode(){}};
const live=createSceneBurnStructure({renderer:{},field,parent,
 workerFactory:()=>workerRef={terminate(){},postMessage(){}},
 gpuFactory:async()=>{prepared++;return resident;}});
assert.equal(typeof live.setRequired,'function','Mechanics must retain sections independently of inspection visibility');
const required=live.setRequired(true);workerRef.onmessage({data:{}});await required;
assert.equal(prepared,1);assert.equal(live.read().enabled,false);assert.equal(resident.overlay.visible,false);
await live.configure(true);assert.equal(resident.overlay.visible,true);
await live.configure(false);assert.equal(resident.overlay.visible,false);assert.equal(released,0);
assert.equal(live.resident().buffer,'sections');assert.equal(prepared,1);
await live.setRequired(false);assert.equal(released,1);assert.equal(live.resident(),null);
live.dispose();assert.equal(released,1);
