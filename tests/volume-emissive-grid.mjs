import assert from 'node:assert/strict';
import {createEmissiveLightField} from '../volume-emissive-transport.mjs';
globalThis.GPUBufferUsage={STORAGE:1};
for(const [grid,height] of [[32,64],[96,192],[64,64]]) {
  const pipelines=[];
  const device={createBuffer:()=>({destroy(){}}),createBindGroup:x=>x,
    createComputePipeline:desc=>{pipelines.push(desc);return {getBindGroupLayout:()=>({})};}};
  createEmissiveLightField(device,{}, {}, [{},{}],[{},{}],grid,height);
  const seed=pipelines.find(p=>p.compute.entryPoint==='seedEmissiveLight');
  assert.deepEqual(seed.compute.constants,{GRID:grid,GRID_Y:height},
    'light seed must address the actual fluid grid, not shader default64x128');
}
console.log('emissive light seed dimension contract passed');
