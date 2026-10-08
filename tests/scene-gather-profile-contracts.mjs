import assert from 'node:assert/strict';
import {installGatherProfiler} from '../scratch/beaming-gather-profiler.mjs';
globalThis.GPUBufferUsage={QUERY_RESOLVE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8};
globalThis.GPUMapMode={READ:1};
for(const [times,valid] of [[[100n,200n],true],[[100n,99n],false],[[0n,200n],false]]){
 const profile={remaining:1,records:[],errors:[]};globalThis.window={__beamingGatherProfile:profile};
 const device={features:new Set(['timestamp-query']),queue:{submit(){}},
  createQuerySet(){return {destroy(){}};},
  createBuffer(){return {mapAsync:async()=>{},getMappedRange:()=>new BigUint64Array(times).buffer,destroy(){}};},
  createCommandEncoder(){return {beginComputePass:()=>({end(){}}),resolveQuerySet(){},copyBufferToBuffer(){},finish:()=>({})};}};
 installGatherProfiler(device);
 const encoder=device.createCommandEncoder({label:'same-state distributed flame lighting'});
 encoder.beginComputePass({label:'observed pass'}).end();device.queue.submit([encoder.finish()]);
 await new Promise(r=>setImmediate(r));
 assert.equal(profile.records.length,1);assert.equal(profile.records[0].valid,valid);
 assert.deepEqual(profile.records[0].rawNanoseconds,times.map(String));
 assert.equal(profile.errors.length,valid?0:1);
 assert.equal(profile.records[0].totalMs,valid?.0001:null,'invalid evidence must not become a cost');
}
console.log('invalid GPU timestamps remain raw evidence, never successful cost');
