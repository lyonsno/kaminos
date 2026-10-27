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
