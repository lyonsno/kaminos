// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const out=await mkdtemp(join(tmpdir(),'three-grid-source-failure-'));
try {
 const run=spawnSync(process.execPath,['tools/three-grid-scene-witness.mjs',out,'unused-preset.json'],{cwd:new URL('..',import.meta.url),env:{...process.env,PATH:'/nonexistent-test-path'},encoding:'utf8'});
 assert.equal(run.status,1);
 let report;try {report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));}catch {assert.fail('Source discovery failed without a durable report');}
 assert.equal(report.status,'failed');assert.equal(report.phase,'source-discovery');assert.equal(report.source,null);assert.match(report.error,/git.*ENOENT/);assert.equal(report.server,undefined);
} finally {await rm(out,{recursive:true,force:true});}
