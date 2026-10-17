// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnableSelection} from '../burnable-selection.mjs';
const root=()=>new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
const objects=[{id:'bear',object:root()},{id:'cube',object:root()},{id:'empty',object:new THREE.Group()}],events=[];
const selection=createBurnableSelection({objects:()=>objects,create:async id=>({read:()=>({id}),dispose:async()=>events.push('dispose:'+id)})});
await selection.set({objectId:'bear'});
await assert.rejects(selection.set({objectId:'empty'}),/one volumetric mesh/);
assert.equal(selection.read().objectId,'bear');assert.deepEqual(events,[]);
await selection.set({objectId:'bear'});assert.deepEqual(events,[]);
await selection.set({objectId:'cube'});assert.deepEqual(events,['dispose:bear']);
await selection.set({objectId:'bear',enabled:false});assert.equal(selection.read().objectId,'cube');
await selection.dispose();assert.deepEqual(events,['dispose:bear','dispose:cube']);assert.equal(objects[0].object.visible,true);
await assert.rejects(selection.set({objectId:'bear'}),/disposed/);
