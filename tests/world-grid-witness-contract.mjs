// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePressureWitness} from '../tools/world-grid-witness-contract.mjs';
test('missing, blank, stale-config and fallback native evidence cannot pass',()=>{
 const fixture=()=>({adapter:{vendor:'apple'},errors:[],cases:[8,4,2].map(n=>({
  plan:{flowDims:[8,16,8],pressureDims:[n,2*n,n],flowCells:1024,pressureCells:2*n**3},
  receipt:{flowDims:[8,16,8],pressureDims:[n,2*n,n],steps:1,pressureIterations:12},
  input:Array(4096).fill(.1),arrays:{'world smoke flow 0':Array(4096).fill(.1),'world smoke flow 1':Array(4096).fill(.1),
   'world smoke pressure 0':Array(2*n**3).fill(.1),'world smoke pressure 1':Array(2*n**3).fill(.1),'world smoke pressure rhs and occupancy':Array(4*n**3).fill(.1)},
 }))});
 assert.doesNotThrow(()=>validatePressureWitness(fixture()));
 for(const mutate of [r=>r.cases=[],r=>r.cases.pop(),r=>r.adapter.vendor='google swiftshader',r=>r.errors.push('validation'),r=>r.cases[1].receipt.pressureDims=[8,16,8],r=>r.cases[0].arrays['world smoke flow 0'].pop(),r=>r.cases[0].arrays['world smoke flow 0'].fill(0),r=>r.cases[0].arrays['world smoke flow 0'][0]=NaN]){
  const r=fixture();mutate(r);assert.throws(()=>validatePressureWitness(r));
 }
});
