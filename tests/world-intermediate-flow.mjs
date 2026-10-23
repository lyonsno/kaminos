// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as world from '../volume-world-smoke.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('GPU profile explicitly excludes unmeasured intermediate solve from cost coverage',()=>{
 const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const start=source.indexOf('      profile.worldSmoke = structuredClone(state.worldSmoke);');
 const end=source.indexOf('      profile.timestampsNs =',start);
 assert.ok(start>=0&&end>start);
 for(const enabled of [false,true]){
  const context={profile:{status:'sampled'},state:{worldSmoke:{effective:'one-way-world-field',intermediate:{effective:enabled?'two-fine-cell-flow':'off'}}},steps:1,worldFlowSamples:[1],worldMaterialSamples:[1],structuredClone};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(context.profile.intermediateTimingStatus,enabled?'unmeasured':'inactive');
  if(enabled)assert.match(context.profile.windowScope,/intermediate solve is unmeasured/i);
 }
});

test('intermediate flow keeps a two-fine-cell pitch and borrows world material',()=>{
  assert.equal(typeof world.intermediateFlowPlan,'function','intermediate flow planner is implemented');
  const far=world.worldSmokePlan({flow:16,material:64,extent:4,fineHeightRatio:1.5});
  const p=world.intermediateFlowPlan(far,[32,48,32],4);
  assert.deepEqual(p.flowDims,[24,32,24]);
  assert.equal(p.flowPitch,.125);
  assert.deepEqual(p.min,[-1.5,-1.5,-1.5]);
  assert.deepEqual(p.max,[1.5,2.5,1.5]);
  assert.deepEqual(p.materialMin,far.min);
  assert.deepEqual(p.materialDims,far.materialDims);
  assert.equal(p.extraMaterialCells,0);
  assert.equal(p.flowCells,24*32*24);
});
test('middle-to-world overlap is continuous, interior one, exterior zero',()=>{
  assert.equal(typeof world.intermediateFlowWeight,'function','middle velocity sampling has a geometric overlap');
  const p={min:[-1.5,-1.5,-1.5],max:[1.5,2.5,1.5],flowPitch:.125};
  assert.equal(world.intermediateFlowWeight([0,0,0],p),1);
  assert.equal(world.intermediateFlowWeight([1.5,0,0],p),0);
  assert.equal(world.intermediateFlowWeight([1.6,0,0],p),0);
  assert.equal(world.intermediateFlowWeight([1.375,0,0],p),.5);
});

test('flow envelope borrows gas without initializing, dispatching, or destroying it',()=>{
  globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
  globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
  globalThis.GPUShaderStage={COMPUTE:1};
  const allocations=[],writes=[],passes=[];
  const resource=desc=>{const r={...desc,destroyed:false,destroy(){this.destroyed=true;},createView(){return this;}};allocations.push(r);return r;};
  const device={limits:{maxTextureDimension3D:2048,maxStorageBufferBindingSize:1e9,maxBufferSize:1e9},
    createBuffer:resource,createTexture:resource,createShaderModule:x=>x,createBindGroupLayout:x=>x,createPipelineLayout:x=>x,
    createComputePipeline:x=>x,createBindGroup:x=>x,queue:{writeBuffer(b){writes.push(b);}}};
  const borrowed={buffers:[resource({label:'borrowed gas 0'}),resource({label:'borrowed gas 1'})],optical:resource({label:'borrowed optical'})};
  const far=world.worldSmokePlan({flow:8,material:16,extent:3});
  const p=world.intermediateFlowPlan(far,[16,32,16]);
  const field=world.createWorldSmoke(device,p,{translate:[0,0,0],scale:1},{borrowMaterial:borrowed});
  assert.equal(allocations.filter(r=>/^world smoke material/.test(r.label)).length,0);
  assert.ok(borrowed.buffers.every(b=>!writes.includes(b)));
  const encoder={beginComputePass(){return {setPipeline(p){passes.push(p.compute.entryPoint);},setBindGroup(_i,g){assert.equal(g.entries.find(e=>e.binding===4).resource.buffer,borrowed.buffers[1]);},dispatchWorkgroups(){},end(){}};}};
  field.encode(encoder,{fineBuffer:{},reactionTexture:{createView:()=>({})},fineDims:[16,32,16],transform:{translate:[0,0,0],scale:1},time:{dtScale:1,backtraceScale:1},materialIndex:1,iterations:2});
  assert.deepEqual(passes,['transportFlow','restrictPressure','pressure','pressure','project']);
  field.destroy();
  assert.ok([...borrowed.buffers,borrowed.optical].every(r=>!r.destroyed));
  assert.ok(allocations.filter(r=>!r.label.startsWith('borrowed')).every(r=>r.destroyed));
});
