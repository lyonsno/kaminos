// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'appearance-report-'));
try{
 for(const name of ['neural-appearance-check','neural-shading-check']){
 const out=path.join(root,name);
 const run=spawnSync(process.execPath,[new URL('../tools/'+name+'.mjs',import.meta.url).pathname,out],{cwd:root,encoding:'utf8'});
 assert.notEqual(run.status,0);
 const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
 assert.equal(report.status,'failed');assert.equal(report.phase,'source-identity');assert.match(report.error,/git|repository/);
 }
}finally{await fs.rm(root,{recursive:true,force:true});}
console.log('Pre-launch identity failure retains a durable terminal report');
