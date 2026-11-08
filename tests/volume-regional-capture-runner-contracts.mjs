// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=await mkdtemp(path.join(tmpdir(),'regional-capture-failure-'));
try {
  const run=spawnSync(process.execPath,['scripts/capture-regional-optics.mjs','--out',out,
    '--root',path.join(out,'missing-source')],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.notEqual(run.status,0);
  const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.equal(report.failurePhase,'inputs');
  assert.deepEqual(report.chunks,[]);
  assert.equal(report.dataset,undefined,'failure must not synthesize a default dataset');
} finally {await rm(out,{recursive:true,force:true});}
console.log('regional capture fails before acquisition with a durable phase report');
