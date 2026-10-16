// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLogGasSourceGpu} from '../live-log-gas-source.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,UNIFORM:64};
globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};

test('gas source clears every tick, resets its texture, and owns no GPU device',async()=>{
  const resources=[],writes=[],clears=[];let resolved=0;
  const create=spec=>{const resource={...spec,destroyed:0,createView:()=>({}),destroy(){this.destroyed++;}};resources.push(resource);return resource;};
  const device={createTexture:create,createBuffer:create,createBindGroup:s=>s,
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
    queue:{writeBuffer(){},writeTexture(...args){writes.push(args);}}};
  const source=await createLogGasSourceGpu({device,dimensions:[32,48,32]});
  const encoder={clearBuffer:b=>clears.push(b),beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(x,y,z){assert.deepEqual([x,y,z],[8,12,8]);resolved++;},end(){}})};
  assert.equal(source.descriptor.device,device);assert.equal(source.accumulation.size,32*48*32*8);
  source.begin(encoder);source.resolve(encoder);source.setEnabled(false);source.begin(encoder);source.resolve(encoder);
  assert.equal(clears.length,2);assert.equal(resolved,2);assert.equal(source.read().steps,2);assert.equal(source.read().runtimeReadbacks,0);
  assert.throws(()=>source.setEnabled('false'),/boolean/);
  source.reset();assert.equal(writes.length,2);assert.equal(source.read().steps,0);
  source.dispose();source.dispose();assert.ok(resources.every(r=>r.destroyed===1));
  assert.throws(()=>source.begin(encoder),/disposed/);
});

test('actual fluid registration rejects incompatible source lifetimes and rebinds before detach',()=>{
  const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
  const start=source.indexOf('    bindGpuThermalConsumer(consumer){'),end=source.indexOf('    thermalConsumerState:',start);
  const device={},rebinds=[];
  const context={device,gridSize:32,gridHeight:32,gpuThermalConsumer:null,controlsSnapshot:{},
    resolveTransportConfig:()=>({effective:{predictorPass:true}}),ensureTransportPredictorBuffer:value=>rebinds.push(value)};
  const api=vm.runInNewContext('({'+source.slice(start,end)+'})',context);
  const consumer={device,encode(){},read(){},prepareSource(){},gasSource:{device,dimensions:[32,32,32],texture:{createView(){}}}};
  assert.throws(()=>api.bindGpuThermalConsumer({...consumer,gasSource:{...consumer.gasSource,device:{}}}),/same-device/);
  assert.throws(()=>api.bindGpuThermalConsumer({...consumer,gasSource:{...consumer.gasSource,dimensions:[48,48,48]}}),/dimensions/);
  assert.throws(()=>api.bindGpuThermalConsumer({...consumer,prepareSource:null}),/prepareSource/);
  const detach=api.bindGpuThermalConsumer(consumer);assert.equal(context.gpuThermalConsumer,consumer);
  assert.throws(()=>api.bindGpuThermalConsumer({...consumer}),/already bound/);
  detach();assert.equal(context.gpuThermalConsumer,null);assert.deepEqual(rebinds,[true,true]);detach();assert.equal(rebinds.length,2);
});
