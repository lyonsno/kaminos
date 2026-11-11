// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {KleinPipeline} from '../models/flux2-klein/klein-pipeline.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({settle=async()=>{},failTransformer=()=>false}={}){
 const calls={},device={queue:{onSubmittedWorkDone:settle},destroy(){calls.device=(calls.device??0)+1;}};
 const pipeline=new KleinPipeline(device);
 for(const name of ['textEncoder','transformer','vae','referenceEncoder','preview','previewInput'])pipeline[name]={destroy(){
  calls[name]=(calls[name]??0)+1;if(name==='transformer'&&failTransformer())throw Error('transformer cleanup failed');
 }};
 pipeline.promptCache={buffer:{destroy(){calls.promptCache=(calls.promptCache??0)+1;}}};
 pipeline.residentBytes={transformer:16};
 return {pipeline,calls};
}
const expected={textEncoder:1,transformer:1,vae:1,referenceEncoder:1,preview:1,previewInput:1,promptCache:1};
test('failed queue settlement retains actual pipeline resources for a real destruction retry',async()=>{
 let failing=true,waits=0;
 const {pipeline,calls}=fixture({settle:async()=>{waits++;if(failing)throw Error('queue unsettled');}});
 await assert.rejects(pipeline.destroy(),/queue unsettled/);
 assert.equal(pipeline.destroyed,true);assert.throws(()=>pipeline.assertUsable(),/destroyed/);
 assert.deepEqual(calls,{});assert.ok(pipeline.transformer);
 const before=waits;failing=false;await pipeline.destroy();
 assert.ok(waits>before);assert.deepEqual(calls,expected);assert.deepEqual(pipeline.residentBytes,{});
 const after=waits;await pipeline.destroy();assert.equal(waits,after);assert.deepEqual(calls,expected);
});
test('concurrent destruction callers wait for the same real cleanup',async(t)=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const {pipeline,calls}=fixture({settle:()=>gate.promise});
 const first=pipeline.destroy();let secondDone=false;
 const second=pipeline.destroy().then(()=>{secondDone=true;});await tick();
 const premature=secondDone;assert.equal(pipeline.destroyed,true);
 gate.resolve();await Promise.all([first,second]);
 assert.equal(premature,false);assert.deepEqual(calls,expected);
});
test('partial component failure retries the remaining resources without double destruction',async()=>{
 let failing=true;
 const {pipeline,calls}=fixture({failTransformer:()=>failing});
 await assert.rejects(pipeline.destroy(),/transformer cleanup failed/);
 assert.equal(pipeline.textEncoder,null);assert.ok(pipeline.transformer);assert.ok(pipeline.vae);
 failing=false;await pipeline.destroy();
 assert.deepEqual(calls,{...expected,transformer:2});assert.equal(pipeline.transformer,null);
});
test('pending scheduler work is not silently discarded as successful model retirement',async()=>{
 const {pipeline,calls}=fixture();pipeline.sched.settling=true;
 await assert.rejects(pipeline.destroy(),/pending command-duty/);assert.deepEqual(calls,{});
 pipeline.sched.settling=false;await pipeline.destroy();assert.deepEqual(calls,expected);
});
