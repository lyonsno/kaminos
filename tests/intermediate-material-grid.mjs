// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as world from '../volume-world-smoke.mjs';
test('intermediate coverage does not grow or shrink when its field resolutions change',()=>{
 assert.equal(typeof world.intermediateSmokePlan,'function');
 const far=world.worldSmokePlan({extent:4});
 const a=world.intermediateSmokePlan(far,{flow:24,material:48,pressure:12,extent:1.5,fineHeightRatio:2});
 const b=world.intermediateSmokePlan(far,{flow:48,material:24,pressure:12,extent:1.5,fineHeightRatio:2});
 assert.deepEqual(a.min,b.min);assert.deepEqual(a.max,b.max);
 assert.deepEqual(a.flowDims,[24,40,24]);
 assert.deepEqual(a.materialDims,[48,80,48]);
 assert.deepEqual(a.pressureDims,[12,20,12]);
 assert.equal(a.extraMaterialCells,48*80*48);
 assert.equal(a.flowPitch,2*b.flowPitch);
 assert.equal(a.materialPitch,b.materialPitch/2);
 assert.equal(a.pressurePitch,b.pressurePitch);
 assert.ok(a.min.every((v,i)=>v>=far.min[i]));
 assert.ok(a.max.every((v,i)=>v<=far.max[i]));
 assert.throws(()=>world.intermediateSmokePlan(far,{extent:5}),/bounds/);
});
