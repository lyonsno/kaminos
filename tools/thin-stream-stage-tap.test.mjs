import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installThinStreamStageTap} from './thin-stream-stage-tap.mjs';
function fixture(){
  const copies=[];
  class Device {
    createBuffer(d){return {...d,values:new Uint8Array(d.size),mapAsync:async()=>{},getMappedRange(){return this.values.buffer},unmap(){},destroy(){this.destroyed=true}}}
    async createComputePipelineAsync(d){return {entry:d.compute.entryPoint}}
    createCommandEncoder(d){return {label:d.label,beginComputePass(){return {setPipeline(p){this.pipeline=p},setBindGroup(){},dispatchWorkgroups(){},end(){}}},copyBufferToBuffer(a,ao,b,bo,n){b.values.set(a.values.subarray(ao,ao+n),bo);copies.push({a,b,n})},finish(){return {}}}}
  }
  const w={};const context={window:w,GPUDevice:Device,GPUBufferUsage:{COPY_DST:8,MAP_READ:1},GPUMapMode:{READ:1},WeakMap,Map,Set,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64')};
  vm.runInNewContext('('+installThinStreamStageTap.toString()+')()',context);
  const device=new Device();return {w,device,copies};
}
test('copies actual particle states at each selected native dispatch without mutating input',async()=>{
  const {w,device,copies}=fixture();const p=device.createBuffer({label:'kaminos-finger-fluid-particles',size:16});device.createBuffer({label:'kaminos-finger-fluid-rest-state',size:4});device.createBuffer({label:'kaminos-finger-fluid-params',size:4});
  w.__thinStreamTrace.active={step:180};const e=device.createCommandEncoder({label:'kaminos-finger-fluid-simulation-step'});const pass=e.beginComputePass({});
  for(const [entry,value] of [['predict_positions',4],['apply_surface_cohesion',8]]){const pipeline=await device.createComputePipelineAsync({compute:{entryPoint:entry}});pass.setPipeline(pipeline);pass.setBindGroup(0,{});p.values[0]=value;pass.dispatchWorkgroups(1)}pass.end();
  assert.equal(w.__thinStreamTrace.records.length,2,'selected native stages must produce two snapshots');assert.equal(copies.length,6);assert.equal(w.__thinStreamTrace.records[0].buffers[0].buffer.values[0],4);assert.equal(w.__thinStreamTrace.records[1].buffers[0].buffer.values[0],8);assert.equal(p.values[0],8);
});
test('unarmed simulation and unrelated encoder produce no evidence or copies',async()=>{
 const {w,device,copies}=fixture();const pipeline=await device.createComputePipelineAsync({compute:{entryPoint:'apply_surface_cohesion'}});
 for(const label of ['kaminos-finger-fluid-simulation-step','other']){const e=device.createCommandEncoder({label});const p=e.beginComputePass({});p.setPipeline(pipeline);p.dispatchWorkgroups(1);p.end()}
 assert.equal(copies.length,0);assert.equal(w.__thinStreamTrace.records.length,0);
});
test('missing native buffers fail instead of fabricating empty evidence',async()=>{
 const {w,device}=fixture();w.__thinStreamTrace.active={step:180};const pipeline=await device.createComputePipelineAsync({compute:{entryPoint:'apply_surface_cohesion'}});const p=device.createCommandEncoder({label:'kaminos-finger-fluid-simulation-step'}).beginComputePass({});p.setPipeline(pipeline);assert.throws(()=>p.dispatchWorkgroups(1),/native trace buffer missing/);
});
import {validateThinStreamStageTrace} from './thin-stream-stage-tap.mjs';
function artifact(){
 const names=['predict_positions','compute_density_lambda','solve_position_delta','apply_position_delta','classify_free_surface','compute_velocity_viscosity','apply_surface_cohesion','apply_velocity_position'];
 const p=Buffer.alloc(128);p.writeFloatLE(.1,64);p.writeFloatLE(1,60);p.writeFloatLE(1,124);const params=Buffer.alloc(224);params.writeUInt32LE(2,4);params.writeUInt32LE(179,8);
 return {schema:'soggy.native-fluid-stage-trace.v1',route:'native-dispatch-copy-with-pass-splitting.v1',records:names.map((entry,i)=>({step:180,entry,ordinal:i,buffers:[{label:'kaminos-finger-fluid-particles',size:128,bytes:p.toString('base64')},{label:'kaminos-finger-fluid-rest-state',size:32,bytes:Buffer.alloc(32).toString('base64')},{label:'kaminos-finger-fluid-params',size:224,bytes:params.toString('base64')}]}))};
}
test('retained stage artifact rejects wrong route, partial, stale, reordered and nonfinite evidence',()=>{
 const good=artifact();assert.equal(validateThinStreamStageTrace(good,180,2,1).complete,true);
 for(const [change,pattern] of [
  [a=>{a.route='fallback'},/wrong.*route/],
  [a=>{a.records.pop()},/missing.*stages/],
  [a=>{a.records[0].step=179},/stale step/],
  [a=>{a.records[1].buffers[0].bytes=''},/partial/],
  [a=>{const b=Buffer.from(a.records[1].buffers[0].bytes,'base64');b.writeFloatLE(NaN,0);a.records[1].buffers[0].bytes=b.toString('base64')},/nonfinite/],
  [a=>{const b=Buffer.from(a.records[1].buffers[2].bytes,'base64');b.writeUInt32LE(178,8);a.records[1].buffers[2].bytes=b.toString('base64')},/frame mismatch/]
 ]){const a=structuredClone(good);change(a);assert.throws(()=>validateThinStreamStageTrace(a,180,2,1),pattern)}
});
test('blank final material cannot be presented as a completed native stream trace',()=>{
 const a=artifact();a.records.at(-1).buffers[0].bytes=Buffer.alloc(128).toString('base64');assert.throws(()=>validateThinStreamStageTrace(a,180,2,1),/blank final material/);
});
import {validateOwnedCdpEndpoint} from './thin-stream-stage-tap.mjs';
function withCadence(step,confinement){const a=artifact();for(const r of a.records){r.step=step;const b=Buffer.from(r.buffers[2].bytes,'base64');b.writeUInt32LE(step-1,8);r.buffers[2].bytes=b.toString('base64')}
 if(confinement){const r=structuredClone(a.records[5]);r.entry='apply_vorticity_confinement';a.records.splice(6,0,r)}a.records.forEach((r,i)=>r.ordinal=i);return a}
test('required confinement cannot be omitted on frame180',()=>{assert.throws(()=>validateThinStreamStageTrace(withCadence(181,false),181,2,1),/missing.*stages/)});
test('skipped confinement cannot appear on frame179',()=>{assert.throws(()=>validateThinStreamStageTrace(withCadence(180,true),180,2,1),/missing.*stages/)});
test('owned profile endpoint must reject a foreign browser before page mutation',()=>{
 assert.throws(()=>validateOwnedCdpEndpoint('4242\n/devtools/browser/owned\n',{webSocketDebuggerUrl:'ws://127.0.0.1:4242/devtools/browser/foreign'}),/owned profile.*mismatch/);
});
test('both correct confinement sequences and matched owned endpoint pass',()=>{
 assert.equal(validateThinStreamStageTrace(withCadence(181,true),181,2,1).complete,true);assert.equal(validateThinStreamStageTrace(withCadence(180,false),180,2,1).complete,true);
 assert.deepEqual(validateOwnedCdpEndpoint('4242\n/devtools/browser/owned\n',{webSocketDebuggerUrl:'ws://127.0.0.1:4242/devtools/browser/owned'}),{port:4242,browserPath:'/devtools/browser/owned'});
 assert.throws(()=>validateOwnedCdpEndpoint('4242\n/devtools/browser/owned\n',{webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/owned'}),/mismatch/);
});
