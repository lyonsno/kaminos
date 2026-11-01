// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fineGridPlan} from '../volume-fine-grid.mjs';
import {pressureResolutionPlan} from '../volume-pressure-resolution.mjs';
import {worldSmokePlan,intermediateSmokePlan} from '../volume-world-smoke.mjs';

test('independent widths cover an integer neighborhood in either resolution order',()=>{
 for(let velocity=2;velocity<=32;velocity++)for(let pressure=2;pressure<=32;pressure++){
  const p=fineGridPlan({materialDims:[32,64,32],velocity,pressure});
  assert.deepEqual(p.velocityDims,[velocity,2*velocity,velocity]);
  assert.deepEqual(p.pressureDims,[pressure,2*pressure,pressure]);
  const q=pressureResolutionPlan({dims:p.velocityDims,width:pressure});
  assert.equal(q.reason,null);assert.deepEqual(q.pressureDims,p.pressureDims);
  const w=worldSmokePlan({flow:velocity,pressure,material:17,extent:4});
  assert.deepEqual(w.pressureDims,[pressure,2*pressure,pressure]);
  const m=intermediateSmokePlan(w,{flow:velocity,pressure,material:17,extent:2,fineHeightRatio:1});
  assert.deepEqual(m.pressureDims,[pressure,pressure,pressure]);
 }
});
test('shape refusal describes physical tiling rather than imposing divisor choices',()=>{
 assert.throws(()=>fineGridPlan({materialDims:[32,48,32],velocity:7,pressure:4}),/height|cubic|tile/i);
 for(const value of [0.5,-1,NaN,Infinity])assert.throws(()=>fineGridPlan({materialDims:[32,64,32],velocity:value}),/velocity/i);
});

import {cellOverlaps,transferWork} from '../volume-grid-transfer.mjs';
import {restrictPressureReference} from '../volume-pressure-resolution.mjs';
test('all overlap weights conserve constants and total cell volume across a natural width range',()=>{
 for(let source=2;source<=40;source++)for(let target=2;target<=40;target++){
  const coverage=new Float64Array(source);let visits=0;
  for(let c=0;c<target;c++){const row=cellOverlaps(source,target,c);assert.ok(row.length);let sum=0;for(const {index,weight} of row){assert.ok(index>=0&&index<source&&weight>0);sum+=weight;coverage[index]+=weight*source/target;visits++;}assert.ok(Math.abs(sum-1)<1e-12);}
  for(const w of coverage)assert.ok(Math.abs(w-1)<1e-12,'source volume neither lost nor duplicated');
  const work=transferWork([source,source,source],[target,target,target]);assert.equal(work.volumeSamples,visits**3);assert.ok(work.samplesPerLargerGrid<8);
 }
});
test('noninteger and finer pressure maps preserve affine face flux, uniform expansion and material',()=>{
 const dims=[12,24,12],count=dims.reduce((a,b)=>a*b),fluid=new Float32Array(count*16),expansion=new Float32Array(count).fill(.25);
 for(let z=0;z<12;z++)for(let y=0;y<24;y++)for(let x=0;x<12;x++){const i=x+12*(y+24*z);fluid.set([.125*(x+1),.25*(y+1),.5*(z+1),0],i*16);for(let k=4;k<16;k++)fluid[i*16+k]=k;}
 for(const width of [3,5,7,11,13,16,19]){
  const p=restrictPressureReference({dims,divisor:12/width,fluid,expansion});
  for(let z=0;z<width;z++)for(let y=0;y<2*width;y++)for(let x=0;x<width;x++){
   const i=x+width*(y+2*width*z);for(const [a,c] of [x,y,z].entries())assert.ok(Math.abs(p.fluid[i*16+a]-[.125,.25,.5][a]*(c+1))<2e-5);
   assert.ok(Math.abs(p.expansion[i]-.25)<1e-6);for(let k=4;k<16;k++)assert.ok(Math.abs(p.fluid[i*16+k]-k)<2e-5);
  }
 }
});

import {gridTuningPlan} from '../volume-grid-tuning.mjs';
test('material widths need no workgroup divisibility; derived lighting heights still fit',()=>{
 for(const resolution of [17,29,37,55,66]){
  const p=gridTuningPlan({resolution,gridHeightRatio:2,fineVelocity:13,finePressure:7,pressureSolver:'converged-open-top',pressureSolverIterations:12});
  assert.deepEqual(p.fine.materialDims,[resolution,2*resolution,resolution]);
 }
});
