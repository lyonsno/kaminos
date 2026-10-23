import assert from 'node:assert/strict';
export function validatePressureWitness(raw) {
 assert.deepEqual(raw.errors,[]);
 assert.match(raw.adapter.vendor,/apple/i);
 assert.equal(raw.cases.length,3,'All requested native cases must return');
 for(const [i,c] of raw.cases.entries()){
  const n=[8,4,2][i];
  assert.deepEqual(c.plan.flowDims,[8,16,8]);assert.deepEqual(c.plan.pressureDims,[n,2*n,n]);
  assert.equal(c.plan.flowCells,1024);assert.equal(c.plan.pressureCells,2*n**3);
  assert.deepEqual(c.receipt.flowDims,c.plan.flowDims);assert.deepEqual(c.receipt.pressureDims,c.plan.pressureDims);
  assert.equal(c.receipt.steps,1);assert.equal(c.receipt.pressureIterations,12);
  const arrays={input:c.input,...c.arrays};
  for(const [name,length] of Object.entries({input:4096,'world smoke flow 0':4096,'world smoke flow 1':4096,'world smoke pressure 0':2*n**3,'world smoke pressure 1':2*n**3,'world smoke pressure rhs and occupancy':4*n**3})){
   const a=arrays[name];assert.equal(a?.length,length,`Complete ${name}`);
   assert.ok(a.every(Number.isFinite),`Finite ${name}`);
   assert.ok(a.some(v=>Math.abs(v)>1e-6),`Seeded signal present in ${name}`);
  }
 }
}
