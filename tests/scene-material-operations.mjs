// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneMaterials} from '../scene-material-recipes.mjs';
import {sceneMaterialPrograms} from '../scene-material-programs.mjs';
const module=await import('../scene-material-operations.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==new URL('../scene-material-operations.mjs',import.meta.url).href)throw error;return {};});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(extra={}){
 assert.equal(typeof module.createSceneMaterialOperations,'function','ordinary material operations must be reusable without constructing the DOM inspector');
 const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:0x123456}));
 const entry={id:'mesh',label:'Mesh',object},materials=createSceneMaterials({entries:()=>[entry],definitions:sceneMaterialPrograms});
 const api=module.createSceneMaterialOperations({materials,definitions:sceneMaterialPrograms,selected:id=>!id||id===entry.id?entry:null,
  apply:next=>materials.write(next),...extra});
 return {api,materials,entry,dispose(){materials.clear();object.geometry.dispose();object.material.dispose();}};
}
test('shared material operations preserve native synchronous identity, parameters and assignment',()=>{
 const f=fixture();try{
  const id=f.api.create({objectId:'mesh',implementation:'standard-surface',parameters:{color:'#ff0000',roughness:.2,metalness:.1}});
  assert.equal(typeof id,'string');assert.equal(f.materials.read().bindings[0].recipeId,id);assert.equal(f.entry.object.material.color.getHexString(),'ff0000');
  f.api.edit(id,{parameters:{roughness:.7}});assert.equal(f.entry.object.material.roughness,.7);
  const unique=f.api.makeUnique({objectId:'mesh',slot:'.:0'});assert.notEqual(unique,id);
  f.api.assign({objectId:'mesh',slot:'.:0',recipeId:null});assert.equal(f.entry.object.material.color.getHexString(),'123456');
 }finally{f.dispose();}
});
test('a worker material creation and make-unique await their admitted apply before returning identity',async()=>{
 const gate=deferred();let f;f=fixture({apply:next=>gate.promise.then(()=>f.materials.write(next))});
 try{
  const task=f.api.create({objectId:'mesh',implementation:'standard-surface'});
  assert.equal(typeof task?.then,'function');assert.equal(f.materials.read().recipes.length,0);
  gate.resolve();const id=await task;assert.equal(f.materials.read().bindings[0].recipeId,id);
  const unique=f.api.makeUnique({objectId:'mesh',slot:'.:0'});assert.equal(typeof unique?.then,'function');assert.notEqual(await unique,id);
 }finally{await Promise.resolve();f.dispose();}
});
test('initial material source lookup and resource preparation share the supplied worker preparation scope',async()=>{
 let inside=false;const source={...sceneMaterialPrograms.find(definition=>definition.id==='standard-surface'),
  async defaults(){assert.equal(inside,true,'source lookup must not happen outside worker preparation');return {color:'#00ff00',roughness:.4,metalness:.2};},
  async prepare(){assert.equal(inside,true);}};
 const f=fixture({definitions:[source],prepare:async run=>{inside=true;try{return await run();}finally{inside=false;}}});
 try{await f.api.create({objectId:'mesh',implementation:'standard-surface'});assert.equal(f.entry.object.material.color.getHexString(),'00ff00');}
 finally{f.dispose();}
});
