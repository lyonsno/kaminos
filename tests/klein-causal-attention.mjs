// kaminos-test: node
import assert from 'node:assert/strict';
import { KleinTextEncoder } from '../models/flux2-klein/klein-text-encoder.js';
const manifest={layers:1,taps:[1],config:{hidden_size:2560,num_attention_heads:32,num_key_value_heads:8,intermediate_size:9728}};
const full=new KleinTextEncoder({},manifest,{attentionMode:'materialized'});
const blocked=new KleinTextEncoder({},manifest,{attentionMode:'causal-blocked'});
assert.equal(blocked.scoreBufferBytes(512),32*64*512*4,'blocked attention must not allocate full query-by-key scores');
assert.equal(full.scoreBufferBytes(512),32*512*512*4);
const {scores:a,...linearA}=full.activationBufferBytes(512),{scores:b,...linearB}=blocked.activationBufferBytes(512);
assert.deepEqual(linearA,linearB,'the same full token activations remain available');assert.ok(b<a);
assert.throws(()=>new KleinTextEncoder({},manifest,{attentionMode:'unknown'}),/attentionMode/);
for(const L of [80,512,2048,257]){
 const model=new KleinTextEncoder({},manifest,{attentionMode:'causal-blocked'}),calls=[],softmax=[];
 model.L=L;model.act={q:'q',k:'k',vt:'vt',o:'o',scores:'scores',mask:'mask'};
 model.sched={budget:()=>Infinity,boundary:async()=>{}};
 model.gemm=async(_,call)=>calls.push(call);model.pipeline=key=>key;model.uniform=words=>words;
 model.dispatch=(_,pipe,buffers)=>{if(pipe==='masked-softmax-causal-block')softmax.push(buffers.at(-1));};
 await model.attention(model.sched);
 const qk=calls.filter(c=>c.c==='scores'),pv=calls.filter(c=>c.a==='scores');
 assert.equal(qk.length,pv.length);assert.equal(qk.reduce((n,c)=>n+c.M*c.batch,0),L*32,'every query/head must be written');
 for(let i=0;i<qk.length;i++){
  const c=qk[i],v=pv[i],base=(c.aOff%(L*128))/128,keys=L%4?L:Math.min(L,base+c.M);
  assert.ok(c.M>0&&c.M<=64);assert.equal(c.N,keys);assert.equal(v.K,keys);
  assert.equal(c.cRs,L);assert.equal(c.cBs,c.M*L);assert.equal(v.aRs,L);assert.equal(v.aBs,c.M*L);
  assert.equal(v.bRs,L);assert.equal(v.cOff,c.aOff);assert.equal(v.cRs,128);assert.equal(v.bDiv,4);
  assert.deepEqual(softmax[i],[c.batch*c.M,L,base,c.M]);
 }
 if(L%4===0)assert.ok(qk.reduce((n,c)=>n+c.M*c.N*c.batch,0)<L*L*32);
 else assert.ok(pv.every(c=>c.K===L),'unaligned value strides keep the existing scalar-safe contraction');
}
console.log('Klein causal attention covers all rows with bounded scores and correct physical/GQA strides');
