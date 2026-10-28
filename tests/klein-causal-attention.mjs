// kaminos-test: node
import assert from 'node:assert/strict';
import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';
import { Flux3Pipeline } from '../models/flux3-klein/flux3-pipeline.js';
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

for(const Pipeline of [KleinPipeline,Flux3Pipeline])for(const mode of ['causal-tiled','materialized']){
 const p=new Pipeline({}, {textEncoderUrl:'te',transformerUrl:'dit',vaeUrl:'vae',...(mode==='materialized'?{textAttentionMode:mode}:{})});
 assert.equal(p.createTextEncoder(manifest).attentionMode,mode,'both pipeline routes use the selected text attention, with rollback available');
}

const {validateCausalAttentionReport}=await import('../models/flux2-klein/probes/causal-attention-report.mjs');
const valid={route:'KleinTextEncoder.attention',rows:[{tokens:512,errors:[],nonFinite:0,relL2:0,oracleMaxAbs:0.0002,outputElements:[2097152,2097152],variants:[{mode:'materialized',pipelineKeys:['masked-softmax']},{mode:'causal-tiled',pipelineKeys:['gemm2-f32-g64-store-f16-causal-scores','gemm2-f32-g64-store-f16-causal-values']}]}]};
validateCausalAttentionReport(valid,[512]);
for(const [name,mutate]of [
 ['blank output',r=>r.rows[0].outputElements=[]],
 ['wrong requested tokens',r=>r.rows[0].tokens=256],
 ['missing rows',r=>r.rows=[]],
 ['fallback route',r=>r.route='fixture'],
 ['missing candidate values kernel',r=>r.rows[0].variants[1].pipelineKeys.pop()],
 ['nonfinite output',r=>r.rows[0].nonFinite=1],
 ['wrong mode',r=>r.rows[0].variants[1].mode='materialized'],
 ['oracle mismatch',r=>r.rows[0].oracleMaxAbs=.01],
]){const r=structuredClone(valid);mutate(r);assert.throws(()=>validateCausalAttentionReport(r,[512]),undefined,name);}
