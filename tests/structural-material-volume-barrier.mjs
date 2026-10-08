import assert from 'node:assert/strict';import {intactTetrahedron} from '../structural-material-solid-reference.mjs';
const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],material={young:1000,poisson:.25},beta=400,plain=intactTetrahedron(rest,material),guarded=intactTetrahedron(rest,{...material,volumeBarrier:beta});
assert.equal(guarded.volumeBarrier,beta,'The material must name its explicit collapse-resistance law');
const current=rest.map(p=>[p[0]*.01,p[1]*.9,p[2]*1.1]),J=.0099,a=plain.evaluate(current),b=guarded.evaluate(current),expected=plain.volume*beta*(J-1-Math.log(J));assert.ok(Math.abs(b.energy-a.energy-expected)<1e-9);
assert.ok(Math.abs(guarded.evaluate(rest).energy)<1e-12);assert.ok(guarded.evaluate(rest).forces.flat().every(v=>Math.abs(v)<1e-10));
for(const model of [plain,guarded]){const translated=model.evaluate(rest.map(p=>p.map((v,k)=>v+[2,-3,.8][k])));assert.ok(Math.abs(translated.energy)<1e-12,'Rigid translation cannot create elastic strain');assert.ok(translated.forces.flat().every(v=>Math.abs(v)<1e-9));}
for(let node=0;node<4;node++)for(let axis=0;axis<3;axis++){const h=1e-7,plus=structuredClone(current),minus=structuredClone(current);plus[node][axis]+=h;minus[node][axis]-=h;const difference=(guarded.evaluate(plus).energy-guarded.evaluate(minus).energy)/(2*h);assert.ok(Math.abs(difference+b.forces[node][axis])<1e-3,'Barrier force must derive from the same energy');}
const smaller=rest.map(p=>[p[0]*1e-8,p[1],p[2]]);assert.ok(guarded.evaluate(smaller).energy>guarded.evaluate(current).energy);assert.throws(()=>intactTetrahedron(rest,{...material,volumeBarrier:-1}),/barrier/);
console.log('Explicit log-volume resistance has zero rest force, diverging collapse cost and energy-derived force');
