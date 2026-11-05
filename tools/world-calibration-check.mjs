import assert from 'node:assert/strict';
export function checkCalibrationState(s,expected,baseline){
 assert.match(s.backend,/^webgpu:apple/i);assert.equal(s.active,true);assert.ok(!s.error,s.error);
 assert.ok(Number.isFinite(s.step)&&s.step>0,'simulation must have advanced');
 assert.ok(baseline,'a same-arm baseline is required');
 for(const [label,before,after] of [['Fine',baseline.step,s.step],['World',baseline.worldSteps,s.worldSteps],['adaptive material',baseline.adaptive?.steps,s.adaptive?.steps]]){
  assert.ok(Number.isFinite(before)&&Number.isFinite(after)&&after>before,`${label} must advance within the arm`);
 }
 assert.equal(s.calibration?.enabled,true);assert.equal(s.calibration.width,expected.width);
 assert.equal(s.calibration.materialCells,expected.materialCells);assert.equal(s.calibration.velocityCells,expected.velocityCells);
 assert.deepEqual(s.dims,expected.dims);assert.deepEqual(s.velocityDims,expected.velocityDims);
 const gain=expected.width/(2*s.pose.scale)*s.dims[0]/expected.materialCells;
 assert.ok(Math.abs(s.calibration.cellGain-gain)<1e-10);
 return true;
}
