// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffFixture,validateHandoffEvidence} from '../experiments/material-hierarchy/world-fine-handoff.mjs';
import {depositWorldSources} from '../volume-world-sources.mjs';
// Analytical fixture for validator policy only; native runs supply GPU proof.
function reference(){
 const f=handoffFixture(),[nx,ny,nz]=f.plan.materialDims,p=f.plan.materialPitch;
 const supplied=depositWorldSources(f.sources.parcels,{dims:f.plan.materialDims,min:f.plan.min,pitch:p});
 const modes=['dense','adaptive-zero','adaptive-regrid','dense-adaptive-switch'];
 return {adapter:{vendor:'apple',fallback:false},errors:[],cases:modes.map((mode,i)=>({mode,frames:Array.from({length:i<2?5:7},(_,j)=>{
  const values=Array(nx*ny*nz*8).fill(0),heat=j<3?2:1;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const cellLo=[x,y,z].map((v,a)=>f.plan.min[a]+v*p),fineLo=[.05,-.2,.05],fineHi=[.45,.6,.45];
   const v=cellLo.reduce((v,l,a)=>v*Math.max(0,Math.min(l+p,fineHi[a])-Math.max(l,fineLo[a]))/p,1),k=(x+nx*(y+ny*z))*8;
   values[k]=v*.25;values[k+1]=v*heat+(j>=2?supplied[k+2]:0);values[k+2]=v*.125+(j>=2?supplied[k+1]:0);
  }
  const adaptive=i===3?(j===2||j===3):i!==0;
  return {values,receipt:{steps:j+1,materialLaw:'passive-authored',materialDims:f.plan.materialDims,
   fineToField:j>=(i<2?4:5)?[2,0,2,.2]:[.25,0,.25,.2],
   adaptiveMaterial:adaptive?{options:{budget:i===2&&j===3?.125:0},allocatedBricks:i===2&&j===3?144:128}:null}};
 })}))};
}
test('Fine handoff evidence rejects lost, duplicated, stale or spatially misplaced contributions',()=>{
 const valid=reference();assert.doesNotThrow(()=>validateHandoffEvidence(valid));
 const changes=[r=>{r.adapter.fallback=true;},r=>{delete r.errors;},r=>{r.errors.push('GPU error');},r=>{r.cases.pop();},
  r=>{r.cases[1]=structuredClone(r.cases[0]);},r=>{r.cases[0].frames.pop();},
  r=>{r.cases[2].frames[3].receipt.adaptiveMaterial.allocatedBricks=128;},
  r=>{r.cases[3].frames[2].receipt.adaptiveMaterial=null;},
  r=>{r.cases[0].frames[4].receipt.fineToField=[.25,0,.25,.2];},
  r=>{r.cases[0].frames[3].values=r.cases[0].frames[2].values.slice();},
  r=>{r.cases[0].frames[2].values=r.cases[0].frames[1].values.slice();},
  r=>{r.cases[0].frames[0].values=[];},r=>{r.cases[0].frames[0].values[0]=NaN;},
  r=>{r.cases[1].frames[0].values.fill(0);},
  r=>{r.cases[0].frames[1].values=r.cases[0].frames[1].values.map(v=>2*v);},
  r=>{for(const c of r.cases)for(const f of c.frames)f.values=[...f.values.slice(8),...f.values.slice(0,8)];},
 ];
 for(const change of changes){const r=structuredClone(valid);change(r);assert.throws(()=>validateHandoffEvidence(r),String(change));}
});
