// kaminos-test: node
import assert from 'node:assert/strict';
import {reducePointRegionsReference,pointRegionPlan} from '../scene-point-regions.mjs';
const dims=[2,4,2],values=new Float32Array(64);
values.set([2,1,0,100],0);values.set([0,0,3,0],4*(1+2*(3+4)));
const rows=reducePointRegionsReference(values,dims,2,2);
assert.deepEqual(rows[0].energy,[4,2,0],'every cell contributes emission times volume and gain, not extinction');
assert.deepEqual(rows[0].position,[-.5,-.5,-.5]);
assert.deepEqual(rows[1].energy,[0,0,6]);assert.deepEqual(rows[1].position,[.5,2.5,.5]);
assert.equal(rows[0].radiusSquared,.25,'finite cell footprint regularizes near-source singularity');
const dark=reducePointRegionsReference(new Float32Array(64),dims,2);
assert(dark.every(r=>[...r.energy,...r.position,r.radiusSquared].every(Number.isFinite)));
assert.deepEqual(rows.flatMap(r=>r.energy).reduce((a,v,i)=>(a[i%3]+=v,a),[0,0,0]),[4,2,6]);
assert.throws(()=>pointRegionPlan(dims,5),/height/);
console.log('hybrid point-region reference contracts passed');
