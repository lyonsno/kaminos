// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {withChatAdmission} from '../models/qwen3_5/chat-browser.js';
const source=fs.readFileSync(new URL('../models/qwen3_5/chat-ui.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
function harness(){
 const elements=new Map();const element=()=>({value:'',textContent:'',disabled:false,classList:{toggle(){}},append(){},replaceChildren(){}});
 let fail=false,disposed=false,loads=0;const resets=[];const rt={identity:{capacity:100,loadMs:1},model:{},errors:[],chat:{send:async()=>({text:'answer',tokenIds:[1],usage:{totalMs:1,reusedInputTokens:0,evaluatedInputTokens:1,firstTokenMs:1}}),reset:async options=>{resets.push(options);},snapshot:()=>({committed:true,systemPrompt:'active instruction'})},dispose:async()=>{disposed=true;}};
 const window={addEventListener(){}};vm.runInNewContext(source,{window,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},location:{search:'',href:'http://localhost/'},URL,URLSearchParams,AbortController,structuredClone,fetch:async()=>({ok:true,json:async()=>({qwen35:{mounted:true,modelUrl:'/weights',manifestUrl:'/weights/weights.json',manifestSha256:'sha'}})}),loadChatExample:async()=>{loads++;return rt;},withChatAdmission:async(_,work)=>{const result=await work(),lease={status:'held',leaseId:'test'};if(fail)throw Object.assign(Error('handback failed'),{result,lease});return {result,lease};}});
 return {elements,resets,loads:()=>loads,api:window.qwenChat,fail:()=>{fail=true;},disposed:()=>disposed,status:()=>elements.get('status').textContent};
}
test('loaded model remains disposable when admission handback fails',async()=>{const h=harness();h.fail();await assert.rejects(h.api.load(),/handback/);assert.ok(h.api.runtime,'loaded model lost before cleanup');await h.api.unload();assert.equal(h.disposed(),true);assert.equal(h.api.snapshot().admissions.length,1);});
test('completed turn stays committed when only handback fails',async()=>{const h=harness();await h.api.load();h.fail();await assert.rejects(h.api.send('hello'),/handback/);const r=h.api.snapshot().history[0];assert.equal(r.status,'complete-handback-failed');assert.equal(r.result.text,'answer');assert.doesNotMatch(h.status(),/not been added/);assert.equal(h.api.snapshot().admissions.length,2);});

function realAdmissionHarness(admissionStatus){
 const elements=new Map();const element=()=>({value:'',textContent:'',disabled:false,classList:{toggle(){}},append(){},replaceChildren(){}});const calls=[],observed=[];let stop=false;
 const window={addEventListener(){}};const status=()=>elements.get('status').textContent;
 const runtime={identity:{capacity:100,loadMs:1},model:{},errors:[],chat:{snapshot:()=>({}),send:async()=>{observed.push(status());if(stop)throw Object.assign(Error('Stopped'),{name:'AbortError'});return {text:'ok',tokenIds:[1],usage:{totalMs:1,reusedInputTokens:0,evaluatedInputTokens:1,firstTokenMs:1}};}}};
 vm.runInNewContext(source,{window,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},location:{search:'',href:'http://localhost/'},URL,URLSearchParams,AbortController,structuredClone,withChatAdmission,loadChatExample:async()=>{observed.push(status());return runtime;},fetch:async(url,options)=>({ok:true,json:async()=>{if(url==='/api/runtime-config')return {qwen35:{mounted:true,modelUrl:'/weights',manifestUrl:'/weights/weights.json',manifestSha256:'sha'}};const body=JSON.parse(options.body);calls.push(body.action);return body.action==='queued-claim'?{status:admissionStatus,leaseId:'actual-test'}:{status:'released'};}})});
 return {api:window.qwenChat,status,observed,calls,stop:()=>{stop=true;}};
}
test('unconfigured admission remains visible before work and after load/send',async()=>{const h=realAdmissionHarness('unconfigured');await h.api.load();assert.match(h.status(),/No GPU queue configured/);await h.api.send('hi');for(const text of [...h.observed,h.status()])assert.match(text,/No GPU queue configured/);});
test('stopped admitted turn retains identity and successful handback',async()=>{const h=realAdmissionHarness('held');await h.api.load();h.stop();await assert.rejects(h.api.send('stop'),{name:'AbortError'});assert.deepEqual(h.calls,['queued-claim','release','queued-claim','release']);const receipts=h.api.snapshot().admissions;assert.equal(receipts.length,2);assert.equal(receipts[1].leaseId,'actual-test');assert.equal(receipts[1].state,'released');assert.equal(h.api.snapshot().history[0].status,'stopped');});

test('editing a loaded system instruction applies on New conversation without another weight load',async()=>{
 const h=harness();await h.api.load();const model=h.api.runtime;
 assert.equal(h.elements.get('system').disabled,false);
 h.elements.get('system').value='new instruction';await h.api.send('hello');
 assert.equal(h.api.snapshot().history[0].systemPrompt,'active instruction');
 await h.api.reset();assert.equal(h.resets.length,1);assert.equal(h.resets[0].systemPrompt,'new instruction');
 assert.equal(h.loads(),1);assert.equal(h.api.runtime,model);assert.equal(h.elements.get('system').disabled,false);
});

test('every saved turn retains its model mode and source through later switches and unload',async()=>{
 for(const finish of ['complete','stopped','failed','complete-handback-failed']){
  const h=harness();await h.api.load();const rt=h.api.runtime;
  Object.assign(rt.identity,{backend:'webgpu',manifestSha256:'base-package',source:{revision:'base-source'},delta:{enabled:false,rank:256,maxRank:256}});rt.model.delta={...rt.identity.delta};
  rt.model.setDeltaMode=async({enabled,rank})=>{Object.assign(rt.model.delta,{enabled,rank});return{enabled,rank,reset:true};};
  const expected=structuredClone(rt.identity);
  if(finish==='stopped'||finish==='failed')rt.chat.send=async()=>{throw Object.assign(Error('interrupted'),{name:finish==='stopped'?'AbortError':'Error'});};
  if(finish==='complete-handback-failed')h.fail();
  if(finish==='complete')await h.api.send('before');else await assert.rejects(h.api.send('before'));
  await h.api.setMode({enabled:true,rank:64});rt.identity.source.revision='later-source';await h.api.unload();
  const record=h.api.snapshot().history[0];assert.equal(record.status,finish);assert.deepEqual(record.modelIdentity,expected);
 }
});

test('choosing a disabled adapter rank preserves the current base conversation',async()=>{
 const h=harness();await h.api.load();const rt=h.api.runtime;
 rt.identity.delta={enabled:false,rank:256,maxRank:256};rt.model.delta={...rt.identity.delta};rt.model.setDeltaMode=async({enabled,rank})=>{Object.assign(rt.model.delta,{enabled,rank});return{enabled,rank,reset:false};};
 await h.api.send('retain this');await h.api.setMode({enabled:false,rank:64});assert.equal(h.resets.length,0);assert.equal(rt.identity.delta.rank,64);
});
