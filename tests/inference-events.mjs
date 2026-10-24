// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInferenceEvents,INFERENCE_RECORDING_SCHEMA} from '../inference-events.mjs';

test('run events retain exact pixels, identity, ordering and JSON round trips without observer mutation',()=>{
 let time=100;const source=createInferenceEvents({now:()=>time});const seen=[];
 source.subscribe(({event,source})=>{event.type='corrupted';source.route='wrong';throw Error('broken UI');});
 source.subscribe(value=>seen.push(value),{previews:true});
 const run=source.begin({kind:'fixture',route:'injected-callback-fixture'},{runId:'fixture-1'});
 time=120;run.emit({type:'stage',stage:'denoise'});
 const rgba=new Uint8ClampedArray([17,33,65,255]);time=125;
 run.emit({type:'preview',width:1,height:1,rgba,step:1,steps:4,kind:'latent-rgb-approximation'});rgba.fill(0);
 time=200;run.finish('complete');
 const record=source.read('fixture-1');
 assert.equal(record.schema,INFERENCE_RECORDING_SCHEMA);assert.equal(record.status,'complete');assert.equal(record.durationMs,100);
 assert.deepEqual(record.events.map(e=>[e.type,e.atMs]),[['start',0],['stage',20],['preview',25],['complete',100]]);
 assert.deepEqual(record.events[2].rgba,[17,33,65,255]);
 assert.deepEqual(JSON.parse(JSON.stringify(record)),record);
 assert.equal(seen[2].runId,'fixture-1');assert.equal(seen[2].source.route,'injected-callback-fixture');
 record.events[2].rgba[0]=0;assert.equal(source.read().events[2].rgba[0],17);
 assert.deepEqual(source.export(),source.read());
});

test('preview demand belongs to subscriptions and terminal callbacks cannot reopen a run',()=>{
 const source=createInferenceEvents({now:()=>0});assert.equal(source.hasPreviewObservers(),false);
 const unordinary=source.subscribe(()=>{});assert.equal(source.hasPreviewObservers(),false);
 const unpreview=source.subscribe(()=>{},{previews:true});assert.equal(source.hasPreviewObservers(),true);
 unpreview();assert.equal(source.hasPreviewObservers(),false);unordinary();
 const old=source.begin({kind:'fixture'},{runId:'old'});old.finish('stopped');
 const current=source.begin({kind:'fixture'},{runId:'new'});current.emit({type:'stage',stage:'text'});
 assert.equal(old.emit({type:'preview',rgba:[0,0,0,255]}),false);assert.equal(old.finish('complete'),false);
 assert.equal(source.read('old').status,'stopped');assert.equal(source.read('old').events.length,2);
 assert.equal(source.read().runId,'new');assert.equal(source.read().events.length,2);
 assert.throws(()=>source.begin({kind:'fixture'},{runId:'old'}),/already exists/);
});

test('all observed events and runs remain available without retention truncation',()=>{
 let time=0;const source=createInferenceEvents({now:()=>time});
 const run=source.begin({kind:'fixture'},{runId:'long-fixture'});
 for(let i=0;i<10050;i++){time++;run.emit({type:'progress',stage:'denoise',completed:i,total:10050});}
 run.finish('complete');source.begin({kind:'fixture'},{runId:'another-fixture'}).finish('failed',{phase:'weights',error:{name:'Error',message:'fixture failure'}});
 const recordings=source.recordings();assert.equal(recordings.length,2);assert.equal(recordings[0].events.length,10052);
 assert.equal(recordings[0].events.at(-2).completed,10049);
 assert.equal(recordings[1].events.at(-1).error.message,'fixture failure');
});

test('terminal state is visible before delivery and reentrant listeners cannot add more events',()=>{
 const source=createInferenceEvents({now:()=>0});let run;
 source.subscribe(({event})=>{if(event.type==='complete'){assert.equal(source.read().status,'complete');assert.equal(run.emit({type:'preview'}),false);}});
 run=source.begin({kind:'fixture'},{runId:'one'});run.finish('complete');assert.equal(source.read().events.length,2);
});

test('an async observer rejection cannot escape into inference or become an unhandled rejection',async()=>{
 const source=createInferenceEvents({now:()=>0});
 source.subscribe(async()=>{throw Error('async observer failed');});
 const run=source.begin({kind:'fixture'},{runId:'async-observer'});run.finish('complete');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(source.read().status,'complete');
});
