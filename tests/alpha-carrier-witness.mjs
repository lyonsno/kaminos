// kaminos-test: node
import assert from 'node:assert/strict';
import {assertAlphaRuntime,assertAlphaPixels} from '../tools/alpha-ladder-witness.mjs';
const expected={repoRoot:'/owned',branch:'cc/alpha',commit:'exact'};
assertAlphaRuntime(expected,{...expected,dirty:false});
for(const bad of [null,{...expected,dirty:true},{...expected,dirty:false,commit:'stale'},{...expected,dirty:false,repoRoot:'/other'},{...expected,dirty:false,branch:'main'}])assert.throws(()=>assertAlphaRuntime(expected,bad),/Effective alpha renderer/);
assert.throws(()=>assertAlphaPixels({changed:250000,foregroundChanged:0}),/No visible/);
assertAlphaPixels({foregroundChanged:10000});
console.log('Wrong/stale/dirty renderer cannot close a visual alpha witness');
