// kaminos-test: node
import assert from 'node:assert/strict';
import {assertAlphaRuntime,assertAlphaPixels,admitAlphaPage} from '../tools/alpha-ladder-witness.mjs';
const expected={repoRoot:'/owned',branch:'cc/alpha',commit:'exact'};
assertAlphaRuntime(expected,{...expected,dirty:false});
for(const bad of [null,{...expected,dirty:true},{...expected,dirty:false,commit:'stale'},{...expected,dirty:false,repoRoot:'/other'},{...expected,dirty:false,branch:'main'}])assert.throws(()=>assertAlphaRuntime(expected,bad),/Effective alpha renderer/);
assert.throws(()=>assertAlphaPixels({changed:250000,foregroundChanged:0}),/No visible/);
assertAlphaPixels({foregroundChanged:10000});
const pageFor=state=>({waitForFunction:async()=>({jsonValue:async()=>true,dispose:async()=>{}}),evaluate:async()=>state});
await admitAlphaPage(pageFor({asset:'grass',mode:'learned',count:4000}),{asset:'grass'});
for(const state of [{asset:'kiln',mode:'learned',count:4000},{asset:'grass',mode:'baked',count:4000},{asset:'grass',mode:'learned',count:2000}])await assert.rejects(admitAlphaPage(pageFor(state),{asset:'grass'}));
console.log('Wrong/stale/dirty renderer cannot close a visual alpha witness');
