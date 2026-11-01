// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceSurfelRows} from '../surfel-field-reduction.mjs';
const row=(x,alpha=1,nz=1)=>[x,0,0,0,0,nz,.2,.4,.6,.1,.3,alpha];
const meta={stride:12,count:4,gridSize:512,radius:.8/512};
test('spatial reduction averages all material channels without merging opaque/glass or opposing walls',()=>{
 const data=new Float32Array([...row(.0001,.2),...row(.0002,.4),...row(.0003,1),...row(.0004,.2,-1)]);
 const before=data.slice(),r=reduceSurfelRows(data,meta,4);
 assert.equal(r.meta.count,3);assert.equal(r.meta.sourceCount,4);assert.equal(r.meta.radius,meta.radius*4);
 assert.deepEqual(data,before);assert.deepEqual([...r.parent],[0,0,1,2]);
 assert.ok(Math.abs(r.data[11]-.3)<1e-6);
 assert.equal(r.data[23],1);assert.equal(r.data[29],-1);
 for(let k=6;k<11;k++)assert.ok(Math.abs(r.data[k]-data[k])<1e-6);
 assert.deepEqual(r.meta.reduction,{factor:4,normalCosine:.75,opacityCutoff:.98});
});
test('original tier is exact and invalid reduction cannot silently substitute another tier',()=>{
 const data=new Float32Array(row(0));
 const r=reduceSurfelRows(data,{...meta,count:1},1);
 assert.deepEqual(r.data,data);assert.notEqual(r.data,data);assert.equal(r.meta.count,1);
 for(const factor of [0,1.5,NaN])assert.throws(()=>reduceSurfelRows(data,{...meta,count:1},factor));
 assert.throws(()=>reduceSurfelRows(data,meta,2));
});
