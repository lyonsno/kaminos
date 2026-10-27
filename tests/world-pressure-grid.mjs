// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {worldSmokePlan, createWorldSmoke} from '../volume-world-smoke.mjs';

test('pressure allocation has its own resolution without changing velocity, material or bounds',()=>{
 const base=worldSmokePlan({flow:16,material:32,extent:3});
 const coarse=worldSmokePlan({flow:16,material:32,pressure:8,extent:3});
 assert.deepEqual(coarse.pressureDims,[8,16,8]);
 for(const key of ['flowDims','materialDims','min','max'])assert.deepEqual(coarse[key],base[key]);
 assert.equal(coarse.pressurePitch,2*coarse.flowPitch);
 assert.equal(coarse.pressureCells,base.flowCells/8);
 assert.deepEqual(worldSmokePlan({flow:16,pressure:6}).pressureDims,[6,12,6]);
});

test('material can be coarser than velocity without changing coverage',()=>{
 const p=worldSmokePlan({flow:32,material:16,pressure:8});
 assert.equal(p.materialPitch,2*p.flowPitch);
 assert.equal(p.pressurePitch,4*p.flowPitch);
});

test('actual producer allocates coarse pressure and dispatches sweeps on it, with full velocity projection',()=>{
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
 globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
 globalThis.GPUShaderStage={COMPUTE:1};
 const allocated=[],passes=[];
 const resource=d=>{const r={...d,destroy(){},createView(){return this;}};allocated.push(r);return r;};
 const device={limits:{maxTextureDimension3D:2048,maxStorageBufferBindingSize:1e9,maxBufferSize:1e9},
 createBuffer:resource,createTexture:resource,createShaderModule:x=>x,createBindGroupLayout:x=>x,
 createPipelineLayout:x=>x,createComputePipeline:x=>x,createBindGroup:x=>x,queue:{writeBuffer(){}}};
 const p=worldSmokePlan({flow:16,material:32,pressure:8});
 const field=createWorldSmoke(device,p,{translate:[0,0,0],scale:1});
 const encoder={beginComputePass(){let name;return {setPipeline(p){name=p.compute.entryPoint;},setBindGroup(){},
 dispatchWorkgroups(...dims){passes.push({name,dims});},end(){}};}};
 const result=field.encode(encoder,{fineBuffer:{},reactionTexture:{createView:()=>({})},fineDims:[16,32,16],
 transform:{translate:[0,0,0],scale:1},time:{dtScale:1,backtraceScale:1},iterations:12});
 const pressure=allocated.filter(r=>/^world smoke pressure [01]$/.test(r.label));
 assert.equal(pressure.length,2);
 assert.ok(pressure.every(r=>r.size===8*16*8*4));
 assert.deepEqual(passes.filter(p=>p.name==='pressure'),Array.from({length:12},()=>({name:'pressure',dims:[2,4,2]})));
 assert.deepEqual(passes.find(p=>p.name==='project').dims,[4,8,4]);
 assert.deepEqual(result.pressureDims,[8,16,8]);
 assert.equal(result.pressureIterations,12);
 field.destroy();
});
