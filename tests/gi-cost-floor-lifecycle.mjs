// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {finishGiCostReport} from '../tools/gi-cost-floor-finalize.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gi-cost-lifecycle-'));
try{
 for(const rounds of [0,null]){
  const out=path.join(temp,String(rounds));await fs.mkdir(out);const manifest=path.join(out,'manifest.json');
  await fs.writeFile(manifest,JSON.stringify({out,repoRoot:process.cwd(),origin:'http://127.0.0.1:1',sceneFile:'unused.kaminos.json',rounds,samples:1,warmup:0,cases:[{id:'unused'}],executable:'chrome-headless-shell',playwrightModule:'deliberately-not-imported',viewport:{width:32,height:32}}));
  const result=spawnSync(process.execPath,['tools/gi-cost-floor-witness.mjs',manifest],{cwd:process.cwd(),encoding:'utf8'});
  assert.notEqual(result.status,0);const report=JSON.parse(await fs.readFile(path.join(out,'cost-report.json'),'utf8'));
  assert.equal(report.status,'failed');assert.match(report.error,/rounds/,'Invalid rounds must fail admission, before fetching or importing a browser');assert.equal(report.cases.length,0);
 }
 const failedClose={status:'observed',phase:'complete'};let saved=0,removed=0;
 const closed=await finishGiCostReport(failedClose,{close:async()=>{throw Error('deliberate close failure');},removeProfile:async()=>removed++,save:async()=>saved++});
 assert.equal(closed,false);assert.equal(saved,1);assert.equal(removed,0,'Unconfirmed browser closure must retain its profile');assert.equal(failedClose.status,'failed');assert.equal(failedClose.browserClosed,false);assert.match(failedClose.cleanupErrors[0].error,/deliberate close/);
 const failedRemove={status:'failed',phase:'load',error:'original scene error'};saved=0;
 assert.equal(await finishGiCostReport(failedRemove,{close:async()=>{},removeProfile:async()=>{throw Error('deliberate remove failure');},save:async()=>saved++}),false);
 assert.equal(saved,1);assert.equal(failedRemove.browserClosed,true);assert.equal(failedRemove.profileRemoved,false);assert.equal(failedRemove.error,'original scene error');assert.equal(failedRemove.cleanupErrors[0].phase,'profile-remove');
 const complete={status:'observed',phase:'complete'};
 assert.equal(await finishGiCostReport(complete,{close:async()=>{},removeProfile:async()=>{},save:async()=>{}}),true);assert.equal(complete.browserClosed,true);assert.equal(complete.profileRemoved,true);
 console.log('Cost witness rejects empty rounds before browser work and preserves primary/cleanup failures in terminal reports');
}finally{await fs.rm(temp,{recursive:true,force:true});}
