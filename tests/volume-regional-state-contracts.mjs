// kaminos-test: node
import assert from 'node:assert/strict';
import {regionalQueryPlan,regionalDataset,integrateRegionalPredictions} from '../volume-regional-state.mjs';
const options={bounds:{lo:[-1,-1,-1],hi:[1,2,1]},tiles:[2,3,2],contextSide:3,queriesPerRegion:4,subdivisions:8,seed:42};
const plan=regionalQueryPlan(options);
assert.equal(plan.regions.length,12);
assert.equal(plan.pointCount,12*(27+4*9));
assert.deepEqual(regionalQueryPlan(options),plan);
for(const r of plan.regions)assert.ok(r.lo.every((v,i)=>v>=options.bounds.lo[i]&&r.hi[i]<=options.bounds.hi[i]));
const rows=new Float32Array(plan.pointCount*32);
for(let i=0;i<plan.pointCount;i++) {
  rows.set([i,0,1,1],i*32);rows.set(plan.points[i].position,i*32+8);
  rows[i*32+16]=.7;rows.set([2,-.3,0],i*32+17);rows.set([.2,.4,.1],i*32+20);
}
const data=regionalDataset(plan,rows);
assert.equal(data.context.length,12*27*7);
assert.equal(data.query.length,48*7);
assert.equal(data.sparse?.length,48*7,'the actual midpoint material observation must be an input, independent of its integrated baseline');
assert.equal(data.sparse[0],Math.fround(.7));
assert.equal(data.sparse[1],2);
assert.equal(data.opticalDepth.length,48);
for(const s of plan.segments){const t=data.target.subarray(s.id*7,s.id*7+7);assert.ok(Math.abs(t[6]-Math.exp(-.7*s.length))<1e-7);assert.ok(t[1]<0);}
assert.ok(data.reference.maxNestedDifference<1e-6);
assert.ok(data.reference.maxOrderingDifference<1e-6,'constant field is invariant to ray reversal');
const changed=rows.slice();changed[8]=NaN;
assert.throws(()=>regionalDataset(plan,changed),/nonfinite/);
assert.throws(()=>regionalDataset(plan,rows.subarray(32)),/partial/);
assert.throws(()=>regionalQueryPlan({...options,subdivisions:7}),/even/);
integrateRegionalPredictions([[1,2,3,.1,.2,.3,.5],[4,6,8,.4,.6,.8,.25]])
  .forEach((v,i)=>assert.ok(Math.abs(v-[3.3,5.5,7.7,.125][i])<1e-12));
console.log('regional source/query association, ordering, signed source and complete population passed');
