import assert from 'node:assert/strict';
import * as m from '../volume-outer-smoke.mjs';
assert.equal(typeof m.outerSmokeOverlapWidth,'function','handoff does not span the coarse reconstruction footprint');
const c=m.outerSmokeConfig({grid:32,extent:4});
assert.equal(m.outerSmokeOverlapWidth(c),2*c.cellWidth);
assert.ok(m.outerBlend([0,.625,0],m.outerSmokeOverlapWidth(c),1)>0,'Cube transition begins before the last coarse cell');
assert.equal(m.outerBlend([0,0,0],m.outerSmokeOverlapWidth(c),1),0,'fine center remains authoritative');
assert.equal(m.outerBlend([0,1,0],m.outerSmokeOverlapWidth(c),1),1,'coarse field owns the exterior');
console.log('handoff covers coarse reconstruction footprint passed');
