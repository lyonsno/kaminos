import assert from 'node:assert/strict';
import {createPackedDensityLayout} from '../finger-fluid-packed-density.mjs';
// Validate retained native bytes; synthetic fixtures test this validator only.
export function validatePackedDensityWitness(capture) {
 assert.equal(capture.schema,'kaminos.packed-density-frozen-witness.v1');
 assert.equal(capture.route,'same-native-grid-linked-vs-packed-lambda-delta-scratch-buffers');
 const {count:n,cells:c}=capture, layout=createPackedDensityLayout(n,c);
 assert.deepEqual(capture.packedLayout,layout);
 const b={};
 for(const [name,size] of Object.entries({source:n*64,linkedResult:n*64,packedResult:n*64,heads:layout.headWords*4,records:layout.particleWords*4})){
  const raw=capture.buffers?.[name];assert.ok(typeof raw==='string'||Buffer.isBuffer(raw),'missing '+name);
  b[name]=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'base64');assert.equal(b[name].length,size,'partial '+name);
 }
 const head=i=>b.heads.readInt32LE(i*4),record=i=>b.records.readInt32LE(i*4);
 assert.equal(head(layout.errorOffset),0,'packing overflow');
 const seen=new Set();let slot=0,maxCellCount=0;
 for(let cell=0;cell<c;cell++){
  assert.equal(head(c+cell),slot,'noncontiguous cell start');let id=head(cell),local=0;
  while(id>=0){
   assert.ok(id<n&&!seen.has(id),'invalid or duplicate linked ID');seen.add(id);
   assert.ok(b.source.readFloatLE(id*64+44)>=0,'inactive linked ID');
   assert.ok(slot<n,'packed capacity overflow');const w=n+slot*4;
   assert.equal(record(w+3),id,'packed chain order/ID mismatch');
   assert.ok(b.records.subarray(w*4,w*4+12).equals(b.source.subarray(id*64+16,id*64+28)),'packed xyz mismatch');
   id=record(id);slot++;local++;
  }
  assert.equal(id,-1,'invalid chain terminator');assert.equal(head(2*c+cell),local,'cell count');maxCellCount=Math.max(maxCellCount,local);
 }
 assert.equal(head(layout.totalOffset),slot,'total count');
 for(let id=0;id<n;id++)assert.equal(seen.has(id),b.source.readFloatLE(id*64+44)>=0,'active ID completeness');
 let maxAbsoluteDifference=0;
 // xyz, velocity, lambda, density and correction all remain canonical-ID keyed.
 for(const id of seen)for(let word=0;word<16;word++){
  const offset=id*64+word*4,a=b.linkedResult.readFloatLE(offset),z=b.packedResult.readFloatLE(offset);
  assert.ok(Number.isFinite(a)&&Number.isFinite(z),'nonfinite density result');maxAbsoluteDifference=Math.max(maxAbsoluteDifference,Math.abs(a-z));
  assert.equal(b.linkedResult.readUInt32LE(offset),b.packedResult.readUInt32LE(offset),`density result bit mismatch particle ${id} word ${word}`);
 }
 return {activeCount:slot,maxCellCount,maxAbsoluteDifference,identityAndOrder:'exact',activeParticleResults:'bit-identical'};
}
