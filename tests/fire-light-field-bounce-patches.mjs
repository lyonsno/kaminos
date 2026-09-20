import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {collectStaticBounceTriangles,selectStaticBouncePatches} from '../fire-light-field-bounce.mjs';

const scene=new THREE.Scene();
const authoredRoot=new THREE.Group();
authoredRoot.userData.kaminosSceneObject={id:'authored-kiln'};
scene.add(authoredRoot);
const matte=new THREE.MeshStandardMaterial({color:0x804020,roughness:1,metalness:0,side:THREE.DoubleSide});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(4,4,2,2),matte);
floor.rotation.x=-Math.PI/2;floor.position.y=-1;floor.castShadow=true;authoredRoot.add(floor);
const wall=new THREE.Mesh(new THREE.PlaneGeometry(4,3,2,2),matte.clone());
wall.position.z=-2;wall.castShadow=true;authoredRoot.add(wall);
const glass=new THREE.Mesh(new THREE.PlaneGeometry(4,3),new THREE.MeshStandardMaterial({transparent:true,opacity:.5}));
glass.position.z=1;glass.castShadow=true;authoredRoot.add(glass);
const runtimeDistractor=new THREE.Mesh(new THREE.SphereGeometry(.2,32,16),matte.clone());
runtimeDistractor.position.set(0,0,.01);runtimeDistractor.castShadow=true;scene.add(runtimeDistractor);
scene.updateMatrixWorld(true);

const first=selectStaticBouncePatches(scene,{count:6,origin:new THREE.Vector3(0,0,0)});
const second=selectStaticBouncePatches(scene,{count:6,origin:new THREE.Vector3(0,0,0)});
const candidates=collectStaticBounceTriangles(scene,{origin:new THREE.Vector3(0,0,0)});
assert.equal(first.length,6,'requested patch count is filled from eligible static opaque triangles');
assert.deepEqual(first.map(p=>p.identity),second.map(p=>p.identity),'selection is deterministic');
assert.ok(first.every(p=>Number.isFinite(p.area)&&p.area>0),'every patch has positive finite area');
assert.ok(first.every(p=>p.position.distanceTo(new THREE.Vector3(0,0,0))>0),'patch positions are finite world-space surface points');
assert.ok(first.every(p=>p.normal.dot(new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0),p.position))>=0),'two-sided patch normals face the nominal fire origin');
assert.ok(first.every(p=>p.albedo.distanceTo?.(matte.color)<1e-6||(
  Math.abs(p.albedo.r-matte.color.r)<1e-6&&Math.abs(p.albedo.g-matte.color.g)<1e-6&&Math.abs(p.albedo.b-matte.color.b)<1e-6
)),'material base color survives patch extraction');
assert.ok(first.every(p=>p.object!==glass),'transparent geometry cannot become an opaque bounce emitter');
assert.ok(candidates.every(p=>p.object!==runtimeDistractor),'runtime/helper geometry is excluded before static patch selection');
assert.ok(first.every(p=>p.object!==runtimeDistractor),'runtime/helper geometry outside an authored scene object cannot enter the static receiver cache');
console.log('static bounce patches are deterministic, material-bearing, and opaque-only');
