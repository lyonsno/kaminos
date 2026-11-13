// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,existsSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
test('a missing explicit recipe value fails before writing or admitting a fit',()=>{
 const out=mkdtempSync(path.join(os.tmpdir(),'neumip-cli-'));const env={...process.env};delete env.GREENROOM_JOB_ID;
 try{const r=spawnSync(process.execPath,['tools/neumip-fit.mjs','unused.model',out,'--training-recipe'],{encoding:'utf8',env});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Missing value for --training-recipe/);assert.equal(existsSync(path.join(out,'report.json')),false);
 }finally{rmSync(out,{recursive:true,force:true});}
});
