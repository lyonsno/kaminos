// kaminos-test: node
import assert from 'node:assert/strict';
import {importanceDistribution,importanceSelect,importanceWeight} from '../scene-angular-importance.mjs';
import {volumeGatherPlan} from '../scene-volume-gather.mjs';
const q=importanceDistribution([0,0,10,0]);
assert.deepEqual(q,[.0625,.0625,.8125,.0625]);
assert.deepEqual(importanceDistribution([0,0,0,0]),[.25,.25,.25,.25]);
const values=[2,3,20,1],N=2;
let expected=0;
for(let i=0;i<q.length;i++)expected+=q[i]*values[i]*importanceWeight(q[i],N,q.length)*N;
assert.equal(expected,values.reduce((a,b)=>a+b)/4,'importance weights preserve the finite-bank mean');
assert.equal(importanceSelect(q,0),0);assert.equal(importanceSelect(q,.125),2);assert.equal(importanceSelect(q,.999999),3);
assert(q.every(p=>p>=.25/q.length),'every direction remains discoverable');
const limits={maxStorageBufferBindingSize:1e8,maxTextureDimension2D:8192,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535};
const plan=volumeGatherPlan({volumeGrid:2,sourceDimensions:[2,2,2],directions:4,angularPattern:'importance',smokeRefinement:1},limits);
assert.equal(plan.bankDirections,8);assert.equal(plan.importanceBytes,8*8*8);
assert.throws(()=>volumeGatherPlan({volumeGrid:2,sourceDimensions:[2,2,2],directions:8,angularPattern:'importance',smokeRefinement:1},{...limits,maxStorageBufferBindingSize:300}),/distance|importance/);
for(const bad of [[NaN],[-1],[Infinity]])assert.throws(()=>importanceDistribution(bad),/score/);
console.log('PASS cached importance exploration, finite-bank weighting and allocation admission');
