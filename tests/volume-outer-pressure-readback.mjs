import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const method=source.match(/async readOuterSmokeState\(\)\{[^\n]*\}/)[0];
test('successive actual production wrapper reads pair completion with the returned field',async()=>{
  let step=0,observed=null;
  const outerSmoke={receipt:()=>({pressureCompletion:observed}),async readState(){await Promise.resolve();observed={measuredStep:++step};return new Float32Array([step]);}};
  const api=vm.runInNewContext(`({${method}})`,{outerSmoke,Error});
  for(const expected of [1,2]){
    const r=await api.readOuterSmokeState();assert.equal(r.values[0],expected);
    assert.equal(r.receipt.pressureCompletion?.measuredStep,expected,'the receipt must be sampled after this readback');
  }
});
