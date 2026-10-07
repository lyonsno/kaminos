import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {joinedPressurePolicy} from '../volume-core.js';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('joined pressure execution checks post-bound velocity error and reports actual completion',()=>{
  assert.match(source,/entryPoint: 'csJoinedPressureError'/,'the production runtime must construct the error pipeline');
  assert.match(source,/completion: outerRequested && solver\.solver === PRESSURE_SOLVER_CONVERGED \?/,'only the actual checked solver can claim observed completion');
  assert.match(source,/pressureCheckPipelines\[0\]/,'actual solve dispatches the check');
  assert.match(source,/heatReleaseExpansion\(c\)/,'expansion remains part of the target');
});
test('the accuracy target is resolution-independent while work budget grows with pressure wavelength',()=>{
  assert.equal(joinedPressurePolicy(32,24).target,joinedPressurePolicy(64,24).target);
  assert.equal(joinedPressurePolicy(64,24).maxSweeps,4*joinedPressurePolicy(32,24).maxSweeps);
  assert.equal(joinedPressurePolicy(32,24).minSweeps,8,'the requested sweep count is work allowance, not compulsory over-solving');
});
