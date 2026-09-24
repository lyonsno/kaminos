import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

const shaderSource = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lambda = shaderSource.match(/fn compute_density_lambda[\s\S]*?(?=@compute @workgroup_size\([^\n]+\)\nfn solve_position_delta)/)?.[0] ?? '';
const delta = shaderSource.match(/fn solve_position_delta[\s\S]*?(?=@compute @workgroup_size\([^\n]+\)\nfn apply_position_delta)/)?.[0] ?? '';

assert.match(shaderSource, /uniformVolumeDensityKernel = false/, 'direct API keeps specialization separately opt-in');
assert.match(shaderSource, /uniformVolumeDensityKernel !== 'boolean'/, 'direct API rejects truthy nonboolean requests');
assert.match(shaderSource, /const safeUniformVolumeDensityKernel = uniformVolumeDensityKernel === true && !safeAdaptiveDensity;/, 'adaptive particles bypass a uniform-volume specialization');
assert.match(shaderSource, /densityControl: vec4<f32>/, 'uniform density constants have an explicit GPU parameter block');
assert.match(shaderSource, /const buffer = new ArrayBuffer\(224\)/, 'CPU upload matches the extended WGSL parameter layout');
assert.match(shaderSource, /view\.setFloat32\(208, safeUniformParticleVolumeScale, true\)/, 'the active uniform volume scale reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(212, safeUniformParticleRadiusScale, true\)/, 'the shared support radius scale reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(216, safeUniformVolumeKernelNormalization, true\)/, 'the shared kernel normalization reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(220, safeUniformVolumeDensityKernel \? 1 : 0, true\)/, 'the effective specialization switch reaches the shader');
assert.match(shaderSource, /fn density_pair_kernel_weight\(index: u32, neighborIndex: u32, distance: f32\)/, 'density has a specialized weight path');
assert.match(shaderSource, /fn density_pair_kernel_gradient\(index: u32, neighborIndex: u32, offset: vec3<f32>\)/, 'density has a specialized gradient path');
assert.match(lambda, /density_pair_kernel_weight\(index, neighborIndex, distance\)[\s\S]*density_pair_kernel_gradient\(index, neighborIndex, offset\)/, 'lambda uses the specialized helpers');
assert.match(delta, /density_pair_kernel_weight\(index, index,[\s\S]*density_pair_kernel_gradient\(index, neighborIndex, offset\)/, 'position correction and tensile reference use the specialized helpers');
assert.ok(!/density_pair_kernel_(?:weight|gradient)/.test(shaderSource.match(/fn compute_velocity_vorticity[\s\S]*?(?=@compute)/)?.[0] ?? ''), 'the specialization is scoped to density projection');
assert.ok(browserSource.includes("params.get('finger_fluid_uniform_volume_density_kernel')"), 'the browser URL has an independent comparison switch');
assert.ok(browserSource.includes('uniformVolumeDensityKernel: fingerFluidBenchConfig.effectiveUniformVolumeDensityKernel'), 'the browser forwards the effective switch');
assert.ok(browserSource.includes('effectiveUniformVolumeDensityKernel: requestedUniformVolumeDensityKernel && !requestedAdaptiveDensity'), 'the browser reports adaptive bypass truthfully');

await assert.rejects(
  createWebGPUFingerFluidSolver({ uniformVolumeDensityKernel: 1 }),
  /uniform volume density kernel must be a boolean/,
  'the solver rejects a silently coerced API value',
);
console.log('Finger Fluid uniform-volume density kernel contracts passed');
