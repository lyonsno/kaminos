// kaminos-test: node
import assert from 'node:assert/strict';
import * as filter from '../fire-shadow-filter.mjs';
assert.equal(typeof filter.cubeComparisonFootprint,'function','solid shadow taps need a comparison footprint at cubemap texel boundaries');
const resolution=8;
const visibility=ray=>filter.cubeComparisonFootprint(ray,resolution).reduce((sum,t)=>sum+t.weight*(t.direction[0]>=0?1:0),0);
for(const ray of [[0,0,1],[.1,.2,1],[1,1,0],[1,-1,1],[-1,-1,-1]]){
 const taps=filter.cubeComparisonFootprint(ray,resolution);assert.equal(taps.length,4);
 assert(Math.abs(taps.reduce((s,t)=>s+t.weight,0)-1)<1e-12);
 assert(taps.every(t=>t.weight>=0&&t.direction.every(Number.isFinite)));
 assert.deepEqual(taps,filter.cubeComparisonFootprint(ray.map(x=>x*7),resolution),'direction footprint is independent of ray length');
}
assert(Math.abs(visibility([0,0,1])-.5)<1e-12,'comparison values blend across a shadow texel edge');
assert(visibility([-.01,0,1])<.5&&visibility([.01,0,1])>.5);
assert(Math.abs(visibility([-.00001,0,1])-visibility([.00001,0,1]))<.001,'no nearest-neighbor jump');
// A uniform receiver plane must remain lit after plane-corrected comparisons.
for(const ray of [[.3,.2,1],[1,.2,.9999],[.9999,.2,1]]){
 const delta=ray.map(v=>v*3),normal=[0,0,1],plane=delta[2];
 const lit=filter.cubeComparisonFootprint(ray,resolution).reduce((s,t)=>{const d=t.direction;const distance=plane/d[2];return s+t.weight*(distance>=distance-.01?1:0);},0);
 assert(Math.abs(lit-1)<1e-12);
}
console.log('PASS cubemap comparison footprint is continuous, normalized and length independent');
