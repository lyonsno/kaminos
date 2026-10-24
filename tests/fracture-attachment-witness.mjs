// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('source identification failure replaces stale success with a terminal report',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'fracture-witness-failure-'));
 try{
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:'passed',sourceCommit:'old'}));
  const run=spawnSync(process.execPath,[new URL('../tools/fracture-attachment-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out,'/unavailable-playwright','/unavailable-browser'],{env:{...process.env,PATH:'/nonexistent'},encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed','startup must overwrite an old success');assert.equal(report.phase,'terminal');assert.equal(report.lastPhase,'source-identification');assert.equal(report.sourceCommit,null);assert.match(report.failure.message,/git|ENOENT/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});
