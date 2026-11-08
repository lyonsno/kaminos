// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createFireUnitObject} from '../fire-unit-runtime.mjs';
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
function fixture(){
 const original={document:globalThis.document,window:globalThis.window,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 globalThis.document={createElement:()=>({dataset:{},style:{},classList:{add(){},remove(){}},remove(){}})};globalThis.window={devicePixelRatio:1};globalThis.cancelAnimationFrame=()=>{};
 const controls={emitterSourceLaw:'immersed-source',resolution:16,gridHeightRatio:1,fineVelocity:16,finePressure:16,worldSmoke:'on',worldSmokeExtent:3,worldSmokeFlow:8,worldSmokeMaterial:8,worldSmokePressure:8,worldSmokeIterations:12,worldSmokeIntermediate:'off'};
 const owner=createFireUnitObject({THREE,camera:new THREE.PerspectiveCamera(50,1.5,.1,100),viewport:{appendChild(){},clientWidth:600,clientHeight:400},controls:null,
  record:{id:'fire-a',type:'fire-unit',source:'kaminos:fire-unit',transform:pose(),fireUnit:{controls,moveEmitterWithGrid:true,emitter:{...pose(),position:[0,-.76,0]}}}});
 return {owner,restore:()=>Object.assign(globalThis,original)};
}
test('a new unit shows its outer World grid and Fine grid before GPU initialization',()=>{
 const {owner,restore}=fixture();try{assert.deepEqual(owner.root.children[1].box.min.toArray(),[-3,-3,-3]);assert.deepEqual(owner.root.children[0].box.min.toArray(),[-1,-1,-1]);assert.equal(owner.runtime.canvasElement().style.background,'transparent');}finally{restore();}
});
test('a rigidly scaled unit represents the source once in world space',()=>{
 const {owner,restore}=fixture();try{owner.root.scale.setScalar(2);owner.syncPose();owner.root.updateMatrixWorld(true);assert.deepEqual(owner.emitter.getWorldScale(new THREE.Vector3()).toArray(),[2,2,2]);}finally{restore();}
});
test('steady frames do not poll or analyze a static unit transform',()=>{
 const {owner,restore}=fixture();try{let reads=0;const read=owner.root.position.toArray.bind(owner.root.position);owner.root.position.toArray=()=>{reads++;return read();};for(let i=0;i<3;i++)owner.sync({visible:false,helpers:true,paused:true});assert.equal(reads,0);}finally{restore();}
});
test('a refused native grid rotation restores the last accepted root pose',()=>{
 const {owner,restore}=fixture();try{owner.root.rotation.y=.3;assert.throws(()=>owner.syncPose(),/aligned/);assert.equal(owner.root.rotation.y,0);assert.equal(owner.capture().moveEmitterWithGrid,true);}finally{restore();}
});
test('each unit disables the prototype floor/cluster injector',()=>{
 const {owner,restore}=fixture();try{assert.equal(owner.runtime.debugState().coreEmitterSourceMode,'analytic-only');}finally{restore();}
});
