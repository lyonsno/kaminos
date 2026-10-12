import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';
const renderer={library:{fromMaterial:source=>new THREE.MeshStandardNodeMaterial().copy(source)}};
const bounds=new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(1,1,1));
test('cold char has a shading-normal treatment that is stable across appearance time',()=>{
  const source=new THREE.MeshStandardMaterial();
  const binding=createBurnMaterial({renderer,original:source,bounds,settings:{heat:0,char:1,reaction:0}});
  assert.ok(binding.material.normalNode,'cold char must have the facet-normal treatment');
  const normal=binding.material.normalNode;
  binding.update(0);binding.update(8);binding.set({heat:1,char:1,reaction:1});
  assert.equal(binding.material.normalNode,normal);
  assert.equal(source.normalNode,undefined);binding.dispose();source.dispose();
});
test('adding the finish retains authored PBR and normal maps',()=>{
  const source=new THREE.MeshStandardMaterial();source.map=new THREE.Texture();source.normalMap=new THREE.Texture();
  source.roughnessMap=new THREE.Texture();source.metalnessMap=new THREE.Texture();
  const binding=createBurnMaterial({renderer,original:source,bounds,settings:{heat:0,char:.8,reaction:0}});
  for(const key of ['map','normalMap','roughnessMap','metalnessMap'])assert.equal(binding.material[key],source[key]);
  binding.dispose();source.dispose();
});
