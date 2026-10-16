// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {coldFuse,stepFuse} from '../fuse-core.mjs';
test('cold fuse stays cold without a deliberate heat input',()=>{
  const cells=coldFuse(48);assert.deepEqual(stepFuse(cells,new Float32Array(48),1/60,.02),cells);
});
test('a finite end heat input produces a fuel-consuming front beyond the initially heated material',()=>{
  let cells=coldFuse(48);const input=new Float32Array(48);input.fill(4,0,3);
  let initiallyHeated=0;
  for(let step=0;step<1800;step++){
    if(step===90){initiallyHeated=Array.from({length:48},(_,i)=>cells[i*8]).findLastIndex(t=>t>.8);input.fill(0);}
    cells=stepFuse(cells,input,1/60,.02);
  }
  assert.ok(initiallyHeated<8,'ignition remains localized');
  const spent=Array.from({length:48},(_,i)=>1-cells[i*8+5]);
  assert.ok(spent[12]>.5,'material beyond the heat input must burn after input is off');
  assert.ok(spent[0]>.99,'the tail must exhaust finite fuel');
  assert.ok(cells.every(Number.isFinite));
});
