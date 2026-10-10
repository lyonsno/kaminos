import test from 'node:test';
import assert from 'node:assert/strict';
import * as evidence from '../tools/fluid-discriminator-evidence.mjs';
test('diagnosis rejects wrong backend, effective dynamics, partial states and nonfinite raw bits',()=>{
  assert.equal(typeof evidence.validateDiscriminatorState,'function');
  const request={arm:'reduced',particleCount:1,volume:.1,radius:.125,surfaceRadius:.11,gamma:.19,step:1};
  const actual={adapter:{vendor:'apple',isFallbackAdapter:false},dynamics:{effective:'pressure_surface',neighborSmoothing:false,vorticityConfinement:false,speedClipping:false,population:{particleCount:1,particleVolume:.1}},pressure:{radius:.125},surface:{neighborhoodRadius:.11,coefficient:.19},step:1,words:Array.from(new Uint32Array(new Float32Array([0,0,0,1,0,0,0,1,0,0,0,.3,0,0,0,1]).buffer))};
  assert.doesNotThrow(()=>evidence.validateDiscriminatorState(actual,request));
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,adapter:{vendor:'apple'}},request),/backend/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,dynamics:{...actual.dynamics,effective:'assembled'}},request),/dynamics/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,step:0},request),/step/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,words:actual.words.slice(16)},request),/complete/);
  const bad=actual.words.slice();bad[0]=0x7fc00000;
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,words:bad},request),/finite/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,surface:{...actual.surface,coefficient:0}},request),/configuration/);
});
