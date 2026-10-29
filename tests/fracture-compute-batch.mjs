// kaminos-test: node
import assert from 'node:assert/strict';
const {batchCoarseCompute}=await import(process.env.FRACTURE_BATCH_TEST_MODULE??'../fracture-compute-batch.mjs');
globalThis.GPUBufferUsage={UNIFORM:64,COPY_SRC:4};
const observed=[];let passCount=0;
const device={limits:{minUniformBufferOffsetAlignment:256},createBuffer({size,usage}){return{size,usage,data:new ArrayBuffer(size),getMappedRange(){return this.data;},unmap(){},destroy(){}};},createBindGroup(d){return d;},createCommandEncoder(){const ops=[];return{copyBufferToBuffer(a,ao,b,bo,n){ops.push(()=>new Uint8Array(b.data,bo,n).set(new Uint8Array(a.data,ao,n)));},beginComputePass(){passCount++;let group;return{setPipeline(){},setBindGroup(i,g){group=g;},dispatchWorkgroups(){const g=group;ops.push(()=>observed.push(new Uint32Array(g.entries[0].resource.buffer.data,g.entries[0].resource.offset??0,1)[0]));},end(){}};},finish(){return ops;}};}};
device.queue={writeBuffer(buffer,offset,data){new Uint8Array(buffer.data,offset,data.byteLength).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));},submit(commands){for(const cmd of commands)for(const op of cmd)op();}};
const records=new Map();const backend={device,get(g){if(!records.has(g))records.set(g,{});return records.get(g);},beginCompute(){},finishCompute(){}};
const renderer={backend};const originalBegin=backend.beginCompute,originalWrite=device.queue.writeBuffer,originalCreate=device.createBindGroup,originalSubmit=device.queue.submit;
batchCoarseCompute(renderer,()=>{
 const uniform=device.createBuffer({size:16,usage:64}),binding=device.createBindGroup({layout:{},entries:[{binding:0,resource:{buffer:uniform}}]});
 for(const value of [1,2]){device.queue.writeBuffer(uniform,0,new Uint32Array([value,0,0,0]));const group={};backend.beginCompute(group);const pass=backend.get(group).passEncoderGPU;pass.setPipeline({});pass.setBindGroup(0,binding);pass.dispatchWorkgroups(1);backend.finishCompute(group);}
});
assert.deepEqual(observed,[1,2],'Dispatches must consume their own uniform values');
assert.equal(backend.beginCompute,originalBegin,'Backend restored');
assert.equal(passCount,1,'Uniform-only changes should share one compute pass');
assert.equal(device.queue.writeBuffer,originalWrite,'Queue write hook must be scoped to the synchronous solve');
assert.equal(device.createBindGroup,originalCreate,'Bind-group hook must be scoped to the synchronous solve');
assert.equal(device.queue.submit,originalSubmit,'Queue submission restored');
assert.throws(()=>batchCoarseCompute(renderer,()=>{throw Error('intentional');}),/intentional/);
assert.equal(backend.beginCompute,originalBegin,'Backend restored after failure');
assert.equal(device.queue.writeBuffer,originalWrite,'Queue write restored after failure');
assert.equal(device.createBindGroup,originalCreate,'Bind-group creation restored after failure');
console.log('Uniform versioning, one-pass encoding, and restoration checks passed');

// Reuse renderer-cached bindings across frames, including an ordered storage write.
let binding,uniform;
const emit=()=>{const group={};backend.beginCompute(group);const pass=backend.get(group).passEncoderGPU;pass.setBindGroup(0,binding);pass.dispatchWorkgroups(1);backend.finishCompute(group);};
batchCoarseCompute(renderer,()=>{uniform=device.createBuffer({size:16,usage:64});binding=device.createBindGroup({layout:{},entries:[{binding:0,resource:{buffer:uniform}}]});device.queue.writeBuffer(uniform,0,new Uint32Array([3,0,0,0]));emit();});
batchCoarseCompute(renderer,()=>{emit();device.queue.writeBuffer(uniform,0,new Uint32Array([4,0,0,0]));emit();});
assert.deepEqual(observed,[1,2,3,3,4],'Cached binding consumes each frame/version correctly');
const storage=device.createBuffer({size:16,usage:0});
batchCoarseCompute(renderer,()=>{binding=device.createBindGroup({layout:{},entries:[{binding:0,resource:{buffer:storage}}]});device.queue.writeBuffer(storage,0,new Uint32Array([9,0,0,0]));emit();device.queue.writeBuffer(storage,0,new Uint32Array([10,0,0,0]));emit();});
assert.deepEqual(observed.slice(-2),[9,10],'Storage writes preserve their position between dispatches');
