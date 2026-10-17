// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldSmokePlan, worldSmokeMapping } from '../volume-world-smoke.mjs';
test('world field separates material cells from flow and pressure cells',()=>{
  const p=worldSmokePlan({flow:16,material:32,extent:3});
  assert.deepEqual(p.flowDims,[16,32,16]);assert.deepEqual(p.materialDims,[32,64,32]);
  assert.equal(p.materialCells/p.flowCells,8);assert.equal(p.flowPitch,2*p.materialPitch);
  assert.equal(p.fineFeedback,false);
});
test('world storage stays anchored when the fine domain moves',()=>{
  const p=worldSmokePlan({flow:16,material:32,extent:3});
  const anchor={translate:[10,20,30],scale:2},fine={translate:[14,18,30],scale:1};
  const m=worldSmokeMapping(p,anchor,fine);
  assert.deepEqual(m.fineToField,[2,-1,0,.5]);
  assert.deepEqual(m.renderMin,[-10,-4,-6]);assert.deepEqual(m.renderMax,[2,20,6]);
});
test('invalid requested resolution fails rather than silently using another field',()=>{
  for(const options of [{flow:0},{material:3.5},{extent:1},{flow:32,material:16}])assert.throws(()=>worldSmokePlan(options));
});
test('every admitted fine height has exterior storage beyond its outlet',()=>{
  for(const ratio of [1,1.5,2,3,4])for(const extent of [2,3,4,6]){
    const p=worldSmokePlan({flow:16,material:32,extent,fineHeightRatio:ratio});
    assert.ok(p.max[1]>=2*ratio-1+extent, `ratio ${ratio}, extent ${extent}`);
    assert.equal(p.flowDims[1]*p.flowPitch,p.max[1]-p.min[1]);
    assert.equal(p.materialDims[1]*p.materialPitch,p.max[1]-p.min[1]);
  }
});
