// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireShadowCasters} from '../fire-shadow-casters.mjs';
import {createLocalSceneVisibility} from '../scene-local-visibility.mjs';
test('native editor presentation keeps the same prepared shadow topology at admission and restores on failure',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(root);root.add(mesh);mesh.castShadow=true;mesh.visible=false;
 root.userData.kaminosCaptureVisibility=()=>{const previous=mesh.visible;mesh.visible=true;return()=>{mesh.visible=previous;};};
 const casters=createFireShadowCasters({scene}),visibility=createLocalSceneVisibility();
 try{
  const cold=casters.withCapture(()=>visibility.snapshot(scene),{smokeVisibility:true});
  assert.equal(cold.meshCount,1,'cold preparation must include the actual retained lettering');assert.equal(mesh.visible,false);
  mesh.visible=true;const admitted=casters.withCapture(()=>visibility.snapshot(scene),{smokeVisibility:true});
  assert.equal(admitted.revision,cold.revision,'admission must not change prepared optical topology');assert.equal(admitted.localBuilds,cold.localBuilds);
  mesh.visible=false;assert.throws(()=>casters.withCapture(()=>{assert.equal(mesh.visible,true);throw Error('capture failed');}),/capture failed/);assert.equal(mesh.visible,false);
 }finally{casters.dispose();}
});
