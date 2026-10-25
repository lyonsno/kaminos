// kaminos-test: node
// Runtime stubs test rejection, retry and ownership only; they prove no model math.
import assert from 'node:assert/strict';
import {createBrowserPromptHelper,BFL_SOURCE_REVISION} from '../models/bfl-pup/browser-backend.mjs';
globalThis.location={href:'http://localhost/probe.html',origin:'http://localhost'};
globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('provenance.json')?{status:'complete',source:'/snapshot/'+BFL_SOURCE_REVISION}:{t2i:'scene',i2i:'edit'}});
globalThis.pupRuntimeTest={loads:0,disposed:0,generated:0,acceptAfter:Infinity};
const runtime=`
export const env={};
export const AutoProcessor={from_pretrained:async()=>Object.assign(async()=>({input_ids:{dims:[1,1],dispose(){}}}),{apply_chat_template:()=>"prompt",tokenizer:{decode:()=>"A blue kettle"}})};
export class LogitsProcessor{};export class InterruptableStoppingCriteria{interrupt(){}};export class TextStreamer{};
export const Qwen3_5ForConditionalGeneration={from_pretrained:async()=>{
 const state=globalThis.pupRuntimeTest;state.loads++;
 return {sessions:{embed_tokens:{config:{device:'webgpu'}},vision_encoder:{config:{device:state.loads>state.acceptAfter?'webgpu':'wasm'}},decoder_model_merged:{config:{device:'webgpu'}}},
 generate:async()=>{state.generated++;return {sequences:{tolist:()=>[[1n,12n,248046n]],dispose(){}}};},
 dispose:async()=>{state.disposed++;}};
}};`;
const runtimeUrl='data:text/javascript;base64,'+Buffer.from(runtime).toString('base64');
const helper=await createBrowserPromptHelper({modelUrl:'http://localhost/model',runtimeUrl});
try{
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(helper.expand({prompt:'blue'}),/vision_encoder did not select/);
 assert.equal(pupRuntimeTest.loads,2,'each retry validates a new candidate');
 assert.equal(pupRuntimeTest.disposed,2,'each rejected candidate is released');
 assert.equal(pupRuntimeTest.generated,0,'a rejected candidate must never generate');
 pupRuntimeTest.acceptAfter=2;
 const result=await helper.expand({prompt:'blue'});
 assert.equal(result.text,'A blue kettle');assert.ok(Object.values(result.sessions).every(s=>s.device==='webgpu'));
 assert.equal(pupRuntimeTest.generated,1);
}finally{await helper.dispose();}
assert.equal(pupRuntimeTest.disposed,3);
console.log('BFL rejected-route retry and model ownership pass');
