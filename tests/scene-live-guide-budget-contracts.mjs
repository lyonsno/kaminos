import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const evidence=await mkdtemp(path.join(os.tmpdir(),'kaminos-live-guide-preflight-'));
const script=fileURLToPath(new URL('../scratch/beaming-live-guide-budget.mjs',import.meta.url));
const result=spawnSync(process.execPath,[script,'http://127.0.0.1:1',evidence,'1'],{cwd:evidence,encoding:'utf8'});
assert.equal(result.status,1);
let report;
try{report=JSON.parse(await readFile(path.join(evidence,'report.json'),'utf8'));}catch{}
assert.ok(report,'failed Git preflight must preserve a durable report before browser launch');
assert.equal(report.status,'failed');assert.equal(report.phase,'source-identity');
assert.equal(report.source.revision,null);assert.match(report.error,/git rev-parse HEAD/);
assert.deepEqual(report.arms,[]);
console.log('pre-browser source failure preserved at '+evidence);
