import assert from 'node:assert/strict';
import * as checks from '../sparse-generation-witness-checks.js';
assert.equal(typeof checks.validateGenerationResult,'function');
assert.equal(typeof checks.persistGenerationPhase,'function',
  'A browser disconnect must leave the exact reached native kernel and replay input without quadratic phase-history rewrites.');
const report={},lines=[],writes=[],row={phase:'sparse-structure-sampling',effectiveRoute:checks.GENERATION_ROUTE,sessionId:'observed-test-session',
  kernel:{stage:'terminal-output-projection',dispatch:[4,1,1],point:'before-native-kernel'}},
  persist=()=>writes.push(true),append=async(path,line)=>lines.push({path,row:JSON.parse(line)});
await checks.persistGenerationPhase({report,row,kernelLogPath:'/caller-owned/kernel-events.jsonl',append,persist});
assert.equal(lines.length,1);assert.equal(writes.length,0);assert.equal(report.kernelEvidence.count,1);
assert.deepEqual(report.lastKernel,row.kernel);assert.equal(report.livePhases,undefined);
await checks.persistGenerationPhase({report,row:{...row,kernel:{...row.kernel,point:'native-kernel-returned'}},
  kernelLogPath:'/caller-owned/kernel-events.jsonl',append,persist});
assert.equal(lines.length,2);assert.equal(report.kernelEvidence.count,2);
await checks.persistGenerationPhase({report,row:{...row,kernel:undefined},kernelLogPath:'/caller-owned/kernel-events.jsonl',append,persist});
assert.equal(report.livePhases.length,1);assert.equal(writes.length,1);
for(const wrong of [{...row,effectiveRoute:'fallback-route'},{...row,sessionId:'other-session'},
  {...row,kernel:{...row.kernel,dispatch:[-1,1,1]}},{...row,kernel:{...row.kernel,point:'invented-complete'}},
  {...row,kernel:undefined,noiseInput:{stage:'sparse',shape:[2],dtype:'f32',byteLength:4,sha256:'0'.repeat(64)}}]){
  const before=lines.length;await assert.rejects(checks.persistGenerationPhase({report,row:wrong,
    kernelLogPath:'/caller-owned/kernel-events.jsonl',append,persist}),/identified|session|kernel|noise/);assert.equal(lines.length,before);
}
const failed={};await assert.rejects(checks.persistGenerationPhase({report:failed,row,kernelLogPath:'/caller-owned/kernel-events.jsonl',
  async append(){throw Error('journal unavailable');},persist}),/journal unavailable/);
assert.equal(failed.lastKernel,undefined);assert.equal(failed.kernelEvidence,undefined);
const {readFile}=await import('node:fs/promises'),native=JSON.parse(await readFile(new URL('./fixtures/generation-phase-native.json',import.meta.url),'utf8')),
  observedState={},observed=[];
await checks.persistGenerationPhase({report:observedState,row:{phase:native.phase,effectiveRoute:native.effectiveRoute,
  sessionId:native.sessionId,kernel:native.kernel},kernelLogPath:'/owned/observed-kernel.jsonl',
  append:async(_path,line)=>observed.push(JSON.parse(line)),persist});
assert.deepEqual(observed[0].kernel.dispatch,[16384],'Actual kit one-dimensional dispatch must pass unchanged.');
// Zero is a traceable attempted dispatch, not accepted kit execution; the kit
// retains its own positive-integer admission after this before-kernel event.
for(const dispatch of [[2,3],[0],[1,1,1]])await checks.persistGenerationPhase({report:observedState,
  row:{phase:native.phase,effectiveRoute:native.effectiveRoute,sessionId:native.sessionId,kernel:{...native.kernel,dispatch}},
  kernelLogPath:'/owned/observed-kernel.jsonl',append:async()=>{},persist});
for(const dispatch of [[],[1,1,1,1]])await assert.rejects(checks.persistGenerationPhase({report:observedState,
  row:{phase:native.phase,effectiveRoute:native.effectiveRoute,sessionId:native.sessionId,kernel:{...native.kernel,dispatch}},
  kernelLogPath:'/owned/observed-kernel.jsonl',append:async()=>{},persist}),/complete native kernel/);
console.log('Each native kernel event is appended uncapped; route/session/dispatch/input conflicts reject, failed retention cannot publish a successful observation, and compact phase snapshots avoid quadratic journal rewrites.');
