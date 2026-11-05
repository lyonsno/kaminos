// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsAshWitness} from '../tools/ash-witness-verdict.mjs';
// Observed 5d714fd55 browser report: ash-gpu-final/negative-pageerror/report.json.
const early={status:'failed',phase:'deposit',error:'page.evaluate: Error: Ash operation in progress',errors:[],consoleErrors:[],browserClosed:true};
test('unrelated early failure cannot establish any requested negative',()=>{
 for(const kind of ['pageerror','unmounted','frozen-live'])assert.equal(acceptsAshWitness(early,kind,1),false,kind);
});
test('page-error proof requires injected and observed error plus terminal rejection',()=>{
 const witnessed={...early,phase:'pageerror-negative',injectedPageError:'injected GPU ash witness failure',errors:['Error: injected GPU ash witness failure']};
 assert.equal(acceptsAshWitness(witnessed,'pageerror',1),true);
 for(const changed of [{injectedPageError:undefined},{errors:[]},{status:'passed'},{browserClosed:false}])assert.equal(acceptsAshWitness({...witnessed,...changed},'pageerror',1),false);
});
test('other negative results require their exact phase and cause',()=>{
 assert.equal(acceptsAshWitness({...early,phase:'mount',error:'Error: No experiment open'},'unmounted',1),true);
 assert.equal(acceptsAshWitness({...early,phase:'live',error:'AssertionError: live host frames must actually advance ash',liveFrames:[{steps:45},{steps:45}]},'frozen-live',1),true);
 assert.equal(acceptsAshWitness({...early,phase:'live',error:'AssertionError: live host frames must actually advance ash'},'frozen-live',1),false);
});
