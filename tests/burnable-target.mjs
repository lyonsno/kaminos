// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {resolveBurnableTarget} from '../burnable-target.mjs';
const object=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());object.add(mesh);
object.position.set(2,3,4);object.rotation.set(.2,.3,.4);const pose=object.matrix.clone(),entry={id:'bear',object,source:'bear.glb'};
assert.equal(resolveBurnableTarget([entry],'bear'),entry);assert.deepEqual(object.position.toArray(),[2,3,4]);assert.deepEqual(object.matrix.elements,pose.elements);
assert.throws(()=>resolveBurnableTarget([entry],'missing'),/existing mesh/);
object.add(mesh.clone());assert.throws(()=>resolveBurnableTarget([entry],'bear'),/one volumetric mesh/);object.remove(object.children[1]);
mesh.geometry=new THREE.PlaneGeometry();assert.throws(()=>resolveBurnableTarget([entry],'bear'),/volumetric bounds/);
