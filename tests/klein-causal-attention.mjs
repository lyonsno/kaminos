// kaminos-test: node
import assert from 'node:assert/strict';
import { KleinTextEncoder } from '../models/flux2-klein/klein-text-encoder.js';
const manifest={layers:1,taps:[1],config:{hidden_size:2560,num_attention_heads:32,num_key_value_heads:8,intermediate_size:9728}};
const full=new KleinTextEncoder({},manifest), tiled=new KleinTextEncoder({},manifest,{attentionMode:'causal-tiled'});
assert.equal(full.attentionMode,'materialized');
assert.deepEqual(tiled.activationBufferBytes(512),full.activationBufferBytes(512),'tile skipping preserves full physical allocation and admission');
assert.throws(()=>new KleinTextEncoder({},manifest,{attentionMode:'unknown'}),/attentionMode/);
for(const L of [80,512,2048,257])for(const budget of [Infinity,1e8]){
 const model=new KleinTextEncoder({},manifest,{attentionMode:'causal-tiled'}),calls=[],softmax=[];
 model.L=L;model.act={q:'q',k:'k',vt:'vt',o:'o',scores:'scores',mask:'mask'};
 model.sched={budget:()=>budget,boundary:async()=>{}};
 model.gemm=async(_,call)=>calls.push(call);model.pipeline=key=>key;model.uniform=words=>words;
 model.dispatch=(_,pipe,buffers)=>{if(pipe==='masked-softmax')softmax.push(buffers.at(-1));};
 await model.attention(model.sched);
 const qk=calls.filter(c=>c.c==='scores'),pv=calls.filter(c=>c.a==='scores');
 assert.equal(qk.length,pv.length);assert.equal(qk.reduce((n,c)=>n+c.M*c.batch,0),L*32);
 for(let i=0;i<qk.length;i++){
  const c=qk[i],v=pv[i];assert.equal(c.causal,'scores');assert.equal(v.causal,'values');
  assert.equal(c.M,L);assert.equal(c.N,L);assert.equal(v.K,L);assert.equal(c.cRs,L);assert.equal(c.cBs,L*L);
  assert.equal(v.aRs,L);assert.equal(v.aBs,L*L);assert.equal(v.bRs,L);assert.equal(v.cOff,c.aOff);
  assert.equal(v.bDiv,4);assert.equal(c.batch%4,0);assert.deepEqual(softmax[i],[c.batch*L,L,0,0]);
 }
}
console.log('Causal tiled attention preserves full rows, allocation, GQA and cooperative group geometry');
