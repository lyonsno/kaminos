// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('an unadmitted fit produces a terminal failure before any GPU or primary artifact',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'causeway-no-admission-'));try{
  const env={...process.env};delete env.GREENROOM_JOB_ID;
  const child=spawnSync(process.execPath,['tools/causeway-fit.mjs','missing-config.json',out],{env,encoding:'utf8'});assert.equal(child.status,1);
  const r=JSON.parse(await readFile(path.join(out,'continuation.json'),'utf8'));assert.equal(r.status,'failed');assert.equal(r.phase,'admission');assert.match(r.error,/admission required/);
  await assert.rejects(()=>readFile(path.join(out,'report.json')),/ENOENT/);
 }finally{await rm(out,{recursive:true,force:true});}
});

test('an unavailable output volume leaves its failure report on the control volume',async()=>{
 const control=await mkdtemp(path.join(tmpdir(),'causeway-volume-'));const output=path.join(control,'material');try{
  const config=path.join(control,'config.json');await writeFile(config,JSON.stringify({outputVolume:control}));
  const child=spawnSync(process.execPath,['tools/causeway-fit.mjs',config,output,control],{env:{...process.env,GREENROOM_JOB_ID:'negative-volume-fixture'},encoding:'utf8'});assert.equal(child.status,1);
  const r=JSON.parse(await readFile(path.join(control,'continuation.json'),'utf8'));assert.equal(r.status,'failed');assert.equal(r.phase,'output-volume');assert.match(r.error,/not mounted/);await assert.rejects(()=>readFile(path.join(output,'report.json')),/ENOENT/);
 }finally{await rm(control,{recursive:true,force:true});}
});
