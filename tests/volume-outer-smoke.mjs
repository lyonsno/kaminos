import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const moduleUrl = new URL('../volume-outer-smoke.mjs', import.meta.url);
assert.ok(existsSync(moduleUrl), 'surrounding smoke transport is absent: no outer-domain implementation');
const { outerSmokeConfig, outerCellCenter, nearCellRange, nearVelocityToLocal, outerSmokeShader, outerBlend, outerDonorBounds, validateOuterSmokeDevice } = await import(moduleUrl);
const c = outerSmokeConfig({grid:32, extent:4, pressureIterations:24});
assert.deepEqual(c.shape, [32,64,32]);
assert.deepEqual(c.min, [-4,-4,-4]);
assert.deepEqual(c.max, [4,12,4]);
assert.equal(c.cellWidth, .25);
assert.deepEqual(outerDonorBounds(c),{min:[-.75,-.75,-.75],max:[.75,2.75,.75]});
assert.equal(typeof validateOuterSmokeDevice,'function');
assert.throws(()=>validateOuterSmokeDevice(c,{maxTextureDimension3D:32,maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535}),/texture/);
assert.deepEqual(outerCellCenter(c,[0,0,0]),[-3.875,-3.875,-3.875]);
assert.deepEqual(nearCellRange(c,[12,12,12],64),{min:[0,0,0],max:[8,8,8]});
assert.deepEqual(nearCellRange(c,[0,0,0],64),null);
assert.deepEqual(nearVelocityToLocal([2,3,4],64),[.0625,.09375,.125]);
assert.equal(outerBlend([0,0,0],.25),0);
assert.equal(outerBlend([1,0,0],.25),1);
assert.equal(outerBlend([0,3,0],.25),1);
assert.equal(outerBlend([1.1,0,0],.25),1);
assert.ok(outerBlend([.875,0,0],.25)>0 && outerBlend([.875,0,0],.25)<1);
assert.throws(()=>outerSmokeConfig({grid:0}),/grid/);
assert.throws(()=>outerSmokeConfig({extent:1}),/extent/);
assert.throws(()=>outerSmokeConfig({pressureIterations:0}),/pressure/);
const shader=outerSmokeShader(c,64);
for (const entry of ['advect','divergence','jacobi','project','publish']) {
  assert.match(shader,new RegExp(`fn ${entry}\\(`));
}
assert.match(shader,/clipCharacteristic/,'transport must not tunnel through solid geometry');
assert.match(shader,/nearFace/,'near prescribed face flux must survive the outer pressure solve');
assert.match(shader,/stepScale/,'outer evolution must use the current simulation time step');
console.log('outer smoke domain, metric transfer and kernel contracts passed');
