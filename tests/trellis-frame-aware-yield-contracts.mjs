// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createTrellisFrameAwareSleep} from '../models/trellis2/frame-aware-yield.js';

function fixture(extra={}){
 let clock=0;const events=[],frames=new Map();let next=0;
 const signal=new AbortController();
 const sleep=createTrellisFrameAwareSleep({frameBudgetMs:8,now:()=>clock,signal:signal.signal,
  task:async()=>events.push('task'),timer:async ms=>events.push(['timer',ms]),
  queue:{async onSubmittedWorkDone(){events.push('drain');}},
  requestFrame:fn=>{const id=++next;frames.set(id,fn);events.push('request-frame');return id;},
  cancelFrame:id=>{frames.delete(id);events.push('cancel-frame');},...extra});
 return{sleep,events,frames,signal,setClock:t=>clock=t};
}

test('zero delay posts tasks inside the frame budget, then drains and yields an actual frame',async()=>{
 const f=fixture();await f.sleep(0);assert.deepEqual(f.events,['task']);
 f.setClock(9);const pending=f.sleep(0);await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.events,['task','drain','request-frame']);assert.equal(f.frames.size,1);
 const [id,frame]=f.frames.entries().next().value;f.frames.delete(id);f.setClock(17);frame(17);await pending;
 await f.sleep(0);assert.deepEqual(f.events,['task','drain','request-frame','task']);
 assert.deepEqual(f.sleep.snapshot(),{kind:'frame-aware',frameBudgetMs:8,maxTaskYieldsPerFrame:8,taskYields:2,frameYields:1,positiveWaits:0,gpuDrains:1});
});

test('positive requested delays retain the caller timer',async()=>{
 const f=fixture();await f.sleep(12);assert.deepEqual(f.events,[['timer',12]]);
});

test('queue loss is propagated without requesting a misleading completed frame',async()=>{
 const lost=Error('observed device loss');const f=fixture({queue:{async onSubmittedWorkDone(){throw lost;}}});
 f.setClock(9);await assert.rejects(f.sleep(0),e=>e===lost);assert.equal(f.frames.size,0);
});

test('Stop rejects a pending frame wait and cancels its owned callback',async()=>{
 const f=fixture();f.setClock(9);const pending=f.sleep(0);const observed=pending.catch(e=>e);
 await new Promise(r=>setImmediate(r));f.signal.abort(new DOMException('operator Stop','AbortError'));
 const e=await observed;assert.equal(e.name,'AbortError');assert.equal(f.frames.size,0);assert.ok(f.events.includes('cancel-frame'));
});

test('Stop during a drain prevents the next frame and model duty',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=fixture({queue:{onSubmittedWorkDone:()=>gate}});
 f.setClock(9);const p=f.sleep(0);const observed=p.catch(e=>e);f.signal.abort();release();
 assert.equal((await observed).name,'AbortError');assert.equal(f.frames.size,0);
});

test('missing real frame/queue capabilities and invalid policy are refused',()=>{
 for(const change of [{queue:{}},{requestFrame:null},{cancelFrame:null},{frameBudgetMs:0},{frameBudgetMs:NaN}])
  assert.throws(()=>fixture(change));
});


test('submission-count boundary yields a frame even when the CPU clock has not reached its budget',async()=>{
 const f=fixture({maxTaskYieldsPerFrame:2});await f.sleep(0);await f.sleep(0);
 const p=f.sleep(0);await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.events,['task','task','drain','request-frame']);
 const [id,frame]=f.frames.entries().next().value;f.frames.delete(id);frame(0);await p;
 assert.equal(f.sleep.snapshot().frameYields,1);await f.sleep(0);assert.equal(f.sleep.snapshot().taskYields,3);
});

test('per-duty fence waits for actual GPU completion before a task and leaves frame ownership with the app',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const f=fixture({perDutyFence:true,queue:{onSubmittedWorkDone(){f.events.push('drain');return gate;}}});
 const pending=f.sleep(0);assert.deepEqual(f.events,['drain']);release();await pending;
 assert.deepEqual(f.events,['drain','task']);assert.equal(f.frames.size,0);
 assert.equal(f.sleep.snapshot().gpuDrains,1);assert.equal(f.sleep.snapshot().kind,'per-duty-fence-task');
});

test('per-duty fence propagates queue loss without posting a task or private frame',async()=>{
 const lost=Error('observed device loss'),f=fixture({perDutyFence:true,queue:{async onSubmittedWorkDone(){throw lost;}}});
 await assert.rejects(f.sleep(0),e=>e===lost);assert.deepEqual(f.events,[]);
});
