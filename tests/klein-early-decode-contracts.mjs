// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {KleinPipeline} from '../models/flux2-klein/klein-pipeline.js';
globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8};
globalThis.GPUMapMode={READ:1};
function fixture(){
 let latent=10,decoded=null,forwards=0;
 const p=Object.create(KleinPipeline.prototype);
 p.device={queue:{submit(){}},createCommandEncoder:()=>({copyBufferToBuffer(){},finish(){}}),createBuffer:({size})=>({size,mapAsync:async()=>{},getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}})};
 p.sched={encoder:()=>({copyBufferToBuffer(){}}),flush:async()=>{},stats:{history:[]}};
 p.requestedTextTokens=()=>1;p.sizeLimits=()=>({fits:true,maxTextTokens:1});p.framePrompt=()=>({inputIds:[1],length:1});p.tokenIds=()=>({imgIds:[],txtIds:[]});
 p.promptCache={key:'1\u0000test',buffer:{size:4}};p.textEncoder={allocate(){}};
 p.transformer={cfg:{joint_attention_dim:1},act:{latents:{},promptEmbeds:{}},allocate(){},prepare(){},release(){},forward:async()=>{forwards++;},eulerStep:async dt=>{latent+=dt*2;}};
 p.denoiseSchedule=()=>({sigmas:[1,.75,.5,.25,0],forwardArgs:i=>({i})});
 p.vae={allocateInput(){},prepLatents(){decoded=latent;},allocate(){},decode:async()=>{},release(){}};
 return {p,read:()=>({decoded,forwards})};
}
test('early decode uses x0 estimate and does not execute later denoising steps',async()=>{
 const {p,read}=fixture();let requested=false;
 const out=await p.generateScheduled({prompt:'test',seed:1,width:16,height:16,steps:4,onStep:i=>{if(i===1)requested=true;},shouldDecode:()=>requested});
 assert.equal(read().forwards,2,'request after step1 must stop at step2 boundary');
 assert.equal(read().decoded,8,'decode x_t minus sigma*v, not the partially noisy Euler sample');
 assert.deepEqual(out.sampling,{stepsRequested:4,stepsCompleted:2,earlyDecoded:true});
});
test('normal completion retains all steps and final output',async()=>{
 const {p,read}=fixture();const out=await p.generateScheduled({prompt:'test',seed:1,width:16,height:16,steps:4,shouldDecode:()=>false});
 assert.equal(read().forwards,4);assert.equal(read().decoded,8);
 assert.deepEqual(out.sampling,{stepsRequested:4,stepsCompleted:4,earlyDecoded:false});
});
