// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync}from'node:child_process';
const tool=new URL('../tools/corrosion-source-build.mjs',import.meta.url).pathname;
test('build refusal retains a terminal report before source generation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corrosion-build-'));const config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({sourceRevision:'0'.repeat(40),model:{resolution:8},times:[0,1]}));
 for(const [name,job,phase]of [['no-admission',undefined,'admission'],['wrong-source','synthetic-refusal-only','source-preflight']]){
  const env={...process.env};if(job)env.GREENROOM_JOB_ID=job;else delete env.GREENROOM_JOB_ID;
  const out=path.join(dir,name),r=spawnSync(process.execPath,[tool,config,out],{env,encoding:'utf8'});assert.notEqual(r.status,0);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,phase);assert.equal(fs.existsSync(path.join(out,'catalog.json')),false);
 }
});
