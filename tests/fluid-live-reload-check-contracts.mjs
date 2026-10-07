import assert from 'node:assert/strict';
import {checkLiveFluidState,checkLiveFluidProgress} from '../tools/fluid-live-reload-check.mjs';
const q={particleCount:36864,truthScene:'river_playground',artificialPressureMode:'off'};
const s={status:'running',runtime:{solver_backend:'webgpu_compute',particleCount:36864,truthScene:'river_playground',artificialPressureMode:'off',densityIterationsPerStep:3,fixedVolumeReferenceParticleCount:36864,particleVolumeScale:1,packedDensity:true,uniformVolumeDensityKernel:true,densityCellRejection:true,adaptiveDensity:false,effectiveRendererMode:'screen_space_refraction',energyDiagnostics:{effectiveMode:'disabled'},stepCount:30}};
checkLiveFluidState(s,q);
for(const [key,value] of Object.entries({solver_backend:'fallback',particleCount:24576,truthScene:'multi_regime_playground',artificialPressureMode:'standard',densityIterationsPerStep:1,fixedVolumeReferenceParticleCount:24576,packedDensity:false,effectiveRendererMode:'particles'})) {
  assert.throws(()=>checkLiveFluidState({...s,runtime:{...s.runtime,[key]:value}},q),undefined,'reject wrong effective '+key);
}
assert.throws(()=>checkLiveFluidProgress(s,s,q),/advance/,'cached/frozen snapshot is not motion evidence');
assert.throws(()=>checkLiveFluidState({status:'running'},q));
assert.throws(()=>checkLiveFluidState({...s,status:'error'},q));
checkLiveFluidProgress(s,{...s,runtime:{...s.runtime,stepCount:31}},q);
console.log('Live reload: wrong routes/configs, partial state, frozen output and native progression contracts passed');
