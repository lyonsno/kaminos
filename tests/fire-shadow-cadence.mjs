// kaminos-test: node
import assert from 'node:assert/strict';
import * as shadows from '../fire-light-field-shadow.mjs';
assert.equal(typeof shadows.createShadowCaptureSchedule,'function','solid shadow captures need an independent transactional refresh schedule');
const schedule=shadows.createShadowCaptureSchedule({count:6,budget:2});
const advance=key=>{const plan=schedule.begin(key);return schedule.commit(plan,{generation:1,frame:plan.ordinal});};
let frame=advance('scene-a');
assert.deepEqual(frame.refreshedIndices,[0,1,2,3,4,5]);
assert.equal(frame.reason,'initialize');assert.equal(frame.residentCount,6);
for(const expected of [[0,1],[2,3],[4,5],[0,1]]){
 frame=advance('scene-a');assert.deepEqual(frame.refreshedIndices,expected);
 assert.equal(frame.refreshedCount,2);assert.equal(frame.residentCount,6);assert.ok(frame.oldestAge<=2);
}
const abandoned=schedule.begin('scene-a'),before=schedule.read();
const retry=schedule.begin('scene-a');assert.deepEqual(retry.indices,abandoned.indices);
assert.throws(()=>schedule.commit(abandoned),/expired/,'abandoned/foreign plans must not advance freshness');
assert.deepEqual(schedule.read(),before,'planning without a completed capture must preserve freshness');
schedule.commit(retry,{generation:2,frame:20});
frame=advance('scene-b');assert.equal(frame.reason,'invalidate');assert.deepEqual(frame.ages,[0,0,0,0,0,0]);
assert.equal(frame.refreshedCount,6,'a changed source layout or resource cannot inherit old cubes');
for(const bad of [-1,1.5,NaN])assert.throws(()=>schedule.setBudget(bad),/nonnegative integer/);
schedule.setBudget(0);assert.equal(advance('scene-b').refreshedCount,6,'zero is the unchanged full-refresh baseline');
schedule.setBudget(100);frame=advance('scene-b');assert.equal(frame.requestedBudget,100);assert.equal(frame.effectiveBudget,6);
const other=shadows.createShadowCaptureSchedule({count:6,budget:1});
assert.throws(()=>schedule.commit(other.begin('x')),/expired/);
console.log('PASS solid cube refresh fairness, age, invalidation and failed-plan retention');
