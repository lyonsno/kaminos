// kaminos-test: node
import assert from 'node:assert/strict';
import {createCompositeGrid} from '../volume-composite-grid.mjs';
import {createCompositePCGGPU} from '../volume-composite-pcg-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};
globalThis.GPUShaderStage={COMPUTE:1};
function capture(width,uniformCounts){
  const codes=[],uploads=[];
  const device={limits:{maxComputeWorkgroupsPerDimension:65535,maxBufferSize:1e9,maxStorageBufferBindingSize:1e9},
    queue:{writeBuffer(b,offset,data){if(b.usage&8)uploads.push(Array.from(data));}},
    createBuffer(d){return {...d,destroy(){}};},createShaderModule(d){codes.push(d.code);return d;},
    createBindGroupLayout(d){return d;},createPipelineLayout(d){return d;},createBindGroup(d){return d;},
    createComputePipeline(){return {getBindGroupLayout(){return {};}};}};
  const grid=createCompositeGrid({shape:[width,8,8],cellWidth:1,fine:{min:[2,2,2],max:[4,4,4],ratio:2},boundary:()=> 'open'});
  const solver=createCompositePCGGPU(device,grid,{uniformCounts});solver.destroy();
  return {codes,uploads,n:grid.cells.length,m:grid.faces.length};
}
const a=capture(8,true),b=capture(10,true);
assert.notEqual(a.n,b.n);
assert.deepEqual(a.codes,b.codes,'uniform shader sources must not specialize on topology counts');
assert.deepEqual(a.uploads[0],[a.n,a.m,0,0]);
assert.deepEqual(b.uploads[0],[b.n,b.m,0,0]);
assert.notDeepEqual(capture(8,false).codes,capture(10,false).codes,'constant control must retain count specialization');
console.log('uniform count source and upload contract passed');
