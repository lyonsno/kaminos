// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('rejected resume preserves canonical report and a failed attempt',async()=>{
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'appearance-failure-'));
try{
 const fit=path.join(temporary,'fit');await fs.mkdir(fit);const original=JSON.stringify({status:'passed',completedSteps:128,latestResume:'retained/resume.json',checkpoints:[{step:128}],rawBatches:[{id:1}]});await fs.writeFile(path.join(fit,'report.json'),original);
 const resume=spawnSync('python3',['tools/neural-appearance-fresh-fit.py','absent-config.json',fit,'--until','256','--resume','absent-resume.json'],{encoding:'utf8',env:{...process.env,GREENROOM_JOB_ID:''}});assert.notEqual(resume.status,0);assert.match(resume.stderr,/Greenroom admission required/);assert.equal(await fs.readFile(path.join(fit,'report.json'),'utf8'),original,'Rejected resume must preserve prior execution report bytes');
 const attempts=await fs.readdir(path.join(fit,'attempts'));assert(attempts.length>0);const failure=JSON.parse(await fs.readFile(path.join(fit,'attempts',attempts[0]),'utf8'));assert.equal(failure.status,'failed');assert.equal(failure.phase,'admission');assert.match(failure.error,/Greenroom admission required/);
}finally{await fs.rm(temporary,{recursive:true,force:true});}});
test('missing helper retains actual bootstrap-failure report',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'appearance-bootstrap-'));try{
 const bootstrap=path.join(temporary,'bootstrap'),missing=path.join(temporary,'missing-herder');const witness=spawnSync(process.execPath,['tools/neural-appearance-directions-check.mjs',path.join(temporary,'missing-teacher'),bootstrap],{encoding:'utf8',env:{...process.env,SHADER_HERDER_ROOT:missing}});assert.notEqual(witness.status,0);const report=JSON.parse(await fs.readFile(path.join(bootstrap,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'bootstrap');assert.equal(report.requestedShaderHerderRoot,missing);assert.match(report.error,/ERR_MODULE_NOT_FOUND|Cannot find module/);
}finally{await fs.rm(temporary,{recursive:true,force:true});}});
