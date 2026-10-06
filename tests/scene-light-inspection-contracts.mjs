import assert from 'node:assert/strict';
import {progressiveSourcePoint,sourceRaySample,integrateCellRay} from '../scene-source-aware.mjs';
import {inspectSourceRays,validateInspectionSnapshot} from '../scene-light-inspection.mjs';
const n=12,p=[0,0,0],normal=[0,1,0],front=[0,0,0],back=[0,0,0];
for(let a=0;a<n;a++){const s=sourceRaySample(p,a),cos=s.direction[1],value=integrateCellRay(()=>[1,1,1,0],[1,1,1],p,s.direction);for(let c=0;c<3;c++)(cos<0?back:front)[c]+=value[c]*Math.abs(cos)/(n*s.pdf);}
const input={directions:n,generation:3,points:Array.from({length:n},(_,i)=>progressiveSourcePoint(i)),rows:[{id:0,position:p,normal,twoSided:true,firstHits:Array(n).fill(1e20),front,back}]};
const field={dimensions:[1,1,1],data:[1,1,1,0]},metadata={directions:n,generation:3,angularPattern:'source',samplingLaw:'progressive-volume-induced-solid-angle-v1',surfaceGainFactor:1};
const result=inspectSourceRays({inputs:input,field,metadata});assert.equal(result.status,'matched');assert.equal(result.rows[0].rays.length,n);
assert.throws(()=>inspectSourceRays({inputs:input,field,metadata:{...metadata,surfaceGainFactor:undefined}}),/finite.*gain/);
assert.equal(inspectSourceRays({inputs:input,field,metadata:{...metadata,surfaceReconstruction:{passes:4}}}).status,'reconstructed','filtered receiver output is not direct-ray parity evidence');
const snapshot={status:'captured',metadata,sourceGeneration:3,inputs:input};validateInspectionSnapshot(snapshot);
for(const mutate of [s=>s.sourceGeneration=2,s=>s.inputs.generation=1,s=>s.status='failed',s=>s.inputs.rows[0].front[0]=NaN]){const s=structuredClone(snapshot);mutate(s);assert.throws(()=>validateInspectionSnapshot(s));}
const invalid=structuredClone(input);invalid.rows[0].firstHits[0]=0;assert.throws(()=>inspectSourceRays({inputs:invalid,field,metadata}),/unwritten/);
assert.equal(inspectSourceRays({inputs:input,field,metadata:{...metadata,angularPattern:'fixed'}}).status,'unsupported','unsupported replay cannot impersonate source-aware math');
assert.throws(()=>inspectSourceRays({inputs:input,field:{dimensions:[1,1,1],data:[]},metadata}),/complete finite/);
console.log('inspection rejects partial/mixed/unwritten inputs and reports explicit replay capability');
