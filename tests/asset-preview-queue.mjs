// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as queueModule from '../asset-preview-queue.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('selected high-resolution preview overtakes queued tiles, with one renderer and deduplicated sources',async()=>{
 assert.equal(typeof queueModule.createAssetPreviewQueue,'function');let release;const gate=new Promise(r=>release=r),calls=[];
 const q=queueModule.createAssetPreviewQueue(async(entry,size)=>{calls.push([entry.source,size]);if(entry.source==='first')await gate;return `${entry.source}:${size}`;});
 const first=q.thumbnail({source:'first'});await tick();const queued=q.thumbnail({source:'tile'}),selected=q.detail({source:'selected'}),duplicate=q.detail({source:'selected'});
 release();assert.deepEqual(await Promise.all([first,queued,selected,duplicate]),['first:192','tile:192','selected:512','selected:512']);assert.deepEqual(calls,[['first',192],['selected',512],['tile',192]]);
});
test('withheld and no-longer-wanted work never renders, and a skipped preview remains retryable',async()=>{
 const calls=[],q=queueModule.createAssetPreviewQueue(async entry=>{calls.push(entry.source);return 'image';});
 assert.equal(await q.detail({source:'held',visibility:{status:'withheld'}}),null);assert.equal(await q.thumbnail({source:'skipped'},()=>false),null);assert.equal(await q.thumbnail({source:'skipped'}),'image');assert.deepEqual(calls,['skipped']);
});
