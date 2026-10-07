import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
export async function startProcessMemory({python,script,rootPid=process.pid,rawPath,runId=randomUUID(),periodMs=1000,probe}={}){
  if(!rawPath||!Number.isSafeInteger(rootPid)||rootPid<1||!Number.isFinite(periodMs)||periodMs<=0)
    throw Error('explicit memory output/owner and positive sample interval required');
  const collect=probe??(async()=>{
    const {stdout}=await execute(python,[script,'--root-pid',String(rootPid),'--run-id',runId]);return JSON.parse(stdout);
  });
  const summary={schema:'trellis2.process-memory.v0',status:'running',runId,rootPid,periodMs,sampleCount:0,
    sampledPeakAggregatePhysicalFootprintBytes:null,processes:{},rawPath,
    meaning:'sampled simultaneous owned-process footprint including observer; per-process kernel peaks are not summed; not machine-capacity certification'};
  await fs.writeFile(rawPath,'');let pending,stopped=false,timer,failed;
  const sample=async()=>{
    const row=await collect();
    if(row.runId!==runId||row.rootPid!==rootPid||row.status!=='observed'||!Array.isArray(row.processes)||
      !row.processes.some(p=>p.pid===rootPid)||!Number.isSafeInteger(row.sampledAggregatePhysicalFootprintBytes)||row.sampledAggregatePhysicalFootprintBytes<1)
      throw Error('observed current-owner process-memory sample required; stale/missing output is not zero memory');
    if(row.processes.reduce((total,p)=>total+p.physicalFootprintBytes,0)!==row.sampledAggregatePhysicalFootprintBytes)
      throw Error('process-memory aggregate disagrees with observed process rows');
    await fs.appendFile(rawPath,JSON.stringify(row)+'\n');summary.sampleCount++;
    summary.sampledPeakAggregatePhysicalFootprintBytes=Math.max(summary.sampledPeakAggregatePhysicalFootprintBytes??0,row.sampledAggregatePhysicalFootprintBytes);
    for(const p of row.processes){
      if(!Number.isSafeInteger(p.physicalFootprintBytes)||p.physicalFootprintBytes<0||
        !Number.isSafeInteger(p.kernelLifetimePeakPhysicalFootprintBytes)||p.kernelLifetimePeakPhysicalFootprintBytes<p.physicalFootprintBytes||!p.processStartAbstime)
        throw Error('actual process footprint/start identity required');
      const key=p.pid+':'+p.processStartAbstime,old=summary.processes[key];
      summary.processes[key]={...p,observedPeakPhysicalFootprintBytes:Math.max(old?.observedPeakPhysicalFootprintBytes??0,p.physicalFootprintBytes),
        kernelLifetimePeakPhysicalFootprintBytes:Math.max(old?.kernelLifetimePeakPhysicalFootprintBytes??0,p.kernelLifetimePeakPhysicalFootprintBytes)};
    }
  };
  const request=()=>{
    if(stopped||pending)return pending;
    pending=sample().catch(e=>{failed=e;summary.status='failed';summary.error=e.message;clearInterval(timer);}).finally(()=>pending=null);
    return pending;
  };
  await request();if(failed)throw failed;
  timer=setInterval(request,periodMs);
  return{sample:request,async stop(){if(stopped)return summary;await request();stopped=true;clearInterval(timer);if(pending)await pending;
    summary.status=failed?'failed':'observed';return summary;}};
}
