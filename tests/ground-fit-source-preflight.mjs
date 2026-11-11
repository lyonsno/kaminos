// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
test('a wrong requested revision refuses with a source-preflight report before source/GPU work',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'grass-source-preflight-')),config=path.join(out,'config.json');
 // An invalid source kind is a second pre-GPU stop on old behavior, so this
 // fail-first check cannot accidentally launch a training job with a fake id.
 await fs.writeFile(config,JSON.stringify({sourceRevision:'wrong-requested-revision',sourceKind:'pre-GPU-stop'}));
 const run=spawnSync(process.execPath,['tools/ground-material-fit.mjs',config,out],{cwd:new URL('..',import.meta.url),env:{...process.env,GREENROOM_JOB_ID:'unit-refusal-only'},encoding:'utf8'});
 assert.notEqual(run.status,0);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'source-preflight');assert.match(report.error,/requested clean source revision/i);
});
