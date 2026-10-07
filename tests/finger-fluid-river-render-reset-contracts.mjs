import assert from 'node:assert/strict';
import {solverSpy} from './helpers/finger-fluid-solver-spy.mjs';
for(const particleCount of [36864,24576]) {
 const run=await solverSpy({particleCount,truthScene:'river_playground',fixedVolumeReferenceParticleCount:36864,artificialPressureMode:'off'});
 try {
  const w=run.initialWrites.find(w=>w.buffer==='kaminos-finger-fluid-material-tracers');
  const tracers=new Float32Array(Uint8Array.from(w.bytes).buffer);
  const shader=run.modules.find(m=>m.label==='kaminos-finger-fluid-screen-space-surface-wgsl-v0')?.code ?? run.modules.find(m=>m.code.includes('fn vs_accumulate'))?.code;
  assert.ok(shader?.includes('liveInletAgeState.w > 0.5'),'actual surface interpretation remains the admitted capsule flag');
  for(let i=0;i<particleCount;i+=3)assert.ok(tracers[i*20+15]<=.5,'river scheduling must keep every ordinary particle out of the optical capsule path');
  const oldCount=particleCount-Math.ceil(particleCount/3),refOld=36864-12288;
  for(let i=0;i<particleCount;i++)if(i%3!==0) {
   const oldIndex=i-Math.floor(i/3)-1;
   const expected=Math.floor(oldIndex*refOld/oldCount);
   assert.equal(tracers[i*20+12],expected,'source reset must preserve the original reference identity');
  }
  if(particleCount===36864)assert.deepEqual([7,8,10,11].map(i=>tracers[i*20+12]),[4,5,6,7]);
 } finally{run.close()}
}
console.log('River factory upload: ordinary optical weight and original source/reset identities passed at both fixed-volume counts');
