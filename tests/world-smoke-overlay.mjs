// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as optics from '../volume-world-smoke-optics.mjs';
test('overlay reports effective world-space geometry and independent cell pitches',()=>{
  assert.equal(typeof optics.worldSmokeOverlayGeometry,'function','effective geometry must be exposed, not inferred from requested settings');
  const g=optics.worldSmokeOverlayGeometry({effective:'one-way-world-field',min:[-3,-3,-3],max:[3,9,3],anchor:{translate:[10,20,30],scale:2},flowDims:[16,32,16],materialDims:[32,64,32],fineDims:[32,64,32],fineTransform:{translate:[10,20,30],scale:2}});
  assert.deepEqual(g.worldMin,[4,14,24]);assert.deepEqual(g.worldMax,[16,38,36]);
  assert.deepEqual(g.fineMin,[8,18,28]);assert.deepEqual(g.fineMax,[12,26,32]);
  assert.equal(g.finePitch,.125);assert.equal(g.materialPitch,.375);assert.equal(g.flowPitch,.75);assert.equal(g.volumeRatio,27);
  assert.equal(optics.worldSmokeOverlayGeometry({effective:'off'}),null);
  assert.equal(optics.worldSmokeOverlayGeometry({effective:'one-way-world-field'}),null);
});
