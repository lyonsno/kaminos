import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';
assert.equal(core.resolveFingerFluidTruthScene('river_playground'), 'river_playground', 'river route must not fall back to old terrain');
const {sampleRiverBed, sampleRiverCenter, sampleRiverTerrain, riverSample, riverReleaseDue} = await import('../finger-fluid-river-playground.mjs');
for(let z=-2.75;z<2.75;z+=.01) {
  const grade=(sampleRiverBed(z+.005)-sampleRiverBed(z-.005))/.01;
  assert.ok(grade<=1e-10 && grade>-.11, `gentle downhill grade at ${z}: ${grade}`);
  assert.ok(Math.abs(sampleRiverTerrain(sampleRiverCenter(z),z,-2)-sampleRiverBed(z))<1e-12);
}
assert.equal(sampleRiverBed(0),sampleRiverBed(.8),'middle reach is flat');
assert.ok(sampleRiverTerrain(sampleRiverCenter(0)+1.02,0,-2)>sampleRiverBed(0)+.3,'bank contains shallow flow');
const full=core.createFingerFluidTruthScenePopulation(36864,'river_playground',{referenceParticleCount:36864});
const coarse=core.createFingerFluidTruthScenePopulation(24576,'river_playground',{referenceParticleCount:36864});
assert.equal(full.representedVolume,coarse.representedVolume);
for(const pop of [full,coarse]) {
  let river=0,flat=0;
  for(let i=0;i<pop.particleCount;i++) {
    const o=i*16;
    if(Math.abs(pop.particleData[o+11]-.18)>.0001)continue;
    river++;
    const [x,y,z]=pop.particleData.slice(o,o+3);
    const depth=y-sampleRiverBed(z);
    assert.ok(depth>.05&&depth<.24,'four-layer shallow river at reference population');
    assert.ok(Math.abs(x-sampleRiverCenter(z))<.83);
    flat+=Number(z>=0&&z<=.8);
  }
  assert.ok(Math.abs(river/pop.particleCount-1/3)<.0001);
  assert.ok(flat>river*.1,'flat reach actually has water');
}
assert.equal(riverSample(100).releaseSlot,0);
assert.equal(riverReleaseDue(11,1/60,0),true);
assert.equal(riverReleaseDue(12,1/60,0),false,'release clock must not duplicate adjacent frames');
assert.equal(riverReleaseDue(11,1/60,1),false,'different axial slots cannot release on same lane event');
assert.equal(core.resolveFingerFluidArtificialPressureMode(), 'standard');
assert.equal(core.resolveFingerFluidArtificialPressureMode('off'), 'off');
assert.throws(()=>core.resolveFingerFluidArtificialPressureMode('typo'),RangeError);
console.log('River: explicit route, slope/flat reach, banks, one-third fixed volume, release schedule and pressure-mode contracts passed');
