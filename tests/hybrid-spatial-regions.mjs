// kaminos-test: node
import assert from 'node:assert/strict';
import {reducePointRegionsReference} from '../scene-point-regions.mjs';
const dims=[8,8,8];
function field(cells){const a=new Float32Array(8**3*4);for(const [x,y,z,r,g,b] of cells)a.set([r,g,b,0],4*(x+8*(y+8*z)));return a;}
for(const axis of [0,1,2]){
 const a=[3,3,3],b=[3,3,3];a[axis]=1;b[axis]=6;
 const rows=reducePointRegionsReference(field([[...a,4,0,0],[...b,0,0,4]]),dims,2,1,'spatial');
 assert.equal(rows.length,2);
 for(let i=0;i<2;i++)assert(Math.abs(rows[i].position[axis]-(-1+([1,6][i]+.5)/4))<1e-12,'separated emission must retain two locations along every axis');
 assert.deepEqual(rows.map(r=>r.energy),[[.0625,0,0],[0,0,.0625]],'do not merge two colors or duplicate their power');
}
const cells=[[1,1,1,4,1,0],[1,6,1,3,0,1],[6,1,6,0,2,4],[6,6,6,1,4,3]];
for(const count of [1,2,3,4,5,9]){
 const rows=reducePointRegionsReference(field(cells),dims,count,2,'spatial');
 const sum=rows.reduce((a,r)=>a.map((v,i)=>v+r.energy[i]),[0,0,0]);
 for(let c=0;c<3;c++)assert(Math.abs(sum[c]-cells.reduce((s,v)=>s+v[3+c],0)*2/64)<1e-12);
 assert(rows.every(r=>[...r.position,...r.energy,r.radiusSquared].every(Number.isFinite)&&r.radiusSquared>=1/64));
}
const four=reducePointRegionsReference(field(cells),dims,4,1,'spatial');
assert(four.every(r=>r.radiusSquared===1/64),'four separated sources each retain their own cell footprint');
const dark=reducePointRegionsReference(field([]),dims,4,1,'spatial');
assert(dark.every(r=>r.energy.every(v=>v===0)&&r.position.every(Number.isFinite)));
console.log('PASS spatial light reduction: all axes, disconnected sources, conserved RGB, finite dark field');
