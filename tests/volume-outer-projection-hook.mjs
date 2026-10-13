import test from 'node:test';
import assert from 'node:assert/strict';
import {createOuterSmoke} from '../volume-outer-smoke.mjs';

// Host sequencing only; native conformance exercises the actual kernels.
function fixture(){
  Object.assign(globalThis,{GPUBufferUsage:{STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8},GPUTextureUsage:{STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_DST:4},GPUShaderStage:{COMPUTE:1}});
  const calls=[],buffers=[];
  const device={limits:{maxTextureDimension3D:2048,maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(){},writeTexture(){}},
    createBuffer(d){const b={...d,destroy(){}};buffers.push(b);return b;},
    createTexture:()=>({createView:()=>({}),destroy(){}}),createBindGroupLayout:x=>x,
    createShaderModule:x=>x,createPipelineLayout:x=>x,createComputePipeline:x=>x,createBindGroup:x=>x};
  const encoder={beginComputePass(){let name;return {setPipeline(p){name=p.compute.entryPoint;},setBindGroup(){},dispatchWorkgroups(){calls.push(name);},end(){}};}};
  const solver=createOuterSmoke(device,{grid:16,extent:2},16,[{},{}]);
  return {solver,encoder,calls,buffers};
}
test('external projection replaces isolated projection between predictor and publish',()=>{
  const {solver,encoder,calls,buffers}=fixture();
  assert.equal(typeof solver.encodeExternalProjection,'function','outer solver does not expose its preprojection state');
  const seen=[];
  for(let i=0;i<2;i++)solver.encodeExternalProjection(encoder,0,{dtScale:1,backtraceScale:1},(e,state)=>{
    assert.equal(e,encoder);seen.push(state);calls.push('external');
  });
  assert.deepEqual(calls,['advect','external','publish','advect','external','publish']);
  const states=buffers.filter(b=>b.label.startsWith('outer smoke state '));
  assert.deepEqual(seen,[states[1],states[0]],'next predictor must consume the externally corrected ping-pong state');
  assert.equal(solver.receipt().pressureScheme,'external-unverified');
  assert.equal(solver.receipt().pressureCompletion,null);
  assert.equal(solver.receipt().innerFeedback,false,'outer hook alone cannot claim fine consumption');
  assert.equal(solver.receipt().steps,2);
  solver.encode(encoder,0,{dtScale:1,backtraceScale:1});
  assert.equal(solver.receipt().pressureScheme,'red-black-sor');
  assert.ok(calls.includes('project'),'legacy entry still executes isolated projection');
});
test('missing callback refuses before encoding; failed callback prevents stale success',async()=>{
  const {solver,encoder,calls}=fixture();
  assert.equal(typeof solver.encodeExternalProjection,'function','outer solver lacks external projection hook');
  assert.throws(()=>solver.encodeExternalProjection(encoder,0,{dtScale:1,backtraceScale:1}),/synchronous projection callback/);
  assert.deepEqual(calls,[]);
  assert.throws(()=>solver.encodeExternalProjection(encoder,0,{dtScale:1,backtraceScale:1},()=>{throw Error('injected');}),/injected/);
  assert.equal(solver.receipt().steps,0);
  assert.equal(solver.receipt().effective,'external-projection-failed');
  assert.throws(()=>solver.encode(encoder,0,{dtScale:1,backtraceScale:1}),/external projection failed/);
  await assert.rejects(solver.readState(),/external projection failed/);
});
