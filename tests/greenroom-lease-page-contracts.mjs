// kaminos-test: node — a page model run holds a Greenroom lease: it waits while the GPU is held,
// renews while it runs, and always releases, whether the run succeeds, fails or is stopped
import test from 'node:test';import assert from 'node:assert/strict';
import {withGreenroomLease} from '../greenroom-lease.mjs';

function server(script){
  const calls=[];let i=0;
  const post=async body=>{calls.push(body);const r=typeof script==='function'?script(body,calls):script[Math.min(i++,script.length-1)];if(r instanceof Error)throw r;return r;};
  return {post,calls,actions:()=>calls.map(c=>c.action)};
}
const manual=()=>{const timers=[];return {setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:id=>{if(timers[id-1])timers[id-1].fn=null;},
  fire:async()=>{for(const t of [...timers]){const f=t.fn;t.fn=null;await f?.();}},timers};};

test('waits while a queue job holds the GPU, then holds a lease for the run and releases it after',async()=>{
  const s=server(b=>b.action==='claim'?(s.calls.filter(c=>c.action==='claim').length<3?{status:'waiting',heldBy:['job1']}:{status:'held',leaseId:'kaminos-page-r',ttlSeconds:120}):{status:b.action==='renew'?'held':'released'});
  const waits=[],clock=manual();
  const run=withGreenroomLease({post:s.post,runId:'r',route:'trellis-page',onWait:w=>waits.push(w),sleep:async()=>{},setTimer:clock.setTimer,clearTimer:clock.clearTimer},async lease=>{
    assert.equal(lease.status,'held');await clock.fire();return 'mesh';});
  assert.equal(await run.then(r=>r.result),'mesh');
  assert.deepEqual(s.actions(),['claim','claim','claim','renew','release']);
  assert.deepEqual(waits.map(w=>w.heldBy),[['job1'],['job1']]);
});

for(const [name,body] of [['fails',async()=>{throw Error('boom');}],['is stopped',async()=>{throw Object.assign(Error('stopped'),{name:'AbortError'});}]]){
  test(`releases the lease when the run ${name}`,async()=>{
    const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'});
    await assert.rejects(withGreenroomLease({post:s.post,runId:'r',route:'t',sleep:async()=>{}},body));
    assert.deepEqual(s.actions(),['claim','release']);
  });
}

test('a stop while waiting gives up without claiming further, and without a release',async()=>{
  const ctl=new AbortController(),s=server(()=>({status:'waiting',heldBy:['job1']}));
  const run=withGreenroomLease({post:s.post,runId:'r',route:'t',signal:ctl.signal,sleep:async()=>ctl.abort()},async()=>'never');
  await assert.rejects(run,/abort|stop/i);assert.deepEqual(s.actions(),['claim']);
});

test('no Greenroom on this server: the run proceeds and says so',async()=>{
  const s=server(()=>({status:'unconfigured'}));
  const {result,lease}=await withGreenroomLease({post:s.post,runId:'r',route:'t'},async l=>l.status);
  assert.equal(result,'unconfigured');assert.equal(lease.status,'unconfigured');assert.deepEqual(s.actions(),['claim']);
});

test('GL-02: the page never asks to be exempted from the lease',async()=>{
  const s=server(()=>({status:'held',leaseId:'kaminos-page-r'}));
  await withGreenroomLease({post:s.post,runId:'r',route:'t',insideJob:'job1'},async()=>'x');
  assert.ok(s.calls.every(c=>!('insideJob' in c)));
});

test('a server that cannot be reached for the claim fails the run loudly instead of running unleased',async()=>{
  const s=server(()=>new Error('fetch failed'));
  await assert.rejects(withGreenroomLease({post:s.post,runId:'r',route:'t'},async()=>'ran'),/Greenroom lease/);
});

// GL-01: a run whose GPU work did not settle must keep Greenroom blocked.
import {runTrellisInPage} from '../authoring-trellis-page.mjs';
function heldTrellis(release){
  const route={routeId:'trellis2.image-generation.webgpu.v0',runtime:{readTensor(){}},
    enqueue(job){return {completion:(async()=>({status:'succeeded',output:await job.execute('i')}))()};}};
  const glb=new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]).buffer,outputs={geometry:{},material:{}};
  const deps={async createTrellisSharedHost(){return {async beginRun({runId}){return {runId,route,withForeground:(p,w)=>w(),async finish(){return {status:release};}};},async dispose(){}};},
    async loadGenerationInputs(){return {seed:42};},createTrellisImageGenerationAdapter(){return {outputs,async run(){return outputs;},dispose(){}};},
    createTrellisAssetAdapter(){return {async run(){return {glb,mesh:{uvMetadata:{}},textures:{metadata:{}}};},dispose(){}};}};
  return ()=>runTrellisInPage({appGpu:{device:{},queue:{},async session(){return {};},beginRun(){return {};}},manifest:{id:'p'},fetchTensor:async()=>new ArrayBuffer(4),
    pixelValues:new Float32Array(512*512*3),finishing:{postprocessMesh:async m=>m,unwrapMesh:async m=>m},deps});
}
test('GL-01: when TRELLIS reports its GPU route held, no release is sent and the run says Greenroom stays blocked',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'});
  const error=await withGreenroomLease({post:s.post,runId:'r',route:'t'},heldTrellis('held')).catch(e=>e);
  assert.match(error.message,/not released: held/);
  assert.deepEqual(s.actions(),['claim'],'no release while the GPU work is unsettled');
  assert.deepEqual(error.greenroomHandback,{leaseId:'kaminos-page-r',state:'kept-blocking',reason:error.greenroomHandback.reason});
  assert.match(error.greenroomHandback.reason,/not released/);
});
test('GL-01: a TRELLIS run that settles, whether it succeeds or fails, releases',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'});
  await withGreenroomLease({post:s.post,runId:'r',route:'t'},heldTrellis('released'));
  assert.deepEqual(s.actions(),['claim','release']);
});

