// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('an unadmitted fit produces a terminal failure before any GPU or primary artifact',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'causeway-no-admission-'));try{
  const env={...process.env};delete env.GREENROOM_JOB_ID;
  const child=spawnSync(process.execPath,['tools/causeway-fit.mjs','missing-config.json',out],{env,encoding:'utf8'});assert.equal(child.status,1);
  const r=JSON.parse(await readFile(path.join(out,'continuation.json'),'utf8'));assert.equal(r.status,'failed');assert.equal(r.phase,'admission');assert.match(r.error,/admission required/);
  await assert.rejects(()=>readFile(path.join(out,'report.json')),/ENOENT/);
 }finally{await rm(out,{recursive:true,force:true});}
});
