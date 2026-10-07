import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'shard-source-contract-'));
const root=new URL('../',import.meta.url).pathname;
for(const [name,input,size] of [['malformed-size','assets/arch-stones/03-bedded-stone-500-normal.glb','invalid-json'],['missing-source','not-a-source.glb','[2.4,0.6,0.6]']]){
  const output=path.join(out,`${name}.json`),result=spawnSync(process.execPath,['structural-material-shard-source.mjs',input,output,size],{cwd:root,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert(fs.existsSync(output),`${name}: failure before primary output must retain a report`);
  const report=JSON.parse(fs.readFileSync(output,'utf8'));assert.equal(report.status,'failed');assert(report.failure?.message);assert(report.phase);
  assert.equal(report.phase,name==='malformed-size'?'input':'source-admission');
}
console.log(`Shard preparation failure reports pass; controlled artifacts at ${out}`);
