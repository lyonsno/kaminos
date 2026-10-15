// kaminos-test: node
import assert from 'node:assert/strict';
import {reducePointRegionsReference} from '../scene-point-regions.mjs';
const dims=[2,8,2],values=new Float32Array(128);
values.set([3,0,0,99],0);values.set([0,1,0,0],4*(1+2));
const rows=reducePointRegionsReference(values,dims,2,1,'energy');
assert.deepEqual(rows.map(r=>r.energy),[[2,0,0],[1,1,0]],'split the emitting energy even when all emission is below the domain midpoint');
assert.deepEqual(rows[0].position,[-.5,-.5,-.5]);
assert.deepEqual(rows[1].position,[0,0,-.5]);
assert.equal(rows[0].radiusSquared,.25);assert.equal(rows[1].radiusSquared,.75);
for(const count of [1,2,3,5]){
 const rs=reducePointRegionsReference(values,dims,count,2,'energy');
 const sum=rs.reduce((a,r)=>a.map((v,i)=>v+r.energy[i]),[0,0,0]);
 sum.forEach((v,i)=>assert(Math.abs(v-[6,2,0][i])<1e-12));
 rs.forEach(r=>assert(Math.abs(r.energy.reduce((a,b)=>a+b,0)-8/count)<1e-12));
}
assert.deepEqual(reducePointRegionsReference(values,dims,1,1,'energy'),reducePointRegionsReference(values,dims,1));
const dark=reducePointRegionsReference(new Float32Array(128),dims,2,1,'energy');
assert(dark.every(r=>r.energy.every(v=>v===0)&&[...r.position,r.radiusSquared].every(Number.isFinite)));
assert.throws(()=>reducePointRegionsReference(values,dims,2,1,'bogus'),/partition/);
console.log('PASS emitting-region partition conserves energy and follows compact emission');
