import test from 'node:test';
import assert from 'node:assert/strict';
import * as page from '../fluid-box-reference-view.mjs';
import {createFingerFluidBoxReference} from '../finger-fluid-discriminator.mjs';

test('pressure support stays at the requested world distance when resolution changes',()=>{
  for(const resolution of [16,32]){
    const c=page.boxReferenceConfiguration({resolution,pressureRadius:.1});
    const actual=c.solver.ipbfPressureRadiusScale*.185*Math.cbrt(c.fixture.population.particleVolumeScale);
    assert.ok(Math.abs(actual-.1)<1e-12,'Resolution silently changed the requested world radius');
    assert.equal(c.fixture.pressureRadius,.1);
    assert.equal(c.solver.ipbfDampingBeta,.0113);
  }
});
test('box fixture preserves independent radius and rejects invalid world coordinates',()=>{
  const a=createFingerFluidBoxReference({resolution:16,pressureRadius:.07});
  const b=createFingerFluidBoxReference({resolution:32,pressureRadius:.07});
  assert.equal(a.pressureRadius,b.pressureRadius);
  assert.equal(a.pressureRadius,.07);
  assert.equal(a.representedVolume,b.representedVolume);
  assert.equal(a.surfaceRadius,2*b.surfaceRadius);
  for(const pressureRadius of [0,-1,NaN,Infinity])assert.throws(()=>createFingerFluidBoxReference({pressureRadius}),/radius/i);
});
test('legacy radius URL converts once and explicit world radius wins',()=>{
  assert.equal(typeof page.boxReferenceControlsFromQuery,'function','Missing explicit legacy-to-world query migration');
  const legacy=page.boxReferenceControlsFromQuery(new URLSearchParams('resolution=32&ratio=1.3'));
  assert.equal(legacy.pressureRadius,1.3/32);
  assert.equal(legacy.radiusSource,'legacy_ratio_converted');
  const world=page.boxReferenceControlsFromQuery(new URLSearchParams('resolution=32&ratio=1.3&radius=.1'));
  assert.equal(world.pressureRadius,.1);
  assert.equal(world.radiusSource,'world');
  const a=page.boxReferenceControlsFromQuery(new URLSearchParams('resolution=24'));
  const b=page.boxReferenceControlsFromQuery(new URLSearchParams('resolution=32'));
  assert.equal(a.pressureRadius,b.pressureRadius);
});
test('live patch uses the world radius without changing beta or sample volume',()=>{
  assert.equal(typeof page.boxReferencePressurePatch,'function','Missing shared world-to-solver control conversion');
  const settings={pressureRadius:.095,passes:3,gamma:.19,beta:.0113};
  for(const resolution of [16,32]){
    const fixture=createFingerFluidBoxReference({resolution});
    const p=page.boxReferencePressurePatch(settings,fixture);
    assert.ok(Math.abs(p.pressureRadiusScale*.185*Math.cbrt(fixture.population.particleVolumeScale)-.095)<1e-12);
    assert.equal(p.beta,.0113);assert.equal(p.densityIterations,3);
    assert.equal(p.capillaryStrength,.19);
  }
});
test('frame pump waits for GPU completion before scheduling the next submission',async()=>{
  assert.equal(typeof page.createBoxFramePump,'function','Interactive frame completion gate is absent');
  const scheduled=[];let submitted=0,finish;
  const pump=page.createBoxFramePump({submit:()=>submitted++,completed:()=>new Promise(r=>{finish=r;}),schedule:f=>scheduled.push(f),onError:e=>{throw e;}});
  pump.start();assert.equal(scheduled.length,1);
  const pending=scheduled.shift()();
  assert.equal(submitted,1);assert.equal(scheduled.length,0);
  pump.start();assert.equal(scheduled.length,0,'Repeated start bypassed outstanding GPU work');
  finish();await pending;assert.equal(scheduled.length,1);
  pump.stop();await scheduled.shift()();assert.equal(submitted,1);
});
test('failed GPU completion stops the frame pump and surfaces the failure',async()=>{
  assert.equal(typeof page.createBoxFramePump,'function','Interactive frame completion gate is absent');
  const scheduled=[],errors=[];
  const pump=page.createBoxFramePump({submit:()=>{},completed:async()=>{throw Error('Device lost during completion');},schedule:f=>scheduled.push(f),onError:e=>errors.push(e.message)});
  pump.start();await scheduled.shift()();
  assert.deepEqual(errors,['Device lost during completion']);assert.equal(scheduled.length,0);
});
