// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneSolidGeometryCache} from '../volume-scene-solid.mjs';
let gpuUpdates=0;
const result={backend:'gpu',revision:'pose-1'};
const cache=createSceneSolidGeometryCache({
  voxelize(){throw Error('Moving-mesh GPU route still reaches CPU triangle voxelization');},
  gpuProducer:{update(){gpuUpdates++;return result;}}
});
assert.equal(cache.update([{id:'mesh',object:new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5))}],{translate:[0,0,0],scale:1},{grid:32,gridHeight:32}),result);
assert.equal(gpuUpdates,1);

const {createResidentSolidMeshes}=await import('../scene-solid-gpu.mjs');
let uploads=0,releases=0;
const resident=createResidentSolidMeshes({upload(data){uploads++;assert.ok(data.every(Number.isFinite));return {data};},release(){releases++;}});
const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
const objects=[{id:'log',object:mesh}],domain={translate:[0,0,0],scale:1};
const a=resident.update(objects,domain);assert.equal(uploads,1);
mesh.position.x=.2;const b=resident.update(objects,domain);
assert.notEqual(a[0].revision,b[0].revision);assert.equal(uploads,1,'drag must retain local triangles');
assert.equal(b[0].draws[0].matrix[12],.2);
resident.update(objects,{translate:[.1,0,0],scale:2});assert.equal(uploads,1,'moving domain must not reupload geometry');
mesh.geometry.attributes.position.needsUpdate=true;resident.update(objects,domain);assert.equal(uploads,2);assert.equal(releases,1);
resident.update([],domain);assert.equal(releases,2,'removed collider releases its mesh buffer');
assert.throws(()=>resident.update([{id:'a',object:mesh},{id:'a',object:mesh}],domain),/identity/);
resident.destroy();
