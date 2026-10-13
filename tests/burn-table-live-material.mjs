import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';

test('GPU local material state replaces the held exposure mask without altering the source maps',()=>{
  const original=new THREE.MeshStandardMaterial();original.map=new THREE.Texture();
  const stateNode=THREE.TSL.vec4(0,0,0,0);
  const binding=createBurnMaterial({renderer:{library:{fromMaterial:source=>new THREE.MeshStandardNodeMaterial().copy(source)}},original,
    bounds:new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(1,1,1)),settings:{heat:0,char:0,reaction:0},
    stateNode,stateIdentity:'gpu-local-heat-v1'});
  assert.equal(binding.read().stateAuthority,'gpu-local-heat-v1','live state must not silently use synthetic held exposure');
  assert.equal(binding.material.map,original.map);
  assert.throws(()=>binding.set({heat:1,char:1,reaction:1}),/GPU-owned/);
  binding.update(12);assert.equal(binding.read().appearanceSeconds,12);
  binding.dispose();original.dispose();
});
