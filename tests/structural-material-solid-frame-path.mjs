import assert from 'node:assert/strict';
import {prepareSolidTopology,packSolidTopology} from '../structural-material-solid-topology.mjs';
import {createSolidResident} from '../structural-material-solid-resident.js';

globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
globalThis.GPUShaderStage={COMPUTE:1};globalThis.GPUMapMode={READ:1};
globalThis.crypto??=(await import('node:crypto')).webcrypto;
const log=[];
function device(){return{limits:{maxStorageBufferBindingSize:1e9,minUniformBufferOffsetAlignment:256},
 createBuffer({size,label}){const bytes=new ArrayBuffer(size);return{size,label,bytes,mapAsync:async()=>{},getMappedRange:()=>bytes,unmap(){},destroy(){}};},
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:x=>x,createPipelineLayout:x=>x,
 async createComputePipelineAsync({compute}){log.push(['compile',compute.entryPoint]);return compute;},createBindGroup:x=>x,
 createCommandEncoder(){return{beginComputePass(){log.push(['pass']);return{setPipeline(p){log.push(['dispatch-pipeline',p.entryPoint]);},setBindGroup(){},dispatchWorkgroups(){},end(){}};},copyBufferToBuffer(a,start,b,end,size){new Uint8Array(b.bytes,end,size).set(new Uint8Array(a.bytes,start,size));log.push(['copy',a.label,size]);},finish(){return{};}};},
 queue:{writeBuffer(buffer,offset,data){const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);new Uint8Array(buffer.bytes,offset,bytes.length).set(bytes);},submit(){},onSubmittedWorkDone:async()=>{log.push(['wait']);}}};}
const model=prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6},{kind:'graph'});
const descriptor={kind:'graph',bufferLayout:model.bufferLayout,points:4,elements:1,bonds:6,colorCount:model.colorCount};
const gpu=device(),a=await createSolidResident(gpu,descriptor,packSolidTopology(model)),b=await createSolidResident(gpu,descriptor,packSolidTopology(model));
assert.equal(log.filter(x=>x[0]==='compile').length,7,'Topology replacement on one device must reuse the seven solver pipelines');
assert.equal(typeof a.readFrame,'function','Routine presentation needs a separate non-diagnostic readback');
log.length=0;const frame=await a.readFrame({stress:false});
assert.equal(frame.diagnostics,null);assert.equal(frame.stresses,null);assert.equal(frame.state.length,64);
assert.deepEqual(log.filter(x=>x[0]==='dispatch-pipeline'),[],'A position-only frame must not evaluate node Hessians or stresses');
assert.deepEqual(log.filter(x=>x[0]==='copy').map(x=>x[1]),['Material state'],'Unchanged topology and diagnostics must stay on the GPU');
log.length=0;await a.readFrame({stress:true});
assert.deepEqual(log.filter(x=>x[0]==='dispatch-pipeline').map(x=>x[1]),['stress']);
assert.ok(!log.some(x=>x[0]==='copy'&&x[1]==='Material bonds'));
log.length=0;const full=await a.read();assert.equal(full.diagnostics.length,96);assert.equal(full.bonds.length,24);
assert.deepEqual(log.filter(x=>x[0]==='dispatch-pipeline').map(x=>x[1]),['diagnose','stress']);
log.length=0;await a.step({iterations:12,lineSearchTrials:8,timeStep:1/60,gravity:0,damping:.98,floor:-10});
assert.equal(log.filter(x=>x[0]==='pass').length,1,'Ordered colored solves should share one compute pass');
assert.equal(log.filter(x=>x[0]==='dispatch-pipeline'&&x[1]==='solve').length,12*model.colorCount);
const other=await createSolidResident(device(),descriptor,packSolidTopology(model));
assert.equal(log.filter(x=>x[0]==='compile').length,7,'A different device needs its own pipelines');
log.length=0;const submitted=await a.step({iterations:12,lineSearchTrials:8,timeStep:1/60,gravity:0,damping:.98,floor:-10},{wait:false});assert.equal(submitted.completion,'submitted');assert.equal(submitted.completionWaitMilliseconds,null);assert.ok(!log.some(x=>x[0]==='wait'));
a.dispose();b.dispose();other.dispose();
console.log('Host frame contract: shared device pipelines, unchanged solver dispatches, minimal normal readback, full explicit diagnostics. Mock GPU does not establish native execution or speed.');
