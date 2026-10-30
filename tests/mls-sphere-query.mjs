// kaminos-test: node
import assert from 'node:assert/strict';
import {createMlsSphereQuery} from '../mls-sphere-query.mjs';
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4,COPY_SRC:8,MAP_READ:16};globalThis.GPUMapMode={READ:1};
const maps=[],writes=[],buffers=[];let serial=0;
const device={queue:{writeBuffer(buffer,offset,data){writes.push(Array.from(data));},submit(){}},
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
 createComputePipelineAsync:async()=>({getBindGroupLayout(){return {};}}),createBindGroup:()=>({}),
 createBuffer(){const b={destroy(){},unmap(){},mapAsync:()=>new Promise(resolve=>maps.push(resolve)),getMappedRange:()=>new Uint32Array([10,2,0,0]).buffer};buffers.push(b);return b;},
 createCommandEncoder:()=>({clearBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),copyBufferToBuffer(){},finish(){return {};}})};
const query=await createMlsSphereQuery({device,particles:{},config:{capacity:129,min:[-1,-.1,-1],cell:.05,particleRadius:.0325},readSource:()=>({step:++serial})});
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
for(const order of [[1,2],[2,1]]){
 const first=query.sample({center:[order[0],0,0],radius:.5});await settle();
 const second=query.sample({center:[order[1],0,0],radius:.5});const settled=Promise.all([first,second]);
 // Attach rejection handling immediately so pre-fix contention is reported by this assertion.
 settled.catch(()=>{});await settle();assert.equal(maps.length,1,'Only one readback may be mapped');
 maps.shift()();await settle();
 assert.equal(maps.length,1,'Other consumer must wait, not reject while the readback is busy');
 maps.shift()();const result=await settled;assert.deepEqual(result.map(x=>x.overlap),[2,2]);
 assert(result[1].step>result[0].step,'Source step must be captured at each actual queued sample');
 assert.deepEqual(writes.slice(-2).map(x=>x[0]),order);
}
await assert.rejects(query.sample({center:[NaN,0,0],radius:1}),/Invalid/);
query.dispose();await assert.rejects(query.sample({center:[0,0,0],radius:1}),/disposed/);
console.log('Concurrent sphere consumers serialize both orders with dispatch-local identity and disposal rejection');
