// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireShadowCasters,KILN_CASTER_SOURCE,loadFireCaster} from '../fire-shadow-casters.mjs';
import {renderFireShadowBatch} from '../fire-light-field-shadow.mjs';
const scene=new THREE.Scene(),root=new THREE.Group(),hero=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));
root.userData.kaminosSceneObject={source:`/api/read?root=generated-meshes&path=${KILN_CASTER_SOURCE}.glb`};
hero.castShadow=true;root.add(hero);scene.add(root);root.position.set(2,3,4);root.scale.set(2,3,4);
const proxy=new THREE.Group(),small=new THREE.Mesh(new THREE.TetrahedronGeometry(),new THREE.MeshStandardMaterial());
small.castShadow=true;proxy.add(small);proxy.rotation.x=-Math.PI/2;proxy.updateMatrix();
let loads=0,release;
const casters=createFireShadowCasters({scene,load:async()=>{loads++;return proxy;}});
assert.equal(casters.debugState().level,'original');
await casters.setLevel('10k');assert.equal(loads,1);
const seen=[];
renderFireShadowBatch({scene,casterScene:casters,shadows:Array.from({length:4},()=>({render(p){
  assert.equal(root.visible,false);assert(!p.casters.includes(hero));assert.equal(p.casters[0].geometry,small.geometry);
  assert.equal(p.triangleCount,4);assert.equal(p.casters[0].material.side,THREE.DoubleSide);
  const expected=root.matrixWorld.clone().multiply(proxy.matrix).multiply(small.matrix);
  assert.deepEqual(p.casters[0].matrixWorld.elements,expected.elements,'asset node rotation and nonuniform world placement compose once');seen.push(p);
}}))});
assert.equal(seen.length,4);assert(seen.every(p=>p===seen[0]));
assert.equal(root.visible,true);assert.equal(proxy.parent,null);assert.deepEqual(scene.children,[root]);assert.equal(hero.geometry.attributes.position.count,24,'beauty geometry unchanged');
assert.throws(()=>casters.withCapture(()=>{throw Error('failed face');}),/failed face/);
assert.equal(root.visible,true);assert.equal(proxy.parent,null);
root.visible=false;casters.withCapture(()=>assert.equal(proxy.parent,null));root.visible=true;
casters.withCapture(()=>{});assert.equal(casters.debugState().captureTriangles,4);
await casters.setLevel('5k');assert.equal(casters.debugState().captureTriangles,0,'new choice cannot report old capture work as current');assert.equal(casters.debugState().targets,0);
await casters.setLevel('original');renderFireShadowBatch({scene,casterScene:casters,shadows:[{render(p){assert.deepEqual(p.casters,[hero]);}}]});
await assert.rejects(casters.setLevel('500'),/caster level/);
await casters.setLevel('5k');assert.equal(loads,2);
for(const kind of ['position','index']){
  const original=kind==='position'?hero.geometry.attributes.position:hero.geometry.index;
  const replacement=original.clone();
  while(replacement.version<original.version)replacement.needsUpdate=true;
  if(kind==='position')hero.geometry.setAttribute(kind,replacement);else hero.geometry.setIndex(replacement);
  assert.throws(()=>casters.withCapture(()=>{}),/source geometry changed/,`${kind} replacement at equal revision invalidates`);
  if(kind==='position')hero.geometry.setAttribute(kind,original);else hero.geometry.setIndex(original);
}
hero.geometry.attributes.position.needsUpdate=true;
assert.throws(()=>casters.withCapture(()=>{}),/source geometry changed/);assert.equal(root.visible,true);
await casters.setLevel('original');casters.dispose();assert.equal(proxy.parent,null);
const pending=createFireShadowCasters({scene,load:()=>new Promise(r=>release=r)});
const old=pending.setLevel('10k');await Promise.resolve();await pending.setLevel('original');release(proxy);await old;
assert.equal(pending.debugState().level,'original','late load must not reactivate retired choice');pending.dispose();
const fetchBefore=globalThis.fetch;
try{
  globalThis.fetch=async()=>new Response('',{status:404});await assert.rejects(loadFireCaster('5k'),/HTTP 404/);
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));await assert.rejects(loadFireCaster('5k'),/content identity mismatch/);
}finally{globalThis.fetch=fetchBefore;}
console.log('PASS caster-only frame, four fresh captures, restoration, invalidation and late-load ownership');
