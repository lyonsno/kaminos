import assert from 'node:assert/strict';
import * as sampler from '../slat-sampler.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {buildSLatDecoderPlan,slatDecoderWeightShapes} from '../sparse-decoder.js';
import {buildSparseBlockPlan,sparseBlockWeightShapes} from '../sparse-block.js';
import {createTrellisSLatFlowAdapter} from '../slat-flow.js';
assert.equal(typeof sampler.createTrellisSLatCascadeSupportAdapter,'function',
  'The serving cascade must compose normalization, learned support and regrid, not leave them as test-only adapter calls.');
const config={tokenRows:3,latentChannels:32,resolution:2,channels:[16,8],numBlocks:[1,0]},
  allocated=[],uploads=[],runs=[],reads=[];let regrid=false,failure;
const arrays=shapes=>Object.fromEntries(Object.entries(shapes).map(([key,shape])=>[key,new Float32Array(shape.reduce((a,b)=>a*b,1))])),
  runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
    createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
    uploadTensor(t,data){uploads.push(t);},defineComputeKernel(k){return k;},
    async runKernel(k,o){runs.push({k,o});if(o.stage==='slat-regrid-mark')regrid=true;if(o.stage===failure)throw Error('injected cascade failure');},
    async readTensor(t){reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);
      return new Uint32Array([t.name.includes('hash-status')?0:regrid?4:5]);}},
  route={runtime,routeId:'actual-cascade-to-HR-interface'},invocation={id:'resident-cascade'},
  sample=runtime.createTensor({name:'LR-sampler-result',shape:[3,32],dtype:'f32',usage:U.storage}),
  coordinates=runtime.createTensor({name:'LR-coordinate-producer',shape:[3,3],dtype:'i32',usage:U.storage}),
  options={route,config,weights:arrays(slatDecoderWeightShapes(buildSLatDecoderPlan({...config,structureOnly:true}))),
    siluTable:new Float32Array(65536),sampleTensor:sample,coordinateTensor:coordinates,meshResolution:128},
  cascade=sampler.createTrellisSLatCascadeSupportAdapter(options);
assert.equal(cascade.outputs.coordinates,undefined);
const support=await cascade.run(invocation);assert.deepEqual(support.coordinates.shape,[4,3]);assert.equal(support.resolution,8);
assert.equal(support.lowResolutionDecodedRows,5);assert.equal(support.metadataReadbackBytes,16);
const hrConfig={tokenRows:support.coordinates.shape[0],channels:24,heads:3,contextRows:7,contextChannels:5,
  hidden:20,frequencyDim:6,numBlocks:1},p=buildSparseBlockPlan(hrConfig),c=p.channels,
  weights={prefix:arrays({'input.weight':[c,32],'input.bias':[c],'time0.weight':[c,6],'time0.bias':[c],
    'time2.weight':[c,c],'time2.bias':[c],'mod.weight':[6*c,c],'mod.bias':[6*c]}),
    blocks:[arrays({...sparseBlockWeightShapes(p),gelu:[65536]})],terminal:{weight:new Float32Array(32*c),bias:new Float32Array(32)}},
  hrNoise=runtime.createTensor({name:'HR-noise-producer',shape:[4,32],dtype:'f32',usage:U.storage}),
  hr=createTrellisSLatFlowAdapter({route,config:hrConfig,weights,conditioning:new Float32Array(35),
    sampleTensor:hrNoise,coordinateTensor:support.coordinates});
await hr.run({timestep:1000},invocation);
assert.strictEqual(hr.inputs.coordinates,cascade.outputs.coordinates);
assert.ok(runs.every(v=>v.o.schedulerInvocation===invocation));
assert.ok(!uploads.some(t=>[sample,coordinates,hrNoise,support.coordinates].includes(t)));
assert.ok(reads.every(t=>t.dtype==='u32'&&t.byteLength===4));
hr.dispose();assert.ok(!support.coordinates.destroyed);cascade.dispose();
assert.ok(allocated.filter(t=>![sample,coordinates,hrNoise].includes(t)).every(t=>t.destroyed));
const failed=sampler.createTrellisSLatCascadeSupportAdapter(options);failure='slat-regrid-mark';
await assert.rejects(failed.run(invocation),/injected/);assert.equal(failed.outputs.coordinates,undefined);
await assert.rejects(failed.run(invocation),/failed|poison/);failed.dispose();
assert.ok(!sample.destroyed&&!coordinates.destroyed);
console.log('Production cascade support composes normalization → learned structure → regrid into the actual high-resolution flow interface; fake runtime is not model/GPU fidelity.');
