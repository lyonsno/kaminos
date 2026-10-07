import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(new URL('../../..',import.meta.url).pathname),folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-slat-runner-'));
try{
 await fs.writeFile(path.join(folder,'manifest.json'),'{}');const output=path.join(folder,'report.json');
 const p=spawnSync(process.execPath,[path.join(root,'models/trellis2/run-sparse-prefix-witness.mjs'),
 '--repo-root',root,'--expected-commit','0'.repeat(40),'--fixture',folder,'--witness','slat',
 '--chrome',path.join(folder,'absent-browser'),'--report',output,'--receiver','slat-test'],{encoding:'utf8'});
 assert.notEqual(p.status,0);const r=JSON.parse(await fs.readFile(output,'utf8'));
 assert.doesNotMatch(r.error?.message??'',/--witness must be/,'Complete native SLat consumer needs an admitted witness class.');
 assert.equal(r.status,'failed');assert.ok(r.phase&&r.finishedAt);assert.ok(!r.ownedBrowserPid);
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('SLat class recognized; wrong source preserves negative terminal before browser/GPU execution.');
