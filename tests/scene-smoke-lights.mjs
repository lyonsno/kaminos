// kaminos-test: node
import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {collectSceneSmokeLights,packSceneSmokeLights} from '../scene-smoke-lights.mjs';
import * as THREE from '../lib/three.webgpu.js';
const scene=new THREE.Scene(),parent=new THREE.Group(),spot=new THREE.SpotLight(0x80aaff,12);
parent.position.set(2,0,0);scene.add(parent,spot.target);parent.add(spot);spot.position.set(0,1,0);spot.target.position.set(2,0,0);spot.castShadow=true;
let packet=collectSceneSmokeLights(scene,{translate:[2,0,0],scale:2});
assert.deepEqual(packet.lights[0].position,[0,.5,0]);assert.deepEqual(packet.lights[0].direction,[0,-1,0]);assert.deepEqual(packet.lights[0].color,spot.color.toArray().map(x=>x*12));assert.equal(packet.worldScale,2);
assert.equal(packSceneSmokeLights(packet).count,1);
parent.visible=false;assert.equal(collectSceneSmokeLights(scene).lights.length,0);parent.visible=true;
spot.intensity=0;assert.equal(collectSceneSmokeLights(scene).lights.length,0);spot.intensity=12;
for(const patch of [{color:[NaN,1,1]},{decay:-1},{direction:[0,0,0]}])assert.throws(()=>packSceneSmokeLights({...packet,lights:[{...packet.lights[0],...patch}]}),/invalid/);
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const passes=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(){},submit(){}},createBuffer:d=>({...d,destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),createShaderModule:d=>d,
 createComputePipeline:()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),createCommandEncoder:()=>({copyBufferToBuffer(){},beginComputePass:({label})=>{passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish:()=>({})})};
const gather=createVolumeGather(device,{geometry:buildTriangleVisibility([]).packGpu(),receivers:[],volumeGrid:2,directions:8,smokeRefinement:1});
const source={status:'encoded',texture:{createView:()=>({})},generation:1,frame:1,dimensions:[4,8,4],localMax:[1,3,1]};
const light={id:'actual-spot',type:'spot',position:[0,1,0],direction:[0,-1,0],color:[1,2,3],decay:2,distance:0,coneCos:.5,penumbraCos:.8,castShadow:true};
const sceneLights={lights:[light],worldScale:1,unsupported:[]};
const frame=gather.encode(source,{gain:0,sceneLights});
assert.equal(frame.sceneLights?.count,1,'actual scene lights must illuminate smoke even when fire gain is zero');
assert.deepEqual(frame.sceneLights.ids,['actual-spot']);
assert.equal(passes.filter(p=>p==='cache scene-light smoke visibility').length,1);
gather.encode(source,{sceneLights});assert.equal(passes.filter(p=>p==='cache scene-light smoke visibility').length,1,'unchanged light visibility is cached');
gather.encode(source,{sceneLights:{...sceneLights,lights:[{...light,color:[2,2,2]}]}});
assert.equal(passes.filter(p=>p==='cache scene-light smoke visibility').length,1,'color edit does not retrace geometry');
gather.encode(source,{sceneLights:{...sceneLights,lights:[{...light,position:[1,1,0]}]}});
assert.equal(passes.filter(p=>p==='cache scene-light smoke visibility').length,2,'light movement must refresh visibility');
assert.equal(gather.encode(source).sceneLights.count,0,'removing lights must not preserve stale illumination');
gather.destroy();console.log('PASS direct scene-light input, gain independence, visibility invalidation and off');
