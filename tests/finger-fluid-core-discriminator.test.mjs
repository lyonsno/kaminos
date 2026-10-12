import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';
import {createAkinciSurfaceShader} from '../finger-fluid-akinci.mjs';

test('reduced dynamics must explicitly remove smoothing and clipping while retaining boundary response',()=>{
  assert.equal(typeof core.applyFingerFluidDiagnosticDynamics,'function','reduced dynamics profile is absent');
  const source=core.createFingerFluidDiagnosticShaderFixture();
  const reduced=core.applyFingerFluidDiagnosticDynamics(source,'pressure_surface');
  assert.doesNotMatch(reduced,/velocity = mix\(velocity, neighborVelocity/);
  assert.match(reduced,/resolveSupportVelocity/);
  assert.match(reduced,/supportTangentialRetention/);
  assert.match(reduced,/false && relaxedSpeed > solverMaximumSpeed/);
  assert.equal(core.applyFingerFluidDiagnosticDynamics(source,'assembled'),source);
  assert.throws(()=>core.applyFingerFluidDiagnosticDynamics(source,'other'),/dynamics profile/);
  assert.throws(()=>core.applyFingerFluidDiagnosticDynamics('', 'pressure_surface'),/anchor/);
});

test('finite-pour refinement preserves water, momentum and cell centroids without recycling',()=>{
  assert.equal(typeof core.createFingerFluidDiscriminatorPopulation,'function','controlled finite-pour population is absent');
  const a=core.createFingerFluidDiscriminatorPopulation({fixture:'basin',refinement:1});
  const b=core.createFingerFluidDiscriminatorPopulation({fixture:'basin',refinement:2});
  assert.equal(a.particleCount,12288);assert.equal(b.particleCount,a.particleCount*8);
  assert.equal(a.particleCount*a.particleVolumeScale,b.particleCount*b.particleVolumeScale);
  for(let i=0;i<a.particleCount;i++){
    for(let k=0;k<3;k++){
      let center=0;for(let j=0;j<8;j++){center+=b.particleData[(8*i+j)*16+k]/8;assert.equal(b.particleData[(8*i+j)*16+8+k],a.particleData[i*16+8+k]);}
      assert.ok(Math.abs(center-a.particleData[i*16+k])<2e-7);
    }
    assert.ok(a.particleData[i*16+11]>=.15,'source would recycle');
  }
  assert.throws(()=>core.validateFingerFluidDiagnosticPopulation({...a,particleData:a.particleData.slice(16)},12288),/length/);
  const invalid=a.particleData.slice();invalid[0]=NaN;
  assert.throws(()=>core.validateFingerFluidDiagnosticPopulation({...a,particleData:invalid},12288),/finite/);
});

test('refinement may preserve the physical surface support instead of silently changing its material law',()=>{
  const h=.10998650381240725;
  assert.match(createAkinciSurfaceShader({volume:.00016631376856205766/8,supportRadius:h}),new RegExp('surfaceRadius: f32 = '+h));
  assert.throws(()=>createAkinciSurfaceShader({volume:.01,supportRadius:0}),/support radius/i);
});
