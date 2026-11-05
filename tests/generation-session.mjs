// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../webgpu-inference-kit/src/autoregressive-generation.js';

function fixture() {
  const calls = [], states = [];
  const model = {
    async createState({ capacity }) { const state = { capacity, ids: [] }; states.push(state); calls.push(['create',capacity]); return state; },
    async prefill(ids,s) { calls.push(['prefill',[...ids]]); s.ids.push(...ids); return s.ids.reduce((a,b)=>a+b,0); },
    async append(ids,s) { calls.push(['append',[...ids]]); s.ids.push(...ids); return s.ids.reduce((a,b)=>a+b,0); },
    async decode(id,s) { calls.push(['decode',id]); s.ids.push(id); return s.ids.reduce((a,b)=>a+b,0); },
    async disposeState(s) { calls.push(['dispose']); s.closed = true; },
  };
  return { model, calls, states };
}
function session(f) {
  assert.equal(typeof api.createGenerationSession, 'function', 'persistent generation session is absent');
  return api.createGenerationSession({ model:f.model, capacity:32 });
}
const turn = (inputIds, extra={}) => ({ inputIds, maxNewTokens:2, eosTokenIds:[99], sample:()=>3, ...extra });

test('follow-up reuses consumed prefix and feeds the last length-stopped token exactly once', async()=>{
  const f=fixture(), s=session(f);
  const a=await s.generate(turn([1,2]));
  assert.deepEqual(a.tokenIds,[3,3]); assert.equal(f.states.length,1); assert.equal(f.states[0].closed,undefined);
  const b=await s.generate(turn([1,2,3,3,7],{maxNewTokens:1}));
  assert.deepEqual(f.calls,[['create',32],['prefill',[1,2]],['decode',3],['append',[3,7]]]);
  assert.equal(b.usage.reusedInputTokens,3); assert.equal(b.usage.evaluatedInputTokens,2);
  assert.equal(b.usage.cacheAction,'append'); assert.equal(b.usage.cachedTokens,5);
  assert.ok(b.usage.totalMs>=b.usage.inputMs); assert.ok(b.usage.decodeMs>=0);
  await s.dispose(); assert.equal(f.states[0].closed,true);
});
test('EOS not previously consumed is included by the next complete prompt',async()=>{
 const f=fixture(),s=session(f); await s.generate(turn([1,2],{sample:()=>99}));
 await s.generate(turn([1,2,99,7],{maxNewTokens:1}));
 assert.deepEqual(f.calls.at(-1),['append',[99,7]]); await s.dispose();
});
test('identical cached prefix uses cached logits; edited/shorter prefix rebuilds',async()=>{
 const f=fixture(),s=session(f); const a=await s.generate(turn([1,2],{maxNewTokens:1,sample:x=>x}));
 const b=await s.generate(turn([1,2],{maxNewTokens:1,sample:x=>x}));
 assert.deepEqual(b.tokenIds,a.tokenIds); assert.equal(b.usage.cacheAction,'logits'); assert.equal(b.usage.evaluatedInputTokens,0);
 await s.generate(turn([1,8],{maxNewTokens:1})); assert.equal(f.states[0].closed,true); assert.equal(f.states.length,2);
 await s.generate(turn([1],{maxNewTokens:1})); assert.equal(f.states.length,3); await s.dispose();
});
test('new capacity rebuilds without dropping tokens; invalid request preserves valid cache',async()=>{
 const f=fixture(),s=session(f); await s.generate(turn([1],{maxNewTokens:1}));
 await assert.rejects(s.generate(turn([-1])),/token/); assert.equal(f.states[0].closed,undefined);
 const b=await s.generate(turn([1,2],{capacity:64,maxNewTokens:1}));
 assert.equal(b.usage.cacheAction,'rebuild'); assert.equal(b.usage.reusedInputTokens,0); assert.equal(f.states[1].capacity,64);
 await assert.rejects(s.generate(turn(Array(65).fill(1))),/capacity/); await s.dispose();
});
test('request failure invalidates hybrid state and permits a clean retry',async()=>{
 const f=fixture(),s=session(f); await assert.rejects(s.generate(turn([1],{onToken:()=>{throw Error('consumer');}})),/consumer/);
 assert.equal(f.states[0].closed,true); await s.generate(turn([1],{maxNewTokens:1})); assert.equal(f.states.length,2); await s.dispose();
});
test('concurrent turns fail, disposal cancels active generation and settles before cleanup',async()=>{
 const f=fixture(),s=session(f); let release,entered;
 const blocked=new Promise(r=>release=r), started=new Promise(r=>entered=r);
 const running=s.generate(turn([1],{sample:async()=>{entered(); await blocked; return 3;}}));
 await started; await assert.rejects(s.generate(turn([2])),/busy/);
 const closed=s.dispose(); release(); await assert.rejects(running,{name:'AbortError'}); await closed;
 assert.equal(f.calls.filter(x=>x[0]==='dispose').length,1); await assert.rejects(s.generate(turn([1])),/closed/);
});
test('reset retires state but retains a usable session and caller-owned model',async()=>{
 const f=fixture(),s=session(f); await s.generate(turn([1],{maxNewTokens:1})); await s.reset();
 assert.equal(f.states[0].closed,true); await s.generate(turn([2],{maxNewTokens:1})); await s.dispose(); await s.dispose();
 assert.equal(f.calls.filter(x=>x[0]==='dispose').length,2);
});
test('caller abort invalidates cache without closing borrowed control',async()=>{
 const f=fixture(),s=session(f),a=new AbortController();
 await assert.rejects(s.generate(turn([1],{signal:a.signal,onToken:()=>a.abort('stop')})),{name:'AbortError'});
 assert.equal(f.states[0].closed,true); await s.generate(turn([1],{maxNewTokens:1})); await s.dispose();
});
test('cache replay numerics equal fresh computation after multiple turns',async()=>{
 const f=fixture(),s=session(f); let prefix=[2,4];
 for(let i=0;i<4;i++){
   const reused=await s.generate(turn(prefix,{sample:x=>x%97}));
   const fresh=await api.generateTokens({model:fixture().model,capacity:32,...turn(prefix,{sample:x=>x%97})});
   assert.deepEqual(reused.tokenIds,fresh.tokenIds);prefix=[...prefix,...reused.tokenIds,7];
 }
 await s.dispose();
});
test('failed disposal cannot be mistaken for a reusable or successfully retired cache',async()=>{
 const f=fixture(),s=session(f); await s.generate(turn([1],{maxNewTokens:1}));
 f.model.disposeState=async()=>{throw Error('fence failed');};
 await assert.rejects(s.reset(),/fence failed/);assert.equal(s.snapshot().cachedTokens,0);
 await assert.rejects(s.generate(turn([1])),AggregateError);assert.equal(f.states.length,1);
});
