import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const sourceRef=process.argv[2];
const {startProcessMemory}=sourceRef
  ? await import('data:text/javascript;base64,'+Buffer.from(execFileSync('git',['show',sourceRef+':models/trellis2/process-memory.mjs'])).toString('base64'))
  : await import('../process-memory.mjs');
const out=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-kernel-exit-'));
const row={runId:'kernel-exit',rootPid:42,status:'observed',processes:[{pid:42,processStartAbstime:123,
  physicalFootprintBytes:100,kernelLifetimePeakPhysicalFootprintBytes:100}],sampledAggregatePhysicalFootprintBytes:100};
const missing={pid:43,parentPid:42,errno:1,expectedProbeExit:false,exitedBeforeMeasurement:true,
  exitEvidence:{route:'libproc-pid-status',pid:43,observedPid:43,expectedBytes:64,bytesReturned:64,errno:0,statusCode:5}};
let serial=0;
const start=(entry,onUnsafe)=>startProcessMemory({rootPid:42,runId:'kernel-exit',rawPath:path.join(out,String(serial++)+'.jsonl'),
  maxFootprintBytes:150,onUnsafe,probe:async()=>({...row,unavailableProcesses:[entry]})});
const accepted=await start(missing,()=>assert.fail('exact kernel zombie evidence must not stop the run'));
assert.equal((await accepted.stop()).status,'observed');
const absent=await start({...missing,exitEvidence:{...missing.exitEvidence,bytesReturned:0,observedPid:null,statusCode:null,errno:3}},
  ()=>assert.fail('kernel ESRCH evidence must not stop the run'));
assert.equal((await absent.stop()).status,'observed');
for(const entry of [
  {...missing,exitEvidence:{...missing.exitEvidence,statusCode:2}},
  {...missing,exitEvidence:{...missing.exitEvidence,observedPid:99}},
  {...missing,exitEvidence:{...missing.exitEvidence,bytesReturned:63}},
  {...missing,exitEvidence:{...missing.exitEvidence,bytesReturned:0,errno:1}},
  {...missing,pid:42}, {...missing,exitedBeforeMeasurement:false}
]){
  const actions=[];
  await assert.rejects(start(entry,reason=>actions.push(reason)),/partial process coverage/);
  assert.equal(actions.length,1);
}
console.log('Kernel retirement admits exact zombie/ESRCH; live, partial, wrong PID and root evidence fail closed. Artifacts: '+out);
