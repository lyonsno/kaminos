import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname),folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-trajectory-runner-test-'));
try{
  const fixture=path.join(folder,'fixture');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'manifest.json'),'{}');
  const report=path.join(folder,'report.json');
  const run=spawnSync(process.execPath,['models/trellis2/run-sparse-prefix-witness.mjs','--repo-root',root,
    '--expected-commit',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    '--fixture',fixture,'--sampler-fixture',fixture,'--trajectory-fixture',fixture,'--witness','sampler-full',
    '--chrome','/missing-independent-browser','--report',report,'--receiver','test'],{cwd:root,encoding:'utf8'});
  assert.ok(await fs.stat(report).catch(()=>false),'Complete-schedule early admission failure must write its terminal report.');
  const receipt=JSON.parse(await fs.readFile(report,'utf8'));assert.notEqual(run.status,0);
  assert.notEqual(receipt.phase,'witness-admission','Complete schedule is an admitted witness class, not a silent first-step fallback.');
  assert.ok(['source-identity','sampler-reference-admission'].includes(receipt.phase));
  assert.equal(receipt.witness,'sampler-full');assert.ok(receipt.finishedAt);assert.equal(receipt.status,'failed');assert.ok(!receipt.ownedBrowserPid);
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Full-schedule route class and early reference/source failure preserve terminal evidence without launching a browser.');
