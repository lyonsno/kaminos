// kaminos-test: node
import assert from 'node:assert/strict';
import {tetrahedron} from '../experiments/creature-flesh/elastic.mjs';
const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]], material={young:30,poisson:.35,bulk:100};
const tet=tetrahedron(rest,material),original=tet.evaluate(rest);
assert.ok(Math.abs(original.energy)<1e-12,'unforced reference has zero energy');
const compressed=rest.map(p=>p.map((v,a)=>a===0?v*.75:v)),r=tet.evaluate(compressed);
assert.ok(r.energy>.01,'compression must store elastic energy, unlike the transport-only baseline');
assert.ok(Math.abs(r.J-.75)<1e-12);
const eps=1e-6;
for(let i=0;i<4;i++)for(let a=0;a<3;a++){
 const plus=structuredClone(compressed),minus=structuredClone(compressed);plus[i][a]+=eps;minus[i][a]-=eps;
 const derivative=(tet.evaluate(plus).energy-tet.evaluate(minus).energy)/(2*eps);
 assert.ok(Math.abs(derivative-r.gradients[i][a])<1e-5,'energy gradient agrees with independent central differences');
}
assert.ok(r.gradients[1][0]<0,'restoring force opposes compression');
assert.throws(()=>tet.evaluate(rest.map(p=>[-p[0],p[1],p[2]])),/invert/i);
assert.throws(()=>tetrahedron(rest,{...material,poisson:.5}),/material/i);
const translated=rest.map(p=>p.map((v,a)=>v+[3,-2,7][a]));
assert.ok(tet.evaluate(translated).energy<1e-12,'rigid translation stores no strain');
console.log('finite elastic energy/gradient, rigid invariance and inversion boundary');
