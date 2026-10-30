// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withGreenroomLease} from '../greenroom-lease.mjs';

test('queued page reports its canonical place and removes its entry on cancellation',async()=>{
 const abort=new AbortController(),calls=[];
 await assert.rejects(withGreenroomLease({post:async body=>{calls.push(body.action);return{status:'waiting',jobId:'external-r',position:3,ahead:['a','b']};},
  admission:'queue',runId:'r',route:'prompt',signal:abort.signal,onWait:wait=>{assert.equal(wait.position,3);abort.abort();},sleep:async()=>{}},async()=>assert.fail('must not execute')));
 assert.deepEqual(calls,['queued-claim','withdraw-queued']);
});

test('explicit outside-queue mode never claims execution authority',async()=>{
 let calls=0;
 const {result,lease}=await withGreenroomLease({admission:'outside',post:async()=>{calls++;},runId:'r',route:'prompt'},async lease=>{
  assert.equal(lease.status,'bypassed');return 'expanded';
 });
 assert.equal(calls,0);assert.equal(result,'expanded');assert.equal(lease.coordination,'outside-queue');
});

test('skip while waiting withdraws the canonical ticket before invoking the model',async()=>{
 const bypass=new AbortController(),calls=[];
 const {lease}=await withGreenroomLease({admission:'queue',runId:'r',route:'prompt',bypassSignal:bypass.signal,
  post:async body=>{calls.push(body.action);return{status:body.action==='queued-claim'?'waiting':'cancelled',position:1};},
  onWait:()=>bypass.abort(),sleep:async()=>{}},async()=>{calls.push('model');});
 assert.deepEqual(calls,['queued-claim','withdraw-queued','model']);assert.equal(lease.status,'bypassed');
});

test('cancellation during an in-flight grant withdraws without starting any GPU work',async()=>{
 const abort=new AbortController(),calls=[];
 await assert.rejects(withGreenroomLease({admission:'queue',runId:'r',route:'prompt',signal:abort.signal,
  post:async body=>{calls.push(body.action);if(body.action==='queued-claim'){abort.abort();return{status:'held',leaseId:'kaminos-page-r'};}return{status:'cancelled'};}},async()=>assert.fail('not started')));
 assert.deepEqual(calls,['queued-claim','withdraw-queued']);
});

test('a lost claim response is withdrawn; unavailable admission never silently bypasses',async()=>{
 const calls=[];
 await assert.rejects(withGreenroomLease({admission:'queue',runId:'r',route:'prompt',post:async body=>{
  calls.push(body.action);if(body.action==='queued-claim')throw Error('lost response');return{status:'cancelled'};
 }},async()=>assert.fail('not started')),/lost response/);
 assert.deepEqual(calls,['queued-claim','withdraw-queued']);
});

test('failed withdrawal prevents outside-queue execution and records the unresolved entry',async()=>{
 const bypass=new AbortController();
 const error=await withGreenroomLease({admission:'queue',runId:'r',route:'prompt',bypassSignal:bypass.signal,
  post:async body=>{if(body.action==='withdraw-queued')throw Error('server unavailable');return{status:'waiting'};},
  onWait:()=>bypass.abort(),sleep:async()=>{}},async()=>assert.fail('not started')).catch(e=>e);
 assert.match(error.message,/server unavailable/);assert.equal(error.greenroomHandback?.state,'withdrawal-failed');
});

test('queued admission rechecks within one normal worker polling interval',async()=>{
 const delays=[];let claims=0;
 await withGreenroomLease({admission:'queue',runId:'r',route:'prompt',sleep:async ms=>delays.push(ms),
  post:async body=>body.action==='queued-claim'&&claims++===0?{status:'waiting'}:body.action==='queued-claim'?{status:'held',leaseId:'kaminos-page-r'}:{status:'released'}},async()=>{});
 assert.deepEqual(delays,[2000]);
});
