import test from 'node:test';
import assert from 'node:assert/strict';
import * as evidence from '../tools/fluid-discriminator-evidence.mjs';
import {captureFingerFluidParticleWordsForWitness} from '../finger-fluid-webgpu-core.js';
const request={arm:'reduced',particleCount:1,volume:.1,radius:.125,surfaceRadius:.11,gamma:.19,step:1,dt:1/60};
function fixture(){
  const particleSnapshot=captureFingerFluidParticleWordsForWitness(new Float32Array([0,0,0,1,0,0,0,1,0,0,0,.3,0,0,0,1]),1,{stepCount:1,pressureSolver:'ipbf',boundaryPressureContract:'ipbf-collision-projection-only-v0'});
  const simulation=new Float32Array(56);simulation[0]=1/60;simulation[29]=.19;new Uint32Array(simulation.buffer)[1]=1;
  return {adapter:{vendor:'apple',isFallbackAdapter:false},dynamics:{effective:'pressure_surface',neighborSmoothing:false,vorticityConfinement:false,speedClipping:false,population:{particleCount:1,particleVolume:.1}},pressure:{radius:.125},surface:{neighborhoodRadius:.11,coefficient:.19},step:1,particleSnapshot:{...particleSnapshot,words:undefined},words:particleSnapshot.words,diagnostics:{stepCount:1,readbackMode:'explicit_full_particle_gpu_diagnostics_v1',pressureControlInputs:{packing:'ipbf_vec4f_and_finger_fluid_params_v0_u32_bits',pressureWords:Array.from(new Uint32Array(new Float32Array([.125,.0113,0,0]).buffer)),simulationWords:Array.from(new Uint32Array(simulation.buffer))}}};
}
test('diagnosis rejects wrong backend, effective dynamics, partial states and nonfinite raw bits',()=>{
  assert.equal(typeof evidence.validateDiscriminatorState,'function');
  const actual=fixture();
  assert.doesNotThrow(()=>evidence.validateDiscriminatorState(actual,request));
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,adapter:{vendor:'apple'}},request),/backend/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,dynamics:{...actual.dynamics,effective:'assembled'}},request),/dynamics/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,step:0},request),/step/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,words:actual.words.slice(16)},request),/complete/);
  const bad=actual.words.slice();bad[0]=0x7fc00000;
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,words:bad},request),/finite/);
  assert.throws(()=>evidence.validateDiscriminatorState({...actual,surface:{...actual.surface,coefficient:0}},request),/configuration/);
});
test('raw snapshot and diagnostics must name the requested epoch and IPBF collision-only route',()=>{
  const a=fixture();assert.doesNotThrow(()=>evidence.validateDiscriminatorState(a,request));
  assert.throws(()=>evidence.validateDiscriminatorState({...a,particleSnapshot:{...a.particleSnapshot,stepCount:0}},request),/readback/);
  assert.throws(()=>evidence.validateDiscriminatorState({...a,diagnostics:{...a.diagnostics,stepCount:0}},request),/readback/);
  for(const [key,value] of [['schema',undefined],['packing','other'],['particleCount',2],['recordWords',8],['pressureSolver','pbf'],['boundaryPressureContract','ipbf-cubic-tangent-plane-density-v1']])assert.throws(()=>evidence.validateDiscriminatorState({...a,particleSnapshot:{...a.particleSnapshot,[key]:value}},request),/readback/);
  assert.throws(()=>evidence.validateDiscriminatorState({...a,diagnostics:{...a.diagnostics,readbackMode:'explicit_sparse_gpu_diagnostics_v0'}},request),/readback/);
});
test('elapsed simulation time requires the effective GPU timestep rather than the invocation alone',()=>{
  const a=fixture();a.diagnostics.pressureControlInputs.simulationWords[0]=new Uint32Array(new Float32Array([1/120]).buffer)[0];
  assert.throws(()=>evidence.validateDiscriminatorState(a,request),/timestep/);
});
