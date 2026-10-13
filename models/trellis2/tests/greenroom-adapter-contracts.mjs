import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {runTrellisAdapter} from '../../../scripts/run-trellis-greenroom-adapter.mjs';
import {encodeTrellisPbrGLB,bakeTrellisMaterialTextures} from '../trellis-material.js';
import {GENERATION_ROUTE} from '../sparse-generation-witness-checks.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
// A deterministic transport stand-in, not proof of Greenroom or GPU execution.
// Receipt field names are those observed in M2 job 443fe08cb0b4, worker ff8c4b06.
const fakeQueue=String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const queue=process.argv[process.argv.indexOf('--queue-dir')+1],
  manifest=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--manifest')+1])),
  args=manifest.argv,get=k=>args[args.indexOf(k)+1],config=JSON.parse(fs.readFileSync(get('--config'))),
  mode=config.testMode,job='identified-job',dir=path.join(queue,mode==='failed'?'failed':'done',job);
// Replay the external rejection actually observed on worker ff8c4b06.
if(manifest.output_class==='artifact'){
 console.error(JSON.stringify({schema:'gpu-greenroom.command-submission-failure.v1',status:'failed',
  failure_phase:'submission-validation',error_message:'invalid command output_class'}));process.exit(1);
}
fs.mkdirSync(dir,{recursive:true});
const data=fs.readFileSync(config.testGlb);
fs.writeFileSync(get('--output'),mode==='partial'?data.subarray(0,data.length-4):data);
const report={ok:true,status:'succeeded',mode:'image-generation',runId:get('--run-id'),
 source:{commit:config.expectedCommit},config:{sha256:get('--expected-config-sha256')},
 input:{sha256:get('--expected-input-sha256')},native:{commit:config.expectedCommit,
   sessionId:'unit-session',inputManifestSha256:'a'.repeat(64),backend:{vendor:'apple',isFallbackAdapter:false}},
 artifact:{path:get('--output'),sha256:hash(data),byteLength:data.length}};
if(mode==='stale-input')report.input.sha256='b'.repeat(64);
if(mode==='stale-source')report.source.commit='c'.repeat(40);
if(mode==='retained')report.mode='retained-finishing';
if(mode==='fallback')report.native.backend.isFallbackAdapter=true;
if(mode==='missing-session')delete report.native.sessionId;
if(mode!=='missing-report')fs.writeFileSync(get('--report'),JSON.stringify(report));
fs.writeFileSync(path.join(dir,'stdout.log'),JSON.stringify({schema:'kaminos.pipeline-progress.v0',phase:'mesh-finishing'})+'\n');
fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({job_id:job,status:mode==='failed'?'failed':'done'}));
const receipt={job_id:job,status:mode==='failed'?'failed':'done',exit_code:mode==='failed'?1:0,
 effective_argv:manifest.argv,effective_cwd:manifest.cwd,output_dir:manifest.output_dir,effective_timeout:null};
if(mode==='wrong-dispatch')receipt.effective_argv=['/wrong/model'];
if(mode==='hidden-timeout')receipt.effective_timeout=360;
fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt));
console.log(JSON.stringify({schema:'gpu-greenroom.command-submission.v1',job_id:job,
 effective_queue_dir:mode==='wrong-queue'?path.dirname(queue):queue}));
`;
async function setup(mode){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-adapter-contract-'));
  const mesh={vertices:new Float32Array([0,0,0,0,.25,0,.25,0,0]),triangles:new Uint32Array([0,1,2]),
    uvs:new Float32Array([0,0,1,0,0,1])};
  const textures=bakeTrellisMaterialTextures({...mesh,coordinates:new Int32Array([0,0,0]),
    features:new Float32Array(6),resolution:2,textureSize:4});
  const glb=new Uint8Array(await encodeTrellisPbrGLB(mesh,{textures,
    provenance:{sessionId:'unit-session',inputManifestSha256:'a'.repeat(64),route:GENERATION_ROUTE}}));
  const config={schema:'trellis2.local-generation-config.v0',repoRoot:root,checkpointBase:root,
    python:process.execPath,memoryPython:process.execPath,sourceRoot:root,chrome:process.execPath,
    greenroomBin:path.join(root,'fake-queue.cjs'),queueDir:path.join(root,'queue'),
    expectedCommit:'a'.repeat(40),expectedSourceCommit:'b'.repeat(40),pipelineType:'512',decoderActivationStorage:'f16',
    steps:8,seed:42,targetFaces:200000,gpuBufferBudgetMiB:6144,processMemoryBudgetMiB:10240,
    testMode:mode,testGlb:path.join(root,'source.glb')};
  await fs.mkdir(config.queueDir);await fs.writeFile(config.testGlb,glb);
  await fs.writeFile(config.greenroomBin,fakeQueue.replace('#!/usr/bin/env node','#!'+process.execPath),{mode:0o755});
  const values={config:path.join(root,'config.json'),input:path.join(root,'input.png'),
    output:path.join(root,'output.glb'),report:path.join(root,'report.json')};
  await fs.writeFile(values.config,JSON.stringify(config));await fs.writeFile(values.input,'unit-input-bytes');
  return {root,values};
}
test('transport admits only a fresh identified complete embedded mesh',async()=>{
  const {values}=await setup('success');const result=await runTrellisAdapter(values);
  assert.equal(result.ok,true,result.error?.message);assert.equal(result.phase,'complete');
  assert.equal(result.artifact.sha256,hash(await fs.readFile(values.output)));
});
for(const mode of ['wrong-queue','failed','missing-report','stale-input','stale-source','retained','fallback',
  'partial','missing-session','wrong-dispatch','hidden-timeout']){
  test(mode+' cannot be reported as a completed mesh',async()=>{
    const {values}=await setup(mode);const result=await runTrellisAdapter(values);
    assert.equal(result.ok,false,mode+' was admitted as progress');
    assert.ok(result.error?.message);assert.equal(result.artifact,undefined);
    assert.equal(JSON.parse(await fs.readFile(values.report)).ok,false,'failure must survive in the caller report');
  });
}

test('the queued command always declares its Greenroom class: normal unless Express asks for quick',async()=>{
  for(const [requested,expected] of [[undefined,'normal'],['quick','quick'],['normal','normal']]){
    const {values}=await setup('ok');
    const state=await runTrellisAdapter({...values,...(requested?{serviceClass:requested}:{})});
    assert.equal(state.ok,true,state.error?.message);
    const manifest=JSON.parse(await fs.readFile(state.command.manifestPath));
    assert.equal(manifest.schema,'gpu-greenroom.command.v2');assert.equal(manifest.service_class,expected);
    assert.equal(state.command.serviceClass,expected);
  }
  const {values}=await setup('ok');
  const state=await runTrellisAdapter({...values,serviceClass:'vip'});
  assert.equal(state.ok,false);assert.match(state.error.message,/service class/);
});
