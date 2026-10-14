// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kiln-selected-input-'));
try{
 const store=path.join(dir,'store'),out=path.join(dir,'out');await fs.mkdir(path.join(store,'scenes'),{recursive:true});
 const file='selected.kaminos.json',bytes=JSON.stringify({composition:{flame:{presetId:'selected-preset'},route:{}}});
 await fs.writeFile(path.join(store,'scenes',file),bytes);
 const stop='data:text/javascript,export const chromium={launch(){throw new Error("fixture stop before browser")}}';
 const run=spawnSync(process.execPath,['scratch/beaming-kiln-hybrid-1013.mjs',out,store,'http://localhost','0',file],{cwd:new URL('..',import.meta.url),env:{...process.env,KAMINOS_PLAYWRIGHT_MODULE:stop},encoding:'utf8'});
 assert.equal(run.status,1);const report=JSON.parse(await fs.readFile(path.join(out,'kiln.json')));
 assert.equal(report.input?.file,file,'witness must read the requested scene, not silently substitute its default');
 assert.equal(report.input.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(report.input.preset,'selected-preset');assert.equal(report.failure.message,'fixture stop before browser');
}finally{await fs.rm(dir,{recursive:true,force:true});}
console.log('PASS selected kiln scene retains exact input and preset identity');
