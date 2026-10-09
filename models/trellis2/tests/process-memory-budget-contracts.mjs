import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startProcessMemory} from '../process-memory.mjs';
const out=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-memory-budget-'));
const row=bytes=>({runId:'budget',rootPid:42,status:'observed',processes:[{pid:42,processStartAbstime:123,
  physicalFootprintBytes:bytes,kernelLifetimePeakPhysicalFootprintBytes:bytes}],sampledAggregatePhysicalFootprintBytes:bytes});
try{
  let count=0,actions=[];
  const monitor=await startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'later.jsonl'),
    maxFootprintBytes:150,onUnsafe:async r=>actions.push(r),probe:async()=>row(count++?200:100)});
  await monitor.sample();const summary=await monitor.stop();
  assert.equal(actions.length,1,'a caller-selected footprint ceiling needs an actual one-shot stop action');
  assert.equal(summary.status,'budget-refused');assert.equal(summary.safety.reason,'process-footprint-budget');
  assert.equal(summary.safety.observedBytes,200);assert.equal(summary.safety.maxFootprintBytes,150);
  assert.equal(JSON.parse(await fs.readFile(summary.summaryPath)).safety.observedBytes,200);
  actions=[];
  await assert.rejects(startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'initial.jsonl'),
    maxFootprintBytes:50,onUnsafe:async r=>actions.push(r),probe:async()=>row(100)}),/memory budget/);
  assert.equal(actions.length,1,'startup refusal occurs before browser launch');
  actions=[];let probes=0;
  const unavailable=await startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'unavailable.jsonl'),
    maxFootprintBytes:150,onUnsafe:async r=>actions.push(r),probe:async()=>probes++?row(-1):row(100)});
  await unavailable.sample();await unavailable.stop();assert.equal(actions.length,1);
  assert.equal(actions[0].reason,'memory-observation-unavailable','bounded run cannot continue when its guard loses observation');
  const exited={pid:43,parentPid:42,errno:3,exitedBeforeMeasurement:true,
    exitEvidence:{route:'ps-pid-status',returnCode:0,status:'Z'}};
  const retired=await startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'exited.jsonl'),
    maxFootprintBytes:150,onUnsafe:async()=>{throw Error('confirmed exit must not stop a run');},
    probe:async()=>({...row(100),unavailableProcesses:[exited]})});
  assert.equal((await retired.stop()).status,'observed','OS-confirmed exited descendants do not make live coverage partial');
  for(const missing of [{...exited,exitEvidence:{...exited.exitEvidence,status:'S'}},
    {...exited,errno:13},{...exited,exitEvidence:undefined}]){
    const stopped=[];
    await assert.rejects(startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'live-missing.jsonl'),
      maxFootprintBytes:150,onUnsafe:async reason=>stopped.push(reason),
      probe:async()=>({...row(100),unavailableProcesses:[missing]})}),/partial process coverage/);
    assert.equal(stopped.length,1,'an exit label without observed OS exit evidence cannot waive missing coverage');
  }
  await assert.rejects(startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'no-action.jsonl'),
    maxFootprintBytes:150,probe:async()=>row(100)}),/onUnsafe/);
  actions=[];let ioProbes=0;
  const broken=await startProcessMemory({rootPid:42,runId:'budget',rawPath:path.join(out,'broken-report.jsonl'),summaryPath:out,
    maxFootprintBytes:150,onUnsafe:async r=>actions.push(r),probe:async()=>row(ioProbes++?200:100)});
  await broken.sample().catch(()=>{});await broken.stop().catch(()=>{});
  assert.equal(actions.length,1,'report persistence failure must not suppress the safety stop action');
  const source=await fs.readFile(new URL('../run-sparse-prefix-witness.mjs',import.meta.url),'utf8'),
    start=source.indexOf('async onUnsafe(safety){'),end=source.indexOf('\n      }});',start);
  assert.ok(start>=0&&end>start,'actual runner safety callback must be tested');
  const callback=new Function('report','persist','child','return ('+source.slice(start,end).replace('async onUnsafe(', 'async function onUnsafe(')+'\n});');
  let signals=0;const child={pid:42,exitCode:null,signalCode:null,kill(signal){assert.equal(signal,'SIGTERM');signals++;return true;}};
  const stop=callback({},async()=>{throw Error('intentional report-write failure');},child);
  await stop({reason:'process-footprint-budget'}).catch(()=>{});
  assert.equal(signals,1,'actual runner must signal its exact owned child despite report-write failure');
}finally{await fs.rm(out,{recursive:true,force:true});}
console.log('Explicit process ceiling stops once, durably records refusal and fails closed on missing observation; synthetic samples do not prove OS pressure or whole-machine capacity.');
