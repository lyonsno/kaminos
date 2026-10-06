import assert from 'node:assert/strict';
import {softenEmissionReference} from '../scene-source-softening.mjs';
export function assertSofteningGpuSignal(signal){
  assert.equal(signal.validation,null);assert.deepEqual(signal.errors,[]);assert.deepEqual(signal.losses,[]);
  assert.deepEqual(signal.rows.map(r=>r.name),['empty','plane','reversed']);
  for(const row of signal.rows){
    assert.deepEqual(row.dims,[8,16,8]);assert.equal(row.input.length,4096);
    assert.deepEqual(row.outputs.map(o=>[o.passes,o.scale]),[[0,1],[1,1],[8,1],[16,1],[4,2],[0,2]]);
    assert.equal(row.occupied.length,1024);
    assert.equal(row.metadata.staticPreparations,1);assert.equal(row.metadata.updates,4);
    row.occupied.forEach((v,i)=>assert.equal(v,row.name==='empty'?0:([3,4].includes(i%8)?1:0),'actual SAT occupancy'));
    for(const output of row.outputs){
      const input=Float32Array.from(row.input,(v,i)=>i%4===3?v:v*output.scale);
      const expected=softenEmissionReference(input,row.dims,row.occupied,output.passes);
      assert.equal(output.values.length,expected.length);
      output.values.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i])<2e-6,`${row.name} pass${output.passes} component${i}: ${v} vs ${expected[i]}`));
      if(output.passes===0)assert.equal(output.identity,true);
      if(row.name!=='empty')for(let i=0;i<1024;i++)if(i%8>=3)assert.equal(output.values[i*4],0,'wall blocks emission redistribution');
      for(let c=0;c<3;c++)assert.ok(Math.abs(output.values.reduce((s,v,i)=>s+(i%4===c?v:0),0)-[8,4,2][c]*output.scale)<1e-5);
      for(let i=0;i<1024;i++)assert.equal(output.values[i*4+3],row.input[i*4+3]);
    }
  }
}
