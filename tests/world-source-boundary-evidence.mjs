// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryFixture,validateBoundaryEvidence} from '../experiments/material-hierarchy/world-sources.mjs';
import {depositWorldSources} from '../volume-world-sources.mjs';
function reference(){
 const f=boundaryFixture(),supply=depositWorldSources(f.sources.parcels,{dims:f.plan.materialDims,min:f.plan.min,pitch:f.plan.materialPitch});
 const values=Array(supply.length).fill(0);
 for(let i=0;i<values.length;i+=8){values[i+1]=supply[i+2];values[i+2]=supply[i+1];}
 return {adapter:{vendor:'apple',fallback:false},errors:[],fineSupply:f.fineSupply,parcels:f.sources.parcels.length,
  cases:['dense','adaptive-zero'].map(mode=>({mode,frames:[values.slice(),values.slice()],
   receipt:{steps:2,materialLaw:'passive-authored',materialDims:f.plan.materialDims,
    adaptiveMaterial:mode==='dense'?null:{options:{budget:0}}}}))};
}
test('boundary witness requires the disputed raw source supply before and after removal on both routes',()=>{
 const valid=reference();assert.doesNotThrow(()=>validateBoundaryEvidence(valid));
 const mutations=[
  r=>{r.adapter.fallback=true;},r=>{r.adapter.vendor='swiftshader';},
  r=>{r.errors.push('validation');},r=>{delete r.errors;},
  r=>{r.cases.pop();},r=>{r.cases[1]=structuredClone(r.cases[0]);},
  r=>{r.cases[1].receipt.adaptiveMaterial=null;},
  r=>{r.cases[1].receipt.adaptiveMaterial.options.budget=1;},
  r=>{r.cases[0].receipt.materialDims=[8,16,8];},
  r=>{r.cases[0].receipt.steps=1;},r=>{r.cases[0].frames.pop();},
  r=>{r.cases[0].frames[0]=[];},r=>{r.cases[0].frames[0][0]=NaN;},
  r=>{r.cases[0].frames[0].fill(0);},r=>{r.cases[1].frames[1].fill(0);},
  r=>{r.cases[1].frames[0]=r.cases[1].frames[0].map(v=>v*2);},
 ];
 for(const mutate of mutations){const raw=structuredClone(valid);mutate(raw);assert.throws(()=>validateBoundaryEvidence(raw),String(mutate));}
});
