import assert from 'node:assert/strict';
import {assertSceneTimingSample} from '../scene-light-timing.mjs';
assertSceneTimingSample({ms:.5,frame:4},3);
assert.throws(()=>assertSceneTimingSample({ms:.5,frame:3},3),/stale|fresh/,'Three can return a cached timestamp on resolve failure; repeated frame cannot be fresh evidence');
for(const sample of [{ms:NaN,frame:4},{ms:0,frame:4},{ms:1,frame:undefined}])assert.throws(()=>assertSceneTimingSample(sample));
console.log('scene GPU timing rejects cached, zero and missing frame evidence');
