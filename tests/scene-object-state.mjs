// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
const module=await import('../scene-object-state.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==new URL('../scene-object-state.mjs',import.meta.url).href)throw error;return {};});
function api(){for(const name of ['sceneObjectTransformState','applySceneObjectTransformState','getMaterialStateForObject','applyMaterialStateToObject'])assert.equal(typeof module[name],'function',`actual shared ${name} is required`);return module;}
test('actual Three poses round-trip and partial poses keep the established identity defaults',()=>{
 const a=api(),root=new THREE.Group();root.position.set(1,2,3);root.rotation.set(.1,.2,.3);root.scale.set(2,3,4);
 const pose=a.sceneObjectTransformState(root),copy=new THREE.Group();a.applySceneObjectTransformState(copy,pose);assert.deepEqual(a.sceneObjectTransformState(copy),pose);
 pose.position[0]=999;assert.equal(root.position.x,1);a.applySceneObjectTransformState(copy,{position:[4,5,6]});assert.deepEqual(a.sceneObjectTransformState(copy),{position:[4,5,6],rotation:[0,0,0],scale:[1,1,1]});
});
test('saved material overrides affect every actual slot and restore opaque depth/blending behavior',()=>{
 const a=api(),root=new THREE.Group(),materials=[new THREE.MeshStandardMaterial({transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending}),new THREE.MeshBasicMaterial({transparent:true,opacity:.3,depthWrite:false})];
 root.add(new THREE.Mesh(new THREE.BoxGeometry(),materials));const state={side:THREE.DoubleSide,transparent:false,opacity:.7};
 a.applyMaterialStateToObject(root,state);
 for(const material of materials){assert.equal(material.side,state.side);assert.equal(material.transparent,false);assert.equal(material.opacity,.7);assert.equal(material.depthWrite,true);assert.equal(material.blending,THREE.NormalBlending);assert.ok(material.version>0);}
 assert.deepEqual(a.getMaterialStateForObject(root),state);
});
test('material capture preserves the existing last-mesh first-slot rule and empty input behavior',()=>{
 const a=api(),root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({opacity:.2})),new THREE.Mesh(new THREE.BoxGeometry(),[new THREE.MeshBasicMaterial({side:THREE.BackSide,transparent:true,opacity:.8}),new THREE.MeshBasicMaterial({opacity:.1})]));
 assert.deepEqual(a.getMaterialStateForObject(root),{side:THREE.BackSide,transparent:true,opacity:.8});assert.equal(a.getMaterialStateForObject(null),null);
 assert.deepEqual(a.sceneObjectTransformState(null),{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});a.applySceneObjectTransformState(null,{});a.applyMaterialStateToObject(null,{});
});
