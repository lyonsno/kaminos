// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),sha=x=>createHash('sha256').update(x).digest('hex');
test('footprint comparison preserves input-phase failure for wrong source, source drift and model drift',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stone-footprint-negative-'));
 try{
  const source={schema:'kaminos.stone-transition-source.v1'},bytes=JSON.stringify(source),fit={sourceKind:'stone-transition',ground:{sha256:sha(bytes)},checkpoints:[{file:'model.bin',sha256:'wrong-model'}]};
  for(const [name,report]of [['wrong-source',{...fit,sourceKind:'grass'}],['source-drift',{...fit,ground:{sha256:'wrong-source'}}],['model-drift',fit]]){
   const input=path.join(dir,name),out=path.join(input,'out');await fs.mkdir(input);await fs.writeFile(path.join(input,'report.json'),JSON.stringify(report));await fs.writeFile(path.join(input,'source.json'),bytes);await fs.writeFile(path.join(input,'model.bin'),'not a model');
   await assert.rejects(run(process.execPath,['tools/stone-footprint-compare.mjs',input,out],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'input-validation-fixture'}}));
   const failure=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(failure.status,'failed');assert.equal(failure.phase,'inputs');assert.equal(failure.adapter,undefined);assert.deepEqual(failure.images,[]);
   assert.match(failure.error,/Observed stone|Source bytes|Checkpoint digest/);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
