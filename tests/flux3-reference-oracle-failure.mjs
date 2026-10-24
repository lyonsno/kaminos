// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
for(const retry of [false,true])test(`missing LoRA records current setup failure, prior success=${retry}`,async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'flux3-oracle-failure-'));
 try{
  if(retry)await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({ok:true,phase:'done',tensors:{stale:{}}}));
  const p=spawnSync('python3',['-S','models/flux3-klein/export-reference-conditioning.py','--model-dir',out+'/missing-model','--lora',out+'/missing-lora','--out',out],{encoding:'utf8'});
  assert.notEqual(p.status,0);const r=JSON.parse(await fs.readFile(path.join(out,'manifest.json')));
  assert.equal(r.ok,false);assert.equal(r.phase,'source-identity');assert.match(r.error,/missing-lora/);assert.deepEqual(r.tensors,{});
 }finally{await fs.rm(out,{recursive:true,force:true});}
});
