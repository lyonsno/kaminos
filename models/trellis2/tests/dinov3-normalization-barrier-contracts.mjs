import assert from 'node:assert/strict';
import {runTrellisDinoV3LayerNormResident,runTrellisDinoV3FinalNoAffineLayerNormResident} from '../dinov3-serving.js';
const kernels=[];
const buffer=descriptor=>({...descriptor,destroy(){this.destroyed=true;}});
const runtime={createManagedBuffer:buffer,createTensor:d=>({...d,buffer:buffer(d)}),
  createUniformBuffer:d=>({buffer:buffer(d)}),uploadTensor(){},defineComputeKernel:d=>d,
  async runKernel(k){kernels.push(k);}};
const inputTensor={name:'trellis.dinov3.block23.mlp.residual-output',buffer:buffer({}),dtype:'f32',shape:[1,1029,1024],usage:128,byteLength:1029*1024*4};
await runTrellisDinoV3LayerNormResident({runtime,inputTensor,layerIndex:0,
  weight:new Float32Array(1024).fill(1),bias:new Float32Array(1024),managedTensorBuffers:true});
await runTrellisDinoV3FinalNoAffineLayerNormResident({runtime,inputTensor,managedTensorBuffers:true});
assert.equal(kernels.length,2,'exercise both actual public normalization producers');
function protectsMeanLoad(code){
  // Inspect emitted WGSL, not a README or implementation-file phrase. Ignore
  // comments so a comment mentioning a barrier cannot satisfy ordering.
  const clean=code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const load=clean.indexOf('let mean = reduction[0]'),reuse=clean.indexOf('reduction[lane] = variance_partial;',load);
  assert.ok(load>=0&&reuse>load,'mean load and shared scratch reuse must be identified');
  return /workgroupBarrier\s*\(\s*\)\s*;/.test(clean.slice(load,reuse));
}
const violations=kernels.filter(k=>!protectsMeanLoad(k.code)).map(k=>k.name);
assert.deepEqual(violations,[],
  'Each DINO mean load must precede a workgroup barrier before variance overwrites shared scratch');
for(const k of kernels){
  const load=k.code.indexOf('let mean = reduction[0]'),reuse=k.code.indexOf('reduction[lane] = variance_partial;',load);
  const span=k.code.slice(load,reuse),without=span.replace(/workgroupBarrier\s*\(\s*\)\s*;/g,'');
  const unprotected=k.code.slice(0,load)+without+k.code.slice(reuse);
  assert.equal(protectsMeanLoad(unprotected),false,'earlier reduction and later variance barriers are insufficient');
  assert.equal(protectsMeanLoad(unprotected.replace('var variance_partial = 0.0;',
    '// workgroupBarrier();\nvar variance_partial = 0.0;')),false,'comment-only barrier must not pass');
}
// Source-linked scheduling counterexample, not a native GPU numerical oracle.
// After the sum reduction, lane0 can read the mean and overwrite scratch0
// before lane32 reads it unless the mean-load barrier orders their phases.
const f32=Math.fround,values=Float32Array.from({length:1024},(_,i)=>i);
const partial=Float32Array.from({length:64},(_,lane)=>{
  let sum=0;for(let i=lane;i<1024;i+=64)sum=f32(sum+values[i]);return sum;});
for(let stride=32;stride;stride>>=1)for(let lane=0;lane<stride;lane++)partial[lane]=f32(partial[lane]+partial[lane+stride]);
const mean=f32(partial[0]/1024);assert.equal(mean,511.5);
let variance=0;for(let i=0;i<1024;i+=64){const d=f32(values[i]-mean);variance=f32(variance+f32(d*d));}
partial[0]=variance;assert.equal(f32(partial[0]/1024),1375.50390625);
console.log('Both actual DINO normalization shaders order mean loads before shared variance reuse; misplaced/comment-only barriers reject. CPU schedule counterexample is not native fidelity evidence.');
