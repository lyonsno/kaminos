// kaminos-test: node
import assert from 'node:assert/strict';
import {traceChunkPlan,validateTraceRows,REGIONAL_CAPTURE_IDENTITY} from '../volume-optical-trace.mjs';

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
assert.throws(()=>traceChunkPlan({kind:'points',points:[{position:[2,0,0],direction:[0,0,1]}],
  bounds:{lo:[-1,-1,-1],hi:[1,2,1]},width:2,height:2,maxBytes:4096}),/domain/,
  'native point requests must respect the declared Fine-domain bounds before GPU allocation');
const rows=new Float32Array(plan.rowCount*32);
for(let i=0;i<plan.rowCount;i++){rows[i*32]=i;rows[i*32+2]=1;rows[i*32+3]=1;rows[i*32+6]=1;}
assert.throws(()=>validateTraceRows(rows,plan,{requireRegional:true,effective:{
  route:'fallback',backend:'WebGPU:apple',simStepCount:151,
  regionalCapture:{scope:'fine-only',kind:'points',worldIncluded:false}}}),/native.*route/,
  'valid-looking coefficient rows from a fallback route are not native regional evidence');
const effective={route:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:apple',simStepCount:151,
  uniforms:[0,1],controls:{displayReconstruction:'material'},regionalCapture:{identity:REGIONAL_CAPTURE_IDENTITY,
    scope:'fine-domain',kind:'points',worldTraversalIncluded:false,worldCollarIncluded:true,
    materialPreparation:{effective:true,mode:'material',scale:4},coefficientSource:'native-material-before-trace-support-mask'}};
assert.equal(validateTraceRows(rows,plan,{requireRegional:true,effective}).validRows,2);
assert.throws(()=>validateTraceRows(rows,plan,{requireRegional:true,effective,expectedStep:152}),/state/);
assert.throws(()=>validateTraceRows(rows,plan,{requireRegional:true,effective:{...effective,
  regionalCapture:{...effective.regionalCapture,scope:'fine-only',worldIncluded:false}}}),/identity/);
assert.throws(()=>validateTraceRows(rows,plan,{requireRegional:true,effective:{...effective,
  regionalCapture:{...effective.regionalCapture,materialPreparation:undefined}}}),/identity/);
console.log('native regional capture planning and evidence admission passed');
