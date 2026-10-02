import assert from 'node:assert/strict';
import {validatePackedDensityWitness} from '../tools/packed-density-witness-validation.mjs';
import {createPackedDensityLayout} from '../finger-fluid-packed-density.mjs';
const layout=createPackedDensityLayout(3,2);
function fixture(){
 const b={source:Buffer.alloc(192),linkedResult:Buffer.alloc(192),packedResult:Buffer.alloc(192),heads:Buffer.alloc(layout.headWords*4),records:Buffer.alloc(layout.particleWords*4)};
 for(let i=0;i<3;i++)for(let k=0;k<3;k++)b.source.writeFloatLE(i+k/10,i*64+32+k*4);
 b.source.copy(b.linkedResult);b.source.copy(b.packedResult);
 [2,1,0,2,2,1].forEach((v,i)=>b.heads.writeInt32LE(v,i*4));b.heads.writeInt32LE(3,layout.totalOffset*4);
 [-1,-1,0].forEach((v,i)=>b.records.writeInt32LE(v,i*4));
 [2,0,1].forEach((id,slot)=>{b.source.copy(b.records,(3+slot*4)*4,id*64+32,id*64+44);b.records.writeInt32LE(id,(3+slot*4+3)*4);});
 return {schema:'kaminos.packed-density-frozen-witness.v1',route:'same-native-grid-linked-vs-packed-lambda-delta-scratch-buffers',count:3,cells:2,packedLayout:layout,buffers:b};
}
assert.equal(validatePackedDensityWitness(fixture()).activeCount,3);
for(const [name,mutate] of [
 ['duplicate ID',x=>x.buffers.records.writeInt32LE(2,(3+4+3)*4)],
 ['wrong position',x=>x.buffers.records.writeFloatLE(77,3*4)],
 ['partial buffer',x=>x.buffers.source=Buffer.alloc(4)],
 ['overflow',x=>x.buffers.heads.writeInt32LE(1,layout.errorOffset*4)],
 ['missing active particle',x=>{x.buffers.heads.writeInt32LE(2,layout.totalOffset*4);x.buffers.heads.writeInt32LE(-1,4);x.buffers.heads.writeInt32LE(0,5*4);}],
 ['wrong density output',x=>x.buffers.packedResult.writeFloatLE(1,60)],
 ['wrong schema',x=>x.schema='fallback'],
]) {const x=fixture();mutate(x);assert.throws(()=>validatePackedDensityWitness(x),undefined,name);}
console.log('packed witness corruption contracts passed');
