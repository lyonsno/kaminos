#!/usr/bin/env node
// Pipeline transport for the actual queued TRELLIS image-generation tool.
// A completed queue entry alone never substitutes for its fresh identified GLB.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateLocalGenerationConfig} from '../models/trellis2/generate-image.mjs';
import {persistGenerationAsset} from '../models/trellis2/sparse-generation-witness-checks.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runTrellisAdapter(values){
  if(!values.input||!values.output||!values.report)throw Error('explicit input, output and report required');
  const input=path.resolve(values.input),output=path.resolve(values.output),reportPath=path.resolve(values.report),
    runId=randomUUID(),work=path.join(path.dirname(reportPath),'trellis-queue',runId),
    configPath=values.config??process.env.KAMINOS_TRELLIS_CONFIG,
    state={schema:'kaminos.trellis-greenroom-adapter.v0',ok:false,phase:'configuration',runId,input,output,
      backend:{modelFamily:'TRELLIS 2',runtime:'browser-webgpu'},startedAt:new Date().toISOString()};
  await fs.mkdir(work,{recursive:true});
  const persist=()=>fs.writeFile(reportPath,JSON.stringify(state,null,2)+'\n');
  const progress=(phase,message,status='running')=>console.log(JSON.stringify({schema:'kaminos.pipeline-progress.v0',
    kind:'adapter-progress',phase,message,status,runId,jobId:state.job?.job_id}));
  await persist();
  try{
    if(!configPath)throw Error('TRELLIS setup required: set KAMINOS_TRELLIS_CONFIG to the local model configuration');
    // Express asks Greenroom for its quick lane; every submission declares its class so a
    // quick-eligible route never jumps the line unless asked.
    const serviceClass=values.serviceClass??process.env.KAMINOS_TRELLIS_SERVICE_CLASS??'normal';
    if(!['normal','quick'].includes(serviceClass))throw Error('Greenroom service class must be normal or quick');
    const configRaw=await fs.readFile(configPath),c=validateLocalGenerationConfig(JSON.parse(configRaw)),bytes=await fs.readFile(input);
    state.config={path:path.resolve(configPath),sha256:hash(configRaw),source:c.expectedCommit};
    state.inputSha256=hash(bytes);
    const childReport=path.join(work,'generation-report.json'),manifestPath=path.join(work,'command.json'),
      argv=[process.execPath,path.join(c.repoRoot,'models/trellis2/generate-image.mjs'),
        '--config',path.resolve(configPath),'--expected-config-sha256',state.config.sha256,
        '--input',input,'--expected-input-sha256',state.inputSha256,'--output',output,'--report',childReport,'--run-id',runId],
      command={schema:'gpu-greenroom.command.v2',service_class:serviceClass,agent_id:'kaminos-generate',repo_root:c.repoRoot,cwd:c.repoRoot,
        env:{PYTHONDONTWRITEBYTECODE:'1'},output_dir:work,route_identity:'TRELLIS2 queued browser-WebGPU / CPU source finishing',
        timeout:null,output_class:'final',argv};
    await fs.writeFile(manifestPath,JSON.stringify(command,null,2)+'\n');
    state.command={manifestPath,argv,queueDir:c.queueDir,greenroomBin:c.greenroomBin,childReport,serviceClass};
    state.phase='queue-submission';await persist();
    const proc=spawn(c.greenroomBin,['--queue-dir',c.queueDir,'submit-command','--manifest',manifestPath],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);
    const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
    if(code!==0)throw Error('Greenroom submission failed: '+stderr);
    const job=JSON.parse(stdout);
    if(job.schema!=='gpu-greenroom.command-submission.v1'||! /^[\w-]+$/.test(job.job_id??'')||
      await fs.realpath(job.effective_queue_dir??'')!==await fs.realpath(c.queueDir))
      throw Error('identified Greenroom submission on requested queue required');
    state.command.effectiveQueueDir=job.effective_queue_dir;
    state.job=job;state.phase='queued';await persist();progress('queued','Waiting for the GPU Greenroom');
    let terminal,offset=0,carry='',lastState;
    for(;;){
      let row,dir,bucket;
      for(const name of ['done','failed','cancelled','running','pending']){
        const candidate=path.join(job.effective_queue_dir,name,job.job_id);
        try{row=JSON.parse(await fs.readFile(path.join(candidate,'status.json')));dir=candidate;bucket=name;break;}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(row){
        if(row.job_id!==job.job_id)throw Error('queue status identity changed');
        if(bucket!==lastState){lastState=bucket;state.phase=bucket;await persist();
          if(bucket==='running')progress('running','Preparing and generating the selected image');}
        try{
          const file=await fs.open(path.join(dir,'stdout.log'));
          try{const size=(await file.stat()).size;
            if(size<offset)throw Error('queued job log changed underneath the run');
            if(size>offset){const data=Buffer.alloc(size-offset),read=await file.read(data,0,data.length,offset);offset+=read.bytesRead;
              const lines=(carry+data.subarray(0,read.bytesRead).toString()).split(/\r?\n/);carry=lines.pop()??'';
              for(const line of lines){let event;try{event=JSON.parse(line);}catch{continue;}
                if(event.schema==='kaminos.pipeline-progress.v0')console.log(JSON.stringify({...event,jobId:job.job_id}));}
            }
          }finally{await file.close();}
        }catch(error){if(error.code!=='ENOENT')throw error;}
        if(['done','failed','cancelled'].includes(bucket)){
          terminal=JSON.parse(await fs.readFile(path.join(dir,'receipt.json')));
          state.terminal={status:bucket,receiptPath:path.join(dir,'receipt.json'),receipt:terminal};break;
        }
      }
      await wait(1000);
    }
    if(terminal.job_id!==job.job_id||terminal.exit_code!==0||state.terminal.status!=='done')
      throw Error('queued TRELLIS generation '+state.terminal.status+': '+(terminal.error_message??terminal.failure_phase??terminal.exit_code));
    if(terminal.status!=='done'||terminal.effective_cwd!==command.cwd||terminal.output_dir!==command.output_dir||
      terminal.effective_timeout!==null||JSON.stringify(terminal.effective_argv)!==JSON.stringify(argv))
      throw Error('Greenroom executed a different command, directory or timeout; requested generation was not exercised');
    state.phase='completed-output-admission';await persist();
    const child=JSON.parse(await fs.readFile(childReport)),data=await fs.readFile(output);
    if(!child.ok||child.status!=='succeeded'||child.mode!=='image-generation'||child.runId!==runId||
      child.source?.commit!==c.expectedCommit||child.config?.sha256!==state.config.sha256||
      child.input?.sha256!==state.inputSha256||child.native?.commit!==c.expectedCommit||
      child.native?.backend?.isFallbackAdapter!==false||child.native?.backend?.vendor?.toLowerCase()!=='apple'||
      child.artifact?.path!==output||
      child.artifact?.sha256!==hash(data)||child.artifact.byteLength!==data.length||data.length<12||
      data.readUInt32LE(0)!==0x46546c67||data.readUInt32LE(8)!==data.length)
      throw Error('complete fresh selected-image TRELLIS GLB required; stale, fallback or partial output rejected');
    // Read-only admission of the bytes already written by the identified job.
    // This reuses the producer's finite embedded-PBR contract; it is not a
    // second write, native tensor handoff, or consumer-rendering claim.
    const admission={nativeSessionId:child.native.sessionId,fixtureSha256:child.native.inputManifestSha256};
    await persistGenerationAsset({report:admission,bytes:data,outputPath:output,write:async()=>{},persist:async()=>{}});
    state.artifact=child.artifact;state.native=child.native;state.memory=child.memory;state.finishing=child.finishing;
    state.ok=true;state.phase='complete';progress('complete','Textured mesh generated','complete');
  }catch(error){state.error={message:error.message,stack:error.stack};}
  finally{state.finishedAt=new Date().toISOString();await persist();}
  return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:Object.fromEntries(['input','output','report','config','service-class'].map(k=>[k,{type:'string'}]))});
  const result=await runTrellisAdapter({...values,serviceClass:values['service-class']});console.log(JSON.stringify({ok:result.ok,phase:result.phase,error:result.error,artifact:result.artifact}));
  process.exitCode=result.ok?0:1;
}
