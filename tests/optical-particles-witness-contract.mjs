// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {runParticleWitness,verifyParticleProgress} from '../tools/optical-particles-witness.mjs';
test('witness rejects stale source before browser launch and preserves terminal report',async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({source:{commit:'stale',repoRoot:'/wrong-root',dirty:false}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'particle-witness-negative-'));
 try{const report=await runParticleWitness({origin:`http://127.0.0.1:${server.address().port}`,out,expected:'requested',repoRoot:'/expected-root',playwrightModule:'missing-on-purpose',executable:'/not-launched'});assert.equal(report.status,'failed');assert.equal(report.failurePhase,'runtime');assert.match(report.error,/wrong source revision/);assert.equal(JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8')).failurePhase,'runtime');}
 finally{await new Promise(r=>server.close(r));await fs.rm(out,{recursive:true});}
});

test('witness rejects age-only updates as evidence of material motion',()=>{
 const a=new Float32Array(24);a[3]=1;const b=a.slice();b[3]=2;assert.throws(()=>verifyParticleProgress(a,b),/no retained carrier movement/);b[0]=.1;assert.deepEqual(verifyParticleProgress(a,b),{retained:1,changed:1});
});
