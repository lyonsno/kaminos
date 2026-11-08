// kaminos-test: node
import assert from 'node:assert/strict';
import {assertAlphaRuntime} from '../tools/alpha-ladder-witness.mjs';
const expected={repoRoot:'/owned',branch:'cc/alpha',commit:'exact'};
assertAlphaRuntime(expected,{...expected,dirty:false});
for(const bad of [null,{...expected,dirty:true},{...expected,dirty:false,commit:'stale'},{...expected,dirty:false,repoRoot:'/other'},{...expected,dirty:false,branch:'main'}])assert.throws(()=>assertAlphaRuntime(expected,bad),/Effective alpha renderer/);
console.log('Wrong/stale/dirty renderer cannot close a visual alpha witness');
