// kaminos-test: node
import assert from 'node:assert/strict';import fs from 'node:fs';import {skinTransport,transportDualQuaternions} from '../hindquarter-live-core.mjs';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/dq-pounce-continuity/source.json',import.meta.url))),[a,b]=f.weightEndpoints,epsilon=1e-7,weights=[f.crossover-epsilon,f.crossover+epsilon].flatMap(t=>a.map((v,j)=>v+t*(b[j]-v))),rest=Float64Array.from([...f.restPoint,...f.restPoint]);
const separation=p=>Math.hypot(...[0,1,2].map(k=>p[k]-p[k+3]));
const original=skinTransport(rest,weights,f.matrices);assert(separation(original)>.1,'retained source must still expose original dominant-anchor jump');
const repaired=skinTransport(rest,weights,f.matrices,{rotationParents:f.parents});assert(separation(repaired)<1e-5,`smooth influence rows at the same rest point must not jump across a dominant-channel switch: ${separation(repaired)}`);
const {real,dual}=transportDualQuaternions(f.matrices,{rotationParents:f.parents});
for(let j=0;j<f.parents.length;j++){const p=f.parents[j];if(p>=0)assert(real[j].reduce((s,v,k)=>s+v*real[p][k],0)>=-1e-12,'child/parent signs must agree');assert.equal(real[j].length,4);assert(dual[j].every(Number.isFinite));}
for(const parents of [f.parents.slice(1),f.parents.map((p,j)=>j===1?1:p),f.parents.map((p,j)=>j===1?2:j===2?1:p),f.parents.map((p,j)=>j===1?99:p)])assert.throws(()=>transportDualQuaternions(f.matrices,{rotationParents:parents}),/parent|hierarch|cycle/i);
// A sign choice cannot change any isolated rigid transform.
for(let j=0;j<f.matrices.length;j++){const w=new Float64Array(f.matrices.length);w[j]=1;assert.deepEqual(skinTransport(f.restPoint,w,f.matrices,{rotationParents:f.parents}),skinTransport(f.restPoint,w,f.matrices));}
console.log('Observed pounce continuity pair passes tree-sign policy, isolated transforms and invalid hierarchy checks');
