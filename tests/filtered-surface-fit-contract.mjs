// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('refused capture still publishes a durable failure phase and cannot look completed',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'filtered-surface-refusal-'));
 const env={...process.env};delete env.GREENROOM_JOB_ID;
 const run=spawnSync(process.execPath,['tools/filtered-surface-fit.mjs',path.join(out,'missing.json'),out],{cwd:new URL('..',import.meta.url),env,encoding:'utf8'});
 assert.equal(run.status,1,run.stderr);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
 assert.equal(report.status,'failed');assert.equal(report.phase,'configuration');assert.match(report.error,/Greenroom admission/);assert.deepEqual(report.cases,[]);
});
