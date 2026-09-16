import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const base=mkdtempSync(path.join(tmpdir(),'kimodo-flame-negative-'));
for(const [name,greenroom] of [['missing-greenroom',''],['refused-claim','/usr/bin/false']]){
  const out=path.join(base,name);
  const result=spawnSync(process.execPath,['scripts/witness-kimodo-live-flame.mjs','/nonexistent-kimodo',out],{encoding:'utf8',env:{...process.env,GREENROOM_BIN:greenroom}});
  assert.notEqual(result.status,0);
  const report=JSON.parse(readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed',`${name}: failure before browser launch must leave a terminal report`);
  assert.equal(report.failurePhase,'preflight');
  assert.ok(report.finishedAt);
  assert.equal(report.leaseClaim,undefined);
}
console.log(`Browser preflight failure reports pass; retained fixtures: ${base}`);
