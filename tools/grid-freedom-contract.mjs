import assert from 'node:assert/strict';
import {restrictPressureReference} from '../volume-pressure-resolution.mjs';
export function validateGridTransferSignal(signal,{scenarios=['affine','open-lower-solid']}={}){
 assert.equal(signal.adapter?.vendor,'apple','native Apple adapter required');assert.equal(signal.validation,null);assert.deepEqual(signal.errors,[]);
 const required=scenarios.flatMap(s=>(s==='affine'?[6,7,12,15]:[15]).flatMap(t=>['velocity','pressure'].map(k=>[s,k,t].join(':'))));
 assert.deepEqual(signal.rows.map(r=>[r.scenario??'affine',r.kind,r.target].join(':')).sort(),required.sort(),'complete unique producer cases required');
 const rows=[];
 for(const row of signal.rows){
  assert.deepEqual(row.dims,[12,24,12]);assert.equal(row.input.length,12*24*12*16);assert.equal(row.prolonged.length,row.input.length);
  const expected=restrictPressureReference({dims:row.dims,divisor:12/row.target,fluid:row.input,expansion:row.expansion,solids:row.solids,lower:row.scenario==='open-lower-solid'?(_p,a)=>a+1:undefined});
  assert.equal(row.restricted.length,expected.fluid.length);let maxError=0;
  row.restricted.forEach((v,i)=>{assert.ok(Number.isFinite(v));maxError=Math.max(maxError,Math.abs(v-expected.fluid[i]));assert.ok(Math.abs(v-expected.fluid[i])<4e-5,row.kind+'/'+row.target+' restriction '+i+': '+v+' != '+expected.fluid[i]);});
  row.prolonged.forEach((v,i)=>{assert.ok(Number.isFinite(v));if(i%16>=3)assert.equal(v,row.input[i],'material survives velocity/pressure transfer');});
  rows.push({kind:row.kind,target:row.target,scenario:row.scenario??'affine',maxError});
 }
 assert.deepEqual(signal.outer.map(r=>r.pressure).sort((a,b)=>a-b),[5,8,11],'all outer solver cases required');
 for(const row of signal.outer){assert.ok(row.values.length>0&&row.values.every(Number.isFinite));assert.ok(row.values.some(v=>v>0),'outer solver must produce actual outflow');}
 return rows;
}
