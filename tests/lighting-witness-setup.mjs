// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),out=await fs.mkdtemp(path.join(os.tmpdir(),'kaminos-lighting-bind-'));
const preload=path.join(out,'deny-bind.mjs');
await fs.writeFile(preload,`import http from 'node:http';http.Server.prototype.listen=function(){queueMicrotask(()=>this.emit('error',Object.assign(Error('denied bind witness'),{code:'EPERM'})));return this;};`);
for(const [name,args] of [
 ['all-box-lighting-gpu-witness.mjs',dir=>[root,dir]],
 ['exterior-smoke-gpu-witness.mjs',dir=>[dir,root]],
]){
 const dir=path.join(out,name);
 const run=spawnSync(process.execPath,['--import',preload,path.join(root,'tools',name),...args(dir)],{encoding:'utf8',env:{...process.env,CHROME_EXECUTABLE:'/independent-test-browser'}});
 assert.equal(run.status,1,run.stderr);const report=JSON.parse(await fs.readFile(path.join(dir,'report.json'),'utf8'));
 assert.equal(report.status,'failed','setup failure must never leave a running/success report');assert.match(report.failure??report.error,/denied bind witness/);assert.deepEqual(report.cleanupErrors,[]);
}
console.log('PASS both lighting witnesses retain terminal reports after denied server bind');
