// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from '../lib/three.webgpu.js';import {createBurnMaterial} from '../burn-table-material.mjs';
test('every resident burn composes scorch/crust reflection with temperature-owned emission',()=>{
 const original=new THREE.MeshStandardMaterial({color:'#b8b2a8'}),state=THREE.TSL.vec4(.8,.7,.5,1),presence=state.w;
 for(const legacy of ['crust','incineration']){
 original.userData.kaminosBurnAppearance=legacy;const b=createBurnMaterial({renderer:{library:new THREE.StandardNodeLibrary()},original,bounds:new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1)),settings:{},stateNode:state,presenceNode:presence,stateIdentity:'resident-test'});
 assert.equal(b.thermalControls.weight.value,1,'legacy surface names must not disable physical incandescence');assert.equal(b.read().appearanceModel,'scorched-thermal-crust-v2');
 assert.equal(b.read().emissionAuthority,'resident-temperature-planck-lut-v1');const node=b.material.emissiveNode;b.setAppearance({profile:legacy,glow:.7});assert.equal(b.material.emissiveNode,node);assert.equal(b.thermalControls.weight.value,1);assert.equal(b.read().appearance.glow,.7);b.dispose();
 }original.dispose();
});
