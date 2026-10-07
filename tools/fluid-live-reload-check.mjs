import assert from 'node:assert/strict';
export function checkLiveFluidState(state, requested) {
  assert.equal(state?.status,'running','ordinary liquid scene must run');
  assert.equal(state.runtime?.solver_backend,'webgpu_compute','native solver required');
  assert.equal(state.runtime?.particleCount,requested.particleCount,'effective particle count');
  const expected={truthScene:requested.truthScene,artificialPressureMode:requested.artificialPressureMode,densityIterationsPerStep:3,fixedVolumeReferenceParticleCount:requested.particleCount,particleVolumeScale:1,packedDensity:true,uniformVolumeDensityKernel:true,densityCellRejection:true,adaptiveDensity:false,effectiveRendererMode:'screen_space_refraction'};
  for(const [key,value] of Object.entries(expected))assert.equal(state.runtime?.[key],value,'effective '+key);
  assert.equal(state.runtime?.energyDiagnostics?.effectiveMode,'disabled');
}
export function checkLiveFluidProgress(before,after,requested) {
  checkLiveFluidState(before,requested);checkLiveFluidState(after,requested);
  assert.ok(Number.isSafeInteger(after.runtime.stepCount)&&after.runtime.stepCount>before.runtime.stepCount,'ordinary RAF must advance');
}
