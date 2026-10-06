import assert from 'node:assert/strict';
import {softenEmissionReference} from '../scene-source-softening.mjs';
import {assertSofteningGpuSignal} from './scene-source-softening-gpu-evidence.mjs';
// Synthetic signal tests validator policy only; native execution evidence is separate.
const signal={validation:null,errors:[],losses:[],rows:['empty','plane','reversed'].map(name=>{
  const dims=[8,16,8],occupied=Array.from({length:1024},(_,i)=>name==='empty'?0:Number([3,4].includes(i%8)));
  const input=Array.from({length:4096},(_,i)=>i%4===3?Math.floor(i/4)/1024:0);
  input.splice((2+8*(8+16*4))*4,3,8,4,2);
  return {name,dims,occupied,input,metadata:{staticPreparations:1,updates:4},outputs:[[0,1],[1,1],[8,1],[16,1],[4,2],[0,2]].map(([passes,scale])=>({passes,scale,identity:passes===0,values:Array.from(softenEmissionReference(Float32Array.from(input,(v,i)=>i%4===3?v:v*scale),dims,occupied,passes))}))};})};
assertSofteningGpuSignal(signal);
for(const mutate of [s=>s.rows=[],s=>s.rows.pop(),s=>s.rows[1].name='empty',s=>s.rows[0].outputs.pop(),s=>s.rows[0].occupied=[],s=>s.rows[0].input=[],s=>s.rows[0].outputs[0].values=[],s=>s.rows[0].outputs[0].values[0]=NaN,s=>s.rows[0].outputs[1].passes=0]){
  const bad=structuredClone(signal);mutate(bad);assert.throws(()=>assertSofteningGpuSignal(bad));
}
console.log('GPU evidence rejects absent, partial, substituted and malformed numerical results');
