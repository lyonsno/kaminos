// kaminos-test: node
import assert from 'node:assert/strict';
import * as optical from '../volume-optical-trace.mjs';
assert.equal(typeof optical.compareOpticalTraces,'function');
const plan=optical.traceChunkPlan({firstRay:0,rayCount:1,sampleOffset:0,sampleCount:3,subdivisions:2,width:1,height:1,maxBytes:384});
const a=new Float32Array(96);
for(let s=0;s<3;s++)a.set([0,s,1,1,s/2,0,1,.1,0,0,0,.5,0,0,1,.04,1,1,-.002,2,0,0,0,0,0,1,.1,0,.5,.5,.5,1],s*32);
assert.equal(optical.compareOpticalTraces(a,a,plan).ok,true);
const miss=a.slice();for(let s=0;s<3;s++)miss[s*32+2]=0;
assert.equal(optical.compareOpticalTraces(miss,miss,plan).comparedRays,0);
const zero=a.slice();for(let s=0;s<3;s++){zero[s*32+4]=0;zero[s*32+6]=0;}
assert.equal(optical.compareOpticalTraces(zero,zero,plan).comparedRays,1);
for(const hits of [[0,1,1],[1,0,0]]) {
  const mixed=a.slice();hits.forEach((hit,s)=>{mixed[s*32+2]=hit;});
  assert.throws(()=>optical.validateTraceRows(mixed,plan),/mixed hit\/miss/);
  assert.throws(()=>optical.compareOpticalTraces(mixed,mixed,plan),/mixed hit\/miss/);
  assert.throws(()=>optical.compareOpticalTraces(a,mixed,plan),/mixed hit\/miss/);
}
const small=a.slice();small[17]+=1e-7;small[29]+=4e-6;
assert.equal(optical.compareOpticalTraces(a,small,plan).ok,true);
for(const field of [0,1,2,3,4,5,6,7,8,11,12,15,23,24,25,27,31]) {
  const b=a.slice();b[field]+=field<4?1:1e-5;
  try {assert.equal(optical.compareOpticalTraces(a,b,plan).ok,false,`strict field ${field}`);}
  catch(error){if(error.code==='ERR_ASSERTION')throw error;}
}
for(const field of [16,17,18,19,20,21,22,26,28,29,30]) {
  const b=a.slice();b[field]+=.01;
  assert.equal(optical.compareOpticalTraces(a,b,plan).ok,false,`numerical field ${field}`);
}
const nonfinite=a.slice();nonfinite[17]=NaN;
assert.throws(()=>optical.compareOpticalTraces(a,nonfinite,plan),/nonfinite/);
const bright=a.slice(),shifted=a.slice();
for(let s=0;s<3;s++){bright[s*32+17]=100;shifted[s*32+17]=100.0002;}
const accumulated=optical.compareOpticalTraces(bright,shifted,plan);
assert.equal(accumulated.fields[17].violations,0);
assert.ok(accumulated.transferViolations>0,'small relative source errors must not hide large integrated errors');
assert.equal(accumulated.ok,false);
assert.throws(()=>optical.compareOpticalTraces(a,a.slice(32),plan),/partial/);
assert.throws(()=>optical.compareOpticalTraces(a,a,{...plan,sampleOffset:1,subdivisions:3}),/complete rays/);
console.log('optical agreement tolerates numerical variation and rejects structural/material drift');
