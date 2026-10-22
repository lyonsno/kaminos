// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture} from '../lib/three.core.js';
import {createGeneratedGlass} from '../generated-glass.mjs';

test('glass study preserves source and restores exact materials without disposing shared maps', () => {
  const root=new Group(), map=new Texture(), source=new MeshStandardMaterial({map,roughness:.6});
  const mesh=new Mesh(new BoxGeometry(),source);root.add(mesh);
  let textureDisposals=0;map.addEventListener('dispose',()=>textureDisposals++);
  const controller=createGeneratedGlass(root);
  assert.equal(source.transparent,false);
  assert.equal(source.roughness,.6);
  assert.notEqual(mesh.material,source);
  assert.equal(mesh.children.length,1);
  assert.ok(mesh.children[0].material.transmissionNode);
  assert.ok(mesh.material.maskNode);
  controller.set({mode:'opaque'});
  assert.equal(mesh.material,source);
  assert.equal(mesh.children[0].visible,false);
  controller.set({mode:'opacity'});
  assert.equal(mesh.material.alphaHash,true);
  assert.equal(mesh.material.transparent,false);
  controller.set({mode:'glass',ior:1.5,thickness:.08});
  assert.equal(mesh.children[0].visible,true);
  assert.equal(mesh.children[0].material.ior,1.5);
  controller.set({mode:'normals'});assert.equal(mesh.material.fragmentNode,null,'normal diagnostics must preserve renderer MRT outputs');assert.equal(mesh.material.lights,false);
  assert.throws(()=>controller.set({ior:NaN}));
  assert.equal(controller.read().ior,1.5);
  controller.dispose();controller.dispose();
  assert.equal(mesh.material,source);assert.equal(mesh.children.length,0);
  assert.equal(textureDisposals,0);
  mesh.geometry.dispose();source.dispose();map.dispose();
});

test('unsupported assets fail before mutation',()=>{
 const root=new Group(),source=new MeshStandardMaterial();const mesh=new Mesh(new BoxGeometry(),source);root.add(mesh);
 assert.throws(()=>createGeneratedGlass(root),/base-color/);
 assert.equal(mesh.material,source);assert.equal(mesh.children.length,0);
});