// GL-04: a failed release is reported, never swallowed.
test('GL-04: a generation followed by a failed release keeps its result and reports the incomplete handback',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:new Error('release endpoint unavailable'));
  const {result,lease}=await withGreenroomLease({post:s.post,runId:'r',route:'t'},async()=>'mesh');
  assert.equal(result,'mesh');assert.match(lease.releaseError,/release endpoint unavailable/);assert.equal(lease.leaseId,'kaminos-page-r');
});
test('GL-04: a failed run followed by a failed release keeps both failures',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:new Error('release endpoint unavailable'));
  const error=await withGreenroomLease({post:s.post,runId:'r',route:'t'},async()=>{throw Error('boom');}).catch(e=>e);
  assert.equal(error.message,'boom');assert.match(error.greenroomHandback?.releaseError,/release endpoint unavailable/);
});
test('a renewal that comes back not active (Greenroom moved the lease to ownership_unknown) is reported',async()=>{
  const clock=manual(),s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r',ttlSeconds:120}:b.action==='renew'?{status:'held',lifecycle:'ownership_unknown'}:{status:'released'});
  const {lease}=await withGreenroomLease({post:s.post,runId:'r',route:'t',setTimer:clock.setTimer,clearTimer:clock.clearTimer},async()=>{await clock.fire();return 'mesh';});
  assert.match(lease.renewError,/ownership_unknown/);
});

test('GL-01-C2: however the error is wrapped, unsettled GPU work keeps Greenroom blocked',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'});
  const unsettled=['trellis-frame-run'];
  const error=await withGreenroomLease({post:s.post,runId:'r',route:'t',unsettledWork:async()=>unsettled},
    async()=>{throw new AggregateError([Error('route registration failed'),Error('finish receipt clock failed')],'TRELLIS admission failed');}).catch(e=>e);
  assert.equal(error.message,'TRELLIS admission failed');assert.deepEqual(s.actions(),['claim'],'no release while the host still has an unsettled run');
  assert.equal(error.greenroomHandback.state,'kept-blocking');assert.match(error.greenroomHandback.reason,/trellis-frame-run/);
});
test('GL-01-C2: a run that ends with nothing unsettled releases as before',async()=>{
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'});
  await assert.rejects(withGreenroomLease({post:s.post,runId:'r',route:'t',unsettledWork:async()=>[]},async()=>{throw Error('ordinary');}));
  assert.deepEqual(s.actions(),['claim','release']);
});

// One page helper for every in-page model run (TRELLIS, SF3D, Klein): claim, wait, release, report.
import {createPageGpuLease,leasedService} from '../greenroom-lease.mjs';
const pageLease=(script,{unsettled=[]}={})=>{const s=server(script),infos=[];
  return {s,infos,lease:createPageGpuLease({post:s.post,unsettledWork:async()=>unsettled,setInfo:m=>infos.push(m),sleep:async()=>{},retryMs:0})};};

test('the page helper names the waiting model, holds the lease for the run, and records the lease',async()=>{
  let n=0;const {s,infos,lease}=pageLease(b=>b.action==='claim'?(n++<1?{status:'waiting',heldBy:['job7']}:{status:'held',leaseId:'kaminos-page-k'}):{status:'released'});
  const {result,lease:record}=await lease.run({label:'Klein',route:'flux2-klein.text-to-image.authoring-shared-device.v0'},async()=>'image');
  assert.equal(result,'image');assert.equal(record.status,'held');assert.deepEqual(s.actions(),['claim','claim','release']);
  assert.ok(infos.some(m=>/Klein waits for the GPU: Greenroom job job7/.test(m)));
});

test('a leased service reports busy while it waits for the GPU, and Stop cancels the wait without running',async()=>{
  let release;const gate=new Promise(r=>{release=r;});const calls=[];
  const service={busy:()=>false,stop:()=>{calls.push('stop');return true;},read:()=>({status:'idle'}),run:async input=>{calls.push(['run',input]);return 'image';}};
  const s=server(b=>b.action==='claim'?{status:'waiting',heldBy:['job7']}:{status:'released'});
  const lease=createPageGpuLease({post:s.post,unsettledWork:async()=>[],setInfo(){},sleep:()=>gate,retryMs:0});
  const leased=leasedService(service,{lease,label:'Klein',route:'r'});
  const run=leased.run({prompt:'p'});await new Promise(r=>setTimeout(r,0));
  assert.equal(leased.busy(),true,'waiting for the GPU counts as busy, so a second click is refused');
  await assert.rejects(leased.run({prompt:'again'}),/already/i);
  assert.equal(leased.stop(),true);release();
  await assert.rejects(run,/stop/i);assert.deepEqual(calls,[],'the model never ran');assert.equal(leased.busy(),false);
});

test('a leased service runs the model inside the lease and passes the result through',async()=>{
  const service={busy:()=>false,stop:()=>false,read:()=>({}),run:async input=>`image:${input.prompt}`};
  const s=server(b=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-k'}:{status:'released'});
  const leased=leasedService(service,{lease:createPageGpuLease({post:s.post,unsettledWork:async()=>[],setInfo(){}}),label:'Klein',route:'r'});
  assert.equal(await leased.run({prompt:'lantern'}),'image:lantern');assert.deepEqual(s.actions(),['claim','release']);
  assert.equal(leased.read,service.read,'everything but run, busy and stop is the service itself');
});
