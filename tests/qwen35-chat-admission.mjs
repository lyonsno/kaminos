// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import * as api from '../models/qwen3_5/chat-browser.js';
test('chat waits for queued admission, releases settled work, and keeps handback failure visible',async()=>{
 assert.equal(typeof api.withChatAdmission,'function','chat GPU admission absent');
 const calls=[];const post=async b=>{calls.push(b.action);return b.action==='queued-claim'?{status:'held',leaseId:'x'}:{status:'released'};};
 const out=await api.withChatAdmission({post,runId:'turn',unsettledWork:async()=>[]},async()=>42);
 assert.equal(out.result,42);assert.deepEqual(calls,['queued-claim','release']);
 await assert.rejects(api.withChatAdmission({post:async b=>{if(b.action==='release')throw Error('offline');return {status:'held',leaseId:'x'};},runId:'turn',unsettledWork:async()=>[]},async()=>42),e=>e.result===42&&/handback/.test(e.message));
});
test('unavailable admission never invokes model work',async()=>{
 let ran=false;await assert.rejects(api.withChatAdmission({post:async()=>{throw Error('offline');},runId:'turn'},async()=>{ran=true;}));assert.equal(ran,false);
});
