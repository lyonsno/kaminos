// kaminos-test: node
import assert from 'node:assert/strict';
import {prepareCoarseFracture} from '../fracture-coarse-prepare.mjs';
const positions=Float32Array.from([-1,-.5,-.5,1,-.5,-.5,1,.5,-.5,-1,.5,-.5,-1,-.5,.5,1,-.5,.5,1,.5,.5,-1,.5,.5]);
const indices=Uint32Array.from([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
const uvs=Float32Array.from(Array.from({length:8},(_,i)=>[positions[i*3],positions[i*3+1]]).flat());
const source={positions,indices,uvs,faceMaterial:new Uint8Array(12)},faces=Array.from({length:12},(_,i)=>i),before=structuredClone(source);
const r=prepareCoarseFracture(source,faces,{normal:[1,0,0]});
assert.equal(r.pieces.length,2);assert.equal(r.rest.indices.length,0);
assert.ok(r.interface.area>.99&&r.interface.area<1.01,'The unit square section supplies cohesive area');
assert.ok(Math.abs(r.receipt.exteriorAreaAfter-r.receipt.exteriorAreaBefore)<1e-5,'Clipping preserves the detailed exterior area');
assert.deepEqual(source,before,'Preparation does not mutate imported geometry');
for(const [i,p]of r.pieces.entries()){
 assert.ok(p.capFaces>0,'Both fragments have a new interior');assert.ok(p.volume>0);
 assert.ok([...p.arrays.positions].every(Number.isFinite));assert.ok([...p.arrays.uvs].every(Number.isFinite));
 const a=p.arrays;
 for(let f=0;f<a.indices.length/3;f++)if(a.faceMaterial[f]===0)for(const id of a.indices.subarray(f*3,f*3+3)){
  assert.ok(Math.abs(a.uvs[id*2]-a.positions[id*3])<1e-6);assert.ok(Math.abs(a.uvs[id*2+1]-a.positions[id*3+1])<1e-6);
 }
 assert.equal(p.side,i===0?-1:1);
}
assert.throws(()=>prepareCoarseFracture(source,[0,0]),/unique/i);
assert.throws(()=>prepareCoarseFracture(source,faces,{normal:[0,0,0]}),/normal/i);
assert.throws(()=>prepareCoarseFracture(source,faces,{normal:[1,0,0],offset:3}),/intersect/i);
console.log('coarse fracture preserves source exterior, UVs and opposed closed sections');
