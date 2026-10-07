import assert from 'node:assert/strict';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {createTrellisSparseBlockWorkspace,buildSparseBlockPlan,sparseBlockWeightShapes} from '../sparse-block.js';
import {createTrellisSLatFlowAdapter} from '../slat-flow.js';
import {createTrellisSLatSamplerAdapter} from '../slat-sampler.js';
import {roundBfloat16} from '../sparse-prefix.js';
const allocated=[],uploads=[],runs=[],contexts=[];
let failedStage,pausedStage,releasePause;
const runtime={device:{limits:{maxStorageBufferBindingSize:134217728}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),
    data:new Float32Array(spec.shape.reduce((a,b)=>a*b,1)),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  uploadTensor(t,data){uploads.push(t);t.data.set(data);},defineComputeKernel(k){return k;},
  async runKernel(k,o){runs.push({k,o});if(o.stage===failedStage)throw Error('injected context dispatch failure');
    if(o.stage===pausedStage)await new Promise(resolve=>{releasePause=resolve;});
    const a=k.bindings.map(b=>b.resource);
    if(o.stage==='flow-resident-conditioning-bf16')a[1].data.set(Float32Array.from(a[0].data,roundBfloat16));
    if(o.stage==='flow-resident-negative-zero')a[0].data.fill(0);
    if(o.stage==='cross-kv')contexts.push({tensor:a[0],values:Array.from(a[0].data)});
  },readTensor(){assert.fail('Resident conditioning must not download source features.');}},
  route={runtime,routeId:'same-DINO-flow-session'},config={tokenRows:5,channels:24,heads:3,contextRows:7,
    contextChannels:5,hidden:20,frequencyDim:6,numBlocks:1,steps:3,guidanceInterval:[0,1]},
  source=runtime.createTensor({name:'DINO-final-normalized-features',shape:[1,7,5],dtype:'f32',usage:U.storage}),
  sourceValues=Float32Array.from({length:35},(_,i)=>(i-17)/13);
sourceValues[0]=new Float32Array(new Uint32Array([0x3f808000]).buffer)[0];
sourceValues[1]=new Float32Array(new Uint32Array([0x3f818000]).buffer)[0];source.data.set(sourceValues);
const workspace=createTrellisSparseBlockWorkspace({route,config,conditioningTensor:source,
  phases:new Float32Array(40)});
assert.strictEqual(workspace.sourceConditioning,source,
  'The block workspace must borrow the actual complete DINO tensor instead of requiring CPU feature arrays.');
assert.ok(!uploads.includes(workspace.conditioning));
await workspace.prepareConditioning(false,{id:'direct-context'});
assert.equal(workspace.conditioning.data[0],1);assert.equal(workspace.conditioning.data[1],1.015625);
assert.deepEqual(Array.from(workspace.conditioning.data),Array.from(sourceValues,roundBfloat16));
await workspace.prepareConditioning(true,{id:'direct-context'});
assert.ok(workspace.conditioning.data.every(v=>Object.is(v,0)));
assert.throws(()=>workspace.setConditioning(new Float32Array(35)),/resident|borrowed|CPU/);
workspace.dispose();assert.ok(!source.destroyed);
const p=buildSparseBlockPlan(config),c=p.channels,
  arrays=shapes=>Object.fromEntries(Object.entries(shapes).map(([key,shape])=>[key,new Float32Array(shape.reduce((a,b)=>a*b,1))])),
  weights={prefix:arrays({'input.weight':[c,32],'input.bias':[c],'time0.weight':[c,6],'time0.bias':[c],
    'time2.weight':[c,c],'time2.bias':[c],'mod.weight':[6*c,c],'mod.bias':[6*c]}),
    blocks:[arrays({...sparseBlockWeightShapes(p),gelu:[65536]})],
    terminal:{weight:new Float32Array(32*c),bias:new Float32Array(32)}},
  noise=runtime.createTensor({name:'source-noise',shape:[5,32],dtype:'f32',usage:U.storage}),
  coords=runtime.createTensor({name:'source-coordinates',shape:[5,3],dtype:'i32',usage:U.storage}),
  options={route,config,weights,sampleTensor:noise,coordinateTensor:coords,conditioningTensor:source},
  flow=createTrellisSLatFlowAdapter(options),samplerOptions={route,flow,config,conditioningTensor:source,initialSampleTensor:noise},
  sampler=createTrellisSLatSamplerAdapter(samplerOptions),invocation={id:'DINO-to-actual-sampler'};
const result=await sampler.run({},invocation);assert.equal(result.stepsExecuted,3);
assert.strictEqual(flow.inputs.conditioning,source);assert.strictEqual(result.sample,noise);
assert.ok(contexts.some(v=>v.values.every(x=>x===0)));
assert.ok(contexts.some(v=>v.values[0]===1&&v.values[1]===1.015625));
assert.ok(contexts.every(v=>v.tensor!==source));assert.deepEqual(Array.from(source.data),Array.from(sourceValues));
assert.ok(!uploads.some(t=>[source,noise,coords,...contexts.map(v=>v.tensor)].includes(t)));
assert.ok(runs.filter(v=>v.o.stage.startsWith('flow-resident')).slice(2).every(v=>v.o.schedulerInvocation===invocation));
assert.throws(()=>createTrellisSLatSamplerAdapter({...samplerOptions,conditioning:new Float32Array(35)}),/CPU|borrowed|resident/);
assert.throws(()=>createTrellisSLatSamplerAdapter({...samplerOptions,negativeConditioning:new Float32Array(35)}),/CPU|zero|resident/);
assert.throws(()=>createTrellisSLatSamplerAdapter({...samplerOptions,conditioningTensor:{...source}}),/same|producer/);
await assert.rejects(flow.run({timestep:0,conditioning:new Float32Array(35)},invocation),/CPU|borrowed|resident/);
sampler.dispose();flow.dispose();assert.ok(!source.destroyed&&!noise.destroyed&&!coords.destroyed);
assert.throws(()=>createTrellisSparseBlockWorkspace({route,config,conditioningTensor:source,
  conditioning:new Float32Array(35),phases:new Float32Array(40)}),/CPU|replacement|resident/);
assert.throws(()=>createTrellisSparseBlockWorkspace({route,config,conditioningTensor:{...source,shape:[2,7,5]},
  phases:new Float32Array(40)}),/complete|conditioning/);
const failedFlow=createTrellisSLatFlowAdapter(options),failedSampler=createTrellisSLatSamplerAdapter({...samplerOptions,flow:failedFlow});
failedStage='flow-resident-conditioning-bf16';
await assert.rejects(failedSampler.run({},invocation),/injected/);
await assert.rejects(failedSampler.run({},invocation),/failed dispatch/);
failedSampler.dispose();failedFlow.dispose();failedStage=undefined;
const held=createTrellisSparseBlockWorkspace({route,config,conditioningTensor:source,phases:new Float32Array(40)});
pausedStage='flow-resident-conditioning-bf16';const inFlight=held.prepareConditioning(false,invocation);
assert.throws(()=>held.dispose(),/in use/);await assert.rejects(held.prepareConditioning(true,invocation),/in use/);
releasePause();await inFlight;held.dispose();
assert.ok(allocated.filter(t=>![source,noise,coords].includes(t)).every(t=>t.destroyed));
console.log('Actual resident context → BF16 flow → GPU-zero classifier-free sampler composition; fake runtime tests ownership/control only, not native numerical fidelity.');
