// kaminos-test: node
import assert from 'node:assert/strict';
import { fineGridPlan } from '../volume-fine-grid.mjs';
const p=fineGridPlan({materialDims:[64,128,64],velocity:32,pressure:16});
assert.deepEqual(p.velocityDims,[32,64,32]);
assert.deepEqual(p.pressureDims,[16,32,16]);
assert.equal(p.materialPerVelocity,2);
assert.equal(p.velocityPerPressure,2);
assert.deepEqual(fineGridPlan({materialDims:[32,32,32],velocity:0,pressure:0}).velocityDims,[32,32,32]);
assert.throws(()=>fineGridPlan({materialDims:[64,128,64],velocity:24,pressure:12}),/integral/);
assert.throws(()=>fineGridPlan({materialDims:[64,128,64],velocity:32,pressure:64}),/pressure/i);

assert.throws(()=>fineGridPlan({materialDims:[32,64,32],velocity:NaN}),/velocity/i);
assert.throws(()=>fineGridPlan({materialDims:[32,64,32],pressure:NaN}),/pressure/i);
