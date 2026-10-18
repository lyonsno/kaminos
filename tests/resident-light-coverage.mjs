// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLocalSceneVisibility} from '../scene-local-visibility.mjs';
const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial({alphaTest:.5}));
mesh.castShadow=true;mesh.material.opacityNode=THREE.TSL.float(1);scene.add(mesh);
let revision=0;
const descriptor={texture:{},device:{},initial:new Uint32Array([1,0,0,0,0,0,0,1]),dimensions:[2,2,2],bounds:new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5))};
const coverage={owner:mesh,read:()=>({...descriptor,revision})};
// This is the actual rejected material class, not a synthetic opaque substitute.
const visibility=createLocalSceneVisibility({readCoverage:m=>m===mesh?coverage:null});
const first=visibility.snapshot(scene);
assert.equal(first.geometry.triangleCount,24,'Two initial material cells supply two finite opaque cell boundaries');
assert.equal(first.geometry.coverage.revision,0);
assert.equal(first.geometry.coverage.texture!==undefined,true);
assert.deepEqual(new Set(Array.from({length:24},(_,i)=>first.geometry.triangles[i*12+3])),new Set([1,8]));
revision++;
const next=visibility.snapshot(scene);
assert.equal(next.localBuilds,first.localBuilds,'Consumption changes GPU visibility, not CPU topology');
assert.equal(next.geometry.coverage.revision,1);
mesh.position.x=3;
assert.equal(visibility.snapshot(scene).geometry.matrices[12],3);
assert.throws(()=>createLocalSceneVisibility().snapshot(scene),/transparent-caster/,'Unregistered cutouts remain unsupported rather than leaving ghost geometry');
mesh.material.transparent=true;
assert.throws(()=>visibility.snapshot(scene),/opaque/,'Binary material coverage cannot authorize blended transparency');
console.log('PASS resident material cells replace static source triangles without CPU burn feedback');
