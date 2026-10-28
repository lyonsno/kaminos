// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';

function material(appearance){
 const original=new THREE.MeshStandardMaterial({color:0xb8b2a8,roughness:.8});
 original.userData.kaminosBurnAppearance=appearance;
 original.map=new THREE.Texture();original.normalMap=new THREE.Texture();
 const presence=THREE.TSL.float(.8);
 const binding=createBurnMaterial({renderer:{library:{fromMaterial:m=>new THREE.MeshStandardNodeMaterial().copy(m)}},original,
  bounds:new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(2,.5,.04)),settings:{},
  stateNode:THREE.TSL.vec4(.8,.5,.4,.8),stateIdentity:'resident-test',presenceNode:presence});
 return {binding,original,presence};
}
test('incineration is opt-in, preserves authored maps and uses the resident material coverage',()=>{
 const {binding,original,presence}=material('incineration');
 assert.equal(binding.read().appearanceModel,'thermal-incineration-v1');
 assert.equal(binding.read().stateAuthority,'resident-test');
 assert.equal(binding.material.map,original.map);assert.equal(binding.material.normalMap,original.normalMap);
 assert.equal(binding.material.opacityNode,presence);assert.equal(binding.material.alphaTest,.5);
 binding.setAppearance({glow:2.8});assert.equal(binding.read().appearance.glow,2.8);
 const resident=binding.material;binding.update(12);binding.setAppearance({profile:'crust'});assert.equal(binding.read().appearanceModel,'char-facet-crust-v1');assert.equal(binding.material,resident);assert.equal(binding.material.opacityNode,presence);assert.equal(binding.read().appearanceSeconds,12);
 binding.setAppearance({profile:'incineration'});assert.equal(binding.material,resident);assert.equal(binding.read().appearance.glow,2.8);
 assert.throws(()=>binding.setAppearance({glow:NaN}),/gain|glow/);assert.equal(binding.read().appearance.glow,2.8);
 binding.dispose();original.dispose();
});
test('ordinary burn materials retain crust and can select the shared thermal response',()=>{
 const {binding,original}=material(undefined);assert.equal(binding.read().appearanceModel,'char-facet-crust-v1');
 binding.setAppearance({profile:'incineration',glow:.75});assert.equal(binding.read().appearance.glow,.75);assert.equal(binding.read().appearanceModel,'thermal-incineration-v1');binding.dispose();original.dispose();
});

test('thermal appearance composes the original scorch and reports the shared thermal law',()=>{
 const {binding,original}=material('incineration');
 assert.equal(binding.read().scorchResponse,'char-facet-crust-v1');
 assert.equal(binding.read().emissionAuthority,'resident-temperature-planck-lut-v1');
 assert.equal(binding.read().thermal.kelvinPerHeat,1600);
 binding.setAppearance({kelvinPerHeat:1200});assert.equal(binding.read().thermal.kelvinPerHeat,1200);
 const before=binding.read();assert.throws(()=>binding.setAppearance({kelvinPerHeat:NaN,glow:3}),/Kelvin/);assert.deepEqual(binding.read(),before);
 binding.dispose();original.dispose();
});
