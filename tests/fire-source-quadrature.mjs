// kaminos-test: node
import assert from 'node:assert/strict';
import {sourceQuadratureReference,validateSourceQuadrature} from '../fire-source-quadrature.mjs';
for(const count of [1,2,3,4,6,8])validateSourceQuadrature(count);
validateSourceQuadrature(4,'paired');
assert.throws(()=>validateSourceQuadrature(2,'paired'),/four/);
assert.throws(()=>validateSourceQuadrature(4,'random'),/sampling/);
const phases=Array.from({length:4},()=>new Set()),energy=[1,3,7,13];let total=0;
for(let y=0;y<4;y++)for(let x=0;x<8;x++){
 const row=sourceQuadratureReference(x,y);assert.equal(row.indices.length,2);
 assert(row.indices[0]<2&&row.indices[1]>=2);
 total+=row.weight*row.indices.reduce((sum,i)=>sum+energy[i],0);
 for(const i of row.indices)phases[i].add(row.filterCoordinates.map(v=>v%4).join(','));
 assert.deepEqual(sourceQuadratureReference(x,y),row,'no frame-dependent selection');
}
assert.equal(total/32,energy.reduce((a,b)=>a+b,0));
assert.deepEqual(phases.map(p=>p.size),[16,16,16,16],'each source sees every shadow-filter phase');
console.log('PASS complementary source weights and independent shadow-filter phases');

// A receiver budget is independent of the number of freshly captured sources.
for(const count of [4,6,8])for(const budget of [0,1,2,3,4,6,8]){
 const n=budget?Math.min(count,budget):count,energy=Array.from({length:count},(_,i)=>i*i+1);let total=0;
 const visits=Array(count).fill(0);
 for(let phase=0;phase<count;phase++){
  const row=sourceQuadratureReference(phase,0,{count,budget});
  assert.equal(row.indices.length,n,'receiver source budget must not be fixed to the old four-source pair');
  assert.equal(new Set(row.indices).size,n,'one receiver must not repeat a selected source');
  for(const i of row.indices){assert(i>=0&&i<count);visits[i]++;total+=row.weight*energy[i];}
 }
 assert.deepEqual(visits,Array(count).fill(n),'all captured sources remain represented across complementary phases');
 assert(Math.abs(total/count-energy.reduce((a,b)=>a+b,0))<1e-10,'receiver budget preserves the source sum across phases');
}
for(const budget of [-1,.5,NaN])assert.throws(()=>sourceQuadratureReference(0,0,{count:8,budget}),/budget/);
