import assert from 'node:assert/strict';
import {awaitAppGpu} from './startup.mjs';
let calls=0,ticks=0,frames=0;const host={device:{},frameOwner:()=>{frames++;return {}}};
const result=await awaitAppGpu(async()=>++calls<3?null:host,async()=>ticks++);
assert.equal(result,host);assert.equal(calls,3);assert.equal(ticks,2);assert.equal(frames,1);
console.log('accessor may precede device; host waits for actual device and creates frame owner before frame reads');
