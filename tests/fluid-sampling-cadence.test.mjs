import assert from 'node:assert/strict';
import {createFixedStepPlayback} from '../finger-fluid-box-clock.mjs';
import {createFingerFluidBoxReference} from '../finger-fluid-box-fixtures.mjs';
const clock=createFixedStepPlayback({dt:1/240,mode:'render_cadence'});
assert.equal(clock.advance(0).steps,0);
assert.equal(clock.advance(10000).steps,1,'drawn-frame mode must not accrue wall-time catch-up');
assert.equal(clock.advance(10001).dt,1/240);
clock.setRate(.25);clock.reset();clock.advance(0);
assert.deepEqual([1,2,3,4].map(n=>clock.advance(n*10000).steps),[0,0,0,1]);
clock.setMode('wall_time');clock.advance(50000);assert.equal(clock.advance(50100).steps,6);
clock.setMode('render_cadence');clock.advance(60000,{paused:true});assert.equal(clock.advance(70000).steps,0);assert.equal(clock.advance(80000).steps,0); // .25 credit, not elapsed seconds
assert.throws(()=>clock.setMode('imaginary'),/mode/);
const whole=createFingerFluidBoxReference({resolution:24}),small=createFingerFluidBoxReference({resolution:24,blockWidth:.5});
assert.equal(small.particleCount,1728);assert.equal(small.spacing,whole.spacing);assert.equal(small.box.collisionRadius,whole.box.collisionRadius);assert.equal(small.population.particleVolumeScale,whole.population.particleVolumeScale);assert.ok(Math.abs(small.representedVolume-.125)<1e-12);
assert.ok(Math.abs(createFingerFluidBoxReference({scene:'block_flop',resolution:24,blockWidth:.5}).representedVolume-.5)<1e-12);
assert.throws(()=>createFingerFluidBoxReference({resolution:24,blockWidth:.51}),/whole number/);
console.log('Drawn-frame clock and independent amount preserve fixed physics/local sampling');
const {describeLazarusFiniteSetup,lazarusFiniteSetup,updateLazarusFiniteControls,lazarusFiniteReplayURL}=await import('../experiments/lazarus-fluid/contributions.mjs');
const {initialSupportSlice}=await import('../fluid-sampling-preview.mjs');
const preview=describeLazarusFiniteSetup({resolution:128,scaling:'legacy'});
assert.equal(preview.sampling.particleCount,128**3);assert.equal(preview.fixture.population,undefined,'draft must not allocate particle population');
assert.equal(JSON.parse(new URL(lazarusFiniteReplayURL('http://localhost',preview.inputs)).searchParams.get('experiment_inputs')).resolution,128);
const setup=lazarusFiniteSetup({resolution:24,blockWidth:.5});
const edited=updateLazarusFiniteControls(setup,{rate:2,playbackMode:'render_cadence',capillaryStrength:.4});
assert.equal(edited.solver.diagnosticPopulation,setup.solver.diagnosticPopulation,'live scalar edits must retain actual population allocation');assert.equal(edited.sampling,setup.sampling);
assert.throws(()=>updateLazarusFiniteControls(setup,{resolution:32}),/reset/);
const p=describeLazarusFiniteSetup().sampling,slice=initialSupportSlice(p);
assert.equal(slice.weight(...slice.center),1);assert.equal(slice.weight(slice.center[0]+4,slice.center[1]),0);assert.ok(slice.neighbors>100);
assert.ok(initialSupportSlice(p,[0,0]).neighbors<slice.neighbors);assert.throws(()=>initialSupportSlice(p,[-1,0]),/outside/);
// Independent count directly over the complete committed cube, no local-radius bound.
let expected=0;for(let z=0;z<24;z++)for(let y=0;y<24;y++)for(let x=0;x<24;x++){
 const ds=((x-slice.center[0])**2+(y-slice.center[1])**2+(z-slice.z)**2)*p.spacing**2;if(ds>0&&ds<p.supportRadius**2)expected++;
}assert.equal(slice.neighbors,expected);
console.log('Allocation-free proposed counts, live scalar population identity and exact initial support counts pass');
assert.throws(()=>lazarusFiniteSetup({resolution:32,blockWidth:.25}),/at least 1024/,'existing backend minimum must be rejected before replacement');
