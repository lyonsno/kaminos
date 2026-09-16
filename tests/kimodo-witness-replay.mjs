import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyIdentity,verifyMotion} from '../lib/kimodo-witness-contracts.mjs';
import {summarizeFlameSpan} from '../lib/kimodo-flame-evidence.mjs';
const folder=process.argv[2];
if(!folder)throw new Error('Supply a preserved browser witness directory');
const report=JSON.parse(await readFile(path.join(folder,'report.json'))),run=report.evidence.runs[0];
const bytes=await readFile(path.join(folder,'kimodo-motion-1.json'));
assert.equal(verifyMotion(bytes,run).status,'verified');
for(const mutate of [m=>m.generationId++,m=>m.numFrames--,m=>m.joints[0][0][0]++,m=>m.motion[0][0]++,m=>m.joints[0].pop()]){
  const m=JSON.parse(bytes);mutate(m);assert.throws(()=>verifyMotion(Buffer.from(JSON.stringify(m)),run));
}
const samples=report.evidence.samples.slice(...run.inferenceSampleRange);
assert.equal(summarizeFlameSpan(samples).distributedAdvancement,true,'observed live counters advance in each third');
// Synthetic resource inventory tests only the local admission policy. The live
// witness separately records browser response bytes from the effective route.
const expected=report.evidence.source,resources=[];
for(const [name,value] of Object.entries(expected.assets))if(name!=='kimodo.bin')resources.push({path:`artifacts/kimodo-live-flame/assets/${name}`,sha256:value.sha256,expectedSha256:value.sha256});
for(const [name,hash] of Object.entries(expected.bundles))resources.push({path:`artifacts/kimodo-live-flame/lib/${name}`,sha256:hash,expectedSha256:hash});
for(const name of ['index.html','kimodo-live-flame-inject.mjs','volume-core.js'])resources.push({path:name,sha256:'synthetic-host',expectedSha256:'synthetic-host'});
const input={expected,effective:structuredClone(expected),resources,weightsHash:expected.assets['kimodo.bin'].sha256,url:report.effectiveUrl};
assert.equal(verifyIdentity(input).status,'verified');
for(const key of ['sourceCommit','hostCommit'])assert.throws(()=>verifyIdentity({...input,effective:{...expected,[key]:'wrong'}}));
assert.throws(()=>verifyIdentity({...input,url:report.effectiveUrl.replace('settings_preset=vsp-','settings_preset=wrong-')}));
for(const resource of resources){
  const changed=resources.map(r=>r===resource?{...r,sha256:'mutated-after-manifest'}:r);
  assert.throws(()=>verifyIdentity({...input,resources:changed}),resource.path);
}
assert.throws(()=>verifyIdentity({...input,resources:[]}));
assert.throws(()=>verifyIdentity({...input,weightsHash:'wrong'}));
console.log('Observed motion/counter replay and adversarial identity/export controls pass');
