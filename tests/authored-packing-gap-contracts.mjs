import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {evaluateAuthoredPackingExactResidualState as evaluate} from '../authored-packing-sweep-core.mjs';

const root=new URL('../artifacts/packing-inequality-comparison-0915/raw-r2/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const problem=await read('problem.json');
const {startVector}=await read('provenance.json');

test('sub-tolerance contact retains its geometric sign instead of inventing clearance',()=>{
  const state=evaluate({problem,vector:startVector});
  const row=state.rows.find(r=>r.key==='bone:central-bone|muscle-2');
  assert.ok(row.maximumPenetration>0 && row.maximumPenetration<1e-9,
    'observed late-state fixture must exercise sub-tolerance penetration');
  assert.equal(state.metrics.skeletalPenetration,0,'admission tolerance remains unchanged');
  assert.equal(row.signedGap,-row.maximumPenetration,
    'raw geometric gap cannot become positive when penetration is admitted as negligible');
});

test('every penetrated row keeps negative raw gap at original and nearby states',()=>{
  for(const vector of [Array(startVector.length).fill(0),startVector.map((x,i)=>x+(i===3?1e-8:0)),startVector.map((x,i)=>x-(i===3?1e-8:0))]){
    const state=evaluate({problem,vector});
    for(const row of state.rows) if(row.maximumPenetration>0)
      assert.equal(row.signedGap,-row.maximumPenetration,`${row.key}: sign must not depend on admission`);
  }
});
