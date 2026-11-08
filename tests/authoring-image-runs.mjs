// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as experiments from '../authoring-image-experiments.mjs';
const p={schema:'kaminos.image-generation.v1',model:'FLUX.3 Image Klein',prompt:'Rack with open slot',seed:5,width:512,height:512,weightsLevel:'4-bit',lora:null,source:{repo:'original',revision:'exact'},sampling:{steps:4,shift:3},completion:{earlyDecoded:true,stepsCompleted:3,stepsRequested:4},reference:{source:'/cad.png',name:'CAD'}};
const source={source:'/rack.png',name:'Rack',provenance:p};
test('seed variation plan preserves each recorded recipe and identifies every blocked source',()=>{
 assert.equal(typeof experiments.imageVariationPlan,'function','experiment must expose its explicit seed plan');
 const plan=experiments.imageVariationPlan({experiment:{id:'burners',title:'Burners'},sources:[source,{source:'/raw.png',name:'Raw'}],seeds:[42,43]});
 assert.equal(plan.count,4);assert.equal(plan.rows.length,2);assert.equal(plan.rows[0].request.reference.source,'/cad.png');assert.equal(plan.rows[1].error.includes('recipe'),true);
 assert.equal(plan.rows[0].completion.stepsCompleted,3);assert.deepEqual(plan.seeds,[42,43]);assert.deepEqual(source.provenance,p);
 assert.throws(()=>experiments.imageVariationPlan({experiment:{},sources:[source],seeds:[1,1]}),/distinct/);
});
test('run request is rebuilt from frozen source inputs with fixed seed and model admission',()=>{
 assert.equal(typeof experiments.imageVariationRequest,'function');
 const run={id:'run',title:'Seeds',sources:[source],author:{kind:'agent',id:'hotwet',label:'Hotwet'}};
 const request=experiments.imageVariationRequest({experiment:{id:'burners',title:'Burners'},run,job:{id:'0:0',sourceIndex:0,seed:42,attempt:'attempt'}});
 assert.equal(request.prompt,p.prompt);assert.equal(request.seed,42);assert.equal(request.reference.source,'/cad.png');assert.deepEqual(request.expectedModel,{source:p.source,sampling:p.sampling,lora:null});assert.deepEqual(request.iteration.parentCompletion,p.completion);assert.deepEqual(request.variation,{experimentId:'burners',runId:'run',jobId:'0:0',attempt:'attempt'});assert.deepEqual(request.author,run.author);
});

test('executor claims sequential jobs with fixed requests and retains a failed row without rerunning successes',async()=>{
 const run={id:'r',title:'Seeds',sources:[source],seeds:[41,42],author:{kind:'agent',id:'hotwet',label:'Hotwet'},jobs:[{id:'0:0',sourceIndex:0,seed:41,status:'queued'},{id:'0:1',sourceIndex:0,seed:42,status:'queued'}]};
 let doc={id:'burners',title:'Burners',runs:[run]},active=0;const calls=[];
 const request=async(url,body)=>{if(!body)return structuredClone(doc);const j=run.jobs.find(j=>j.id===body.jobId);calls.push(body.action);if(body.action==='claim-job'){assert.equal(active,0);active++;j.status='running';j.attempt=body.attempt;}if(body.action==='finish-job'){j.status=body.status;active--;}return structuredClone(doc);};
 const executor=experiments.createImageRunExecutor({request,generate:async r=>{assert.equal(r.prompt,p.prompt);assert.equal(r.reference.source,'/cad.png');if(r.seed===41)throw Error('effective model unavailable');assert.equal(active,1);const j=run.jobs.find(j=>j.seed===42);j.status='succeeded';active--;return {source:'/saved.png'};}});
 await executor.execute('burners','r');assert.deepEqual(run.jobs.map(j=>j.status),['failed','succeeded']);assert.deepEqual(calls,['claim-job','finish-job','claim-job']);assert.equal(executor.busy(),false);
});

