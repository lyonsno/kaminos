// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,Group,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial} from '../lib/three.core.js';
import {installSurfaceFieldMaterials} from '../surface-field-material.mjs';

test('raw field material preserves local PBR attributes and restores the source',()=>{
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
 geometry.setAttribute('_kaminos_material',new Float32BufferAttribute([0,.1,.4,.5,1,.9],2));
 const source=new MeshStandardMaterial({metalness:.3,roughness:.5}),mesh=new Mesh(geometry,source),root=new Group();root.add(mesh);
 const mounted=installSurfaceFieldMaterials(root);
 assert.equal(mounted.count,1);assert.notEqual(mesh.material,source);
 assert.ok(mesh.material.metalnessNode);assert.ok(mesh.material.roughnessNode);
 assert.equal(mesh.material.userData.kaminosSurfaceFields,'vertex-metallic-roughness.v1');
 assert.equal(source.metalness,.3);mounted.dispose();assert.equal(mesh.material,source);
});

test('invalid field material refuses before any source is replaced',()=>{
 const root=new Group();for(const values of [[0,.1,.2,.3,.4,.5],[0,.1,NaN,.3,.4,.5]]){
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));geometry.setAttribute('_kaminos_material',new Float32BufferAttribute(values,2));root.add(new Mesh(geometry,new MeshStandardMaterial()));
 }
 const originals=root.children.map(x=>x.material);assert.throws(()=>installSurfaceFieldMaterials(root),/material field/i);
 assert.deepEqual(root.children.map(x=>x.material),originals);
});
