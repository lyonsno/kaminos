// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLogDebrisGpu} from '../log-debris-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64};globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};
const make=spec=>({...spec,createView:()=>({}),destroy(){}});
const device={createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBuffer:make,createTexture:make,queue:{writeBuffer(){},writeTexture(){}}};
const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
const initial=new Uint32Array(8).fill(1),surface=initial.slice(),buffer={size:8*32};let tick=null,released=0;
const field={device,disintegrate:true,sampleState:()=>THREE.TSL.vec4(0,0,0,1),residentState:()=>({mesh,bounds:mesh.geometry.boundingBox,dimensions:[2,2,2],initial,surface,before:buffer,after:buffer})};
const debris=await createLogDebrisGpu({renderer:{backend:{device,get:()=>({})}},field,ground:{center:[0,-1,0],height:-1,radius:5},onFrame:callback=>{tick=callback;return ()=>released++;}});
const [caps,particles]=debris.root.children,particlePose=particles.matrixWorld.clone();
mesh.position.set(.7,.2,-.3);mesh.rotation.set(.2,1.1,.4);mesh.updateWorldMatrix(true,true);
tick?.();debris.root.updateWorldMatrix(true,true);
assert.ok(caps.matrixWorld.elements.every((v,i)=>Math.abs(v-mesh.matrixWorld.elements[i])<1e-10),'Paused attached interior must follow ordinary source pose without simulation');
assert.deepEqual(particles.matrixWorld.elements,particlePose.elements,'Detached residue remains in its independent world frame');
assert.equal(debris.read().steps,0,'Presentation must not advance the physics');
debris.dispose();assert.equal(released,1);mesh.geometry.dispose();mesh.material.dispose();
