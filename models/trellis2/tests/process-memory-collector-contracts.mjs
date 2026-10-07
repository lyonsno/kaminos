import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startProcessMemory} from '../process-memory.mjs';
const out=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-memory-collector-'));
const row=(runId='one')=>({runId,rootPid:42,status:'observed',processes:[{pid:42,processStartAbstime:123,
  physicalFootprintBytes:100,residentBytes:200,kernelLifetimePeakPhysicalFootprintBytes:120}],sampledAggregatePhysicalFootprintBytes:100});
try{
  const monitor=await startProcessMemory({rootPid:42,runId:'one',rawPath:path.join(out,'one.jsonl'),periodMs:1000,probe:async()=>row()});
  await monitor.sample();const s=await monitor.stop();assert.equal(s.status,'observed');assert.ok(s.sampleCount>=2);
  assert.equal(s.sampledPeakAggregatePhysicalFootprintBytes,100);assert.equal(s.processes['42:123'].kernelLifetimePeakPhysicalFootprintBytes,120);
  assert.equal((await fs.readFile(s.rawPath,'utf8')).trim().split('\n').length,s.sampleCount);
  await assert.rejects(startProcessMemory({rootPid:42,runId:'one',rawPath:path.join(out,'stale.jsonl'),probe:async()=>row('old')}),/current-owner/);
  await assert.rejects(startProcessMemory({rootPid:42,runId:'one',rawPath:path.join(out,'missing.jsonl'),probe:async()=>({...row(),status:'unavailable'})}),/current-owner/);
  let count=0;const failed=await startProcessMemory({rootPid:42,runId:'one',rawPath:path.join(out,'failed.jsonl'),probe:async()=>{
    if(count++)throw Error('observed sampler failure');return row();}});
  const failure=await failed.stop();assert.equal(failure.status,'failed');assert.match(failure.error,/sampler failure/);
}finally{await fs.rm(out,{recursive:true,force:true});}
console.log('Uncapped raw samples and distinct process/lifetime peaks preserve identity; stale, missing and failed sampling cannot masquerade as measured zero.');
