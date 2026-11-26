// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mixingContactCell} from '../earth-gpu/mixing-recipe.mjs';
import {makeRegionState, regionSummary, retainRegionState} from '../earth-gpu/regions.mjs';

const specimen=()=>makeRegionState({compaction:true,mixing:true,samplesPerRegion:1152,gritCount:272});

test('one physical bed supports three independently dosed mobile ingredients', () => {
  const s=specimen();
  assert.equal(s.regionCount,1);
  assert.deepEqual(s.ingredients.map(({id,count})=>[id,count]),[
    ['gravel',48],['sand',224],['crumb',960],['bed',1152],
  ]);
  assert.equal(s.attachments.length,1152);
  assert.equal(s.attachments[0].body,s.mobileCount);
  assert.equal(s.mobileCount,1232);
  assert.ok(s.material.tets.every(tet=>tet.packing===1));
  const actualMass=Array.from({length:s.floats.length/24},(_,i)=>s.massScale/s.floats[i*24+3]).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(s.ingredients.reduce((sum,item)=>sum+item.mass,0)-actualMass)<1e-9);
  assert.ok(regionSummary(s).matrixMass>0);
  assert.ok(s.ingredients.find(({id})=>id==='crumb').mass>actualMass*.10);
  const radii=id=>{
    const {start,count}=s.ingredients.find(item=>item.id===id);
    return Array.from({length:count},(_,i)=>s.floats[(start+i)*24+11]);
  };
  assert.ok(Math.min(...radii('gravel'))>Math.max(...radii('sand')));
  assert.ok(Math.min(...radii('crumb'))>Math.max(...radii('sand')));
});

test('loose crumb identity and mass survive capture with attachment ancestry reserved for the bed', () => {
  const s=specimen();
  assert.equal(s.packetTets.length,s.sampleCount+s.crumbCount);
  assert.ok(s.packetTets.slice(0,s.crumbCount).every(id=>id===0xffffffff));
  assert.ok(s.packetTets.slice(s.crumbCount).every(id=>id<s.material.tets.length));
  const retained=retainRegionState(s,s.floats.slice(),s.tets,s.linkWords);
  assert.deepEqual(retained.ingredients,s.ingredients);
  assert.deepEqual(retained.floats,s.floats);
  assert.deepEqual(specimen().floats,s.floats);
});

test('the mixing contact grid covers both lobes of every live ingredient', () => {
  const s=specimen();
  const cell=mixingContactCell(s.floats,s.grainCount);
  let maximum=0;
  for(let i=0;i<s.grainCount;i++){
    const base=i*24;
    maximum=Math.max(maximum,Math.abs(s.floats[base+16])+s.floats[base+11],
      Math.abs(s.floats[base+17])+s.floats[base+15]);
  }
  assert.ok(cell>=maximum*2);
  assert.ok(cell<s.radius*4.2);
});
