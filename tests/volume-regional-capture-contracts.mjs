// kaminos-test: node
import assert from 'node:assert/strict';
import {traceChunkPlan,validateTraceRows} from '../volume-optical-trace.mjs';

// Point queries evaluate the actual native material once at each requested
// position. A caller's camera subdivision count must not multiply that work.
const points=[{position:[0,0,0],direction:[0,0,1]},
  {position:[.25,.5,-.25],direction:[1,0,0]}];
const plan=traceChunkPlan({kind:'points',points,firstRay:0,rayCount:4,
  sampleOffset:0,sampleCount:9,subdivisions:8,width:2,height:2,maxBytes:8192});
assert.equal(plan.rowCount,points.length,
  'native point capture must allocate one row per requested position, not camera subdivisions');
assert.equal(plan.sampleCount,1);
assert.equal(plan.byteLength,points.length*32*4);
assert.throws(()=>traceChunkPlan({kind:'points',points:[{position:[0,NaN,0],direction:[0,0,1]}],
  width:2,height:2,maxBytes:4096}),/position/);
assert.throws(()=>traceChunkPlan({kind:'points',points:[{position:[0,0,0],direction:[0,0,0]}],
  width:2,height:2,maxBytes:4096}),/direction/);
const rows=new Float32Array(plan.rowCount*32);
for(let i=0;i<plan.rowCount;i++){rows[i*32]=i;rows[i*32+2]=1;rows[i*32+3]=1;rows[i*32+6]=1;}
assert.throws(()=>validateTraceRows(rows,plan,{requireRegional:true,effective:{
  route:'fallback',backend:'WebGPU:apple',simStepCount:151,
  regionalCapture:{scope:'fine-only',kind:'points',worldIncluded:false}}}),/native.*route/,
  'valid-looking coefficient rows from a fallback route are not native regional evidence');
console.log('native regional capture planning and evidence admission passed');
