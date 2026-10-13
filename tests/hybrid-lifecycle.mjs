// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {mountDistributedSceneRadiance} from '../scene-hybrid-radiance.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const passes=[],uploads=[];
const pipeline={getBindGroupLayout(){return {};}};
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(buffer,offset,data){uploads.push([buffer.label,new Float32Array(data)]);},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(){return pipeline;},createBindGroup(){return {};},
 createCommandEncoder(){return {beginComputePass({label}={}){passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
let consume,hostFrame;
const field={source:{status:'encoded',texture:{createView(){return {};}},dimensions:[4,8,4],localMax:[1,3,1],generation:1,frame:1}};
const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(frame){hostFrame=frame;},sceneVolumeSourceField:()=>field.source};
const renderer={library:new THREE.StandardNodeLibrary(),backend:{get(){return {};}}},scene=new THREE.Scene();
const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:0xaaff88});
const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;scene.add(mesh);
const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,volumeGrid:2,pointCount:2,createShadow:()=>({visibility:THREE.TSL.float(1),render(){},debugState:()=>({fixture:true}),dispose(){}})});
consume(field);assert.equal(mount.canRender(),true);assert.equal(mesh.geometry,geometry,'hybrid must not clone/build surface receivers');
assert.equal(geometry.hasAttribute('sceneReceiverIndex'),false);assert.equal(mount.debugState().surfaceReceivers,0);assert.equal(hostFrame.volumeReceivers,16);
const first=mount.debugState();mount.setReceiverSpacing(.8);mount.setSurfaceReconstruction(8);field.source.generation++;field.source.frame++;consume(field);
assert.equal(mount.debugState().geometryBuilds,first.geometryBuilds,'surface spacing controls must not construct an unused cache');
field.source.worldTransform={translate:[2,-1,4],scale:2};field.source.generation++;consume(field);
assert.equal(mount.debugState().geometryBuilds,1,'source movement reuses world BVH');
assert.equal(passes.filter(p=>p==='reproject world BVH without CPU rebuild').length,2);
assert.equal(passes.filter(p=>p==='prepare static smoke interpolation').length,2,'source movement must invalidate dependent smoke geometry');
assert.equal(passes.filter(p=>p==='static kiln visibility preparation').length,2,'source movement must invalidate smoke ray visibility');
assert.equal(uploads.filter(([label])=>label==='surface and smoke receivers').length,1);
field.source.generation++;assert.equal(mount.canRender(),false,'new generation must not render stale point fields');consume(field);
mesh.position.x=.25;consume(field);assert.equal(mount.debugState().geometryBuilds,2,'actual solid movement still rebuilds world visibility');
mesh.material.color.setHex(0xff0000);mount.dispose();assert.equal(mesh.material.color.getHex(),0xff0000);assert.equal(mesh.geometry,geometry);assert.equal(mount.canRender(),false);assert.equal(hostFrame,null);
console.log('hybrid lifecycle and honest rebuild boundaries passed');
