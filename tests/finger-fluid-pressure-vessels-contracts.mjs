import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';
assert.equal(core.resolveFingerFluidTruthScene('pressure_playground'),'pressure_playground','pressure scene must have explicit admission');
const {PRESSURE_STATIONS,pressureSolidFrame,pressureResolve,createPressureParticles,PRESSURE_BOXES,PRESSURE_GATE_STEP}=await import('../finger-fluid-pressure-vessels.mjs');
assert.equal(PRESSURE_STATIONS.length,3);
for(const station of PRESSURE_STATIONS){
 const mouth=[station.x,-.30,-.85];
 assert.ok(pressureSolidFrame(mouth,true).distance<0,'closed gate is a physical obstruction');
 assert.ok(pressureSolidFrame(mouth,false).distance>.09,'open outlet has an actual fluid passage');
 const rim=[station.x+station.width+.08,-.30,-.85];
 assert.ok(pressureSolidFrame(rim,false).distance<0,'opening does not remove surrounding wall');
 const stopped=pressureResolve(mouth,.0407,true);
 assert.ok(pressureSolidFrame(stopped,true).distance>=.0406,'gate penetration projects out of all solids');
}
assert.ok(PRESSURE_STATIONS[1].width<PRESSURE_STATIONS[0].width);
assert.ok(PRESSURE_STATIONS[2].exitWidth<PRESSURE_STATIONS[2].width,'funnel converges');
for(const box of PRESSURE_BOXES)for(const axis of box.axes)assert.ok(Math.abs(Math.hypot(...axis)-1)<1e-12);
for(const count of [36864,24576]){
 const p=createPressureParticles(count,36864),counts=[0,0,0];
 for(let i=0;i<count;i++){
  const o=i*16,phase=p[o+11],station=phase<.3?0:phase<.7?1:2;counts[station]++;
  assert.deepEqual([...p.slice(o+8,o+11)],[0,0,0],'jet must emerge from solve, not prescribed source velocity');
  assert.ok(pressureSolidFrame([...p.slice(o,o+3)],true).distance>.0406,'initial water is inside the vessel void');
 }
 assert.equal(counts[0],counts[1]);assert.equal(counts[1],counts[2]);
 const pop=core.createFingerFluidTruthScenePopulation(count,'pressure_playground',{referenceParticleCount:36864});
 assert.equal(pop.representedVolume,core.createFingerFluidTruthScenePopulation(36864,'pressure_playground').representedVolume);
}
assert.equal(PRESSURE_GATE_STEP,90);
console.log('Pressure vessels: physical gate/aperture, converging funnel, collision projection and equal resting inventory passed');
