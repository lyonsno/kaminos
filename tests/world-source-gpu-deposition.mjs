// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../volume-world-sources.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2};
test('World source changes upload parcel descriptors and dispatch GPU deposition without a CPU field',()=>{
 const writes=[],passes=[],textures=[];
 const d={limits:{maxTextureDimension2D:16384,maxStorageBufferBindingSize:2**28,maxBufferSize:2**28},createBuffer:s=>({...s,destroy(){}}),createTexture:s=>{const t={...s,createView(){return {texture:t};},destroy(){}};textures.push(t);return t;},createShaderModule:s=>s,createComputePipeline:s=>({...s,getBindGroupLayout:()=>({})}),createBindGroup:s=>s,queue:{writeBuffer(b,offset,data){writes.push(data.byteLength);},writeTexture(){assert.fail('No CPU source field upload');},onSubmittedWorkDone:async()=>{}}};
 const encoder={beginComputePass(){const p={};passes.push(p);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(...dims){p.dims=dims;},end(){}};}};
 assert.equal(typeof sources.createGPUWorldSourceAtlas,'function','GPU deposition must replace the live CPU rasterizer');
 const a=sources.createGPUWorldSourceAtlas(d,{dims:[8,4,4],min:[0,0,0],pitch:1},'test supply');
 const p={lo:[0,0,0],hi:[1,1,1],rate:.5,fuel:1,heat:1,relax:.2,velocity:[1,0,0]};
 try{const first=a.encode(encoder,[p]);assert.equal(passes.length,1);assert.deepEqual(passes[0].dims,[2,1,1]);assert.ok(writes.every(n=>n<=64),'only a compact parcel and grid parameters reach the GPU');assert.equal(a.encode(encoder,[p]),first);assert.equal(passes.length,1,'unchanged sources reuse their GPU field');a.encode(encoder,[{...p,heat:2}]);assert.equal(passes.length,2);const empty=a.encode(encoder,[]);assert.notEqual(empty,first);assert.equal(passes.length,2,'an empty source binds the empty texture');assert.equal(a.encode(encoder,[p]),first);assert.equal(passes.length,3,'removing and restoring a source cannot reuse stale contents');}finally{a.destroy();}
});
