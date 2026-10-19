// kaminos-test: node
import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {sceneSmokeEnvironmentRecipe,createSceneSmokeEnvironment} from '../scene-smoke-environment.mjs';
import * as THREE from '../lib/three.webgpu.js';
const scene=new THREE.Scene(),map=new THREE.Texture();map.image={width:256,height:256};scene.environment=map;
const recipe=sceneSmokeEnvironmentRecipe(scene);
assert.equal(recipe.intensity,1);assert.equal(recipe.width,256);assert.equal(recipe.height,128);
scene.backgroundIntensity=99;scene.backgroundRotation.y=2;scene.background=null;
assert.deepEqual(sceneSmokeEnvironmentRecipe(scene),recipe,'background grading must not change lighting');
scene.environmentRotation.y=.5;
assert.notDeepEqual(sceneSmokeEnvironmentRecipe(scene),recipe,'environment rotation must invalidate lighting');
scene.environmentIntensity=0;assert.equal(sceneSmokeEnvironmentRecipe(scene),null);
scene.environmentIntensity=-1;assert.throws(()=>sceneSmokeEnvironmentRecipe(scene),/intensity/);
scene.environmentIntensity=2;
const wrongDevice=createSceneSmokeEnvironment({renderer:{backend:{device:{}}},scene,device:{}});
assert.throws(()=>wrongDevice.frame(),/scene GPU device/);wrongDevice.dispose();
assert.throws(()=>wrongDevice.frame(),/disposed/);
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const uploads=new Map(),passes=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(b,o,data){uploads.set(b.label,Array.from(data));},submit(){}},
 createBuffer(d){return {...d,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(d){return d;},createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(){return {};},
 createCommandEncoder(){return {copyBufferToBuffer(){},beginComputePass({label}){passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
const gather=createVolumeGather(device,{geometry:buildTriangleVisibility([]).packGpu(),receivers:[],volumeGrid:2,directions:8});
const source={status:'encoded',texture:{createView(){return {};}},generation:1,frame:7,dimensions:[4,8,4],localMax:[1,3,1]};
const environment={texture:{createView(){return {};}},metadata:{route:'scene-pmrem-world-radiance-v1',generation:1,source:'actual-hdr',intensity:2}};
const frame=gather.encode(source,{gain:0,environment});
assert.deepEqual(frame.environment,{...environment.metadata,enabled:true},'smoke must consume the actual environment even with flame gain zero');
assert.equal(uploads.get('smoke environment parameters')[0],1);
assert.equal(gather.transportSource().gain,0,'environment is not added to the flame source used by surface lighting');
assert.equal(gather.encode(source).environment.enabled,false,'removing the environment must not reuse stale illumination');
assert.equal(uploads.get('smoke environment parameters')[0],0);
assert.throws(()=>gather.encode(source,{environment:{metadata:environment.metadata}}),/environment.*texture/i);
for(const pattern of ['source','guided']){
 gather.setAngularPattern(pattern);
 const frame=gather.encode(source,{environment});
 assert.equal(frame.environment.enabled,true);
 assert.ok(passes.includes('cache environment visibility'),'source-biased rays need independent full-sphere environment visibility');
 gather.setDirections(24);gather.encode(source,{environment});
 gather.setDirections(8);gather.encode(source,{environment});
 assert.equal(uploads.get('uniform environment directions').length,8*4,'lowering requested count must upload its own full-sphere constellation, not retain the larger one');
}
gather.destroy();
console.log('PASS environment input, off transition, source-gain isolation and full-sphere source-pattern coverage');
