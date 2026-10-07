import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';

test('a shorter IPBF support radius preserves represented particle volume',()=>{
  assert.equal(typeof core.resolveFingerFluidIPBFSampling,'function','independent pressure sampling is absent');
  const physical={kernelRadius:.185,restDensity:24.3,particleRadiusScale:1,particleVolumeScale:1};
  const original=core.resolveFingerFluidIPBFSampling(physical);
  const shorter=core.resolveFingerFluidIPBFSampling({...physical,pressureRadiusScale:.1155/.185});
  assert.equal(original.radius,.185);
  assert.ok(Math.abs(shorter.radius-.1155)<1e-15);
  assert.equal(shorter.particleVolume,original.particleVolume);
  assert.ok(Math.abs(original.particleVolume-.055**3)/(.055**3)<.001);
});

test('fixed-volume population scaling and pressure sampling remain independent',()=>{
  assert.equal(typeof core.resolveFingerFluidIPBFSampling,'function','independent pressure sampling is absent');
  const base={kernelRadius:.185,restDensity:24.3,particleRadiusScale:1,particleVolumeScale:1};
  const original=core.resolveFingerFluidIPBFSampling(base);
  const twice=core.resolveFingerFluidIPBFSampling({...base,particleRadiusScale:Math.cbrt(2),particleVolumeScale:2,pressureRadiusScale:.1155/.185});
  assert.equal(twice.particleVolume*12288,original.particleVolume*24576);
  assert.ok(Math.abs(twice.radius-.1155*Math.cbrt(2))<1e-15);
});

test('invalid sampling and custom IPBF sampling under PBF fail before GPU admission',async()=>{
  for(const scale of [0,-1,NaN,Infinity,'0.6']) {
    await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'ipbf',ipbfPressureRadiusScale:scale}),/IPBF pressure radius scale/);
  }
  await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'pbf',ipbfPressureRadiusScale:.6}),/requires IPBF pressure/);
});
