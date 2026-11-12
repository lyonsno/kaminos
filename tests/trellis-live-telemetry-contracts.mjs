// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createTrellisLiveTelemetry,formatTrellisLiveTelemetry} from '../trellis-live-telemetry.mjs';

test('the live view exposes long gaps and active operation age without calling them GPU timings',()=>{
 let now=0,next,cleared=null;const t=createTrellisLiveTelemetry({input:{source:'/actual.png'},now:()=>now,requestFrame:f=>{next=f;return 12;},cancelFrame:id=>cleared=id,
   readFrame:()=>({frameCount:4,simStepCount:4,queueDoneMs:15000,queueProbePending:true})});
 next();t.record({kind:'phase',phase:'sparse-structure-sampling',step:2});
 now=17000;next();t.record({kind:'kernel',status:'started',name:'cross-attention'});t.heartbeat();now=19500;
 const summary=t.summary();assert.equal(summary.animation.maxGapMs,17000);assert.equal(summary.operationElapsedMs,2500);
 const text=formatTrellisLiveTelemetry(summary);assert.match(text,/worst 17\.00s/);assert.match(text,/cross-attention/);assert.match(text,/15\.00s · pending/);assert.match(text,/not GPU-exclusive/);
 const raw=t.export();assert.equal(raw.events[0].step,2);assert.equal(raw.input.source,'/actual.png');assert.equal(raw.frames.length,2);
 t.finish('stopped');assert.equal(cleared,12);const before=t.export();now=99999;next();t.record({kind:'phase',phase:'late'});assert.deepEqual(t.export(),before,'late callbacks cannot change a stopped run');
});

test('unavailable frame and probe information remains explicitly unavailable',()=>{
 const t=createTrellisLiveTelemetry({now:()=>100,requestFrame:null});t.heartbeat();
 assert.equal(t.summary().animation.available,false);assert.equal(t.summary().animation.maxGapMs,null);assert.match(formatTrellisLiveTelemetry(t.summary()),/worst unavailable/);t.finish('failed');
});

test('a frame-reader failure is exposed without losing the operation trace',()=>{
 const t=createTrellisLiveTelemetry({requestFrame:null,readFrame:()=>{throw Error('frame owner lost');}});
 t.record({kind:'kernel',status:'completed',name:'actual-op',durationMs:1});t.heartbeat();
 assert.match(formatTrellisLiveTelemetry(t.summary()),/frame owner lost/);assert.equal(t.export().events.length,1);t.finish('failed');
});

test('weight reads and uploads become the current visible operation',()=>{
 let now=0;const t=createTrellisLiveTelemetry({now:()=>now,requestFrame:null});
 for(const kind of ['checkpoint','upload']){t.record({kind,status:'started',name:kind+'-weight'});now+=1000;assert.equal(t.summary().latestOperation.name,kind+'-weight');assert.match(formatTrellisLiveTelemetry(t.summary()),new RegExp(kind+'-weight'));}
 t.finish('completed');
});
