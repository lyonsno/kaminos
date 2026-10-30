// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertWorkerDrained} from '../tools/hand-browser-witness-contract.mjs';
assertWorkerDrained({retention:{pending:0,error:null,extra:'additive field'}});
for(const retention of [undefined,null,{}, {pending:0}, {error:null}, {pending:'0',error:null}, {pending:1,error:null}, {pending:0,error:'write failed'}]) {
  assert.throws(()=>assertWorkerDrained({retention}),'missing, partial or failed worker evidence must not pass a drain check');
}
const output=mkdtempSync(join(tmpdir(),'hand-browser-failure-'));
const result=spawnSync(process.execPath,['tools/hand-browser-witness.mjs','--output',output,'--playwright',join(output,'missing.mjs')],{encoding:'utf8'});
assert.notEqual(result.status,0);
assert(existsSync(join(output,'report.json')),'failure before browser must preserve a report');
const report=JSON.parse(readFileSync(join(output,'report.json')));
assert.equal(report.status,'failed');assert.equal(report.phase,'browser_launch');assert.match(report.error,/module/i);
