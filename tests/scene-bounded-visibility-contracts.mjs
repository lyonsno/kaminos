import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const writes=[],pipelines=[],buffers=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(b,o,data){writes.push({label:b.label,data:Array.from(data)});},submit(){}},
 createBuffer(spec){const b={...spec,destroy(){}};buffers.push(b);return b;},
 createTexture(){return {createView:()=>({}),destroy(){}};},createShaderModule:spec=>spec,
 createComputePipeline(spec){pipelines.push(spec);return {getBindGroupLayout:()=>({})};},createBindGroup:()=>({}),
 createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),copyBufferToBuffer(){},finish:()=>({})})};
const options={geometry:buildTriangleVisibility([{a:[-2,-2,4],b:[2,-2,4],c:[0,4,4]}]).packGpu(),receivers:[{position:[0,0,2],normal:[0,0,-1]}],volumeGrid:2,directions:8,angularPattern:'guided',visibilityBounds:'source-volume'};
const api=createVolumeGather(device,options),field={status:'encoded',texture:{createView:()=>({})},dimensions:[4,8,4],localMax:[1,3,1],generation:1};
let m=api.encode(field);
assert.equal(m.visibilityBounds,'source-volume','requested bounded query must be effective, not silently ignored');
assert.deepEqual(writes.filter(w=>w.label==='visibility refresh range').at(-1).data,[0,8,1,0]);
const resourceCounts=[buffers.length,pipelines.length],prepared=m.angularCache.visibilityPreparations;
api.setVisibilityBounds('unbounded');m=api.encode(field);
assert.equal(m.visibilityBounds,'unbounded');assert.equal(m.angularCache.visibilityPreparations,prepared+1);
assert.deepEqual(writes.filter(w=>w.label==='visibility refresh range').at(-1).data,[0,8,0,0]);
api.setVisibilityBounds('source-volume');m=api.encode(field);
assert.equal(m.angularCache.visibilityPreparations,prepared+2);assert.deepEqual([buffers.length,pipelines.length],resourceCounts);
api.setVisibilityBounds('source-volume');assert.equal(api.encode(field).angularCache.visibilityPreparations,prepared+2);
assert.throws(()=>api.setVisibilityBounds('typo'),/visibility bounds/);
api.setDirections(12);m=api.encode(field);assert.equal(m.angularCache.lastPreparedDirections,4);
api.setVisibilityBounds('unbounded');m=api.encode(field);assert.equal(m.angularCache.lastPreparedDirections,12,'bounds change must invalidate a grown prefix');
api.destroy();
// Source-texture installation is setup; subsequent same-texture generation,
// guide and visibility edits must preserve that scattering pipeline.
const scatteringApi=createVolumeGather(device,options);
const scatteringField={...field,scatteringTexture:{createView:()=>({})},scatteringGeneration:1};
scatteringApi.encode(scatteringField,{surfaceScattering:true});
const installed=pipelines.length;
const replayField={...scatteringField,texture:{createView:()=>({})}};
scatteringApi.encode(replayField,{surfaceScattering:true});
assert.equal(pipelines.length,installed+1,'new replay binding has one explicit setup pipeline');
const replayResources=[buffers.length,pipelines.length];
for(let generation=2;generation<=4;generation++){
 scatteringApi.setVisibilityBounds(generation%2?'source-volume':'unbounded');
 scatteringApi.setSourceGuide({lo:[-.5,-1,-.5],hi:[.5,1+.01*generation,.5]});
 scatteringApi.encode({...replayField,generation,scatteringGeneration:generation},{surfaceScattering:true});
 assert.deepEqual([buffers.length,pipelines.length],replayResources,'recurring replay must not pay setup again');
}
scatteringApi.destroy();
assert.throws(()=>createVolumeGather(device,{...options,visibilityBounds:'typo'}),/visibility bounds/);
console.log('bounded visibility mode, invalidation, growth and persistent allocation contracts passed');
