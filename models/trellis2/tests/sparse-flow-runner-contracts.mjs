import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname);
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-flow-runner-test-'));
try{
  const fixture=path.join(folder,'fixture');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'manifest.json'),'{}');
  const report=path.join(folder,'report.json');
  const run=spawnSync(process.execPath,['models/trellis2/run-sparse-prefix-witness.mjs','--repo-root',root,
    '--expected-commit',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    '--fixture',fixture,'--witness','flow','--chrome','/missing-independent-browser','--report',report,'--receiver','test'],{cwd:root,encoding:'utf8'});
  const receipt=JSON.parse(await fs.readFile(report,'utf8'));
  assert.notEqual(run.status,0);
  assert.notEqual(receipt.phase,'witness-admission','Full sparse flow must be an admitted witness class, not rejected as unknown.');
  assert.ok(['source-identity','flow-reference-admission'].includes(receipt.phase));
  assert.ok(receipt.finishedAt);assert.equal(receipt.status,'failed');
  assert.ok(!receipt.ownedBrowserPid,'invalid/dirty fixtures must not launch a browser');
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Full-flow runner preserves terminal admission failure and refuses browser launch on invalid source/reference.');
