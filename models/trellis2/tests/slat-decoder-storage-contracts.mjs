import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSLatDecoderPlan,slatDecoderWeightShapes,createTrellisSLatDecoderAdapter} from '../slat-decoder.js';
import {createSLatDecoderKernelOps} from '../slat-decoder-ops.js';
import * as checks from '../slat-decoder-witness-checks.js';
test('storage witness cannot accept missing identity or a default route instead of requested half storage',()=>{
  assert.equal(typeof checks.validateDecoderActivationStorage,'function');
  const observed={composition:{decoderActivationStorage:{shape:'f16',texture:'f16'}},requiredFeatures:['shader-f16']};
  checks.validateDecoderActivationStorage(observed,{shape:'f16',texture:'f16'});
  for(const candidate of [{}, {...observed,requiredFeatures:[]}, {...observed,composition:{decoderActivationStorage:{shape:'f32',texture:'f16'}}}])
    assert.throws(()=>checks.validateDecoderActivationStorage(candidate,{shape:'f16',texture:'f16'}),/storage|shader-f16/);
});
test('physical activation storage selection is explicit and rejects unsupported formats',()=>{
  assert.equal(buildSLatDecoderPlan({tokenRows:1,activationStorage:'f16'}).activationStorage,'f16');
  assert.throws(()=>buildSLatDecoderPlan({tokenRows:1,activationStorage:'int8'}),/activation storage/);
});
test('half tensors consume two bytes per value under the actual binding allowance',()=>{
  const allocations=[];const runtime={device:{features:new Set(['shader-f16']),limits:{maxStorageBufferBindingSize:1024}},
    createTensor(spec){allocations.push(spec);return{...spec,byteLength:spec.shape.reduce((a,b)=>a*b,2),buffer:{destroy(){}}};},
    defineComputeKernel(){},runKernel(){},readTensor(){},uploadTensor(){}};
  const ops=createSLatDecoderKernelOps(runtime);
  const t=ops.allocate('half-feature',[8,64],'f16');assert.equal(t.byteLength,1024);assert.equal(t.dtype,'f16');
  assert.throws(()=>ops.allocate('full-feature',[8,64],'f32'),/binding capacity/);
  ops.dispose();
});
test('actual decoder binds half features, keeps endpoints and weights full, and preserves every element dispatch',async()=>{
  const allocated=[],runs=[];
  const runtime={device:{features:new Set(['shader-f16']),limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
    createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,spec.dtype==='f16'?2:4),buffer:{destroy(){}}};allocated.push(t);return t;},
    uploadTensor(){},defineComputeKernel(spec){return spec;},async runKernel(kernel,options){runs.push({kernel,options});},
    async readTensor(t){return new Uint32Array([t.name.includes('hash-status')?0:5]);}};
  const config={tokenRows:3,latentChannels:2,resolution:2,channels:[16,8],numBlocks:[1,0],activationStorage:'f16'},
    weights=Object.fromEntries(Object.entries(slatDecoderWeightShapes(buildSLatDecoderPlan(config))).map(([n,s])=>[n,new Float32Array(s.reduce((a,b)=>a*b,1))])),
    sample=runtime.createTensor({shape:[3,2],dtype:'f32',usage:128}),coords=runtime.createTensor({shape:[3,3],dtype:'i32',usage:128}),
    decoder=createTrellisSLatDecoderAdapter({route:{runtime},config,weights,siluTable:new Float32Array(65536),sampleTensor:sample,coordinateTensor:coords});
  const result=await decoder.run({});assert.equal(result.activationStorage,'f16');assert.equal(result.features.dtype,'f32');
  assert.ok(result.subdivisions.every(t=>t.dtype==='f32'));
  assert.ok(allocated.some(t=>t.dtype==='f16'&&t.name.includes('expanded-mlp')));
  for(const {kernel,options}of runs){
    for(const match of kernel.code.matchAll(/@binding\((\d+)\)[^;]*?array<(f32|f16|i32|u32)>/g))
      assert.equal(kernel.bindings[Number(match[1])].resource.dtype,match[2]);
    if(['decoder-silu','decoder-residual'].includes(options.stage)){
      const t=kernel.bindings.find(b=>b.resource.dtype==='f16').resource;
      assert.equal(options.dispatch[0],Math.ceil(t.shape.reduce((a,b)=>a*b,1)/256));
    }
  }
  decoder.dispose();
  runtime.device.features.clear();assert.throws(()=>createSLatDecoderKernelOps(runtime).allocate('unsupported',[2],'f16'),/shader-f16/);
});
