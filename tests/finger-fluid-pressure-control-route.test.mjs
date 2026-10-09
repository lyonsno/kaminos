import test from 'node:test';
import assert from 'node:assert/strict';
import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';

test('live pressure support and damping read the optional uniform rather than compile-time constants',()=>{
  const shader=createIPBFGridShader({radius:.185,volume:.000166,dynamicControls:true});
  assert.match(shader,/@group\(1\) @binding\(1\) var<uniform> ipbfControls/,'live parameter binding absent');
  assert.doesNotMatch(shader,/const ipbfRadius/);
  assert.match(shader,/ipbf_kernel\([^\n]+ipbfControls\.radius\)/);
  assert.match(shader,/ipbf_damp\([^\n]+ipbfControls\.radius,ipbfControls\.beta\)/);
});

test('live pressure controls reject unsupported method and invalid flag before GPU admission',async()=>{
  await assert.rejects(createWebGPUFingerFluidSolver({pressureSolver:'pbf',livePressureControls:true}),/Live pressure controls require IPBF/);
  await assert.rejects(createWebGPUFingerFluidSolver({pressureSolver:'ipbf',livePressureControls:'yes'}),/Live pressure controls must be boolean/);
});
