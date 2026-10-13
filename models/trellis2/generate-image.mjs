#!/usr/bin/env node
// One queued, caller-owned image -> WebGPU fields -> CPU finishing operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {startProcessMemory} from './process-memory.mjs';
import {fluidBrowserLaunch} from '../../finger-fluid-browser-launch.mjs';
import {gitSourceIdentity} from './source-attestation.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateLocalGenerationConfig(c){
  if(c?.schema!=='trellis2.local-generation-config.v0')throw Error('identified TRELLIS local generation config required');
  for(const key of ['repoRoot','checkpointBase','python','memoryPython','sourceRoot','chrome','greenroomBin','queueDir'])
    if(typeof c[key]!=='string'||!path.isAbsolute(c[key]))throw Error('explicit absolute '+key+' required');
  for(const key of ['expectedCommit','expectedSourceCommit'])
    if(!/^[a-f0-9]{40}$/.test(c[key]??''))throw Error('exact '+key+' required');
  if(!['512','1024_cascade'].includes(c.pipelineType)||!['f32','f16'].includes(c.decoderActivationStorage))
    throw Error('explicit supported pipeline and decoder storage required');
  for(const key of ['steps','targetFaces','gpuBufferBudgetMiB','processMemoryBudgetMiB'])
    if(!Number.isSafeInteger(c[key])||c[key]<1)throw Error('positive explicit '+key+' required');
  for(const key of ['gpuBufferBudgetMiB','processMemoryBudgetMiB'])
    if(!Number.isSafeInteger(c[key]*1048576))throw Error('representable '+key+' required');
  if(!Number.isInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('unsigned32 source seed required');
  if(c.textureSize!==undefined&&c.textureSize!==1024)throw Error('this finishing route supports 1024 textures; requested size cannot be ignored');
  if(c.preparedPackageRoot!==undefined&&(typeof c.preparedPackageRoot!=='string'||!path.isAbsolute(c.preparedPackageRoot)))
    throw Error('explicit absolute preparedPackageRoot required');
  return c;
}

