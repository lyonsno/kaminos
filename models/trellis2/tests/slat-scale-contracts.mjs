import assert from 'node:assert/strict';
import * as scale from '../slat-sampler.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
assert.equal(typeof scale.createTrellisSLatScaleAdapter,'function',
  'The sampled resident codes must reach decoder units and shape-to-texture conditioning without a CPU transform.');
const {createTrellisSLatScaleAdapter:create,buildSLatScalePlan:build}=scale;
assert.equal(build({tokenRows:3,mode:'shape'}).direction,'denormalize');
for(const config of [{tokenRows:0},{tokenRows:3,mode:'wrong'},{tokenRows:3,direction:'fallback'}])assert.throws(()=>build(config));
for(const mode of ['shape','texture'])for(const direction of ['normalize','denormalize']){
  const owned=[],uploads=[],dispatches=[],reads=[],input={name:'sampler-result',shape:[3,32],dtype:'f32',usage:U.storage,
    byteLength:3*32*4,buffer:{destroy(){throw Error('borrowed input must remain alive');}},data:Float32Array.from({length:96},(_,i)=>(i-48)/8)},
    before=input.data.slice(),runtime={device:{limits:{maxStorageBufferBindingSize:4096,maxComputeWorkgroupsPerDimension:2}},
      createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),data:new Float32Array(spec.shape.reduce((a,b)=>a*b,1)),
        buffer:{destroy(){t.destroyed=true;}}};owned.push(t);return t;},uploadTensor(t,a){uploads.push(t);t.data=a.slice();},
      defineComputeKernel(k){return k;},async runKernel(k,options){dispatches.push(options);
        const [a,b,out]=k.bindings.map(v=>v.resource);for(let i=0;i<a.data.length;i++){
          const c=b.data[i%32];out.data[i]=options.stage.endsWith('multiply')?a.data[i]*c:
            options.stage.endsWith('add')?a.data[i]+c:options.stage.endsWith('subtract')?a.data[i]-c:a.data[i]/c;
        }},async readTensor(t){reads.push(t);return t.data;}};
  const route={runtime,routeId:'one-serving-session'},adapter=create({route,tokenRows:3,mode,direction,sampleTensor:input});
  assert.equal(adapter.inputs.sample,input);assert.notEqual(adapter.outputs.sample,input);
  const output=await adapter.run({invocation:'same-job'});assert.equal(output,adapter.outputs.sample);
  assert.equal(output.dtype,'f32');assert.deepEqual(output.shape,[3,32]);assert.deepEqual(input.data,before);
  assert.deepEqual(dispatches.map(d=>d.stage),adapter.plan.stages);assert.ok(dispatches.every(d=>d.schedulerInvocation.invocation==='same-job'));
  assert.equal(reads.length,0);assert.equal(uploads.length,2);assert.ok(uploads.every(t=>t.data.length===32));
  const [mean,std]=uploads.map(t=>t.data);
  for(let i=0;i<96;i++)assert.equal(output.data[i],direction==='denormalize'?Math.fround(Math.fround(before[i]*std[i%32])+mean[i%32]):
    Math.fround(Math.fround(before[i]-mean[i%32])/std[i%32]));
  adapter.dispose();assert.ok(owned.every(t=>t.destroyed));await assert.rejects(()=>adapter.run({}),/disposed/);
  // Unknown additive metadata is harmless; the complete borrowed shape is not.
  assert.throws(()=>create({route,tokenRows:3,mode,direction,sampleTensor:{...input,dtype:'f16'}}));
  assert.throws(()=>create({route,tokenRows:3,mode,direction,sampleTensor:{...input,shape:[3,31]}}));
  assert.throws(()=>create({route,tokenRows:3,mode,direction,sampleTensor:{...input,byteLength:4}}));
  assert.throws(()=>create({route,tokenRows:3,mode,direction,sampleTensor:{...input,usage:0}}));
}
// Serving binding limits reject complete work, never silently truncate it.
const input={shape:[3,32],dtype:'f32',usage:U.storage,byteLength:384,buffer:{}},
  runtime={device:{limits:{maxStorageBufferBindingSize:128}},createTensor(){throw Error('no allocation before capacity rejection');},uploadTensor(){},defineComputeKernel(){},runKernel(){}};
assert.throws(()=>create({route:{runtime},tokenRows:3,sampleTensor:input}),/capacity/);
// Construction errors release only newly owned buffers; borrowed inputs live.
for(const failure of ['allocation','upload','kernel']){
  const allocated=[],r={...runtime,device:{limits:{maxStorageBufferBindingSize:4096}},
    createTensor(spec){if(failure==='allocation'&&allocated.length===2)throw Error('injected allocation');
      const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
    uploadTensor(){if(failure==='upload')throw Error('injected upload');},
    defineComputeKernel(k){if(failure==='kernel')throw Error('injected kernel');return k;}};
  assert.throws(()=>create({route:{runtime:r},tokenRows:3,sampleTensor:input}),/injected/);
  assert.ok(allocated.every(t=>t.destroyed));assert.ok(!input.destroyed);
}
// The adapter cannot be disposed or run concurrently while its output is in use.
const allocated=[];let release;
const r={...runtime,device:{limits:{maxStorageBufferBindingSize:4096}},
  createTensor(spec){const t={...spec,buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  defineComputeKernel(k){return k;},runKernel(){return new Promise(resolve=>{release=resolve;});}},
  a=create({route:{runtime:r},tokenRows:3,sampleTensor:input}),active=a.run({id:'active'});
await assert.rejects(a.run({}),/in use/);assert.throws(()=>a.dispose(),/in use/);
release();await Promise.resolve();release();await active;a.dispose();assert.ok(allocated.every(t=>t.destroyed));
console.log('Resident SLat normalization binds exact input, two F32 boundaries, full rows, same invocation and owned cleanup; fake runtime is not GPU conformance.');
