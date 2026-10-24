// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const output=mkdtempSync(join(tmpdir(),'hand-browser-failure-'));
const result=spawnSync(process.execPath,['tools/hand-browser-witness.mjs','--output',output,'--playwright',join(output,'missing.mjs')],{encoding:'utf8'});
assert.notEqual(result.status,0);
assert(existsSync(join(output,'report.json')),'failure before browser must preserve a report');
const report=JSON.parse(readFileSync(join(output,'report.json')));
assert.equal(report.status,'failed');assert.equal(report.phase,'browser_launch');assert.match(report.error,/module/i);
