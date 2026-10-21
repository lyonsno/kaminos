// kaminos-test: node
import assert from 'node:assert/strict';
import {admitContactState} from '../tools/creature-flesh-evidence.mjs';
const good={steps:2,volume:{steps:2,minJ:1,volumeRatio:1},body:{vertices:3,triangles:1},deformer:{backend:'webgpu-dense-dq',physicalBackend:'cpu-tetrahedral-local-energy',allInfluences:true,dispatches:3,pending:false},source:{caseSha256:'a'},preparedSha256:'b'};
assert.equal(admitContactState(good,{steps:2,caseSha256:'a',preparedSha256:'b',presented:true}),true);
for(const mutate of [s=>delete s.steps,s=>s.steps=NaN,s=>s.steps=3,s=>s.volume.steps=1,s=>s.volume.minJ=-1,s=>s.body.vertices=0,s=>s.deformer.backend='cpu-reference',s=>s.deformer.dispatches=0,s=>s.source.caseSha256='wrong',s=>s.preparedSha256='wrong',s=>s.deformer.pending=true]){const s=structuredClone(good);mutate(s);assert.throws(()=>admitContactState(s,{steps:2,caseSha256:'a',preparedSha256:'b',presented:true}));}
console.log('evidence rejects fallback, partial/missing/stale physical state, wrong inputs and unpresented output');
