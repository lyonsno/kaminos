import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=await import('../structural-material-stress-release.mjs');
assert.ok(api.planComponentCut,'A stress plane must establish compatible released components before GPU mutation');
const failed=JSON.parse(fs.readFileSync(process.argv[2])).failureState.events.at(-1),bad=api.planComponentCut(failed.rest,failed.before,failed.targetNodes,failed.normal,failed.offset);
assert.equal(bad.admitted,false,'Observed orphan-producing plane cannot be admitted as a two-piece cut');assert.match(bad.reason,/component/i);
const report=JSON.parse(fs.readFileSync(process.argv[3])),good=report.observations.find(o=>o.name==='first-injury').effective.events[0],plan=api.planComponentCut(good.rest,good.before,good.targetNodes,good.normal,good.offset);assert.equal(plan.admitted,true);assert.deepEqual(plan.after,good.after);
console.log('Observed orphan cut refuses before mutation; observed compatible native release agrees exactly');
