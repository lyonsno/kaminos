import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'stone-support-negative-'));
for(const [name,baseline,inputs]of [['empty','18158aa8',[]],['baseline','not-a-real-baseline',['missing-observation.json']]]){
 const reportPath=path.join(out,name+'.json'),r=spawnSync(process.execPath,['structural-material-support-benchmark.mjs',reportPath,baseline,...inputs],{encoding:'utf8'});
 assert.equal(r.status,1,'Empty or unresolved evidence must not pass');assert.ok(fs.existsSync(reportPath),'Setup failure must replace stale evidence with a failure report');
 const report=JSON.parse(fs.readFileSync(reportPath));assert.equal(report.status,'failed');assert.ok(report.failure.phase);assert.deepEqual(report.runs,[]);
}
console.log('Support benchmark rejects empty observations and retains unresolved-baseline failure');
