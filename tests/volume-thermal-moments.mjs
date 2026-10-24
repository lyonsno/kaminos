// kaminos-test: node
import assert from 'node:assert/strict';
import { WORLD_SMOKE_WGSL } from '../volume-world-smoke.mjs';
assert.match(WORLD_SMOKE_WGSL,/thermalMoments/, 'Outer material must retain hot-soot distribution, not only its mean temperature');
const { sootHeatMoments, thermalQuadrature, evolveThermalMoments } = await import('../volume-thermal-moments.mjs');
const sum = (samples) => samples.reduce((a,[s,h]) => a.map((v,i)=>v+sootHeatMoments(s,h)[i]),[0,0,0]);
for(const samples of [[[.7,.1],[.3,1.1]], [[.2,0],[.8,.9]], [[1,.6]]]){
 const soot=samples.reduce((s,p)=>s+p[0],0),m=sum(samples),q=thermalQuadrature(soot,m);
 for(let n=0;n<=3;n++)assert.ok(Math.abs(q.reduce((s,[w,h])=>s+w*h**n,0)-(n===0?soot:m[n-1]))<1e-8,`moment ${n}`);
 const expected=sum(samples.map(([s,h])=>[s*.8,(h+.2)*.9]));
 const actual=evolveThermalMoments(m,soot,{heatAdded:.2,cooling:.9,sootSurvival:.8});
 actual.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-8));
}
assert.deepEqual(thermalQuadrature(0,[0,0,0]),[]);
console.log('thermal moments: heterogeneous temperature, cooling and soot-loss invariants pass');
