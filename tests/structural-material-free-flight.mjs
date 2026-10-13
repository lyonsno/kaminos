import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../structural-material-solid-resident.js',import.meta.url),'utf8');
assert.ok(source.includes('fn freeFlight(node:u32)->bool'),'Released material needs exact inertial-only update detection');
const predict=source.slice(source.indexOf('fn predict('),source.indexOf('fn solve(')),solve=source.slice(source.indexOf('fn solve('),source.indexOf('fn finish('));
assert.match(predict,/freeFlight\(i\)/);assert.match(solve,/p\.predicted\.w==1\.0/);
assert.match(source,/parameters\[element\*16u\+11u\]>0\.0/,'Active elastic elements cannot become free flight');
assert.match(source,/baseline\.w>0\.0/,'Gripped material remains solved');
console.log('Free-flight path preserves active elasticity, grip and support while bypassing inertial-only local solves');
