import assert from 'node:assert/strict';
import {assertSceneTimingSample,measureSceneGpu} from '../scene-light-timing.mjs';
assertSceneTimingSample({ms:.5,frame:4},3);
assert.throws(()=>assertSceneTimingSample({ms:.5,frame:3},3),/stale|fresh/,'Three can return a cached timestamp on resolve failure; repeated frame cannot be fresh evidence');
for(const sample of [{ms:NaN,frame:4},{ms:0,frame:4},{ms:1,frame:undefined}])assert.throws(()=>assertSceneTimingSample(sample));
const previousRAF=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>queueMicrotask(fn);
try{
 const renderer={info:{frame:10},backend:{trackTimestamp:false,device:{features:new Set(['timestamp-query']),queue:{async onSubmittedWorkDone(){renderer.info.frame++;}}},timestampQueryPool:{render:{frames:[]}}},async resolveTimestampsAsync(){this.backend.timestampQueryPool.render.frames=[this.info.frame];return .5;}};
 const result=await measureSceneGpu(renderer,{samples:2,drawFrame(){renderer.info.frame++;return {frame:renderer.info.frame,drawn:true};}});
 assert.equal(result.status,'failed','another draw during the queue wait cannot satisfy explicit-draw attribution');
 assert.match(result.error,/draw|frame|attribution/);assert.equal(renderer.backend.trackTimestamp,false);
}finally{globalThis.requestAnimationFrame=previousRAF;}
console.log('scene GPU timing rejects cached, zero and missing frame evidence');
