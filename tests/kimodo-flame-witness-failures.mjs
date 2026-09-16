import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {execFileSync} from 'node:child_process';
const base=mkdtempSync(path.join(tmpdir(),'kimodo-flame-negative-'));
const sourceRoot=process.argv[2]??'/nonexistent-kimodo';
const hostPin=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const producerPin=process.argv[2]?execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim():'0'.repeat(40);
for(const [name,greenroom,cwd] of [['missing-greenroom',''],['invalid-executable','/nonexistent-greenroom'],['refused-claim','/usr/bin/false'],['no-host-git','/usr/bin/false',base]]){
  const out=path.join(base,name);
  const result=spawnSync(process.execPath,[path.resolve('scripts/witness-kimodo-live-flame.mjs'),sourceRoot,out,'http://127.0.0.1:8096/kimodo-elfinblue.html',hostPin,producerPin],{cwd,encoding:'utf8',env:{...process.env,GREENROOM_BIN:greenroom}});
  assert.notEqual(result.status,0);
  const report=JSON.parse(readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed',`${name}: failure before browser launch must leave a terminal report`);
  assert.equal(report.failurePhase,'preflight');
  assert.ok(report.finishedAt);
  assert.equal(report.leaseClaim,undefined);
}
console.log(`Browser preflight failure reports pass; retained fixtures: ${base}`);
