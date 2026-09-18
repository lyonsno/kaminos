import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameAdmission,verifyFrameAdmission} from '../lib/kimodo-frame-admission.mjs';
const flush=()=>new Promise(setImmediate);
function fixture(mode='frame-admission'){
  let release,frame,fences=0,clock=0;
  const controller=new AbortController(),events=[];
  const flame={active:true,backend:'WebGPU:fixture',frameCount:10,simStepCount:20};
  const queue={onSubmittedWorkDone(){fences++;return new Promise(r=>release=r);}};
  const gate=createFrameAdmission({mode,queue,readFlame:()=>flame,visibility:()=>flame.visibility??'visible',
    requestFrame:fn=>{frame=fn;return 1;},cancelFrame:()=>{frame=null;},now:()=>++clock,events});
  let done=false;
  const pending=gate({step:1,pass:'cond-root',signal:controller.signal}).then(()=>done=true);
  pending.catch(()=>{});
  return {controller,events,flame,pending,get done(){return done;},get fences(){return fences;},release:()=>release(),tick:()=>frame?.()};
}
const f=fixture();await flush();assert.equal(f.done,false);assert.equal(f.fences,1);
f.flame.frameCount++;f.flame.simStepCount++;f.release();await flush();
f.tick();await flush();assert.equal(f.done,false,'advances before the queue fence do not count');
f.flame.frameCount++;f.tick();await flush();assert.equal(f.done,false,'render alone cannot close simulation advancement');
f.flame.simStepCount++;f.tick();await f.pending;assert.equal(f.events[0].status,'advanced');
for(const when of ['before-fence','after-fence']){
  const x=fixture();await flush();if(when==='after-fence'){x.release();await flush();}
  x.controller.abort();await assert.rejects(x.pending,{name:'AbortError'});
  assert.equal(x.events[0].status,'failed');
}
for(const mutation of [s=>s.active=false,s=>s.visibility='hidden',s=>s.frameCount=0,s=>s.backend='CPU:fallback']){
  const x=fixture();await flush();x.release();await flush();mutation(x.flame);x.tick();
  await assert.rejects(x.pending);assert.equal(x.events[0].status,'failed');
}
const baseline=fixture('telemetry-only');await baseline.pending;assert.equal(baseline.fences,0);assert.equal(baseline.events[0].status,'observed-only');
assert.throws(()=>createFrameAdmission({mode:'typo',requestFrame(){},cancelFrame(){}}),/Unknown/);
const pageTimeOrigin=1234;
const valid={steps:1,scheduling:{mode:'frame-admission',events:[]},diagnostics:{clock:'performance.now',timeOrigin:pageTimeOrigin,passes:[],submissionReport:{duties:[]}}};
for(const pass of ['cond-root','cond-body','uncond-root','uncond-body']){
  valid.scheduling.events.push({...f.events[0],pass,startedAtMs:4,queueDoneAtMs:5,endedAtMs:6});
  valid.diagnostics.passes.push({pass,dutyId:pass,encodeStartedAtMs:1,encodeEndedAtMs:2,admittedAtMs:3,boundaryEndedAtMs:7,readbackCompletedAtMs:8});
  valid.diagnostics.submissionReport.duties.push({dutyId:pass,status:'completed',submitStartedAtMs:2,submitReturnedAtMs:2.5,submittedAtMs:2.5,completedAtMs:4.5,timingAuthority:'queue-work-done'});
}
assert.equal(verifyFrameAdmission(valid,'frame-admission',pageTimeOrigin).passes,4);
for(const mutate of [r=>r.scheduling.mode='telemetry-only',r=>r.scheduling.events.pop(),r=>r.diagnostics.passes[0].dutyId='other',r=>r.scheduling.events[0].after.simStepCount=0,r=>r.diagnostics.passes[0].encodeEndedAtMs=NaN]){
  const r=structuredClone(valid);mutate(r);assert.throws(()=>verifyFrameAdmission(r,'frame-admission',pageTimeOrigin));
}
for(const field of ['submitStartedAtMs','submitReturnedAtMs','submittedAtMs','completedAtMs','timingAuthority']){
  const r=structuredClone(valid);delete r.diagnostics.submissionReport.duties[0][field];
  assert.throws(()=>verifyFrameAdmission(r,'frame-admission',pageTimeOrigin),`missing ${field} must not verify`);
}
for(const mutate of [r=>r.diagnostics.submissionReport.duties[0].timingAuthority='projected',
  r=>r.diagnostics.submissionReport.duties[0].completedAtMs=5.5,
  r=>r.diagnostics.submissionReport.duties[0].submittedAtMs=1,
  r=>r.diagnostics.submissionReport.duties[0].submitReturnedAtMs=Infinity,
  r=>r.diagnostics.timeOrigin=5678,r=>delete r.diagnostics.timeOrigin]){
  const r=structuredClone(valid);mutate(r);assert.throws(()=>verifyFrameAdmission(r,'frame-admission',pageTimeOrigin));
}
assert.throws(()=>verifyFrameAdmission(valid,'frame-admission'));
const observed=structuredClone(valid);observed.scheduling.mode='telemetry-only';
for(const e of observed.scheduling.events){e.mode='telemetry-only';e.status='observed-only';delete e.queueDoneAtMs;}
const baselineVerdict=verifyFrameAdmission(observed,'telemetry-only',pageTimeOrigin);
assert.equal(baselineVerdict.foregroundQueueFence,false);
assert.equal(baselineVerdict.authority,'page-clock-pass-and-duty-timing');
const candidateVerdict=verifyFrameAdmission(valid,'frame-admission',pageTimeOrigin);
assert.equal(candidateVerdict.foregroundQueueFence,true);
assert.equal(candidateVerdict.authority,'page-clock-current-duty-queue-prefix-and-fresh-dual-counter');
const chunked={steps:1,scheduling:{mode:'layer-chunk-admission',layersPerDuty:4,chunksPerPass:4,events:[]},diagnostics:{clock:'performance.now',timeOrigin:pageTimeOrigin,passes:[],submissionReport:{duties:[]}}};
for(const pass of ['cond-root','cond-body','uncond-root','uncond-body']){
  for(let chunkIndex=1;chunkIndex<=4;chunkIndex++){
    const dutyId=`${pass}-c${chunkIndex}`,layerStart=(chunkIndex-1)*4,layerEnd=chunkIndex*4;
    chunked.scheduling.events.push({mode:'layer-chunk-admission',status:'advanced',step:1,pass,dutyId,chunkIndex,chunkCount:4,layerStart,layerEnd,startedAtMs:4,queueDoneAtMs:5,before:{frameCount:10,simStepCount:20},after:{frameCount:11,simStepCount:21},endedAtMs:6});
    chunked.diagnostics.passes.push({pass,dutyId,chunkIndex,chunkCount:4,layerStart,layerEnd,encodeStartedAtMs:1,encodeEndedAtMs:2,admittedAtMs:3,boundaryEndedAtMs:7,readbackCompletedAtMs:8});
    chunked.diagnostics.submissionReport.duties.push({dutyId,status:'completed',submitStartedAtMs:2,submitReturnedAtMs:2.5,submittedAtMs:2.5,completedAtMs:4.5,timingAuthority:'queue-work-done'});
  }
}
const chunkVerdict=verifyFrameAdmission(chunked,'layer-chunk-admission',pageTimeOrigin);
assert.equal(chunkVerdict.passes,16);
assert.equal(chunkVerdict.foregroundQueueFence,true);
assert.equal(chunkVerdict.authority,'page-clock-current-chunk-duty-queue-prefix-and-fresh-dual-counter');
const injection=readFileSync(new URL('../kimodo-live-flame-inject.mjs',import.meta.url),'utf8');
assert.match(injection,/value="layer-chunk-admission"/);
assert.match(injection,/schedulingMode==='layer-chunk-admission'\?4:16/);
assert.match(injection,/boundariesPerStep:4\*chunksPerPass/);
assert.match(injection,/producer\.generate\(\{prompt,steps,duration,generationId,layersPerDuty/);
console.log('Frame admission: fence + fresh dual-counter advance, abort, hidden/reset/fallback, baseline and invalid mode pass');
