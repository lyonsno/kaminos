// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialQueryPool} from '../material-query-pool.mjs';
const capture=(a,b)=>({queries:new Float32Array([a,0,0,0,0,0,0,0,b,0,0,0,0,0,0,0]),filtered:new Float32Array([a,a,a,b,b,b]),raw:new Float32Array([a+10,a+10,a+10,b+10,b+10,b+10])});
test('mixed optimizer batches retain query/label pairing across directions and rolling replacement',()=>{
 const pool=createMaterialQueryPool(4);assert.throws(()=>pool.sample(2,()=>0),/Nonempty/);
 pool.add(capture(1,2));pool.add(capture(3,4));let i=0;const mixed=pool.sample(4,()=>[0,.25,.5,.75][i++]);
 assert.deepEqual(Array.from(mixed.filtered),[1,1,1,2,2,2,3,3,3,4,4,4]);
 pool.add(capture(5,6));i=0;const next=pool.sample(4,()=>[0,.25,.5,.75][i++]);
 assert.deepEqual(Array.from(next.filtered),[5,5,5,6,6,6,3,3,3,4,4,4]);
 for(let j=0;j<4;j++){assert.equal(next.queries[j*8],next.filtered[j*3]);assert.equal(next.raw[j*3],next.filtered[j*3]+10);}
 assert.equal(pool.count,4);assert.throws(()=>pool.sample(1,()=>1),/RNG/);
});
