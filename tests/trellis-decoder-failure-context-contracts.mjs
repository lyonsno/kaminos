// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTrellisSLatDecoderAdapter,buildSLatDecoderPlan,slatDecoderWeightShapes} from '../models/trellis2/slat-decoder.js';
import {WEBGPU_BUFFER_USAGE as U} from '../webgpu-inference-kit/src/core.js';

function fixture({count=0,failStage}={}){
  const allocated=[],runs=[],reads=[],invocation={id:'observed-failed-decoder'};
  const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
    createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),buffer:{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
    uploadTensor(){},defineComputeKernel(k){return k;},
    async runKernel(k,o){runs.push({k,o});if(o.stage===failStage)throw new RangeError('observed kernel failure');},
    async readTensor(t){reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);return new Uint32Array([t.name.includes('hash-status')?0:count]);}};
  const sample=runtime.createTensor({name:'borrowed.shape-codes',shape:[2,2],dtype:'f32',usage:U.storage}),
    coordinates=runtime.createTensor({name:'borrowed.coordinates',shape:[2,3],dtype:'i32',usage:U.storage}),
    config={tokenRows:2,latentChannels:2,resolution:2,channels:[8,4],numBlocks:[0,0]},
    weights=Object.fromEntries(Object.entries(slatDecoderWeightShapes(buildSLatDecoderPlan(config)))
      .map(([name,shape])=>[name,new Float32Array(shape.reduce((a,b)=>a*b,1))]));
  const adapter=createTrellisSLatDecoderAdapter({route:{runtime,routeId:'local-failure-context'},config,weights,
    siluTable:new Float32Array(65536),sampleTensor:sample,coordinateTensor:coordinates});
  return {adapter,allocated,runs,reads,sample,coordinates,invocation};
}

test('empty-child failure exposes exact resident replay inputs and selection boundary until disposal',async()=>{
  const f=fixture(),a=f.adapter;
  assert.equal(a.failureContext,undefined);
  await assert.rejects(a.run(f.invocation),/learned decoder generated empty cells/);
  const c=a.failureContext;
  assert.ok(c,'failed decoder must retain its actual boundary, not only a terminal message');
  assert.equal(c.mode,'shape');assert.equal(c.operation,'subdivision-count');
  assert.equal(c.level,0);assert.equal(c.rows,2);assert.equal(c.resolution,2);
  assert.strictEqual(c.inputs.sample,f.sample);assert.strictEqual(c.inputs.coordinates,f.coordinates);
  assert.strictEqual(c.coordinates,f.coordinates);
  const logits=f.runs.find(r=>r.o.stage==='decoder-linear'&&r.k.bindings.at(-1).resource.name.includes('subdivision-logits')).k.bindings.at(-1).resource;
  assert.strictEqual(c.subdivisionLogits,logits);assert.deepEqual(logits.shape,[2,8]);
  assert.ok(c.features.buffer&&!c.features.destroyed&&!logits.destroyed);
  assert.deepEqual(c.error,{name:'Error',message:'learned decoder generated empty cells; no replacement support'});
  assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.inputs)&&Object.isFrozen(c.error));
  assert.equal(a.outputs.features,undefined,'diagnostic context is not a replacement learned result');
  assert.equal(f.reads.length,2,'context adds no feature readback to normal or failed execution');
  await assert.rejects(a.run(f.invocation),/failed|poison/);
  a.dispose();assert.equal(a.failureContext,undefined,'disposed tensor handles must not be advertised as live');
  assert.ok(logits.destroyed);assert.ok(!f.sample.destroyed&&!f.coordinates.destroyed);
});

test('kernel failure before subdivision preserves causal error and only the boundary actually reached',async()=>{
  const f=fixture({failStage:'decoder-linear'});
  await assert.rejects(f.adapter.run(f.invocation),{name:'RangeError',message:'observed kernel failure'});
  const c=f.adapter.failureContext;
  assert.ok(c,'kernel failures also need an actual reached boundary');
  assert.equal(c.operation,'input-projection');assert.equal(c.level,null);
  assert.equal(c.subdivisionLogits,undefined);assert.strictEqual(c.inputs.sample,f.sample);
  assert.deepEqual(c.error,{name:'RangeError',message:'observed kernel failure'});
  assert.equal(f.reads.length,0);f.adapter.dispose();
});

test('successful decoder publishes no failed context and retains scalar-only serving reads',async()=>{
  const f=fixture({count:2}),out=await f.adapter.run(f.invocation);
  assert.equal(f.adapter.failureContext,undefined);assert.deepEqual(out.features.shape,[2,7]);
  assert.equal(f.reads.length,3);assert.ok(f.runs.every(r=>r.o.schedulerInvocation===f.invocation));
  f.adapter.dispose();
});

test('actual generation composition exposes failed geometry and material decoders before resource release',async()=>{
  await import('../models/trellis2/tests/generation-composition-contracts.mjs');
});
