import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname),folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-decoder-runner-contract-'));
try{
  await fs.writeFile(path.join(folder,'manifest.json'),'{}');const reportPath=path.join(folder,'report.json');
  const run=spawnSync(process.execPath,[path.join(root,'models/trellis2/run-sparse-prefix-witness.mjs'),
    '--repo-root',root,'--expected-commit','0'.repeat(40),'--fixture',folder,'--witness','decoder',
    '--chrome',path.join(folder,'missing-independent-browser'),'--report',reportPath,'--receiver','decoder-contract'],{encoding:'utf8'});
  assert.notEqual(run.status,0);const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
  assert.equal(report.witness,'decoder');assert.equal(report.status,'failed');
  assert.ok(!report.ownedBrowserPid);
  assert.doesNotMatch(report.error?.message??'',/--witness must be/,'The same isolated runner must recognize the real decoder witness class.');
  assert.ok(report.finishedAt);assert.ok(report.phase);
  console.log('Recognized decoder route preserves pre-browser source/reference failure and terminal evidence.');
}finally{await fs.rm(folder,{recursive:true,force:true});}
