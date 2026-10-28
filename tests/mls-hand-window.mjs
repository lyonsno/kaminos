// kaminos-test: node
import assert from 'node:assert/strict';
import * as witness from '../tools/mls-witness-source.mjs';
import {MLS_ROUTE} from '../mls-juice-contract.mjs';
assert.equal(typeof witness.validateMlsHandWindow,'function','populated-window validation is absent');
const state=(frame,seconds,received)=>({running:true,starting:false,error:null,received,identity:{backend:'webgpu-local'},
  fingerJuice:{enabled:true,backend:'mls-mpm',error:null,runtime:{effectiveRoute:MLS_ROUTE,failure:null,frameCount:frame,solver:{clock:{simulatedSeconds:seconds}}}}});
const start=state(20,8,15),end=state(40,11,20),validate=witness.validateMlsHandWindow;
assert.deepEqual(validate(start,end),{presentedFrames:20,simulatedSeconds:3,handResults:5});
assert.throws(()=>validate(start,state(20,11,20)),/presentation progress/);
assert.throws(()=>validate(start,state(40,8,20)),/simulation progress/);
assert.throws(()=>validate(start,state(40,11,15)),/hand progress/);
for(const mutate of [s=>s.error='hand failed',s=>s.running=false,s=>s.fingerJuice.error='expired',
  s=>s.fingerJuice.runtime.failure='device lost',s=>s.fingerJuice.runtime.effectiveRoute='legacy',s=>delete s.fingerJuice.runtime]){
  const bad=structuredClone(end);mutate(bad);assert.throws(()=>validate(start,bad));
}
console.log('MLS populated-window requires hand, presentation and simulation progress without errors');