// The observer's safety callback uses this same runner. Signal before report
// I/O, latch refusal, and recheck after the pre-spawn await as in the exercised
// prototype. Each detached group consists solely of our exact owned child.
export function createGenerationCommandRunner({cwd,record,persist,spawnCommand=spawn,stopGroup=pid=>process.kill(-pid,'SIGTERM')}={}){
  let active;
  return {
    async stop(reason){
      record.safety=reason;
      if(active?.pid){record.stopAction={pid:active.pid,signal:'SIGTERM'};stopGroup(active.pid);}
      await persist();
    },
    async run(argv,label){
      if(record.safety)throw Error('generation halted by memory guard');
      const command={argv,label,startedAt:new Date().toISOString()};record.commands.push(command);await persist();
      if(record.safety)throw Error('generation halted by memory guard before spawn');
      active=spawnCommand(argv[0],argv.slice(1),{cwd,detached:true,stdio:'inherit',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
      const child=active;command.pid=child.pid;
      try{command.exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}
      finally{active=null;command.finishedAt=new Date().toISOString();await persist();}
      if(record.safety)throw Error('generation halted by memory guard');
      if(command.exit.code!==0)throw Error(label+' exited '+command.exit.code+' '+(command.exit.signal??''));
    },
  };
}

export async function generateImage(values){
  if(!values.report||!values.output)throw Error('explicit output and report required');
  const output=path.resolve(values.output),reportPath=path.resolve(values.report),out=path.dirname(reportPath),
    runId=values['run-id']??randomUUID(),work=path.join(out,'trellis-runs',runId);
  if(!/^[\w-]+$/.test(runId))throw Error('safe explicit run identity required');
  await fs.mkdir(work,{recursive:true});
  const report={schema:'kaminos.trellis-generation.v0',ok:false,status:'running',phase:'configuration',runId,
    output,work,commands:[],startedAt:new Date().toISOString(),mode:values['native-root']?'retained-finishing':'image-generation',
    backend:{modelFamily:'TRELLIS 2',runtime:values['native-root']?'cpu-retained-finishing':'browser-webgpu'}};
  const persist=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  const phase=async (name,message)=>{report.phase=name;await persist();
    console.log(JSON.stringify({schema:'kaminos.pipeline-progress.v0',kind:'adapter-progress',phase:name,message,status:'running',runId}));};
  let monitor;
  await persist();
  try{
    const configRaw=await fs.readFile(values.config),c=validateLocalGenerationConfig(JSON.parse(configRaw));
    if(values['expected-config-sha256']&&sha(configRaw)!==values['expected-config-sha256'])throw Error('generation config changed while queued');
    const ownRoot=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
    if(c.repoRoot!==ownRoot)throw Error('effective generation repo root differs from config');
    const sourceIdentity=gitSourceIdentity(ownRoot),{commit,dirty}=sourceIdentity;
    if(commit!==c.expectedCommit||dirty)throw Error('exact clean generation source required');
    report.source={repoRoot:ownRoot,...sourceIdentity};report.config={...c,sha256:sha(configRaw)};
    if(!values['native-root'])report.browser=fluidBrowserLaunch({executable:c.chrome,debugPort:0,
      userDataDir:path.join(work,'browser-admission'),width:1,height:1});
    const runner=createGenerationCommandRunner({cwd:ownRoot,record:report,persist});
    await phase('memory-admission','Checking configured process headroom');
    monitor=await startProcessMemory({python:c.memoryPython,script:path.join(ownRoot,'models/trellis2/process-memory.py'),
      rawPath:path.join(work,'process-memory.jsonl'),maxFootprintBytes:c.processMemoryBudgetMiB*1048576,onUnsafe:reason=>runner.stop(reason)});
    const native=values['native-root']?path.resolve(values['native-root']):path.join(work,'native');
    const nativeCommit=values['native-root']?values['native-commit']:c.expectedCommit;
    if(values['native-root']&&!/^[a-f0-9]{40}$/.test(nativeCommit??''))throw Error('exact retained native revision required');
    if(!values['native-root']){
      if(!values.input)throw Error('selected input image required');
      const input=path.resolve(values.input),bytes=await fs.readFile(input),inputSha=sha(bytes);
      if(values['expected-input-sha256']&&inputSha!==values['expected-input-sha256'])throw Error('selected input changed while queued');
      report.input={path:input,sha256:inputSha,byteLength:bytes.length};
      // Hard-link the unchanged weight files on their own filesystem. The
      // image package is a named input artifact, not a second weight download.
      const prepared=path.join(c.preparedPackageRoot??path.join(path.dirname(c.checkpointBase),'trellis-image-packages'),runId);
      report.preparedPackageRoot=prepared;
      await phase('image-preparation','Removing background and preparing the selected image');
      await runner.run([c.python,'-B',path.join(ownRoot,'models/trellis2/pack-prepared-generation.py'),
        '--repo-root',ownRoot,'--expected-commit',c.expectedCommit,'--base',c.checkpointBase,
        '--image',input,'--expected-image-sha256',inputSha,'--preprocess-source-root',c.sourceRoot,
        '--expected-preprocess-source-commit',c.expectedSourceCommit,'--out',prepared,'--pipeline-type',c.pipelineType,
        '--steps',String(c.steps),'--seed',String(c.seed)],'image preparation');
      await phase('webgpu-generation','Generating shape and materials with WebGPU');
      await runner.run([process.execPath,path.join(ownRoot,'models/trellis2/run-sparse-prefix-witness.mjs'),
        '--repo-root',ownRoot,'--expected-commit',c.expectedCommit,'--fixture',prepared,'--chrome',c.chrome,
        '--report',path.join(native,'report.json'),'--receiver','kaminos-generate','--witness','generation','--fields-only',
        '--memory-python',c.memoryPython,'--gpu-buffer-budget-mib',String(c.gpuBufferBudgetMiB),
        '--process-memory-budget-mib',String(c.processMemoryBudgetMiB),'--decoder-activation-storage',c.decoderActivationStorage],
        'WebGPU generation');
    }
    await phase('mesh-finishing','Cleaning the mesh, unwrapping UVs and baking textures');
    const finished=path.join(work,'finished'),glb=path.join(finished,'asset.glb');
    await runner.run([process.execPath,path.join(ownRoot,'models/trellis2/finalize-retained-generation.mjs'),
      '--repo-root',ownRoot,'--expected-commit',c.expectedCommit,'--input-root',native,'--expected-native-commit',nativeCommit,
      '--python',c.python,'--source-root',c.sourceRoot,'--expected-source-commit',c.expectedSourceCommit,
      '--target-faces',String(c.targetFaces),'--uv-backend','source-xatlas','--receiver','kaminos-generate','--output',glb],
      'mesh finishing');
    const f=JSON.parse(await fs.readFile(path.join(finished,'report.json'))),data=await fs.readFile(glb);
    if(f.status!=='succeeded'||f.assetArtifact?.sha256!==sha(data)||f.assetArtifact.byteLength!==data.length)
      throw Error('complete identified finished GLB required');
    report.memory=await monitor.stop();monitor=undefined;
    if(report.memory.status!=='observed')throw Error('complete process-memory observation required before publication');
    if(report.safety)throw Error('generation halted before publication');
    await fs.mkdir(path.dirname(output),{recursive:true});
    const pending=output+'.pending-'+runId;await fs.writeFile(pending,data);await fs.rename(pending,output);
    report.artifact={path:output,sha256:sha(data),byteLength:data.length,role:'textured-mesh'};
    report.native={root:native,commit:nativeCommit,reportPath:path.join(native,'report.json'),sessionId:f.nativeSessionId,
      inputManifestSha256:f.fixtureSha256,backend:f.native?.backend,reportSha256:f.native?.reportSha256};
    report.finishing={reportPath:path.join(finished,'report.json'),uv:f.uv,route:'CPU source cleanup / source-xatlas / learned PBR'};
    report.ok=true;report.status='succeeded';report.phase=null;
  }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};}
  finally{
    if(monitor)try{report.memory=await monitor.stop();if(report.memory.status!=='observed'||report.safety){report.ok=false;report.status='failed';}}
    catch(error){report.ok=false;report.status='failed';report.memoryError=error.message;}
    report.finishedAt=new Date().toISOString();await persist();
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:Object.fromEntries(['input','output','report','config','run-id',
    'expected-config-sha256','expected-input-sha256','native-root','native-commit'].map(k=>[k,{type:'string'}]))});
  const result=await generateImage(values);console.log(JSON.stringify({ok:result.ok,phase:result.phase,error:result.error,artifact:result.artifact}));
  process.exitCode=result.ok?0:1;
}
