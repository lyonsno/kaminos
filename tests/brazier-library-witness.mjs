// kaminos-test: node
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'brazier-library-startup-'));
try{
 for(const mode of ['missing','malformed','stale-pass']){
  const out=path.join(root,mode),registration=path.join(root,mode+'.json');await fs.mkdir(out);
  if(mode!=='missing')await fs.writeFile(registration,'{broken');
  if(mode==='stale-pass')await fs.writeFile(path.join(out,'launch.json'),JSON.stringify({status:'passed',phase:'complete',source:'old-source'}));
  const r=spawnSync(process.execPath,['tools/brazier-library-witness.mjs','http://127.0.0.1:1',out,registration],{encoding:'utf8'});assert.notEqual(r.status,0);
  const file=path.join(out,'launch.json');assert(await fs.stat(file).then(()=>true,()=>false),'failed input must produce a terminal report');
  const report=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(report.status,'failed','failed invocation must replace a stale pass');assert.equal(report.phase,'registration');assert.match(report.failure,mode==='missing'?/ENOENT/:/SyntaxError/);assert.equal(report.source,null);assert.deepEqual(report.requests,[]);
 }
}finally{await fs.rm(root,{recursive:true,force:true});}
