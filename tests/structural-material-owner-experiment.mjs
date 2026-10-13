import test from 'node:test';
import assert from 'node:assert/strict';
import {openExperiment} from '../workbench-experiments.mjs';
import {createInvestigationRecording} from '../investigation-recording.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const missing=()=>{throw Error('Stone owner contribution is unavailable');};
const {default:definition={id:'stone',title:'Stone',create:missing}}=await import('../experiments/stone/stone-fracture.experiment.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith('/stone-fracture.experiment.mjs'))return {};throw error;
});
const fixture=()=>{
 const state={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'fixture',submittedSteps:0,paused:true,threshold:180,failure:null};
 let denseReads=0,releases=0;const calls=[];
 const stone={read:()=>({...state}),hold:async()=>{state.paused=true;},resume:()=>{state.paused=false;},reset:async()=>{state.runId+='-reset';state.submittedSteps=0;},tension:value=>{state.threshold=value;},grip:request=>calls.push(request),move:request=>calls.push(request),release:()=>{releases++;},step:async count=>{state.submittedSteps+=count;},view:request=>calls.push(request),observe:()=>{denseReads++;return {kind:'explicit-state'};},dispose:()=>{releases++;}};
 return {state,stone,calls,counts:()=>({denseReads,releases}),host:{stone:{open:async()=>stone},controls:{mountStone:({invoke})=>({tension:value=>invoke('tension',value)})}}};
};
test('stone owner operations share UI invocation and explicit cheap recording',async()=>{
 const f=fixture(),recording=createInvestigationRecording({id:'stone',source:{kind:'fixture'},initial:f.state,startingConditions:{kind:'fixture'}});
 const current=await openExperiment(definition,{host:f.host});const ui=await current.mount({});
 await ui.tension(200);await current.invoke('step',3);assert.equal((await current.read()).submittedSteps,3);
 assert.equal(f.counts().denseReads,0);const saved=recording.finish();assert.equal(saved.complete,true);assert.equal(saved.operations.filter(v=>v.phase==='applied').length,2);
 assert.equal(saved.operations[0].effective.threshold,200);
 await current.invoke('observe');assert.equal(f.counts().denseReads,1);await current.dispose();await current.dispose();assert.equal(f.counts().releases,1);
});
test('fallback, wrong connectivity and unavailable host fail before mutation',async()=>{
 for(const patch of [{backend:'cpu'},{adapterFallback:true},{connectivity:'literal-edge'},{failure:{message:'device lost'}}]){
  const f=fixture();Object.assign(f.state,patch);await assert.rejects(openExperiment(definition,{host:f.host}),/Native bounded elastic-support stone/);assert.equal(f.calls.length,0);
 }
 await assert.rejects(openExperiment(definition,{host:{}}),/stone.open/);
});
test('invalid requests fail visibly and do not change the stone',async()=>{
 const f=fixture(),operations=[];const current=await openExperiment(definition,{host:f.host,record:v=>operations.push(v)});
 await assert.rejects(current.invoke('step',1.5),/positive integer/);await assert.rejects(current.invoke('tension',0),/positive/);await assert.rejects(current.invoke('move',[1,NaN,0]),/finite/);
 assert.equal(f.state.submittedSteps,0);assert.equal(f.state.threshold,180);assert.ok(operations.every(v=>v.phase==='failed'));
 await current.invoke('resume');await assert.rejects(current.invoke('step',1),/held/);
 await current.dispose();
});
test('actual producer experiment status and hold avoid physical readback',async()=>{
 const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
 const start=source.indexOf('function experimentStatus('),end=source.indexOf('function inside(',start);
 assert.ok(start>=0&&end>start,'Producer has no cheap experiment status/hold operations');
 const calls=[],ctx={bounded:true,connectivity:'elastic-support',route:'kaminos.picked-stone.bounded-shards.webgpu.v0',resident:{submittedState:()=>({runId:'native-fixture',steps:6}),read(){throw Error('Dense read forbidden');}},observed:{model:{points:4,elements:1,bonds:6}},configuration:{timeStep:1/60},materialRegime:{name:'fixture'},manifest:{sourceSha256:'fixture',preparationSha256:'prepared'},paused:true,busy:false,pendingPick:false,finishing:false,gesture:null,failure:null,cameraState:()=>({position:[0,1,3],target:[0,0,0]}),$:()=>({value:'180'}),settle:async()=>calls.push('host-settle'),device:{queue:{onSubmittedWorkDone:async()=>calls.push('queue-settle')}},structuredClone};
 ctx.closing=false;vm.runInNewContext(source.slice(start,end),ctx);
 const status=ctx.experimentStatus();assert.equal(status.submittedSteps,6);assert.equal(status.observation,'submission-metadata-not-physical-observation');assert.equal(status.backend,'webgpu');
 await ctx.waitSubmitted({gpu:false});assert.deepEqual(calls,['host-settle']);await ctx.waitSubmitted();assert.deepEqual(calls,['host-settle','host-settle','queue-settle']);
});
