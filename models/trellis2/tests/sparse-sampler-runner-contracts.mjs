import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname);
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-sampler-runner-test-'));
try{
  const fixture=path.join(folder,'fixture');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'manifest.json'),'{}');
  const report=path.join(folder,'report.json');
  const run=spawnSync(process.execPath,['models/trellis2/run-sparse-prefix-witness.mjs','--repo-root',root,
    '--expected-commit',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    '--fixture',fixture,'--sampler-fixture',fixture,'--witness','sampler','--chrome','/missing-independent-browser','--report',report,'--receiver','test'],{cwd:root,encoding:'utf8'});
  assert.ok(await fs.stat(report).catch(()=>false),'Sampler admission failure must preserve the terminal report.');
  const receipt=JSON.parse(await fs.readFile(report,'utf8'));
  assert.notEqual(run.status,0);assert.notEqual(receipt.phase,'witness-admission','Sampler is an admitted witness class.');
  assert.ok(['source-identity','sampler-reference-admission'].includes(receipt.phase));
  assert.ok(receipt.finishedAt);assert.equal(receipt.status,'failed');assert.ok(!receipt.ownedBrowserPid);
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Sampler runner source/reference early failure is durably negative before browser launch.');
