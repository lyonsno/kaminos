// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGrassMaterialSource} from '../grass-material-source.mjs';
const run=promisify(execFile);
test('grass fit source keeps source colors, height and blade dimensions across the broader patch',()=>{
 const a=createGrassMaterialSource({blades:12,height:.35}),b=createGrassMaterialSource({blades:192,width:9.6,depth:7.2,height:.35});
 assert.equal(b.config.blades/(b.config.width*b.config.depth),a.config.blades/(a.config.width*a.config.depth));
 assert.equal(b.config.bladeWidth,a.config.bladeWidth);assert.equal(b.config.bend,a.config.bend);
 assert.equal(b.triangles.length,192*14+2);assert.equal(b.materials.length,2);
 assert.ok(b.materials[1].color[1]>b.materials[1].color[0]);
 assert.ok(b.referenceHeight>Math.max(...b.blades.map(x=>x.centres.at(-1)[1])));
 assert.deepEqual(b,createGrassMaterialSource(b.config));
});
test('bad source or label route fails before GPU launch and preserves a failure report',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'grass-fit-config-'));
 try{
 for(const config of [{sourceKind:'missing'},{labels:'missing'},{labels:'denoised-grid',fit:{fresh:false}},{labels:'denoised-grid',grid:{width:16,height:64}},{labels:'denoised-grid',grid:{width:25.6,height:80}}]){
 const file=path.join(root,'config.json'),out=path.join(root,String(Object.keys(config)[0])+String(config.fit?.fresh));await fs.writeFile(file,JSON.stringify(config));
 await assert.rejects(run(process.execPath,['tools/ground-material-fit.mjs',file,out],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'negative-config-fixture'}}));
 const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
 assert.equal(report.status,'failed');assert.equal(report.phase,'configuration');assert.equal(report.adapter,undefined);assert.match(report.error,/Unknown|require fresh|Grid extent/);
 }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
