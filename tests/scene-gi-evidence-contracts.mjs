import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const path=new URL('../scene-gi-evidence.mjs',import.meta.url);
// Before this validator, the witness accepted a run without pixel admission.
const admit=existsSync(path)?(await import(path)).admitSceneGIComparison:()=>true;
assert.throws(()=>admit({}),/evidence/, 'missing pixel/route evidence must not pass');
const pixels=v=>({width:2,height:1,values:[v,v,v,255,30,40,50,255]});
const good={native:true,root:'owned',expectedRoot:'owned',errors:[],sourceBefore:'abc',sourceAfter:'abc',
  giRaw:{max:2,nonzero:3},baseline:pixels(10),restored:pixels(10),combined:pixels(12),zero:pixels(10)};
assert.ok(admit(good));
for(const bad of [{native:false},{root:'wrong'},{errors:['validation']},{sourceAfter:'changed'},
  {giRaw:{max:0,nonzero:0}},{combined:pixels(10)},{restored:pixels(0)},
  {baseline:{width:2,height:1,values:[]}}, {combined:{width:2,height:1,values:[NaN]}}]) {
  assert.throws(()=>admit({...good,...bad}),/evidence/);
}
console.log('scene GI evidence rejects wrong route, errors, changed source, blank, partial and disconnected output');
