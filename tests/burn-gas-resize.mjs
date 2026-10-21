// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLogGasSourceGpu} from '../live-log-gas-source.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,UNIFORM:64};
globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};

test('grid resize retains the gas producer identity and feed state, replacing only grid resources',async()=>{
 const resources=[],dispatches=[];let rejectBuffer=false;
 const create=spec=>{const r={...spec,destroyed:0,createView:()=>({owner:r}),destroy(){this.destroyed++;}};resources.push(r);return r;};
 const device={createTexture:create,createBuffer:spec=>{if(rejectBuffer)throw Error('allocation refused');return create(spec);},createBindGroup:s=>s,
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),queue:{writeBuffer(){},writeTexture(){}}};
 const source=await createLogGasSourceGpu({device,dimensions:[32,32,32]});
 assert.equal(typeof source.resize,'function','A live burn producer must follow fluid grid changes');
 const descriptor=source.descriptor,texture=descriptor.texture,accumulation=source.accumulation;
 source.setEnabled(false);source.resize([48,64,48]);
 assert.equal(source.descriptor,descriptor);assert.equal(source.enabled,false);
 assert.deepEqual(descriptor.dimensions,[48,64,48]);assert.notEqual(descriptor.texture,texture);
 assert.equal(texture.destroyed,1);assert.equal(accumulation.destroyed,1);
 assert.equal(source.accumulation.size,48*64*48*8);
 const live=source.descriptor.texture;source.resize([48,64,48]);assert.equal(source.descriptor.texture,live);
 assert.throws(()=>source.resize([48,0,48]),/dimensions/);assert.equal(source.descriptor.texture,live);
 rejectBuffer=true;assert.throws(()=>source.resize([64,64,64]),/allocation refused/);rejectBuffer=false;
 assert.equal(source.descriptor.texture,live);assert.deepEqual(source.descriptor.dimensions,[48,64,48]);
 source.resolve({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(...dims){dispatches.push(dims);},end(){}})});
 assert.deepEqual(dispatches,[[12,16,12]]);
 source.dispose();source.dispose();assert.ok(resources.every(r=>r.destroyed===1));
});
