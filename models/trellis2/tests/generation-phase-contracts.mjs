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
console.log('Each native kernel event is appended uncapped; route/session/dispatch/input conflicts reject, failed retention cannot publish a successful observation, and compact phase snapshots avoid quadratic journal rewrites.');
