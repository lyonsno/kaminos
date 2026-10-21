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

test('no Greenroom on this server, or a page inside a Greenroom job: the run proceeds and says which',async()=>{
  for(const [reply,status] of [[{status:'unconfigured'},'unconfigured'],[{status:'inside-job',jobId:'j9'},'inside-job']]){
    const s=server(()=>reply);
    const {result,lease}=await withGreenroomLease({post:s.post,runId:'r',route:'t',insideJob:'j9'},async l=>l.status);
    assert.equal(result,status);assert.equal(lease.status,status);assert.deepEqual(s.actions(),['claim']);
    assert.equal(s.calls[0].insideJob,'j9');
  }
});

test('a server that cannot be reached for the claim fails the run loudly instead of running unleased',async()=>{
  const s=server(()=>new Error('fetch failed'));
  await assert.rejects(withGreenroomLease({post:s.post,runId:'r',route:'t'},async()=>'ran'),/Greenroom lease/);
});
