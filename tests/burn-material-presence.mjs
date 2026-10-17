// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';
const binding=createBurnMaterial({renderer:{library:{fromMaterial:m=>new THREE.MeshStandardNodeMaterial().copy(m)}},
 original:new THREE.MeshStandardMaterial(),bounds:new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1)),settings:{},
 stateNode:THREE.TSL.vec4(0,0,0,0),stateIdentity:'resident',presenceNode:THREE.TSL.float(0)});
assert.ok(binding.material.opacityNode,'Consumed material must cut the original surface, not only recolor it');
assert.equal(binding.material.alphaTest,.5);binding.dispose();
