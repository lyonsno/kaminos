// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGpuSkinDeformer} from '../experiments/creature-motion/gpu-skin-deformer.mjs';
const make=()=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));geometry.setIndex([0,1,2]);geometry.computeVertexNormals();return {geometry,rest:geometry.attributes.position.array,triangles:new Uint32Array([0,1,2]),weights:new Float32Array([1,1,1]),channels:1};};
const physical={positions:[[0,0,0],[1,0,0]],bindings:[0,1,0,1],bindingWeights:[1.1,-.1,.6,.4],bindingOffsets:[0,2,2,4],interpolation:'tricubic-grid'};
let d;assert.doesNotThrow(()=>{d=createGpuSkinDeformer({...make(),physical});},'GPU transfer must accept complete variable stencils and explicit cubic signed weights');d.dispose();
assert.throws(()=>createGpuSkinDeformer({...make(),physical:{...physical,bindingOffsets:[0,3,2,4]}}),/embedding/);
assert.throws(()=>createGpuSkinDeformer({...make(),physical:{...physical,interpolation:undefined}}),/embedding/);
assert.throws(()=>createGpuSkinDeformer({...make(),physical:{...physical,bindings:[0,2,0,1]}}),/embedding/);
console.log('GPU data accepts explicit smooth stencils and rejects malformed or undeclared signed support');
