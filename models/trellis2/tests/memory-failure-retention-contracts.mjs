import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startProcessMemory} from '../process-memory.mjs';
const out=await fs.mkdtemp(path.join(os.tmpdir(),'memory-failure-retention-'));
try{
  const raw=path.join(out,'actual-unavailable.jsonl');let caught;
  try{await startProcessMemory({python:process.argv[2],script:new URL('../process-memory.py',import.meta.url).pathname,
      rootPid:2147483647,runId:'actual-missing-root',rawPath:raw});}catch(e){caught=e;}
  assert.ok(caught,'actual probe nonzero exit must reject measurement');
  const text=await fs.readFile(raw,'utf8');assert.ok(text.trim(),'actual structured unavailable response must survive before sample admission');
  const failure=JSON.parse(text.trim().split('\n').at(-1));
  assert.equal(failure.status,'unavailable');assert.equal(failure.runId,'actual-missing-root');
  assert.equal(failure.transport.exitStatus,1);assert.match(failure.error,/absent/);
  assert.equal(caught.memorySummary.status,'failed');assert.equal(caught.memorySummary.sampleCount,0);
  assert.equal(caught.memorySummary.sampledPeakAggregatePhysicalFootprintBytes,null);
  const durable=JSON.parse(await fs.readFile(raw+'.summary.json','utf8'));assert.equal(durable.status,'failed');assert.equal(durable.runId,'actual-missing-root');
  let count=0;const laterRaw=path.join(out,'later.jsonl'),row={runId:'later',rootPid:42,status:'observed',processes:[
    {pid:42,processStartAbstime:2,physicalFootprintBytes:100,kernelLifetimePeakPhysicalFootprintBytes:200}],sampledAggregatePhysicalFootprintBytes:100};
  const monitor=await startProcessMemory({rootPid:42,runId:'later',rawPath:laterRaw,probe:async()=>{
    if(count++)throw Object.assign(Error('probe exit1'),{code:1,stdout:JSON.stringify({...row,status:'unavailable',error:'observed libproc refusal'}),stderr:'probe-stderr'});
    return row;}});
  const result=await monitor.stop();assert.equal(result.status,'failed');assert.equal(result.sampleCount,1);
  assert.equal(result.sampledPeakAggregatePhysicalFootprintBytes,100);
  const events=(await fs.readFile(laterRaw,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).error,'observed libproc refusal');assert.equal(events.at(-1).transport.stderr,'probe-stderr');
  for(const [name,probe]of [
    ['malformed-json',async()=>({stdout:'not JSON',stderr:'bad report',exitStatus:0})],
    ['malformed-row',async()=>({...row,processes:[{...row.processes[0],kernelLifetimePeakPhysicalFootprintBytes:-1}]})],
    ['missing-report',async()=>null],
    ['nonzero-observed',async()=>({stdout:JSON.stringify(row),stderr:'nonzero',exitStatus:1})],
  ]){
    const file=path.join(out,name+'.jsonl');let failure;
    try{await startProcessMemory({rootPid:42,runId:'later',rawPath:file,probe});}catch(e){failure=e;}
    assert.ok(failure);assert.equal(failure.memorySummary.sampleCount,0);
    assert.equal(failure.memorySummary.sampledPeakAggregatePhysicalFootprintBytes,null);
    assert.equal(JSON.parse(await fs.readFile(file+'.summary.json','utf8')).status,'failed');
    assert.ok((await fs.readFile(file,'utf8')).trim());
  }
}finally{await fs.rm(out,{recursive:true,force:true});}
console.log('Actual unavailable probe stdout/status and later failures are durable; only admitted samples enter peak arithmetic.');
