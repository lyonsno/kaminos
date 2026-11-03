// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as chatApi from '../models/qwen3_5/pup-text.js';
const token = { added:new Map([['<|im_end|>',99],['<|endoftext|>',100]]), encode:s=>[...s].map(c=>c.codePointAt(0)), createDecoder:()=>({push:()=> 'fox',end:()=>''}) };
function fixture(){const calls=[];return {calls,model:{createState:async()=>({}),prefill:async ids=>{calls.push([...ids]);return [2,0];},append:async ids=>{calls.push([...ids]);return [2,0];},decode:async()=>[2,0],disposeState:async()=>{}}};}
test('chat retains exact generated tokens and includes turn terminator on follow-up',async()=>{
 assert.equal(typeof chatApi.createQwenTextChat,'function','chat consumer absent');
 const f=fixture(),chat=chatApi.createQwenTextChat({model:f.model,tokenizer:token,capacity:2048,systemPrompt:'Help.'});
 const a=await chat.send({text:' fox ',maxNewTokens:1});
 const b=await chat.send({text:'make it blue',maxNewTokens:1});
 assert.equal(a.text,'fox'); assert.ok(b.usage.reusedInputTokens>0);
 assert.equal(f.calls[1][0],0,'actual output token retained instead of detokenizing/reencoding');
 assert.equal(f.calls[1][1],99,'length-stopped turn explicitly closed');
 assert.match(String.fromCodePoint(...f.calls[1].slice(2)),/user\nmake it blue/);
 await chat.reset(); assert.equal(chat.snapshot().turns.length,0); await chat.dispose();
});
test('new system instruction resets conversation state without reloading model weights',async()=>{
 const f=fixture(),chat=chatApi.createQwenTextChat({model:f.model,tokenizer:token,capacity:2048,systemPrompt:'Old instruction.'});
 await chat.send({text:'hello',maxNewTokens:1});
 await chat.reset({systemPrompt:'New instruction.'});
 assert.equal(chat.snapshot().systemPrompt,'New instruction.');assert.equal(chat.snapshot().turns.length,0);
 const r=await chat.send({text:'hello again',maxNewTokens:1});assert.equal(r.usage.reusedInputTokens,0);
 assert.match(String.fromCodePoint(...f.calls.at(-1)),/system\nNew instruction\./);
 await assert.rejects(chat.reset({systemPrompt:42}),/systemPrompt/);assert.equal(chat.snapshot().turns.length,1);
 await chat.dispose();await assert.rejects(chat.reset(),/closed/);
});
