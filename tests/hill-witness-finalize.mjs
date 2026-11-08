// kaminos-test: node
import assert from 'node:assert/strict';import {finishHillWitness} from '../tools/hill-witness-finalize.mjs';
for(const primary of [false,true]){
 const report={status:primary?'failed':'passed',phase:primary?'physics':'complete',result:{cases:30},closed:false,...(primary?{error:'primary failure'}:{})};let saved;
 await assert.doesNotReject(()=>finishHillWitness(report,{close:async()=>{throw Error('browser cleanup failure');},save:async()=>{saved=structuredClone(report);}}),'Cleanup failure must not bypass terminal publication');
 assert.equal(saved.status,'failed');assert.equal(saved.closed,false);assert.match(saved.cleanupError,/browser cleanup failure/);assert.equal(saved.result.cases,30);if(primary){assert.equal(saved.error,'primary failure');assert.equal(saved.phase,'physics');}else assert.equal(saved.phase,'cleanup');
}
let saved;const report={status:'passed',phase:'complete',closed:false};await finishHillWitness(report,{close:async()=>{},postflight:async()=>{throw Error('changed source');},save:async()=>{saved=structuredClone(report);}});assert.equal(saved.status,'failed');assert.equal(saved.phase,'source-postflight');assert.equal(saved.closed,true);assert.match(saved.error,/changed source/);
