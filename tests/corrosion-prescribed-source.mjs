// kaminos-test: node
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';import{createHash}from'node:crypto';
const run=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
test('prescribed source refuses stale catalog, partial producer and wrong state bytes before formation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'coating-prescribed-'));
 try{const state=Buffer.from('{}');await fs.writeFile(path.join(root,'state.model'),state);
 for(const kind of['catalog-digest','partial-producer','state-digest']){
  const catalog={schema:'kaminos.corrosion-evolution.v1',status:kind==='partial-producer'?'running':'passed',sourceRevision:'352933184c28ab6b7d5618f993cd450f1bf08226',snapshots:[{time:0,file:'state.model',bytes:state.length,sha256:'0'.repeat(64)}]},bytes=Buffer.from(JSON.stringify(catalog));await fs.writeFile(path.join(root,'catalog.json'),bytes);
  // Invalid resolution is a second, pre-formation stop if the input guard is
  // absent. This fixture cannot launch physics with a pretend admission.
  const config={sourceRevision:'wrong',model:{resolution:0},times:[0],prescribedChemistry:{catalogPath:path.join(root,'catalog.json'),sha256:kind==='catalog-digest'?'0'.repeat(64):sha(bytes)}},cfg=path.join(root,kind+'.json'),out=path.join(root,kind);await fs.writeFile(cfg,JSON.stringify(config));await assert.rejects(run(process.execPath,['tools/corrosion-source-build.mjs',cfg,out],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'negative-input-fixture'}}));const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(report.phase,'input-preflight');assert.equal(report.status,'failed');assert.deepEqual(report.snapshots,[]);assert.match(report.error,kind==='partial-producer'?/completed prescribed/:/digest|bytes/);
 }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
