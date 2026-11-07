// kaminos-test: node
import assert from 'node:assert/strict';
import {createFireSmokeShadow} from '../fire-smoke-shadow.mjs';
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4};
globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
const requests=[],pipeline={getBindGroupLayout:()=>({})};
const device={limits:{maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(){},submit(){}},
 createComputePipeline(){throw Error('blocking smoke-shadow compilation used');},
 createComputePipelineAsync(descriptor){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({label:descriptor.label,resolve,reject});return promise;},
 createShaderModule:()=>({}),createBuffer:()=>({destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),createBindGroup:()=>({}),
 createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})})};
const points=device.createTexture(),shadow=createFireSmokeShadow(device,{points,count:1,resolution:2,steps:8,asynchronous:true});
const field={status:'encoded',texture:device.createTexture(),dimensions:[4,8,4],generation:1,frame:1};
assert.equal(shadow.isPrepared(),false);
assert.throws(()=>shadow.encode(field,{generation:1,frame:1,count:1}),/not completed/);
let complete=false;const first=shadow.ready().then(()=>complete=true);await Promise.resolve();assert.equal(complete,false);
assert.deepEqual(requests.map(r=>r.label),['smoke optical-depth prefix rays'],'unused filter and prepared-medium variants stay cold');
requests.forEach(r=>r.resolve(pipeline));await first;assert.equal(shadow.isPrepared(),true);shadow.encode(field,{generation:1,frame:1,count:1});
const count=requests.length;shadow.setQuality({resolution:4,steps:12});assert.equal(shadow.isPrepared(),true);assert.equal(requests.length,count,'uniform/texture dimensions do not compile pipelines');
shadow.setQuality({mediumResolution:2,filter:true});assert.equal(shadow.isPrepared(),false);
const next=shadow.ready();await Promise.resolve();assert(requests.some(r=>r.label==='volume-average shadow extinction'));assert(requests.some(r=>r.label==='filtered smoke optical-depth prefix rays'));assert(requests.some(r=>r.label==='smoke neighboring-direction transmission filter'));
for(const r of requests.slice(count))r.resolve(pipeline);await next;assert.equal(shadow.isPrepared(),true);shadow.encode(field,{generation:1,frame:1,count:1});
shadow.setQuality({mediumResolution:0,filter:false});assert.equal(shadow.isPrepared(),true);assert.equal(requests.length,count+3,'switching to prepared variants reuses prior raw kernel');
shadow.dispose();console.log('PASS live smoke-shadow raw/prepared/filter kernels prepare asynchronously and dimension edits reuse them');
