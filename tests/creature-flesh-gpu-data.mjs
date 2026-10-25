// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGpuSkinDeformer} from '../experiments/creature-motion/gpu-skin-deformer.mjs';
import {transportDualQuaternions,skinTransport} from '../hindquarter-live-core.mjs';
const geometry=new THREE.BufferGeometry(),rest=new Float32Array([0,0,0,1,0,0,0,1,0]),triangles=new Uint32Array([0,1,2]),weights=new Float32Array([1,1,1]);geometry.setAttribute('position',new THREE.BufferAttribute(rest,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));geometry.computeVertexNormals();
const I=new THREE.Matrix4().toArray(),physical={positions:[[0,0,0]],bindings:Array(12).fill(0),bindingWeights:Array.from({length:12},(_,i)=>i%4===0?1:0)};
const d=createGpuSkinDeformer({geometry,rest,triangles,weights,channels:1,physical});d.update([I]);d.setOffsets([[.2,0,0]]);assert.equal(d.read().physicalBackend,'cpu-tetrahedral-local-energy');assert.throws(()=>d.setOffsets([[NaN,0,0]]),/finite/);assert.throws(()=>d.flush({backend:{isWebGPUBackend:false}}),/WebGPU/);
assert.deepEqual(skinTransport(rest,weights,[I]),rest);assert.equal(transportDualQuaternions([I]).real[0][0],1);d.dispose();
console.log('explicit all-influences GPU/residual contract, finite offsets and no fallback; not a GPU execution witness');
