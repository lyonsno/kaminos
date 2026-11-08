// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {runParticleCosts} from '../tools/particle-cost-witness.mjs';
test('particle cost witness rejects a wrong source before hardware and preserves failure report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'particle-cost-'));try{const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({baseline:{root:fileURLToPath(new URL('..',import.meta.url)),commit:'not-the-source'},candidate:{root:fileURLToPath(new URL('..',import.meta.url)),commit:'not-the-source'}}));const out=path.join(dir,'out');const r=await runParticleCosts({configPath:config,out});assert.equal(r.status,'failed');assert.equal(r.failurePhase,'admission');assert.match(r.error,/Wrong or dirty cost source/);assert.equal((JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'))).failurePhase,'admission');assert.equal(r.hardwareEvidence,undefined);}finally{await fs.rm(dir,{recursive:true});}
});