test('persistence failure with retained pixels leaves the attempt active for retry saving and stops the batch',async()=>{
 const run={id:'r',title:'Seeds',sources:[source],seeds:[41,42],author:{kind:'agent',id:'hotwet',label:'Hotwet'},jobs:[{id:'0:0',sourceIndex:0,seed:41,status:'queued'},{id:'0:1',sourceIndex:0,seed:42,status:'queued'}]},doc={id:'burners',title:'Burners',runs:[run]};const writes=[];
 const request=async(url,body)=>{if(body){writes.push(body.action);if(body.action==='claim-job'){run.jobs[0].status='running';run.jobs[0].attempt=body.attempt;}}return structuredClone(doc);};
 const executor=experiments.createImageRunExecutor({request,generate:async()=>{throw Object.assign(Error('disk full'),{pendingImage:true});}});
 await assert.rejects(executor.execute('burners','r'),/disk full/);assert.deepEqual(writes,['claim-job']);assert.deepEqual(run.jobs.map(j=>j.status),['running','queued']);assert.equal(executor.busy(),false);
});

test('Stop while a claim is settling prevents the newly claimed image from starting',async()=>{
 const run={id:'r',title:'Seeds',sources:[source],seeds:[41],author:{kind:'agent',id:'hotwet',label:'Hotwet'},jobs:[{id:'0:0',sourceIndex:0,seed:41,status:'queued'}]},doc={id:'burners',title:'Burners',runs:[run]};let executor,generated=0;
 const request=async(url,body)=>{if(body?.action==='claim-job'){run.jobs[0].status='running';run.jobs[0].attempt=body.attempt;await executor.stop();}if(body?.action==='stop-run')run.stopRequested=true;if(body?.action==='finish-job')run.jobs[0].status=body.status;return structuredClone(doc);};
 executor=experiments.createImageRunExecutor({request,generate:async()=>{generated++;return null;}});await executor.execute('burners','r');assert.equal(generated,0);assert.equal(run.jobs[0].status,'stopped');
});

test('explicit model and size choices define preview and execution while preserving original input',()=>{
 const overrides={model:'flux2',size:768},experiment={id:'burners',title:'Burners'};
 const plan=experiments.imageVariationPlan({experiment,sources:[source],seeds:[42],overrides});
 assert.deepEqual(plan.overrides,overrides);assert.equal(plan.rows[0].request.model,'flux2');assert.equal(plan.rows[0].request.size,768);
 const request=experiments.imageVariationRequest({experiment,run:{id:'r',sources:[source],overrides,author:{kind:'person',id:'noah',label:'Noah'}},job:{id:'0:0',sourceIndex:0,seed:42,attempt:'a'}});
 assert.equal(request.model,'flux2');assert.equal(request.size,768);assert.equal(request.reference.source,'/cad.png');assert.equal(request.prompt,p.prompt);assert.equal(request.expectedModel,undefined,'new model must not inherit another model package pin');
 assert.ok(request.iteration.changes.some(c=>c.field==='model'&&c.after==='flux2'));assert.ok(request.iteration.changes.some(c=>c.field==='size'&&c.after===768));assert.deepEqual(source.provenance,p);
 const resize=experiments.imageVariationRequest({experiment,run:{id:'r',sources:[source],overrides:{size:256},author:{kind:'person',id:'noah',label:'Noah'}},job:{id:'j',sourceIndex:0,seed:3}});assert.equal(resize.size,256);assert.deepEqual(resize.expectedModel,{source:p.source,sampling:p.sampling,lora:null});
 assert.throws(()=>experiments.imageVariationPlan({experiment,sources:[source],seeds:[1],overrides:{model:'made-up'}}),/model/i);assert.throws(()=>experiments.imageVariationPlan({experiment,sources:[source],seeds:[1],overrides:{size:999}}),/size/i);
});
