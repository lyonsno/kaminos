import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname),folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-projection-runner-'));
try{
  await fs.writeFile(path.join(folder,'manifest.json'),'{}');
  const report=path.join(folder,'report.json'),run=spawnSync(process.execPath,[path.join(root,'models/trellis2/run-sparse-prefix-witness.mjs'),
    '--repo-root',root,'--expected-commit','0'.repeat(40),'--fixture',folder,'--chrome',path.join(folder,'missing-browser'),
    '--report',report,'--receiver','projection-test','--witness','slat-projection'],{encoding:'utf8'});
  assert.notEqual(run.status,0);const m=JSON.parse(await fs.readFile(report,'utf8'));
  assert.doesNotMatch(m.error.message,/--witness must be/,'A projection diagnostic must not need a whole decoder witness.');
  assert.equal(m.status,'failed');assert.ok(m.phase&&m.finishedAt);assert.ok(!m.ownedBrowserPid);
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Wrong-source projection invocation retains an early negative terminal before browser/compute launch.');
