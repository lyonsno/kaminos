// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
const {createBurnableSelection}=await import(process.env.BURNABLE_SELECTION_TEST_MODULE??'../burnable-selection.mjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const objects=['a','b'].map(id=>({id,object:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())}));
{
 const acquisition=deferred(),cleanup=deferred();let completed=false,cleaning=false;
 const selection=createBurnableSelection({objects:()=>objects,create:()=>acquisition.promise});
 const pending=selection.set({objectId:'a'});pending.catch(()=>{});
 await Promise.resolve();
 const closing=selection.dispose();closing.then(()=>completed=true);
 await new Promise(setImmediate);assert.equal(completed,false,'Disposal must await in-flight acquisition');
 assert.equal(selection.dispose(),closing,'Repeated disposal shares one completion');
 acquisition.resolve({dispose:async()=>{cleaning=true;await cleanup.promise;},read:()=>({})});
 await new Promise(setImmediate);assert.equal(cleaning,true);assert.equal(completed,false,'Disposal must await late instance cleanup');
 cleanup.resolve();await assert.rejects(pending,/disposed/);await closing;assert.equal(selection.read().busy,false);
}
{
 const teardown=deferred();let creates=0,completed=false;
 const selection=createBurnableSelection({objects:()=>objects,create:async()=>{creates++;return {read:()=>({}),dispose:()=>teardown.promise};}});
 await selection.set({objectId:'a'});const pending=selection.set({objectId:'b'});pending.catch(()=>{});
 const closing=selection.dispose();closing.then(()=>completed=true);await Promise.resolve();assert.equal(completed,false,'Disposal must await prior teardown');
 teardown.resolve();await assert.rejects(pending,/disposed/);await closing;assert.equal(creates,1,'Closed owner cannot start replacement');
}
